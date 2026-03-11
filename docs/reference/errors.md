# Errors and Stages

The pipeline throws two distinct error types so callers can react consistently.

## `SearchError`

Thrown when a named pipeline stage fails. Always carries a `stage` label identifying where the failure occurred.

```ts
import { SearchError, PIPELINE_STAGES } from "kolm-search";

try {
  await client.search({ query: "how to configure cache" });
} catch (error) {
  if (error instanceof SearchError) {
    console.error(error.stage, error.message, error.cause);
  }
  throw error;
}
```

Use `PIPELINE_STAGES` constants (see [Core API reference](/reference/core#pipeline_stages)) to compare stages without hard-coding strings:

```ts
if (error instanceof SearchError && error.stage === PIPELINE_STAGES.EMBEDDER) {
  // embedding service is unavailable — degrade gracefully
}
```

## `SchemaValidationError`

Thrown by `SearchClient` when `inputSchema` or `outputSchema` validation fails. This is a **contract error**, not a pipeline failure — it means the data shape was invalid before or after the pipeline ran.

```ts
import { SchemaValidationError } from "kolm-search";

try {
  await client.search(request);
} catch (error) {
  if (error instanceof SchemaValidationError) {
    // error.target: "input" | "output"
    // error.issues: ReadonlyArray<{ message: string; path?: ... }>
    console.error("Schema validation failed on", error.target, error.issues);
  }
}
```

## Pipeline Stage Labels

| Stage label | When it fires |
| --- | --- |
| `"client"` | Empty query, query exceeds `maxQueryLength`, or unexpected error wrapping |
| `"cache.get"` | Cache read failed |
| `"cache.set"` | Cache write failed |
| `"planner"` | `QueryPlanner.plan()` threw |
| `"intent-classifier"` | `IntentClassifier.classify()` threw |
| `"embedder"` | `Embedder.embed()` threw |
| `"retriever"` | `Retriever.retrieve()` threw |
| `"reranker"` | `Reranker.rerank()` threw |
| `"synthesizer"` | `Synthesizer.synthesize()` threw |
| `"composite-retriever"` | All child retrievers in a `CompositeRetriever` failed (best-effort strategy) |

> **Note:** `"deduplicator"` is not a stage label — the deduplicator is synchronous and its errors propagate without wrapping.

## Recommendations

- Log `error.stage` and request metadata for observability
- Surface safe, generic error messages to end-users
- Retry only for transient backend failures (retriever, embedder timeouts)
- Use `PIPELINE_STAGES` constants for type-safe comparisons
- Handle `SchemaValidationError` separately from `SearchError` — it indicates a developer configuration issue, not a runtime failure
