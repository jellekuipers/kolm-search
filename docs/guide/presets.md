# Presets

Presets return a configured `SearchClient` so you can start quickly.

## Basic Preset

```ts
import { createBasicSearchClient } from "kolm-search/presets/basic";

const client = createBasicSearchClient(documents, {
  defaultLimit: 5,
  maxQueryLength: 500,
});
```

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `documents` | `SearchDocument[]` | Yes | — | Document corpus to search over |
| `options` | `SearchPipelineOptions` | No | `{}` | Pipeline configuration (see [contracts reference](/reference/contracts#searchpipelineoptions)) |
| `cache` | `CacheStore` | No | `InMemoryCache` | Custom cache store |

Wires: `InMemoryFulltextRetriever`, `InMemoryDeduplicator`, `ScoreReranker`, `DefaultQueryPlanner`, and `InMemoryCache`. No vector/embedding support — compose `InMemoryFulltextRetriever` with `InMemoryVectorRetriever` via `CompositeRetriever` for hybrid search in tests.

Use for local development, demos, and tests.

## Cloudflare Preset

```ts
import { createCloudflareSearchClient } from "kolm-search/presets/cloudflare";

const client = createCloudflareSearchClient(env, {
  d1Table: "docs_fts",
  toDocument: (row) => ({ id: String(row.id), content: String(row.content) }),
  embeddingModel: "@cf/baai/bge-base-en-v1.5",
  synthesisModel: "@cf/meta/llama-3.1-8b-instruct",
});
```

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `env` | `CloudflarePresetEnv` | Yes | Worker environment bindings |
| `options` | `CloudflarePresetOptions` | No | Preset and pipeline options |

`CloudflarePresetEnv` bindings:

| Binding | Type | Required | Description |
| --- | --- | --- | --- |
| `AI` | Workers AI binding | Yes | Used for embeddings and synthesis |
| `VECTOR_INDEX` | Vectorize index binding | Yes | Used for vector retrieval |
| `SEARCH_CACHE` | KV namespace binding | No | Used for response caching |
| `D1_DATABASE` | D1 database binding | No | Used for fulltext retrieval (hybrid search) |

`CloudflarePresetOptions` (extends `SearchPipelineOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `embeddingModel` | `string` | `"@cf/baai/bge-base-en-v1.5"` | Workers AI embedding model |
| `synthesisModel` | `string` | `"@cf/meta/llama-3.1-8b-instruct"` | Workers AI chat model |
| `promptBuilder` | `(context: SearchPipelineContext) => string` | Built-in prompt | Custom prompt builder for the synthesizer |
| `d1Table` | `string` | `undefined` | FTS5 virtual table name for D1 fulltext retrieval |
| `toDocument` | `(row) => SearchDocument` | `undefined` | Map D1 rows to `SearchDocument` |

When `env.D1_DATABASE`, `d1Table`, and `toDocument` are all provided, a `CompositeRetriever` with `"best-effort"` strategy is wired for hybrid fulltext + vector search.

Supports Workers AI embeddings/synthesis, Vectorize retrieval, and optional D1 fulltext.

## Postgres Preset

```ts
import { createPostgresSearchClient } from "kolm-search/presets/postgres";
import { createFulltextRetriever } from "kolm-search/adapters/generic";

// Replace the search call with your actual PostgreSQL driver query.
// The example below uses a tagged-template driver (e.g. postgres.js / slonik).
const fulltextRetriever = createFulltextRetriever({
  async search(query, limit) {
    return db`SELECT id, content, ts_rank(search_vector, q) AS rank
              FROM articles, to_tsquery('english', ${query}) q
              WHERE search_vector @@ q
              ORDER BY rank DESC
              LIMIT ${limit}`;
  },
  toDocument: (row) => ({ id: row.id, content: row.content, score: row.rank }),
});

const client = createPostgresSearchClient({ fulltextRetriever });
```

`PostgresPresetOptions` (extends `SearchPipelineOptions`):

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `fulltextRetriever` | `Retriever` | Yes | — | Fulltext retriever (build with `createFulltextRetriever`) |
| `vectorRetriever` | `Retriever` | No | `undefined` | Vector retriever (build with `createVectorRetriever`). When provided, a `CompositeRetriever` merges both via RRF |
| `embedder` | `Embedder` | No | `undefined` | Produces query vectors. Required when `vectorRetriever` is provided |
| `intentClassifier` | `IntentClassifier` | No | `undefined` | Classifies query intent before retrieval |
| `cache` | `CacheStore` | No | `InMemoryCache` | Cache store. Provide a shared store (e.g. Redis) for multi-instance deployments |
| `planner` | `QueryPlanner` | No | `DefaultQueryPlanner` | Custom query planner for expansion, stop-words, etc. |
| `reranker` | `Reranker` | No | `ScoreReranker` | Custom reranker to apply after RRF fusion |
| `synthesizer` | `Synthesizer` | No | `undefined` | LLM synthesizer for generating answers |
| `compositeStrategy` | `"fail-fast" \| "best-effort"` | No | `"best-effort"` | Error strategy for `CompositeRetriever` when both retrievers are provided |

Works with any PostgreSQL driver when your retrievers are implemented.

> **Multi-instance deployments:** The default `cache` is `InMemoryCache`, which lives in a single process and is reset on restart. In production with multiple instances (containers, replicas), supply a shared `CacheStore` such as `RedisCacheStore` so all instances share the same cache.

### Hybrid fulltext + pgvector

When `vectorRetriever` and `embedder` are both provided, the preset automatically wires a `CompositeRetriever` for hybrid search:

```ts
import { createPostgresSearchClient } from "kolm-search/presets/postgres";
import { createFulltextRetriever, createVectorRetriever } from "kolm-search/adapters/generic";

const client = createPostgresSearchClient({
  fulltextRetriever: createFulltextRetriever({
    async search(query, limit) {
      return db`SELECT id, content FROM articles
                WHERE search_vector @@ to_tsquery(${query})
                LIMIT ${limit}`;
    },
    toDocument: (row) => ({ id: row.id, content: row.content }),
  }),
  vectorRetriever: createVectorRetriever({
    async search(embeddings, limit) {
      return db`SELECT id, content FROM articles
                ORDER BY embedding <=> ${JSON.stringify(embeddings)}
                LIMIT ${limit}`;
    },
    toDocument: (row) => ({ id: row.id, content: row.content }),
  }),
  embedder: {
    async embed(text) {
      const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
      return res.data[0].embedding;
    },
  },
});
```
