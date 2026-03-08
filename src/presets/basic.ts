import {
	InMemoryCache,
	InMemoryDeduplicator,
	InMemoryFulltextRetriever,
	ScoreReranker,
} from "../adapters/in-memory";
import type { CacheStore } from "../contracts/ports";
import type { SearchDocument, SearchPipelineOptions } from "../contracts/types";
import { DefaultQueryPlanner } from "../core/default-planner";
import { SearchClient } from "../core/search-client";

/**
 * Create a {@link SearchClient} backed entirely by in-memory data structures.
 *
 * Suitable for local development, tests, and demos. Not recommended for
 * production workloads — use a database-backed preset instead.
 *
 * @param documents - Initial document corpus to search over.
 * @param options - Optional pipeline configuration (limit, mode, TTL, …).
 * @param cache - Optional cache store. Defaults to {@link InMemoryCache}.
 *
 * @remarks
 * All data is held in process memory and reset on each restart. Fulltext
 * scoring is based on token-overlap fraction; there is no vector/embedding
 * support in this preset. Compose {@link InMemoryFulltextRetriever} with
 * {@link InMemoryVectorRetriever} via {@link CompositeRetriever} if you need
 * hybrid search in tests.
 */
export const createBasicSearchClient = (
	documents: SearchDocument[],
	options: SearchPipelineOptions = {},
	cache?: CacheStore,
): SearchClient => {
	return new SearchClient(
		{
			cache: cache ?? new InMemoryCache(),
			deduplicator: new InMemoryDeduplicator(),
			planner: new DefaultQueryPlanner(),
			reranker: new ScoreReranker(),
			retriever: new InMemoryFulltextRetriever(documents),
		},
		options,
	);
};
