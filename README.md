# kolm-search

> Modular, adapter-driven RAG search pipeline library — BYO database, no vendor lock-in.

[![npm version](https://img.shields.io/npm/v/kolm-search)](https://www.npmjs.com/package/kolm-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Overview

`kolm-search` is a TypeScript library for building search pipelines with Retrieval-Augmented Generation (RAG) capabilities. It orchestrates the full retrieval lifecycle — query planning, embedding, retrieval, deduplication, reranking, and synthesis — through a clean set of port interfaces you implement against your own data sources.

**Key principles:**

- **BYO database** — bring fulltext (PostgreSQL, SQLite/D1) and vector (pgvector, Cloudflare Vectorize) backends
- **Composable** — every stage is an optional plugin; use only what you need
- **Framework-agnostic** — works in Node.js, Cloudflare Workers, Bun, and any edge runtime
- **Type-safe** — strict TypeScript throughout with [Standard Schema V1](https://standardschema.dev/) support

## Features

- Hybrid search (fulltext + vector) with [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) (Cormack et al. 2009)
- Multi-query expansion with configurable primary-query boost
- Parallel retrieval via `CompositeRetriever` with fail-fast or best-effort strategies
- Response caching with per-request TTLs
- Deduplication, reranking, and LLM synthesis plugins
- Intent classification slot for routing-aware retrieval
- Standard Schema V1 validation for inputs and outputs (Zod, Valibot, ArkType, …)
- Structured `SearchError` with per-stage identification and `PIPELINE_STAGES` constants
- Stage-level telemetry with per-stage `durationMs` tracking

## Installation

```bash
pnpm add kolm-search
```

## Quick Start

```ts
import { createBasicSearchClient } from "kolm-search/presets/basic";

const client = createBasicSearchClient([
  { id: "1", title: "Getting Started", content: "Install and configure kolm-search." },
  { id: "2", title: "Architecture", content: "Modular pipeline with pluggable adapters." },
]);

const response = await client.search({ query: "how to get started" });
console.log(response.results);
// [{ id: "1", title: "Getting Started", content: "...", score: 0.83 }]
```

The basic preset is for development and testing. For production, choose a database-backed preset.

---

## Presets

Presets are batteries-included `SearchClient` factories wired to specific backends.

### `createBasicSearchClient` — in-memory

```ts
import { createBasicSearchClient } from "kolm-search/presets/basic";

const client = createBasicSearchClient(documents, {
  defaultLimit: 5,
  maxQueryLength: 500,
});
```

In-memory fulltext search backed by token overlap scoring. Not suitable for production. Ideal for local dev, unit tests, and demos.

### `createCloudflareSearchClient` — Workers AI + Vectorize ± D1

```ts
import { createCloudflareSearchClient } from "kolm-search/presets/cloudflare";

export default {
  async fetch(request: Request, env: Env) {
    const client = createCloudflareSearchClient(env, {
      // Optional: add D1 fulltext alongside Vectorize for hybrid search
      d1Table: "docs_fts",
      toDocument: (row) => ({ id: String(row.id), content: String(row.content) }),
    });
    const response = await client.search({ query: "..." });
    return Response.json(response.results);
  },
};
```

LLM embeddings via Workers AI (`@cf/baai/bge-base-en-v1.5`), ANN search via Cloudflare Vectorize, optional hybrid search with D1 FTS5, synthesis via `@cf/meta/llama-3.1-8b-instruct`.

Required env bindings: `AI`, `VECTOR_INDEX`. Optional: `SEARCH_CACHE` (KV), `D1_DATABASE`.

### `createPostgresSearchClient` — PostgreSQL + pgvector

```ts
import {
  createFulltextRetriever,
  createVectorRetriever,
} from "kolm-search/adapters/generic";
import { createPostgresSearchClient } from "kolm-search/presets/postgres";

const fulltextRetriever = createFulltextRetriever({
  async search(query, limit) {
    return db.$queryRaw`
      SELECT id, title, content, ts_rank(search_vector, plainto_tsquery(${query})) AS rank
      FROM articles
      WHERE search_vector @@ plainto_tsquery(${query})
      ORDER BY rank DESC
      LIMIT ${limit}
    `;
  },
  toDocument: (row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    score: row.rank,
  }),
});

const client = createPostgresSearchClient({ fulltextRetriever });
```

Works with any PostgreSQL driver (Prisma, Drizzle, `pg`, `postgres.js`). Add `vectorRetriever` and `embedder` for hybrid search.

---

## Pipeline Architecture

```
Request
  │
  ▼
SearchClient  ──  input guard, maxQueryLength, schema validation
  │
  ▼
QueryPlanner  ──  normalise + expand query
  │
  ├── IntentClassifier?  ──  classify intent (optional)
  │
  ├── Embedder?  ──  produce query vector (vector / hybrid mode)
  │
  ▼
Retriever  ──  fetch candidate documents
  │
  └── CompositeRetriever (optional)
       ├── Retriever A  ──┐
       └── Retriever B  ──┴──  Reciprocal Rank Fusion
  │
  ├── Deduplicator?  ──  remove duplicate ids
  │
  ├── Reranker?  ──  re-order results
  │
  ├── Pagination  ──  offset + limit slice
  │
  └── Synthesizer?  ──  generate LLM answer
  │
  ▼
SearchResponse
```

Cache wraps the full pipeline: a hit returns immediately after the planner stage; successful responses are stored before returning.

---

## Plugin Interfaces

Every stage is a TypeScript interface in `src/contracts/ports.ts`. Implement any interface to extend or replace behaviour:

| Interface | Purpose | Optional | Built-in Implementations |
|-----------|---------|----------|--------------------------|
| `QueryPlanner` | Normalise and expand the query | **required** | `DefaultQueryPlanner` |
| `Retriever` | Fetch candidate documents | **required** | `InMemoryFulltextRetriever`, `InMemoryVectorRetriever`, `D1FulltextRetriever`, `VectorizeRetriever`, `createFulltextRetriever`, `createVectorRetriever` |
| `Embedder` | Produce query embedding vector | optional (vector/hybrid) | `WorkersAIEmbedder` |
| `Deduplicator` | Remove duplicate result ids | optional | `InMemoryDeduplicator` |
| `Reranker` | Re-order candidate documents | optional | `ScoreReranker` |
| `Synthesizer` | Generate an LLM answer | optional | `WorkersAISynthesizer` |
| `IntentClassifier` | Classify query intent | optional | `BasicKeywordIntentClassifier` |
| `CacheStore` | Cache serialisable values | optional | `InMemoryCache`, `KVCacheStore`, `RedisCacheStore` |
| `Telemetry` | Emit observability events | optional | custom |

---

## Custom Adapters

All plugin interfaces are minimal—usually one or two methods. Implement them directly as an object literal or class:

### Custom Retriever

```ts
import type { Retriever } from "kolm-search";

const myRetriever: Retriever = {
  async retrieve(context) {
    const { normalizedQuery, targetLimit } = context.plan;
    const rows = await myDb.search(normalizedQuery, targetLimit * 2);
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      score: row.relevance,
    }));
  },
};
```

### Custom Embedder

```ts
import type { Embedder } from "kolm-search";

const openAiEmbedder: Embedder = {
  async embed(input) {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input,
    });
    return res.data[0].embedding;
  },
};
```

### Custom Reranker

```ts
import type { Reranker } from "kolm-search";

const myReranker: Reranker = {
  async rerank(documents, context) {
    // e.g. cross-encoder scoring, intent-aware boosting
    return documents.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  },
};
```

### Custom Synthesizer

```ts
import type { Synthesizer } from "kolm-search";

const gptSynthesizer: Synthesizer = {
  async synthesize(context) {
    if (context.results.length === 0) return undefined;
    const ctx = context.results.map((r) => r.content).join("\n\n");
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: `Answer based on context:\n${ctx}` },
        { role: "user", content: context.plan.normalizedQuery },
      ],
    });
    return res.choices[0]?.message.content ?? undefined;
  },
};
```

### Custom IntentClassifier

```ts
import type { IntentClassifier } from "kolm-search";

// Built-in alternative: BasicKeywordIntentClassifier from kolm-search/adapters/in-memory
const classifier: IntentClassifier = {
  async classify(query) {
    if (query.includes("price") || query.includes("cost")) return "pricing";
    if (query.includes("how") || query.includes("guide")) return "tutorial";
    return undefined;
  },
};
```

The `intent` value is available on `context.plan.intent` in all downstream modules.

### Custom CacheStore

```ts
import type { CacheStore } from "kolm-search";

const myCache: CacheStore = {
  async get(key) { /* return undefined on miss */ },
  async set(key, value, ttlSeconds) { /* store */ },
};
```

### Custom Telemetry

```ts
import type { Telemetry } from "kolm-search";

const telemetry: Telemetry = {
  async track(event, payload) {
    // payload includes durationMs, mode, resultCount, stageDurations
    myAnalytics.track(event, payload);
  },
};
```

---

## Redis Cache Adapter

Share cached search responses across multiple instances with `RedisCacheStore`. Compatible with `ioredis` and `redis` (node-redis v4+) — no direct dependency required, pass your client in.

```ts
import Redis from "ioredis";
import { RedisCacheStore } from "kolm-search/adapters/redis";
import { createPostgresSearchClient } from "kolm-search/presets/postgres";

const redis = new Redis(process.env.REDIS_URL);
const cache = new RedisCacheStore(redis);

const client = createPostgresSearchClient({
  fulltextRetriever,
  cache,
});
```

---

## CompositeRetriever

Run multiple retrievers in parallel and fuse their ranked lists with Reciprocal Rank Fusion:

```ts
import { CompositeRetriever } from "kolm-search";

const retriever = new CompositeRetriever({
  retrievers: [fulltextRetriever, vectorRetriever],
  strategy: "best-effort", // or "fail-fast" (default)
});
```

**`"fail-fast"`** — throws `SearchError` if any retriever throws.
**`"best-effort"`** — ignores individual retriever failures and returns whatever succeeded.

---

## BasicKeywordIntentClassifier

A simple keyword-rules intent classifier included in the in-memory adapter:

```ts
import { BasicKeywordIntentClassifier } from "kolm-search/adapters/in-memory";

const classifier = new BasicKeywordIntentClassifier([
  { intent: "pricing", keywords: ["price", "cost", "plan", "subscription"] },
  { intent: "tutorial", keywords: ["how", "guide", "setup", "install"] },
  { intent: "troubleshoot", keywords: ["error", "fix", "broken", "fail"] },
]);
```

Rules are evaluated in order; the first match wins. Returns `undefined` when no rule matches. For higher precision, replace with a model-based classifier while keeping the same `IntentClassifier` interface.

---

## Schema Validation

Pass any [Standard Schema V1](https://standardschema.dev/)-compatible schema to validate inputs and outputs:

```ts
import { z } from "zod";
import { createBasicSearchClient } from "kolm-search/presets/basic";

const requestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
});

const client = createBasicSearchClient(documents, {
  inputSchema: requestSchema,
});
```

Works with Zod, Valibot, ArkType, and any library implementing the Standard Schema spec. Throws `SchemaValidationError` on failure.

---

## Error Handling

The pipeline throws `SearchError` on stage failures. Use `PIPELINE_STAGES` constants for type-safe stage comparison:

```ts
import { SearchError, PIPELINE_STAGES } from "kolm-search";

try {
  await client.search({ query: "..." });
} catch (error) {
  if (error instanceof SearchError) {
    console.error(`Failed at stage "${error.stage}":`, error.message);

    if (error.stage === PIPELINE_STAGES.RETRIEVER) {
      // handle retriever failure specifically
    }
  }
}
```

**Pipeline stages:**

| Constant | Value | Description |
|----------|-------|-------------|
| `PIPELINE_STAGES.CLIENT` | `"client"` | Input guard / schema validation |
| `PIPELINE_STAGES.CACHE_GET` | `"cache.get"` | Cache read |
| `PIPELINE_STAGES.CACHE_SET` | `"cache.set"` | Cache write |
| `PIPELINE_STAGES.PLANNER` | `"planner"` | Query planning |
| `PIPELINE_STAGES.INTENT_CLASSIFIER` | `"intent-classifier"` | Intent classification |
| `PIPELINE_STAGES.EMBEDDER` | `"embedder"` | Embedding |
| `PIPELINE_STAGES.RETRIEVER` | `"retriever"` | Document retrieval |
| `PIPELINE_STAGES.RERANKER` | `"reranker"` | Result reranking |
| `PIPELINE_STAGES.SYNTHESIZER` | `"synthesizer"` | LLM synthesis |
| `PIPELINE_STAGES.COMPOSITE_RETRIEVER` | `"composite-retriever"` | Parallel retrieval |

---

## Telemetry

The pipeline emits a `"search.completed"` event after every successful search. The payload includes per-stage durations:

```ts
import type { Telemetry } from "kolm-search";
import { SearchClient } from "kolm-search";

const telemetry: Telemetry = {
  async track(event, payload) {
    // event: "search.completed"
    // payload.durationMs      – total wall-clock time
    // payload.mode            – "fulltext" | "vector" | "hybrid"
    // payload.resultCount     – number of results returned
    // payload.stageDurations  – { planner: 2, retriever: 18, ... }
    console.log(event, payload);
  },
};

const client = new SearchClient(modules, { ...options, telemetry });
```

Telemetry failures are silently swallowed and never surface to callers.

---

## Import Paths

| Import path | Contents |
|-------------|----------|
| `kolm-search` | Core types, interfaces, errors, `SearchClient`, `SearchPipeline`, `CompositeRetriever`, `DefaultQueryPlanner`, RRF utilities, `PIPELINE_STAGES` |
| `kolm-search/adapters/generic` | `createFulltextRetriever`, `createVectorRetriever` |
| `kolm-search/adapters/in-memory` | `InMemoryFulltextRetriever`, `InMemoryVectorRetriever`, `InMemoryCache`, `InMemoryDeduplicator`, `ScoreReranker`, `BasicKeywordIntentClassifier` |
| `kolm-search/adapters/cloudflare` | `D1FulltextRetriever`, `KVCacheStore`, `VectorizeRetriever`, `WorkersAIEmbedder`, `WorkersAISynthesizer` |
| `kolm-search/adapters/redis` | `RedisCacheStore` |
| `kolm-search/presets/basic` | `createBasicSearchClient` |
| `kolm-search/presets/cloudflare` | `createCloudflareSearchClient` |
| `kolm-search/presets/postgres` | `createPostgresSearchClient` |

---

## Example — Hono Search API

See [`examples/hono-search`](examples/hono-search) for a minimal Hono app with:

- `POST /search` — query the corpus, Zod-validated body
- `GET /health` — liveness check

```bash
cd examples/hono-search
pnpm install
pnpm dev
# → http://localhost:3000

curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "hybrid search", "limit": 3}'
```

---

## Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes.

## License

[MIT](LICENSE) © Jelle Kuipers

