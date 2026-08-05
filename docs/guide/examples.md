# Examples

This page shows practical deployment patterns for `kolm-search`.

Use these examples as architecture templates, not copy/paste-only snippets.

## 1. SaaS documentation search (Postgres + pgvector)

### Use case

You run a documentation product with:

- tenant-specific content
- exact product terminology users search for
- semantic phrasing differences between user questions and article wording

### Recommended setup

- Fulltext retriever against `tsvector`
- Vector retriever against `pgvector`
- `CompositeRetriever` via the Postgres preset
- `embedder` from your model provider
- optional `synthesizer` to generate an answer from citations

```ts
import { createPostgresSearchClient } from "kolm-search/presets/postgres";
import {
  createFulltextRetriever,
  createVectorRetriever,
} from "kolm-search/adapters/generic";

const fulltextRetriever = createFulltextRetriever({
  async search(query, limit, context) {
    const tenantId = String(context.request.filters?.tenantId ?? "public");
    return db.query(
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
});

const vectorRetriever = createVectorRetriever({
  async search(embeddings, limit, context) {
    const tenantId = String(context.request.filters?.tenantId ?? "public");
    return db.query(
      `
      SELECT id, title, content, source,
             1 - (embedding <=> $1::vector) AS similarity
      FROM docs
      WHERE tenant_id = $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
      `,
      [`[${embeddings.join(",")}]`, tenantId, limit],
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
  embedder,
  defaultMode: "hybrid",
  cacheTtlSeconds: 60,
});
```

### Why this works

- Fulltext captures exact terms (`SCIM`, `SAML`, feature flags).
- Vector retrieval captures intent phrased differently.
- RRF combines both rankings without manual score normalization.
- Tenant filtering stays explicit in retriever SQL.

## 2. Cloudflare Worker global search API

### Use case

You serve search at edge locations with Cloudflare and need low-latency hybrid retrieval.

### Recommended setup

- `createCloudflareSearchClient`
- Vectorize index for semantic retrieval
- D1 FTS table for keyword retrieval
- Workers AI for embedding + synthesis
- KV for shared cache

```ts
import { createCloudflareSearchClient } from "kolm-search/presets/cloudflare";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";

    const client = createCloudflareSearchClient(env, {
      d1Table: "docs_fts",
      toDocument: (row) => ({
        id: String(row.id),
        title: String(row.title ?? ""),
        content: String(row.content ?? ""),
        source: String(row.url ?? ""),
        score: Number(row.score ?? 0),
      }),
      queryExpansion: { maxQueries: 4 },
      defaultMode: "hybrid",
      cacheTtlSeconds: 30,
    });

    const result = await client.search({ query: q, limit: 10 });
    return Response.json(result);
  },
};
```

### Why this works

- Query expansion broadens recall for short user queries.
- Expansion degrades gracefully to the base query if the expander fails.
- `best-effort` composite retrieval avoids hard failures if one backend is degraded.

## 3. Enterprise support assistant (strict validation + stage-aware errors)

### Use case

You expose search through a public API and need predictable contracts, clear errors, and safe fallbacks.

### Recommended setup

- `inputSchema` and `outputSchema`
- request-scoped `filters` and `context`
- explicit handling for `SchemaValidationError` and `SearchError`

```ts
import { z } from "zod";
import {
  PIPELINE_STAGES,
  SchemaValidationError,
  SearchError,
  SearchClient,
} from "kolm-search";

const inputSchema = z.object({
  query: z.string().min(2),
  mode: z.enum(["vector", "fulltext", "hybrid"]).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const client = new SearchClient(modules, { inputSchema, maxQueryLength: 500 });

async function searchApiHandler(query: unknown) {
  try {
    return await client.search(query);
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return { status: 400, body: { error: "invalid_request", issues: error.issues } };
    }

    if (error instanceof SearchError) {
      const status =
        error.stage === PIPELINE_STAGES.CLIENT || error.stage === PIPELINE_STAGES.PLANNER
          ? 400
          : 502;
      return { status, body: { error: "search_failed", stage: error.stage } };
    }

    return { status: 500, body: { error: "internal_error" } };
  }
}
```

### Why this works

- Invalid requests are rejected before touching expensive retrieval/model stages.
- Callers can distinguish contract errors from backend errors.
- Stage labels make alerting and incident triage fast.

## 4. Local relevance tuning workflow

### Use case

You want to tune prompts, ranking behavior, and filters before deploying.

### Recommended setup

- `createBasicSearchClient` for deterministic local loops
- stable fixture documents
- snapshot result IDs or top-k order in tests

```ts
import { createBasicSearchClient } from "kolm-search/presets/basic";

const client = createBasicSearchClient(fixtures, {
  defaultLimit: 5,
  defaultMode: "fulltext",
});

const result = await client.search({ query: "billing portal" });
console.log(result.results.map((r) => r.id));
```

### Why this works

- Fast local iteration without external service dependencies.
- Easy test harness for tuning behavior and regression checks.

## Design checklist for production

When moving to production, verify:

- filters are enforced in every retriever query
- cache keys include meaningful request dimensions
- query expansion has a max query count and timeout budget
- synthesizer prompts require citations from retrieved docs
- API maps stage errors to stable status codes
- telemetry captures `durationMs`, `mode`, and stage durations

## Next steps

- Review [Presets](/guide/presets) for environment-specific options.
- Review [Architecture](/guide/architecture) for stage behavior and flow.
- Review [Errors and Stages](/reference/errors) for robust error handling.
