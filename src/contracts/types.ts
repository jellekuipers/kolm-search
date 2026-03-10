import type { StandardSchemaV1 } from "./standard-schema";

/**
 * Controls which retrieval strategy the pipeline uses.
 *
 * - `"fulltext"` — keyword-based search only.
 * - `"vector"` — dense-embedding similarity search only. Requires an {@link Embedder}.
 * - `"hybrid"` — combines fulltext and vector results via Reciprocal Rank Fusion (default).
 *   Requires an {@link Embedder}.
 */
export type SearchMode = "vector" | "fulltext" | "hybrid";

/**
 * A document returned (or stored) by the search pipeline.
 *
 * `id` and `content` are required. All other fields are optional metadata
 * that adapters may populate and downstream stages (reranker, synthesizer) may use.
 * `score` is a normalised relevance score in the range `[0, 1]`; higher is better.
 */
export interface SearchDocument {
	id: string;
	title?: string;
	content: string;
	source?: string;
	tags?: string[];
	metadata?: Record<string, unknown>;
	score?: number;
}

/**
 * The input passed to {@link SearchClient.search}.
 *
 * Only `query` is required. All other fields fall back to the defaults
 * configured on {@link SearchPipelineOptions}.
 */
export interface SearchRequest {
	/** Free-text query string. Must not be empty. */
	query: string;
	/** Maximum number of documents to return. Defaults to {@link SearchPipelineOptions.defaultLimit}. */
	limit?: number;
	/** Zero-based offset into the candidate list for pagination. */
	offset?: number;
	/** Retrieval strategy. Defaults to {@link SearchPipelineOptions.defaultMode}. */
	mode?: SearchMode;
	/** Arbitrary key/value filters forwarded to the retriever. */
	filters?: Record<string, unknown>;
	/** Caller-supplied context forwarded through the pipeline unchanged. */
	context?: Record<string, unknown>;
}

export interface QueryPlan {
	normalizedQuery: string;
	expandedQueries?: string[];
	/**
	 * The classified intent of the query, populated when an
	 * {@link IntentClassifier} is injected into the pipeline.
	 *
	 * @remarks
	 * The value is an opaque string — consumers define their own intent
	 * vocabulary. The pipeline does not interpret or act on this value;
	 * it is made available in {@link SearchPipelineContext} so that
	 * retrievers, rerankers, and synthesizers can use it if they choose to.
	 * `undefined` means no classifier was provided or classification was
	 * inconclusive.
	 */
	intent?: string;
	mode: SearchMode;
	targetLimit: number;
	metadata?: Record<string, unknown>;
}

/**
 * Pagination metadata attached to every {@link SearchResponse}.
 *
 * @remarks
 * `totalCandidates` is the number of documents returned by the retriever
 * **before** slicing, not the total number of rows in your database.
 * Use it to determine whether a next page may exist (`totalCandidates > offset + limit`).
 */
export interface SearchPagination {
	/** Zero-based start index applied to the candidate list. */
	offset: number;
	/** Maximum number of results returned. */
	limit: number;
	/**
	 * Total candidates available before slicing.
	 * @remarks Not a database row count — see {@link SearchPagination}.
	 */
	totalCandidates: number;
}

/**
 * Metadata attached to a {@link SearchResponse}.
 *
 * Contains library-owned observability fields (`resultCount`, `cacheHit`).
 */
export interface SearchResponseMetadata {
	/** Number of documents in the final result set after pagination. */
	resultCount: number;
	/** `true` when the response was served from the pipeline cache. */
	cacheHit?: boolean;
}

/**
 * The value returned by {@link SearchClient.search}.
 *
 * Contains the final ranked result list, pagination metadata, the resolved
 * query plan, and optional LLM-generated answer and telemetry metadata.
 */
export interface SearchResponse {
	/** The original request passed to {@link SearchClient.search}. */
	request: SearchRequest;
	/** The resolved query plan produced by the {@link QueryPlanner}. */
	plan: QueryPlan;
	/** Ranked result documents after deduplication, reranking, and pagination. */
	results: SearchDocument[];
	/** Pagination metadata describing the slice applied to the candidate list. */
	pagination: SearchPagination;
	/** LLM-generated answer, populated when a {@link Synthesizer} is wired in. */
	answer?: string;
	/** Total wall-clock time for the full pipeline run, in milliseconds. */
	durationMs: number;
	/** Optional metadata emitted by pipeline stages for observability. */
	metadata?: SearchResponseMetadata;
}

/**
 * Mutable state object threaded through all pipeline stages.
 *
 * Each stage reads from and writes to this context. It is created at the
 * start of a `search()` call and discarded once the response is built.
 * Adapters and custom stages should treat fields they do not own as read-only.
 */
