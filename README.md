# kolm-search

> Headless RAG search orchestration for your existing stack.
> Build production-grade search pipelines using your own databases and LLM providers.

[![npm version](https://img.shields.io/npm/v/kolm-search)](https://www.npmjs.com/package/kolm-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

`kolm-search` is an adapter-driven search and orchestration pipeline for TypeScript. It provides a headless framework for building Retrieval-Augmented Generation (RAG) and hybrid search implementations without coupling to specific infrastructure.

### Features

- **Infrastructure Agnostic:** Integrates with existing data stores (e.g., PostgreSQL, Cloudflare D1, Redis, Vectorize) and model providers (e.g., OpenAI, Workers AI, Anthropic).
- **Deterministic Pipeline:** Executes a structured lifecycle (`plan -> retrieve -> rerank -> synthesize`).
- **Hybrid Search:** Combines fulltext and vector retrieval natively using Reciprocal Rank Fusion (RRF).
- **Error Diagnostics:** Provides strict, stage-aware error propagation (`SearchError` with stage labels).
- **Type Safety & Validation:** Supports optional request and response validation at boundary layers.

## How components fit together

```text
SearchClient.search(request)
  -> cache.get            (optional short-circuit)
  -> QueryPlanner         (required)
  -> IntentClassifier     (optional)
  -> Embedder             (required for vector/hybrid)
  -> Retriever            (required)
  -> Deduplicator         (optional)
  -> Reranker             (optional)
  -> Pagination
  -> Synthesizer          (optional)
  -> cache.set            (optional)
  -> SearchResponse
```

Layering model:

```text
contracts/ -> core/ -> adapters/ -> presets/
```

- `contracts`: shared types and interfaces (ports)
- `core`: orchestration and public API (`SearchClient`)
- `adapters`: implementations of ports (in-memory, Redis, Cloudflare, generic)
- `presets`: ready-to-use wiring for common deployments

## Installation

```bash
# pnpm
pnpm add kolm-search

# npm
npm install kolm-search

# yarn
yarn add kolm-search

# bun
bun add kolm-search
```

## Quick start

### In-memory preset for local development

```ts
import { createBasicSearchClient } from 'kolm-search/presets/basic';

const client = createBasicSearchClient([
  {
    id: 'guide-1',
    title: 'Getting Started',
    content: 'Install with pnpm add kolm-search',
    tags: ['docs', 'onboarding'],
  },
  {
    id: 'guide-2',
    title: 'Architecture',
    content: 'Query planner, retriever, reranker, and synthesizer stages',
    tags: ['docs', 'architecture'],
  },
]);

const response = await client.search({
  query: 'how does the retriever stage work',
  mode: 'fulltext',
  limit: 5,
});

console.log(response.results.map((r) => r.title));
```

## Enterprise hybrid search (Postgres + pgvector + OpenAI)

### Prerequisites

- PostgreSQL document storage
- `tsvector` column for keyword retrieval
- `pgvector` extension for semantic embeddings
- (Optional) LLM provider for synthesis

```ts
import { createPostgresSearchClient } from 'kolm-search/presets/postgres';
import {
  createFulltextRetriever,
  createVectorRetriever,
} from 'kolm-search/adapters/generic';

type ArticleRow = {
  id: string;
  title: string;
  content: string;
  source: string;
  rank?: number;
  similarity?: number;
};

const fulltextRetriever = createFulltextRetriever<ArticleRow>({
  async search(query, limit, context) {
    const tenantId = String(context.request.filters?.tenantId ?? 'public');
    return db.query<ArticleRow>(
      `
      SELECT id, title, content, source,
             ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
      FROM docs
      WHERE tenant_id = $2
        AND search_vector @@ plainto_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT $3
      `,
      [query, tenantId, limit],
    );
  },
  toDocument: (row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    score: row.rank,
  }),
  primaryQueryBoost: 2,
});

const vectorRetriever = createVectorRetriever<ArticleRow>({
  async search(embeddings, limit, context) {
    const tenantId = String(context.request.filters?.tenantId ?? 'public');
    return db.query<ArticleRow>(
      `
      SELECT id, title, content, source,
             1 - (embedding <=> $1::vector) AS similarity
      FROM docs
      WHERE tenant_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
      `,
      [`[${embeddings.join(',')}]`, tenantId, limit],
    );
  },
  toDocument: (row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    score: row.similarity,
  }),
});

const client = createPostgresSearchClient({
  fulltextRetriever,
  vectorRetriever,
  embedder: {
    async embed(input) {
      const res = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input,
      });
      return res.data[0]?.embedding ?? [];
    },
  },
  synthesizer: {
    async synthesize(context) {
      const citations = context.results
        .slice(0, 4)
        .map((doc, i) => `[${i + 1}] ${doc.title ?? doc.id}: ${doc.content}`)
        .join('\n\n');

      const chat = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Answer only with information from the provided citations.',
          },
          {
            role: 'user',
            content: `Question: ${context.plan.normalizedQuery}\n\n${citations}`,
          },
        ],
      });

      return chat.choices[0]?.message?.content;
    },
  },
  defaultMode: 'hybrid',
  defaultLimit: 8,
  cacheTtlSeconds: 60,
});

const result = await client.search({
  query: 'How do I enable query expansion?',
  filters: { tenantId: 'acme-inc' },
});
```

### Architecture Benefits

- Fulltext retrieval captures exact terminology.
- Vector retrieval captures semantic intent.
- Reciprocal Rank Fusion combines results without manual score normalization.
- Tenant isolation is enforced securely within the retriever layer using `context.request.filters`.

## Cloudflare Worker Edge API

This configuration provides low-latency hybrid retrieval deployed on Cloudflare Workers.

```ts
import { createCloudflareSearchClient } from 'kolm-search/presets/cloudflare';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? '';
    const tenant = url.searchParams.get('tenant') ?? 'public';

    const client = createCloudflareSearchClient(env, {
      d1Table: 'docs_fts',
      toDocument: (row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        content: String(row.content ?? ''),
        source: String(row.url ?? ''),
        score: Number(row.score ?? 0),
      }),
      queryExpansion: { maxQueries: 4 },
      cacheTtlSeconds: 30,
      defaultMode: 'hybrid',
    });

    const search = await client.search({
      query: q,
      filters: { tenantId: tenant },
      limit: 10,
    });

    return Response.json(
      {
        answer: search.answer,
        results: search.results.map((r) => ({
          id: r.id,
          title: r.title,
          source: r.source,
          score: r.score,
        })),
        durationMs: search.durationMs,
      },
      { headers: { 'content-type': 'application/json' } },
    );
  },
};
```

### Architecture Components

- **Embeddings & Synthesis:** Cloudflare Workers AI
- **Vector Retrieval:** Cloudflare Vectorize
- **Keyword Retrieval (Optional):** Cloudflare D1
- **Caching (Optional):** Cloudflare KV

## Express endpoint with telemetry and stage-aware errors

```ts
import express from 'express';
import {
  PIPELINE_STAGES,
  SchemaValidationError,
  SearchError,
  SearchClient,
} from 'kolm-search';

const app = express();

app.get('/api/search', async (req, res) => {
  try {
    const result = await client.search({
      query: String(req.query.q ?? ''),
      mode: 'hybrid',
      limit: Number(req.query.limit ?? 10),
      filters: { tenantId: req.header('x-tenant-id') ?? 'public' },
      context: { requestId: req.header('x-request-id') ?? 'unknown' },
    });

    res.json(result);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      res.status(400).json({
        error: 'invalid_request',
        target: error.target,
        issues: error.issues,
      });
      return;
    }

    if (error instanceof SearchError) {
      const status =
        error.stage === PIPELINE_STAGES.CLIENT ||
        error.stage === PIPELINE_STAGES.PLANNER
          ? 400
          : 502;

      res.status(status).json({
        error: 'search_failed',
        stage: error.stage,
        message: error.message,
      });
      return;
    }

    res.status(500).json({ error: 'internal_error' });
  }
});
```

## Common implementation patterns

### 1) Per-request mode switching

```ts
await client.search({ query: 'pricing', mode: 'fulltext' });
await client.search({ query: 'how do I rotate keys', mode: 'hybrid' });
```

### 2) Multi-tenant filtering

Pass constraints via the `filters` property and enforce them in custom retrievers:

```ts
await client.search({
  query: 'SOC 2 controls',
  filters: { tenantId: 'acme-inc', visibility: 'public' },
});
```

### 3) Query expansion with graceful fallback

Utilize `ExpandingQueryPlanner` (or the Cloudflare preset `queryExpansion` option) to rewrite queries. If the expansion service fails, retrieval degrades gracefully to the primary query.

## API behavior at a glance

- `SearchClient` is the public entry point with input guardrails.
- `planner` and `retriever` are required when constructing custom clients.
- vector/hybrid mode requires an `embedder`.
- all other pipeline stages are optional.
- `SearchError.stage` tells you where failures happened.
- `SchemaValidationError` is reserved for schema boundary violations.

## Documentation

- Guide: [Getting Started](docs/guide/getting-started.md)
- Guide: [Architecture](docs/guide/architecture.md)
- Guide: [Presets](docs/guide/presets.md)
- Guide: [Examples](docs/guide/examples.md)
- Reference: [Core API](docs/reference/core.md)
- Reference: [Adapters](docs/reference/adapters.md)
- Reference: [Contracts](docs/reference/contracts.md)
- Reference: [Errors and Stages](docs/reference/errors.md)

## Contributing

Contributions are welcome. Open an issue before submitting a pull request for significant changes.

## License

[MIT](LICENSE) © Jelle Kuipers
