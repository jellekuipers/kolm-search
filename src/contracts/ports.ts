import type {
	QueryPlan,
	SearchDocument,
	SearchPipelineContext,
	SearchRequest,
} from "./types";

/** Transforms a raw {@link SearchRequest} into a normalised {@link QueryPlan}. */
export interface QueryPlanner {
	/**
	 * @param request - The incoming search request.
	 * @returns A resolved {@link QueryPlan} with a normalised query, mode, and target limit.
	 */
	plan(request: SearchRequest): Promise<QueryPlan>;
}

/**
 * Converts a text string into a dense embedding vector.
 * Required when the pipeline operates in `"vector"` or `"hybrid"` mode.
 */
export interface Embedder {
	/**
	 * @param input - The text string to embed.
	 * @returns A dense float vector representing `input`.
	 */
	embed(input: string): Promise<number[]>;
}

/**
 * Fetches candidate {@link SearchDocument}s from a data source.
 *
 * Implementations may target different backends (fulltext index, vector store,
 * full-text engine, etc.). Multiple retrievers can be composed via
 * `CompositeRetriever`.
 */
export interface Retriever {
	/**
	 * @param context - The current pipeline context, including the resolved query plan,
	 *   optional embeddings, and request filters.
	 * @returns An array of candidate {@link SearchDocument}s, typically pre-sorted by
	 *   descending relevance score.
	 */
	retrieve(context: SearchPipelineContext): Promise<SearchDocument[]>;
}

/**
 * Removes duplicate documents from a results list.
 * Documents are considered duplicates when they share the same `id`.
 */
export interface Deduplicator {
	/**
	 * @param documents - The candidate documents to filter.
	 * @returns A new array with duplicate `id` entries removed, preserving original order.
	 */
	deduplicate(documents: SearchDocument[]): SearchDocument[];
}

/**
 * Re-orders a list of {@link SearchDocument}s after retrieval.
 * Common strategies include score-based sorting and cross-encoder reranking.
 */
export interface Reranker {
	/**
	 * @param documents - Deduplicated candidates to reorder.
	 * @param context - The current pipeline context, available for intent-aware reranking.
	 * @returns The same documents in a new order, potentially with updated scores.
	 */
	rerank(
		documents: SearchDocument[],
		context: SearchPipelineContext,
	): Promise<SearchDocument[]>;
}

/**
 * Generates a natural-language answer from the pipeline context.
 * Typically backed by a large language model.
 *
 * @returns The generated answer string, or `undefined` when synthesis is
 *   skipped (e.g. empty results, model unavailable).
 */
export interface Synthesizer {
	/**
	 * @param context - The pipeline context at the synthesis stage, including
	 *   the final ranked result set in `context.results`.
	 * @returns The generated answer string, or `undefined` when synthesis is
	 *   skipped (e.g. empty results, model unavailable).
	 */
	synthesize(context: SearchPipelineContext): Promise<string | undefined>;
}

/**
 * Classifies a normalised query string into an intent label.
 *
 * @remarks
 * The returned string is opaque — consumers define their own vocabulary
 * and scoring logic. This interface intentionally has no opinion on what
 * valid intent values are.
 *
 * Returning `undefined` signals that classification was inconclusive.
 * The pipeline will continue without setting {@link QueryPlan.intent}.
 *
 * Failures thrown from `classify` are caught by the pipeline's
 * `wrapStage` helper and re-thrown as a {@link SearchError} with
 * `stage: "intent-classifier"`.
 *
 * Inject via {@link SearchPipelineModules.intentClassifier}.
 */
export interface IntentClassifier {
	/**
	 * @param query - The normalised query string produced by the
	 *   {@link QueryPlanner}. Guaranteed to be trimmed, lowercased, and
	 *   free of consecutive whitespace.
	 * @returns The detected intent label, or `undefined` when
	 *   classification is inconclusive or should be skipped.
	 */
	classify(query: string): Promise<string | undefined>;
}

/**
 * Generic key-value cache for storing serialisable values.
 * Used by the pipeline to persist {@link SearchResponse}s between requests.
 */
export interface CacheStore {
	/** @returns The stored value, or `undefined` on a cache miss or expired entry. */
	get<T>(key: string): Promise<T | undefined>;
	/**
	 * @param ttlSeconds - Optional time-to-live. When omitted the entry persists
	 *   indefinitely (or until evicted by the backend).
	 */
	set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
}

/**
 * Observability sink for pipeline events.
 * Failures in `track` are silently swallowed by the pipeline and logged as
 * warnings via the configured {@link Logger}.
 */
export interface Telemetry {
	/**
	 * @param event - The event name. The pipeline emits `"search.completed"`
	 *   after every successful search.
	 * @param payload - Structured event data including `durationMs`, `mode`,
	 *   `resultCount`, and per-stage `stageDurations`.
	 */
	track(event: string, payload: Record<string, unknown>): Promise<void>;
}

/** All modules accepted by {@link SearchPipeline} / {@link SearchClient}. */
export interface SearchPipelineModules {
	/** Required. Normalises the incoming request into a query plan. */
	planner: QueryPlanner;
	/** Required. Fetches candidate documents from the data source. */
	retriever: Retriever;
	/**
	 * Optional. Produces query embeddings for `"vector"` / `"hybrid"` mode.
	 * Required when using {@link VectorizeRetriever} or any vector-based retriever.
	 */
	embedder?: Embedder;
	/** Optional. Removes duplicate documents from the candidate list. */
	deduplicator?: Deduplicator;
	/** Optional. Re-orders results after deduplication. */
	reranker?: Reranker;
	/** Optional. Generates an LLM answer from the final result set. */
	synthesizer?: Synthesizer;
	/**
	 * Optional. Classifies the normalised query into an intent label.
	 *
	 * Called after planning and before retrieval, so the intent is available
	 * in {@link SearchPipelineContext.plan.intent} for all downstream modules.
	 *
	 * @see {@link IntentClassifier}
	 */
	intentClassifier?: IntentClassifier;
	/** Optional. Caches responses to avoid redundant retrieval round-trips. */
	cache?: CacheStore;
	/** Optional. Emits observability events after each successful search. */
	telemetry?: Telemetry;
}