export interface SearchPipelineContext {
	/** The validated incoming request. */
	request: SearchRequest;
	/** The resolved query plan, including intent classification result. */
	plan: QueryPlan;
	/** Query embedding vector. Populated by the {@link Embedder} stage. */
	embeddings?: number[];
	/** Raw candidates returned by the retriever before deduplication/reranking. */
	candidates: SearchDocument[];
	/** Final ranked documents after deduplication, reranking, and pagination. */
	results: SearchDocument[];
	/** LLM-generated answer. Populated by the {@link Synthesizer} stage. */
	answer?: string;
	/** Accumulates metadata from pipeline stages for the response `metadata` field. */
	metadata: Record<string, unknown>;
	/** `Date.now()` timestamp when the pipeline run started. Used to compute `durationMs`. */
	startedAt: number;
}

/**
 * Thrown by the search pipeline when a recoverable or unrecoverable error
 * occurs in a named stage.
 *
 * @remarks
 * The `stage` field identifies where the failure occurred. Known values:
 * `"client"`, `"cache.get"`, `"cache.set"`, `"planner"`, `"embedder"`,
 * `"retriever"`, `"reranker"`, `"synthesizer"`, `"composite-retriever"`.
 *
 * Error messages use the format `"[stage] Description."`.
 */
/**
 * Known pipeline stage identifiers used in {@link SearchError.stage}.
 *
 * @example
 * ```ts
 * import { SearchError, PIPELINE_STAGES } from "kolm-search";
 *
 * try {
 *   await client.search({ query });
 * } catch (err) {
 *   if (err instanceof SearchError && err.stage === PIPELINE_STAGES.RETRIEVER) {
 *     // handle retriever failure
 *   }
 * }
 * ```
 */
export const PIPELINE_STAGES = {
	CLIENT: "client",
	CACHE_GET: "cache.get",
	CACHE_SET: "cache.set",
	PLANNER: "planner",
	INTENT_CLASSIFIER: "intent-classifier",
	EMBEDDER: "embedder",
	RETRIEVER: "retriever",
	RERANKER: "reranker",
	SYNTHESIZER: "synthesizer",
	COMPOSITE_RETRIEVER: "composite-retriever",
} as const;

/** Union of all known pipeline stage string values. */
export type PipelineStage =
	(typeof PIPELINE_STAGES)[keyof typeof PIPELINE_STAGES];

export class SearchError extends Error {
	constructor(
		message: string,
		public readonly stage: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "SearchError";
	}
}

export interface SchemaIssue {
	message: string;
	path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
}

/**
 * Thrown when input or output fails Standard Schema validation.
 * `issues` mirrors the failure shape returned by the schema library.
 */
export class SchemaValidationError extends Error {
	constructor(
		public readonly target: "input" | "output",
		public readonly issues: ReadonlyArray<SchemaIssue>,
	) {
		const summary = issues.map((i) => i.message).join("; ");
		super(`Schema validation failed for ${target}: ${summary}`);
		this.name = "SchemaValidationError";
	}
}

/**
 * Minimal structured logger interface.
 * Inject via {@link SearchPipelineOptions.logger} to receive pipeline diagnostics
 * without any dependency on a specific logging library.
 */
export interface Logger {
	debug(message: string, payload?: unknown): void;
	info(message: string, payload?: unknown): void;
	warn(message: string, payload?: unknown): void;
	error(message: string, payload?: unknown): void;
}

export interface SearchPipelineOptions {
	/** Default result limit when not specified on a request. Default: `10`. */
	defaultLimit?: number;
	/** Default search mode when not specified on a request. Default: `"hybrid"`. */
	defaultMode?: SearchMode;
	/** TTL in seconds for cached responses. Default: `60`. */
	cacheTtlSeconds?: number;
	/** Optional logger for non-fatal pipeline warnings (e.g. swallowed telemetry errors). */
	logger?: Logger;
	/**
	 * Optional Standard Schema-compatible schema to validate the incoming
	 * {@link SearchRequest} before it enters the pipeline. Accepts any schema
	 * library that implements the Standard Schema spec (Zod, Valibot, ArkType, …).
	 * Throws {@link SchemaValidationError} on failure.
	 */
	inputSchema?: StandardSchemaV1<unknown, SearchRequest>;
	/**
	 * Optional Standard Schema-compatible schema to validate the {@link SearchResponse}
	 * produced by the pipeline. Throws {@link SchemaValidationError} on failure.
	 */
	outputSchema?: StandardSchemaV1<unknown, SearchResponse>;
	/**
	 * Maximum allowed query length in characters.
	 *
	 * Queries exceeding this limit are rejected by {@link SearchClient} before
	 * entering the pipeline. Throws {@link SearchError} with
	 * `stage: "client"` on violation.
	 *
	 * Default: no limit.
	 */
	maxQueryLength?: number;
}
