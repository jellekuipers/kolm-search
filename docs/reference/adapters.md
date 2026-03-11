# Adapters

Built-in adapters map external systems to port interfaces in `contracts/ports.ts`.

## Choosing an Adapter

| Scenario | Adapter |
| --- | --- |
| Local development / tests | `InMemoryFulltextRetriever`, `InMemoryVectorRetriever`, `InMemoryCache` |
| Production single-instance | Any retriever + `InMemoryCache` |
| Production multi-instance | Any retriever + `RedisCacheStore` (shared across instances) |
| Cloudflare Workers | `D1FulltextRetriever`, `VectorizeRetriever`, `WorkersAIEmbedder`, `KVCacheStore` |
| Custom database | `createFulltextRetriever` / `createVectorRetriever` (generic factories) |

## In-Memory

Import path: `kolm-search/adapters/in-memory`

### `InMemoryFulltextRetriever`

Fulltext retriever for development and testing. Scores documents by the fraction of query tokens present in `title + content`.

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `documents` | `SearchDocument[]` | Document corpus to search over |

Returns up to `targetLimit × 2` candidates sorted by descending score. Throws `SearchError` when mode is `"vector"`.

### `InMemoryVectorRetriever`

Vector retriever using cosine similarity. Requires an `Embedder` in the pipeline so that `context.embeddings` is populated.

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `documents` | `DocumentWithEmbedding[]` | Documents with pre-computed embedding vectors |

`DocumentWithEmbedding` shape:

| Property | Type | Description |
| --- | --- | --- |
| `document` | `SearchDocument` | The document |
| `embedding` | `number[]` | Pre-computed embedding vector |

Returns up to `targetLimit × 2` candidates. Throws `SearchError` when `context.embeddings` is absent.

### `InMemoryCache`

In-process cache backed by a `Map`. Respects optional per-entry TTLs. Expired entries are evicted lazily on the next `get` call.

No constructor parameters.

> **Note:** Data is not shared across processes or instances. For multi-instance deployments use `RedisCacheStore` or `KVCacheStore`.

### `InMemoryDeduplicator`

Removes documents with duplicate `id` values, keeping the first occurrence.

No constructor parameters.

### `ScoreReranker`

Sorts documents by descending `score`, leaving ties in their original order.

No constructor parameters.

### `BasicKeywordIntentClassifier`

Keyword-based intent classifier. Iterates rules in order and returns the `intent` of the first rule whose keywords match the normalised query.

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `rules` | `KeywordIntentRule[]` | Array of classification rules |

`KeywordIntentRule` shape:

| Property | Type | Description |
| --- | --- | --- |
| `intent` | `string` | The intent label this rule resolves to |
| `keywords` | `string[]` | Keywords that trigger this rule (case-insensitive substring match) |

Returns `undefined` when no rule matches.

```ts
import { BasicKeywordIntentClassifier } from "kolm-search/adapters/in-memory";

const classifier = new BasicKeywordIntentClassifier([
  { intent: "pricing", keywords: ["price", "cost", "plan", "subscription"] },
  { intent: "tutorial", keywords: ["how", "guide", "setup", "install"] },
]);
```

The classified intent is available as `context.plan.intent` in all downstream modules (retriever, reranker, synthesizer).

## Generic

Import path: `kolm-search/adapters/generic`

Factory helpers to adapt your own DB or API functions into retrievers.

### `createFulltextRetriever<TRow>(options)`

Creates a `Retriever` backed by any fulltext-capable database.

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `search` | `(query: string, limit: number, context: SearchPipelineContext) => Promise<TRow[]>` | Yes | — | Execute a fulltext search and return raw rows |
| `toDocument` | `(row: TRow) => SearchDocument` | Yes | — | Map a raw database row to a `SearchDocument` |
| `primaryQueryBoost` | `number` | No | `1` | How many times the primary query is counted in RRF merge relative to expanded variants. Set to `2` to give the base query double the RRF signal |

The `context` parameter passed to `search` provides useful read-only fields:

| Field | Use |
| --- | --- |
| `context.request.filters` | Scope the query by tenant, category, date range, etc. |
| `context.request.context` | Access caller-supplied context (user ID, session info) |
| `context.plan.intent` | Branch query logic based on classified intent |
| `context.plan.targetLimit` | Use as the retrieval limit before pagination |

