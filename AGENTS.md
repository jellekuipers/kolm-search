# kolm-search — Agent Context

Modular, adapter-driven RAG search pipeline library for TypeScript. BYO database, no vendor lock-in. Runs on Node.js, Cloudflare Workers, Bun, and edge runtimes.

## Architecture

```
contracts/   →   core/   →   adapters/   →   presets/
(ports/types)   (pipeline)   (implementations)  (factories)
```

- **`src/contracts/`** — shared types (`types.ts`) and port interfaces (`ports.ts`). Nothing imports from `core/` or `adapters/`.
- **`src/core/`** — pipeline orchestration: `SearchPipeline` (raw engine), `SearchClient` (validated public API), `CompositeRetriever` (merges multiple retrievers via RRF or best-effort), `DefaultQueryPlanner`, `rrf.ts`.
- **`src/adapters/`** — concrete implementations of the ports: `in-memory`, `redis`, `generic` (adapts any retriever function), `cloudflare/` (D1, KV, Vectorize, Workers AI).
- **`src/presets/`** — factory functions that wire modules into a ready-to-use `SearchClient`: `basic` (in-memory), `cloudflare`, `postgres`.

**Pipeline flow:** `SearchClient.search()` → planner → embedder (vector/hybrid only) → retriever → deduplicator → reranker → synthesizer → cache → `SearchResponse`.

## Key Types (`src/contracts/types.ts`)

- `SearchMode = "vector" | "fulltext" | "hybrid"` — default is `"hybrid"`
- `SearchDocument` — `{ id, content, title?, source?, tags?, metadata?, score? }`
- `SearchRequest` — `{ query, limit?, offset?, mode?, filters?, context? }`
- `SearchResponse` — `{ request, plan, results, pagination, answer?, durationMs, metadata? }`
- `SearchPipelineContext` — internal state passed between pipeline stages
- `SearchError` — thrown with a `stage` label (e.g. `"retriever"`, `"embedder"`)

## Port Interfaces (`src/contracts/ports.ts`)

All adapters implement one or more of these interfaces:

| Interface | Method | Required |
|---|---|---|
| `QueryPlanner` | `plan(request): Promise<QueryPlan>` | Yes |
| `Retriever` | `retrieve(context): Promise<SearchDocument[]>` | Yes |
| `Embedder` | `embed(input): Promise<number[]>` | For vector/hybrid |
| `Deduplicator` | `deduplicate(docs): SearchDocument[]` | Optional |
| `Reranker` | `rerank(docs, context): Promise<SearchDocument[]>` | Optional |
| `Synthesizer` | `synthesize(context): Promise<string \| undefined>` | Optional |
| `IntentClassifier` | `classify(query): Promise<string \| undefined>` | Optional |
| `CacheStore` | `get<T>(key): Promise<T \| undefined>`, `set<T>(key, value, ttl?)` | Optional |
| `Telemetry` | `track(event, payload): Promise<void>` | Optional |

## Package Exports

```
kolm-search                    →  src/core/index.ts  (SearchClient, SearchPipeline, CompositeRetriever, etc.)
kolm-search/adapters/in-memory →  src/adapters/in-memory.ts
kolm-search/adapters/generic   →  src/adapters/generic.ts
kolm-search/adapters/redis     →  src/adapters/redis.ts
kolm-search/adapters/cloudflare→  src/adapters/cloudflare/index.ts
kolm-search/presets/basic      →  src/presets/basic.ts
kolm-search/presets/cloudflare →  src/presets/cloudflare.ts
kolm-search/presets/postgres   →  src/presets/postgres.ts
```

New public symbols must be re-exported through the relevant entry point. The root export (`src/core/index.ts`) exports from `src/core/` only — adapters and presets have dedicated entries.

## Adding an Adapter

1. Create `src/adapters/<name>.ts` (or `src/adapters/<name>/index.ts` for multi-file).
2. Implement the relevant port interface(s) from `src/contracts/ports.ts`.
3. Export the class from the file; add a new `exports` entry in `package.json` + a matching entry in `tsdown.config.ts`.
4. Add tests under `tests/adapters/<name>.test.ts`.

Use `InMemoryFulltextRetriever` in `src/adapters/in-memory.ts` as the simplest reference implementation of `Retriever`. Use `KVCacheStore` in `src/adapters/cloudflare/kv-cache.ts` as a reference for `CacheStore`.

## Adding a Preset

1. Create `src/presets/<name>.ts`.
2. Instantiate modules and return `new SearchClient({ planner, retriever, ... }, options)`.
3. Export a `create<Name>SearchClient(...)` factory function — see `src/presets/basic.ts` for the minimal pattern, `src/presets/cloudflare.ts` for a hybrid (vector + fulltext) pattern.
4. Add an `exports` entry in `package.json` and a matching entry in `tsdown.config.ts`.
5. Add tests under `tests/presets/presets.test.ts` or a dedicated file.

## Naming Conventions

- Classes: descriptive noun + role suffix — `Embedder`, `Retriever`, `Reranker`, `Synthesizer`, `Deduplicator`, `CacheStore`, `Planner`
- Factory functions: `create<Preset>SearchClient`
- Options interfaces: `<Class>Options` (e.g. `FulltextRetrieverOptions`)
- No barrel `index.ts` inside `adapters/` or `contracts/` — imports are explicit

## Dev Commands

```bash
pnpm build          # compile with tsdown
pnpm dev            # watch mode
pnpm test           # vitest (all tests)
pnpm lint           # biome lint
pnpm check          # biome check + autofix
pnpm check-types    # tsc --noEmit (root + all workspaces)
```

## Testing Standards

- Framework: Vitest. Coverage thresholds: **80%** lines, branches, and functions.
- Test files live under `tests/` mirroring `src/` structure (e.g. `tests/adapters/`, `tests/core/`).
- Type-level tests use `.test-d.ts` files (e.g. `tests/types/types.test-d.ts`).
- Use `createBasicSearchClient` from `kolm-search/presets/basic` as a test harness for pipeline integration tests — see `tests/pipeline.test.ts`.
- Do not test internal pipeline stages in isolation unless adding a new stage; prefer integration-style tests through `SearchClient`.

## Changelog

Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [Semantic Versioning](https://semver.org/).

- New entries go under `## [Unreleased]` using the standard subsections: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Do not create a versioned section — that is done at release time via `bumpp`.

## Scope

**In scope:** pipeline orchestration, adapter contracts, retriever/reranker/synthesizer implementations, preset factories, RRF, caching, telemetry hooks.

**Out of scope:** document ingestion/indexing pipelines, schema migration, authentication, HTTP transport layer (see `examples/hono-search/` for a usage example).
