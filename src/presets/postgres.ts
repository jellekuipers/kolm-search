import {
	InMemoryCache,
	InMemoryDeduplicator,
	ScoreReranker,
} from "../adapters/in-memory";
import type {
	CacheStore,
	Embedder,
	IntentClassifier,
	QueryPlanner,
	Reranker,
	Retriever,
	Synthesizer,
} from "../contracts/ports";
import type { SearchPipelineOptions } from "../contracts/types";
import type { CompositeRetrieverStrategy } from "../core/composite-retriever";
import { CompositeRetriever } from "../core/composite-retriever";
import { DefaultQueryPlanner } from "../core/default-planner";
import { SearchClient } from "../core/search-client";

/** Options for {@link createPostgresSearchClient}. */
export interface PostgresPresetOptions extends SearchPipelineOptions {
	/**
	 * A {@link Retriever} that performs fulltext search against your PostgreSQL
	 * database. Build one with {@link createFulltextRetriever} from
	 * `kolm-search/adapters/generic`.
	 */
	fulltextRetriever: Retriever;
	/**
	 * Optional {@link Retriever} that performs vector (ANN) search using pgvector
	 * or a similar extension. Build one with {@link createVectorRetriever} from
	 * `kolm-search/adapters/generic`.
	 *
	 * When provided, a {@link CompositeRetriever} is wired to run both
	 * retrievers in parallel and merge their results using Reciprocal Rank
	 * Fusion.
	 */
	vectorRetriever?: Retriever;
	/**
	 * Optional {@link Embedder} that produces query vectors for the
	 * `vectorRetriever`. Required when `vectorRetriever` is provided.
	 */
	embedder?: Embedder;
	/**
	 * Optional {@link IntentClassifier} that classifies the normalised query
	 * into an intent label before retrieval.
	 *
	 * Inject a domain-specific implementation to populate
	 * {@link QueryPlan.intent} in the pipeline context.
	 */
	intentClassifier?: IntentClassifier;
	/**
	 * Optional cache store. Defaults to an in-process {@link InMemoryCache}.
	 *
	 * For multi-instance deployments, provide a shared {@link CacheStore}
	 * (e.g. a Redis adapter) so cache entries are visible across all instances.
	 *
	 * @example
	 * ```ts
	 * const client = createPostgresSearchClient({
	 *   fulltextRetriever,
	 *   cache: myRedisCache, // implements CacheStore
	 * });
	 * ```
	 */
	cache?: CacheStore;
	/**
	 * Optional custom {@link QueryPlanner}. Defaults to {@link DefaultQueryPlanner}.
	 * Inject a domain-specific planner to enable query expansion, stop-word
	 * stripping, and intent-driven query variants.
	 */
	planner?: QueryPlanner;
	/**
	 * Optional {@link Reranker} to apply after RRF fusion.
	 * Defaults to {@link ScoreReranker}.
	 */
	reranker?: Reranker;
	/**
	 * Optional {@link Synthesizer} to generate a natural-language answer from
	 * the final result set. When provided, the answer is included in the
	 * {@link SearchResponse} and is covered by the pipeline's error handling
	 * and response cache.
	 */
	synthesizer?: Synthesizer;
	/**
	 * Strategy used by the {@link CompositeRetriever} when both
	 * `fulltextRetriever` and `vectorRetriever` are provided.
	 *
	 * - `"fail-fast"` — any retriever failure rejects the whole request.
	 * - `"best-effort"` — failed retrievers are logged and skipped; the fusion
	 *   proceeds with results from the remaining retrievers.
	 *
	 * @defaultValue `"best-effort"`
	 */
	compositeStrategy?: CompositeRetrieverStrategy;
}

/**
 * Create a {@link SearchClient} backed by PostgreSQL.
 *
 * Supports fulltext-only or hybrid fulltext + vector search depending on
 * whether `vectorRetriever` and `embedder` are provided.
 *
 * @example Fulltext-only
 * ```ts
 * const client = createPostgresSearchClient({
 *   fulltextRetriever: createFulltextRetriever({ search, toDocument }),
 * });
 * ```
 *
 * @example Hybrid fulltext + pgvector
 * ```ts
 * const client = createPostgresSearchClient({
 *   fulltextRetriever: createFulltextRetriever({ search: ftSearch, toDocument }),
 *   vectorRetriever:   createVectorRetriever({ search: vecSearch, toDocument }),
 *   embedder:          myEmbedder,
 * });
 * ```
 *
 * @remarks
 * When no `cache` option is provided, an in-process {@link InMemoryCache} is
 * used. It is reset on restart and is not shared across instances — pass a
 * `cache` implementation (e.g. Redis) for shared caching in production.
 */
export const createPostgresSearchClient = (
	options: PostgresPresetOptions,
): SearchClient => {
	const {
		fulltextRetriever,
		vectorRetriever,
		embedder,
		cache,
		intentClassifier,
		planner,
		reranker,
		synthesizer,
		compositeStrategy,
		...pipelineOptions
	} = options;

	const retriever = vectorRetriever
		? new CompositeRetriever([fulltextRetriever, vectorRetriever], {
				strategy: compositeStrategy ?? "best-effort",
				logger: pipelineOptions.logger,
			})
		: fulltextRetriever;

	return new SearchClient(
		{
			cache: cache ?? new InMemoryCache(),
			deduplicator: new InMemoryDeduplicator(),
			embedder,
			intentClassifier,
			planner: planner ?? new DefaultQueryPlanner(),
			reranker: reranker ?? new ScoreReranker(),
			retriever,
			synthesizer,
		},
		pipelineOptions,
	);
};
