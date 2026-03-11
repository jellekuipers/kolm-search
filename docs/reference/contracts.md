# Contracts

Port interfaces are defined in `src/contracts/ports.ts`.
Shared types are defined in `src/contracts/types.ts`.

## Core Interfaces

| Interface | Method | Required |
| --- | --- | --- |
| `QueryPlanner` | `plan(request): Promise<QueryPlan>` | Yes |
| `Retriever` | `retrieve(context): Promise<SearchDocument[]>` | Yes |
| `Embedder` | `embed(input): Promise<number[]>` | Vector/Hybrid |
| `Deduplicator` | `deduplicate(docs): SearchDocument[]` | Optional |
| `Reranker` | `rerank(docs, context): Promise<SearchDocument[]>` | Optional |
| `Synthesizer` | `synthesize(context): Promise<string \| undefined>` | Optional |
| `IntentClassifier` | `classify(query): Promise<string \| undefined>` | Optional |
| `CacheStore` | `get<T>(key): Promise<T \| undefined>` / `set<T>(key, value, ttlSeconds?): Promise<void>` | Optional |
| `Telemetry` | `track(event, payload): Promise<void>` | Optional |

Implementing these interfaces is the preferred way to integrate custom systems.

## `SearchPipelineModules`

Container interface accepted by `SearchClient` and `SearchPipeline`. Groups all port implementations:

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `planner` | `QueryPlanner` | Yes | Normalises the incoming request into a query plan |
| `retriever` | `Retriever` | Yes | Fetches candidate documents from the data source |
| `embedder` | `Embedder` | No | Produces query embeddings for vector/hybrid mode |
| `deduplicator` | `Deduplicator` | No | Removes duplicate documents from the candidate list |
| `reranker` | `Reranker` | No | Re-orders results after deduplication |
| `synthesizer` | `Synthesizer` | No | Generates an LLM answer from the final result set |
| `intentClassifier` | `IntentClassifier` | No | Classifies the normalised query into an intent label |
| `cache` | `CacheStore` | No | Caches responses to avoid redundant retrieval round-trips |
| `telemetry` | `Telemetry` | No | Emits observability events after each successful search |

## `SearchPipelineOptions`

Configuration object accepted by `SearchClient`, `SearchPipeline`, and preset factories.

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `defaultLimit` | `number` | `10` | Default result limit when not specified on a request |
| `defaultMode` | `SearchMode` | `"hybrid"` | Default search mode when not specified on a request |
| `cacheTtlSeconds` | `number` | `60` | TTL in seconds for cached responses |
| `logger` | `Logger` | `undefined` | Logger for non-fatal pipeline warnings |
| `inputSchema` | `StandardSchemaV1` | `undefined` | Standard Schema validator for incoming `SearchRequest` |
| `outputSchema` | `StandardSchemaV1` | `undefined` | Standard Schema validator for outgoing `SearchResponse` |
| `maxQueryLength` | `number` | No limit | Maximum allowed query length in characters. Queries exceeding this are rejected with `stage: "client"` |

## Types

### `SearchMode`

```ts
type SearchMode = "vector" | "fulltext" | "hybrid";
```

Controls which retrieval strategy the pipeline uses. Default: `"hybrid"`.

### `SearchDocument`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Unique identifier |
| `content` | `string` | Yes | Document text |
| `title` | `string` | No | Optional title |
| `source` | `string` | No | Optional document origin |
| `tags` | `string[]` | No | Optional classification tags |
| `metadata` | `Record<string, unknown>` | No | Arbitrary metadata |
| `score` | `number` | No | Normalised relevance score in `[0, 1]`; higher is better |

### `SearchRequest`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | `string` | — | Free-text query string. Must not be empty |
| `limit` | `number` | `defaultLimit` (10) | Maximum number of documents to return |
| `offset` | `number` | `0` | Zero-based offset for pagination |
| `mode` | `SearchMode` | `defaultMode` ("hybrid") | Retrieval strategy |
| `filters` | `Record<string, JsonValue>` | `{}` | Arbitrary key/value filters forwarded to the retriever |
| `context` | `Record<string, JsonValue>` | `{}` | Caller-supplied context forwarded through the pipeline unchanged |

### `QueryPlan`

Produced by the `QueryPlanner` and available in `SearchPipelineContext` for all downstream modules.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `normalizedQuery` | `string` | Yes | Trimmed, lowercased, whitespace-collapsed query |
| `expandedQueries` | `string[]` | No | Expanded query variants. Default: `[normalizedQuery]` |
| `intent` | `string` | No | Intent label from `IntentClassifier`. `undefined` when no classifier is provided or classification is inconclusive |
| `mode` | `SearchMode` | Yes | Resolved retrieval strategy |
| `targetLimit` | `number` | Yes | Resolved target result count |
| `metadata` | `Record<string, unknown>` | No | Plan metadata |

### `SearchPagination`

Pagination metadata attached to every `SearchResponse`.

