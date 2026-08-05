# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.1] - 2026-08-05

### Fixed

- Hono example type checking by enabling Node type globals in `examples/hono-search/tsconfig.json`.
- CI compatibility with `pnpm@11.20.0` by removing Node.js 20 from the CI matrix.

### Changed

- Expanded and clarified project documentation and README examples, including dedicated examples guidance and improved API reference coverage.

## [1.1.0] - 2026-07-17

### Added

- `ExpandingQueryPlanner` — multi-query expansion planner driven by a new `QueryExpander` port. The primary query always stays first; expansions are normalised, deduplicated, and capped (`maxQueries`, default 4). Expander failures degrade gracefully to the primary query.
- `QueryExpander` port interface for pluggable expansion sources (LLMs, synonym services, rewrite tables).
- Optional `Embedder.embedMany(inputs)` batch method — used by the pipeline to embed all expanded queries in one call when available.
- `SearchPipelineContext.expandedEmbeddings` — one embedding per expanded query (index-aligned), populated in vector/hybrid mode. `embeddings` remains the primary query's vector.
- `WorkersAIQueryExpander` adapter and `queryExpansion` option on `createCloudflareSearchClient` (off by default).
- `primaryQueryBoost` option on `createVectorRetriever`, mirroring the fulltext factory.
- `normalizeQuery` helper exported from the root entry point.

### Changed

- All built-in retrievers now honor multi-query expansion: `InMemoryFulltextRetriever`, `InMemoryVectorRetriever`, `D1FulltextRetriever`, `VectorizeRetriever`, and `createVectorRetriever` fan out across expanded queries (or their embeddings) and merge the ranked lists with Reciprocal Rank Fusion. Single-query plans keep the previous behaviour unchanged.
- `WorkersAIEmbedder` implements `embedMany`, batching all expanded queries into a single Workers AI call.

## [0.1.7] - 2026-03-11

### Changed

- Fix additional context and filter values to JSON value

## [0.1.7] - 2026-03-11

### Changed

- Fix metadatatype to JSON value

## [0.1.6] - 2026-03-11

### Changed

- README and documentation updates.

## [0.1.5] - 2026-03-10

### Changed

- README updates.

## [0.1.4] - 2026-03-10

### Changed

- Replace `SearchResponse.metadata` type with a new `SearchResponseMetadata` interface providing typed `resultCount` and optional `cacheHit` fields.

### Added

- `SearchResponseMetadata` interface — typed response metadata with `resultCount` and optional `cacheHit`, exported from the root entry point.

## [0.1.3] - 2026-03-09

### Changed

- README improvements.

## [0.1.2] - 2026-03-09

### Changed

- README improvements.

## [0.1.1] - 2026-03-09

### Changed

- README improvements.

## [0.1.0] - 2026-03-08

### Added

- Initial public release.