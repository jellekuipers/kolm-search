# Architecture

The library follows a modular layering model:

```text
contracts/ -> core/ -> adapters/ -> presets/
```

- `contracts`: shared types and port interfaces
- `core`: pipeline orchestration and public client
- `adapters`: concrete implementations of port interfaces
- `presets`: factory functions that wire modules together

## Request Flow

The pipeline runs stages in this order. A **cache hit** on `cache.get` short-circuits everything — the remaining stages are skipped and the cached response is returned immediately.

```text
SearchClient.search()
  -> cache.get          (short-circuit on hit)
  -> QueryPlanner
  -> IntentClassifier   (optional)
  -> Embedder           (vector/hybrid mode only)
  -> Retriever
  -> Deduplicator
  -> Reranker
  -> Pagination (slice)
  -> Synthesizer        (optional)
  -> cache.set
  -> SearchResponse
```

Each stage that fails wraps its error in a `SearchError` with a `stage` label matching the step name (e.g. `"embedder"`, `"retriever"`). See [Errors reference](/reference/errors) for the full list.

## SearchClient vs SearchPipeline

`SearchClient` wraps `SearchPipeline` with:

- Empty-query rejection (`stage: "client"`)
- `maxQueryLength` enforcement (`stage: "client"`)
- Optional Standard Schema validation for request (`inputSchema`) and response (`outputSchema`)
- Consistent `SearchError` wrapping for unexpected throws

**Prefer `SearchClient`** for all standard use cases. Use `SearchPipeline` directly only when you need to bypass its input guards or wrap the pipeline in a custom outer layer.

## Composite Retrieval

`CompositeRetriever` fans out to multiple child retrievers in parallel and merges their results with Reciprocal Rank Fusion (RRF). This is how hybrid fulltext + vector search is implemented.

```ts
import { CompositeRetriever } from "kolm-search";

const retriever = new CompositeRetriever(
  [fulltextRetriever, vectorRetriever],
  { strategy: "best-effort", logger },
);
```

Two error strategies are available:

- **`"fail-fast"`** (default) — any retriever failure rejects the entire `retrieve` call immediately (`Promise.all`)
- **`"best-effort"`** — failed retrievers are logged and skipped; fusion proceeds with the surviving results. Throws `SearchError` only when **all** retrievers fail

## Validation and Guardrails

`SearchPipelineOptions` provides guardrails applied by `SearchClient`:

- `maxQueryLength` — rejects overly long queries before they enter the pipeline
- `inputSchema` — validates the incoming `SearchRequest` with any Standard Schema-compatible library (Zod, Valibot, ArkType)
- `outputSchema` — validates the outgoing `SearchResponse`

Both schema failures throw `SchemaValidationError` (not `SearchError`) so callers can distinguish pipeline failures from contract violations.