| Property | Type | Description |
| --- | --- | --- |
| `offset` | `number` | Zero-based start index applied to the candidate list |
| `limit` | `number` | Maximum number of results returned |
| `totalCandidates` | `number` | Total candidates before slicing. Not a database row count — use it to check whether a next page exists (`totalCandidates > offset + limit`) |

### `SearchResponse`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `request` | `SearchRequest` | Yes | The original request |
| `plan` | `QueryPlan` | Yes | The resolved query plan |
| `results` | `SearchDocument[]` | Yes | Ranked results after deduplication, reranking, and pagination |
| `pagination` | `SearchPagination` | Yes | Pagination metadata |
| `answer` | `string` | No | LLM-generated answer (when a `Synthesizer` is wired in) |
| `durationMs` | `number` | Yes | Total wall-clock time for the pipeline run, in milliseconds |
| `metadata` | `SearchResponseMetadata` | No | Pipeline-populated metadata for observability |

### `SearchResponseMetadata`

Library-owned fields populated by the pipeline and attached to every `SearchResponse.metadata`.

| Property | Type | Description |
| --- | --- | --- |
| `resultCount` | `number` | Number of documents in the final result set after pagination |
| `cacheHit` | `boolean` | `true` when the response was served from the pipeline cache |

```ts
const response = await client.search({ query: "..." });
if (response.metadata?.cacheHit) {
  console.log("Served from cache");
}
console.log(`${response.metadata?.resultCount} results`);
```

### `SearchPipelineContext`

Mutable state object threaded through all pipeline stages. Created at the start of a `search()` call and discarded once the response is built. Adapters and custom stages should treat fields they do not own as read-only.

| Property | Type | Description |
| --- | --- | --- |
| `request` | `SearchRequest` | The validated incoming request |
| `plan` | `QueryPlan` | The resolved query plan, including intent |
| `embeddings` | `number[] \| undefined` | Query embedding vector. Populated by the `Embedder` stage; `undefined` in fulltext-only mode |
| `candidates` | `SearchDocument[]` | Raw candidates before deduplication/reranking |
| `results` | `SearchDocument[]` | Final ranked documents after deduplication, reranking, and pagination |
| `answer` | `string \| undefined` | LLM-generated answer. Populated by the `Synthesizer` stage |
| `metadata` | `Record<string, unknown>` | Accumulates metadata from pipeline stages |
| `startedAt` | `number` | `Date.now()` timestamp when the pipeline run started |

### `Logger`

Minimal structured logger interface. Inject via `SearchPipelineOptions.logger` to receive pipeline diagnostics without depending on a specific logging library.

| Method | Signature |
| --- | --- |
| `debug` | `(message: string, payload?: unknown) => void` |
| `info` | `(message: string, payload?: unknown) => void` |
| `warn` | `(message: string, payload?: unknown) => void` |
| `error` | `(message: string, payload?: unknown) => void` |

Any `console`-like object satisfies this interface.

### `Telemetry`

Observability sink for pipeline events. Failures in `track` are silently swallowed by the pipeline and logged as warnings via the configured `Logger`.

The pipeline emits the event `"search.completed"` after every successful search with this payload:

| Field | Type | Description |
| --- | --- | --- |
| `durationMs` | `number` | Total wall-clock time for the pipeline run |
| `mode` | `SearchMode` | Resolved retrieval mode |
| `resultCount` | `number` | Documents in the final result set |
| `stageDurations` | `Record<string, number>` | Milliseconds per stage (e.g. `{ planner: 2, embedder: 18, retriever: 40 }`) |

```ts
const telemetry: Telemetry = {
  async track(event, payload) {
    // event === "search.completed"
    await analytics.track(event, payload);
  },
};
```

## Error Types

### `SearchError`

Thrown when a named pipeline stage fails.

| Property | Type | Description |
| --- | --- | --- |
| `message` | `string` | Human-readable description. Format: `"[stage] Description."` |
| `stage` | `string` | The pipeline stage that failed. See `PIPELINE_STAGES` for known values |
| `cause` | `unknown` | The original error that triggered this, if available |

### `SchemaValidationError`

Thrown when `inputSchema` or `outputSchema` validation fails. Distinct from `SearchError` — it indicates a contract violation rather than a pipeline failure.

| Property | Type | Description |
| --- | --- | --- |
| `target` | `"input" \| "output"` | Which schema failed |
| `issues` | `ReadonlyArray<SchemaIssue>` | Validation failure details |

`SchemaIssue`:

| Property | Type | Description |
| --- | --- | --- |
| `message` | `string` | Human-readable issue description |
| `path` | `ReadonlyArray<PropertyKey \| { key: PropertyKey }>` | Path to the failing field, if available |

```ts
import { SchemaValidationError } from "kolm-search";

try {
  await client.search(request);
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(err.target, err.issues);
    // "input", [{ message: "String must contain at least 1 character(s)", path: ["query"] }]
  }
}
```
