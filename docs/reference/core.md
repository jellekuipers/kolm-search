# Core API

## Imports

```ts
import {
  SearchClient,
  SearchPipeline,
  CompositeRetriever,
  DefaultQueryPlanner,
  ExpandingQueryPlanner,
  PIPELINE_STAGES,
  rrfScore,
  mergeWithRrf,
} from "kolm-search";
```

## `SearchClient`

Public API wrapper with input guards, validation, and sensible defaults.

| Constructor Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `modules` | `SearchPipelineModules` | Yes | Port implementations (planner, retriever, embedder, etc.) |
| `options` | `SearchPipelineOptions` | No | Pipeline configuration (limit, mode, TTL, schema, logger, etc.) |

Primary method:

```ts
search<TRequest extends SearchRequest>(request: TRequest): Promise<SearchResponse>
```

Guards:
- Rejects empty queries with `SearchError` (`stage: "client"`)
- Rejects queries exceeding `maxQueryLength` with `SearchError` (`stage: "client"`)
- Validates request against `inputSchema` and response against `outputSchema` when configured — throws `SchemaValidationError` on failure

The request type supports `filters?: Record<string, JsonValue>` and `context?: Record<string, JsonValue>`. Use this as the default integration surface. Prefer constructing via preset factories.

## `SearchPipeline`

Lower-level execution engine. Wires together: planning → intent classification → embedding → retrieval → deduplication → reranking → pagination → synthesis, with optional caching and telemetry.

| Constructor Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `modules` | `SearchPipelineModules` | Yes | Port implementations |
| `options` | `SearchPipelineOptions` | No | Pipeline configuration |

Use when you need custom control over stage wiring or execution behavior. Prefer `SearchClient` for most use cases — it adds input validation on top.

## `CompositeRetriever`

Runs multiple retrievers in parallel and fuses results using Reciprocal Rank Fusion (RRF).

| Constructor Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `retrievers` | `Retriever[]` | Yes | Array of child retrievers to fan out to |
| `options` | `CompositeRetrieverOptions` | No | Configuration options |

`CompositeRetrieverOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `k` | `number` | `60` | RRF smoothing constant. `60` is the standard default from the Cormack et al. (2009) paper |
| `strategy` | `"fail-fast" \| "best-effort"` | `"fail-fast"` | Error handling strategy |
| `logger` | `Logger` | `undefined` | Logger for surfacing best-effort failures as warnings |

Strategies:
- **`"fail-fast"`** — any retriever failure immediately rejects the whole `retrieve` call (`Promise.all`)
- **`"best-effort"`** — failed retrievers are logged and skipped; fusion proceeds with surviving results. Throws `SearchError` only when all retrievers fail

## `DefaultQueryPlanner`

Minimal stateless `QueryPlanner` with no constructor parameters.

Normalisation steps:
1. Trim leading/trailing whitespace
2. Lowercase the entire string
3. Collapse consecutive whitespace to a single space

Sets `expandedQueries` to `[normalizedQuery]`. No synonym expansion, spell-checking, or term splitting — use `ExpandingQueryPlanner` for multi-query expansion, or substitute a custom `QueryPlanner`.

## `ExpandingQueryPlanner`

`QueryPlanner` that performs multi-query expansion via an injected `QueryExpander` (see [contracts reference](/reference/contracts)). Every built-in retriever fans out across `expandedQueries` — one search per query (or per query embedding in vector/hybrid mode) — and merges the ranked lists with RRF.

| Constructor Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `expander` | `QueryExpander` | Yes | Produces alternative phrasings of the normalised query |
| `options` | `ExpandingQueryPlannerOptions` | No | Configuration options |

`ExpandingQueryPlannerOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxQueries` | `number` | `4` | Maximum total queries in `expandedQueries`, including the primary query at index 0 |
| `logger` | `Logger` | `undefined` | Receives a warning when the expander fails |

Behaviour:

- The primary query is normalised like `DefaultQueryPlanner` and always kept at index 0.
- Expansions are normalised the same way, deduplicated (against each other and the primary query), and capped at `maxQueries` total.
- Expander failures and empty results degrade gracefully: the plan falls back to the primary query alone and a warning is logged — degraded relevance is preferred over a failed search.

```ts
import { ExpandingQueryPlanner, SearchClient } from "kolm-search";

const planner = new ExpandingQueryPlanner({
  async expand(query) {
    // Call an LLM, synonym service, or rewrite table — your choice.
    return llm.rewrite(query); // e.g. ["install kolm-search", "kolm-search setup"]
  },
});

const client = new SearchClient({ planner, retriever, embedder });
```

In `"vector"` and `"hybrid"` mode the pipeline embeds every expanded query (using `Embedder.embedMany` when implemented, otherwise parallel `embed` calls) and exposes the vectors as `context.expandedEmbeddings` for vector retrievers.

## `PIPELINE_STAGES`

Constant map of all known pipeline stage identifiers. Use with `SearchError.stage` to avoid hard-coding strings.

```ts
import { SearchError, PIPELINE_STAGES } from "kolm-search";

try {
  await client.search({ query });
} catch (err) {
  if (err instanceof SearchError) {
    switch (err.stage) {
      case PIPELINE_STAGES.EMBEDDER:
        // embedding service unavailable
        break;
      case PIPELINE_STAGES.RETRIEVER:
        // database query failed
        break;
      case PIPELINE_STAGES.CLIENT:
        // empty query or exceeded maxQueryLength
        break;
    }
  }
}
```

| Key | Value |
| --- | --- |
| `CLIENT` | `"client"` |
| `CACHE_GET` | `"cache.get"` |
| `CACHE_SET` | `"cache.set"` |
| `PLANNER` | `"planner"` |
| `INTENT_CLASSIFIER` | `"intent-classifier"` |
| `EMBEDDER` | `"embedder"` |
| `RETRIEVER` | `"retriever"` |
| `RERANKER` | `"reranker"` |
| `SYNTHESIZER` | `"synthesizer"` |
| `COMPOSITE_RETRIEVER` | `"composite-retriever"` |

## `rrfScore(rank, k?)`

Computes the RRF score for a single document at a given rank.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `rank` | `number` | — | Zero-based rank position |
| `k` | `number` | `60` | Smoothing constant |

Returns a score in the range `(0, 1]`. Higher is better.

## `mergeWithRrf(rankedLists, docMap, limit, k?)`

Merge multiple ranked result lists into a single deduplicated list using RRF.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `rankedLists` | `SearchDocument[][]` | — | One entry per retriever, each ordered best-first (index 0 = rank 0) |
| `docMap` | `Map<string, SearchDocument>` | — | Pre-built `id → document` map to extend (pass empty map to start fresh) |
| `limit` | `number` | — | Maximum documents to return |
| `k` | `number` | `60` | RRF smoothing constant |

Returns merged documents ordered by descending RRF score, each carrying the fused `score`.