When `expandedQueries` has multiple entries, results from each query are merged via RRF. The `primaryQueryBoost` repeats the first query's ranked list for proportionally more RRF weight.

### `createVectorRetriever<TRow>(options)`

Creates a `Retriever` backed by any vector-capable database.

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `search` | `(embeddings: number[], limit: number, context: SearchPipelineContext) => Promise<TRow[]>` | Yes | Execute a vector (ANN) search using query embeddings |
| `toDocument` | `(row: TRow) => SearchDocument` | Yes | Map a raw database row to a `SearchDocument` |

The same `context` fields described above are available in the `search` callback.

Throws `SearchError` when `context.embeddings` is absent (no `Embedder` wired).

## Redis

Import path: `kolm-search/adapters/redis`

### `RedisCacheStore`

`CacheStore` backed by a Redis client. Values are JSON-serialised. Compatible with `ioredis` and `redis` (node-redis v4+).

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `client` | `RedisClientLike` | Redis client instance |

`RedisClientLike` interface:

| Method | Signature |
| --- | --- |
| `get` | `(key: string) => Promise<string \| null>` |
| `set` | `(key: string, value: string, ex: "EX", ttl: number) => Promise<unknown>` |
| `set` | `(key: string, value: string) => Promise<unknown>` |
| `del` | `(key: string) => Promise<unknown>` |

## Cloudflare

Import path: `kolm-search/adapters/cloudflare`

### `D1FulltextRetriever<TRow>`

`Retriever` backed by a Cloudflare D1 FTS5 virtual table.

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `db` | D1 database binding | The D1 database from `env` |
| `options` | `D1FulltextRetrieverOptions<TRow>` | Configuration options |

`D1FulltextRetrieverOptions`:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `table` | `string` | Yes | Name of the FTS5 virtual table |
| `toDocument` | `(row: TRow & { score: number }) => SearchDocument` | Yes | Map a D1 row to a `SearchDocument`. The `score` field is a positive BM25 value (the adapter negates D1's native negative `rank`) |

### `VectorizeRetriever`

`Retriever` backed by a Cloudflare Vectorize index.

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `index` | Vectorize index binding | The Vectorize index from `env` |

Requests `topK = max(targetLimit × 2, 20)` with `returnMetadata: true`. Metadata fields (`title`, `content`, `source`) are mapped to `SearchDocument` properties.

> **Silent empty list:** When `context.embeddings` is absent (no embedder wired, or fulltext-only mode), `VectorizeRetriever` returns an empty list rather than throwing. This is intentional: it allows safe composition in a `CompositeRetriever` alongside a fulltext retriever without failing fulltext-only requests.

### `WorkersAIEmbedder`

`Embedder` backed by a Cloudflare Workers AI text-embedding model.

| Constructor Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ai` | Workers AI binding | — | The AI binding from `env` |
| `model` | `string` | `"@cf/baai/bge-base-en-v1.5"` | Workers AI embedding model (768 dimensions) |

### `WorkersAISynthesizer`

`Synthesizer` backed by a Cloudflare Workers AI chat-completion model. Returns `undefined` when the result set is empty.

| Constructor Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ai` | Workers AI binding | — | The AI binding from `env` |
| `model` | `string` | `"@cf/meta/llama-3.1-8b-instruct"` | Workers AI chat model |
| `options` | `WorkersAISynthesizerOptions` | `{}` | Additional options |

`WorkersAISynthesizerOptions`:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `promptBuilder` | `(context: SearchPipelineContext) => string` | No | Custom function to build the LLM prompt from pipeline context. The default prompt includes the query and up to 5 result snippets |

### `KVCacheStore`

`CacheStore` backed by a Cloudflare KV namespace binding. Values are JSON-serialised.

| Constructor Parameter | Type | Description |
| --- | --- | --- |
| `kv` | KV namespace binding | The KV namespace from `env` |

`expirationTtl` is forwarded directly to the KV `put` call. KV has a minimum TTL of 60 seconds — setting `cacheTtlSeconds` below 60 in `SearchPipelineOptions` will be silently overridden by KV.
