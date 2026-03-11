# Getting Started

## Install

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

## First Search Client

```ts
import { createBasicSearchClient } from "kolm-search/presets/basic";

const client = createBasicSearchClient([
  { id: "1", title: "Getting Started", content: "Install and configure kolm-search." },
  { id: "2", title: "Architecture", content: "Modular pipeline with pluggable adapters." },
]);

const response = await client.search({ query: "how to get started" });
console.log(response.results);
```

The basic preset is intended for local development and tests.
For production, prefer a backend-driven preset or custom adapters.

## Search Modes

`SearchMode` supports:

- `"vector"`
- `"fulltext"`
- `"hybrid"` (default)

Use `mode` on each request:

```ts
await client.search({
  query: "vector database tuning",
  mode: "hybrid",
  limit: 10,
});
```

## Request Options

Every `SearchRequest` accepts these optional fields:

```ts
await client.search({
  query: "kolm-search architecture",
  mode: "fulltext",
  limit: 5,
  offset: 10,
  filters: { category: "docs", language: "en" },
  context: { userId: "user-123" },
});
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | `string` | — | Free-text query string (required) |
| `limit` | `number` | `10` | Maximum number of results to return |
| `offset` | `number` | `0` | Zero-based offset for pagination |
| `mode` | `SearchMode` | `"hybrid"` | Retrieval strategy |
| `filters` | `Record<string, JsonValue>` | `{}` | Key/value filters forwarded to the retriever |
| `context` | `Record<string, JsonValue>` | `{}` | Caller-supplied context forwarded through the pipeline unchanged |

`filters` are passed to your retriever's `context.request.filters` — use them to scope queries by tenant, category, date range, or any backend-specific dimension. `context` is similar but intended for non-filter data (e.g. user ID, session info) that downstream modules may use.

> **Note:** The `search()` method is generic: `search<TRequest>(request: TRequest): Promise<SearchResponse>`. This allows custom request types and schema validation.

## Building a Custom Client

When not using a preset, construct `SearchClient` directly. `planner` and `retriever` are **required** — all other modules are optional.

```ts
import { SearchClient, DefaultQueryPlanner } from "kolm-search";
import { createFulltextRetriever } from "kolm-search/adapters/generic";

const client = new SearchClient(
  {
    planner: new DefaultQueryPlanner(),   // required
    retriever: createFulltextRetriever({  // required
      async search(query, limit) {
        return db.searchDocs(query, limit);
      },
      toDocument: (row) => ({ id: row.id, content: row.content }),
    }),
    // embedder, reranker, synthesizer, cache, etc. are optional
  },
  {
    defaultLimit: 10,
    defaultMode: "fulltext",
  },
);
```

## Schema Validation

Pass `inputSchema` and/or `outputSchema` (any Standard Schema-compatible validator) to validate the request and response at the pipeline boundary. Failures throw `SchemaValidationError` — distinct from `SearchError` — so you can distinguish contract violations from pipeline failures.

```ts
import { z } from "zod";
import { SchemaValidationError } from "kolm-search";

const client = new SearchClient(modules, {
  inputSchema: z.object({ query: z.string().min(1) }),
});

try {
  await client.search({ query: "" });
} catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(err.target, err.issues); // "input", [{ message: "..." }]
  }
}
```

## Next Steps

- Learn the pipeline stages in [/guide/architecture](/guide/architecture)
- Pick a preset in [/guide/presets](/guide/presets)
- Explore interfaces in [/reference/contracts](/reference/contracts)
