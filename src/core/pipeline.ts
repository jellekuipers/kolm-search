import type { SearchPipelineModules } from "../contracts/ports";
import type {
	SearchPagination,
	SearchPipelineContext,
	SearchPipelineOptions,
	SearchRequest,
	SearchResponse,
} from "../contracts/types";
import { SearchError } from "../contracts/types";

const DEFAULT_LIMIT = 10;
const DEFAULT_MODE = "hybrid" as const;
const DEFAULT_CACHE_TTL = 60;

/**
 * Deterministic JSON serialisation: object keys are sorted recursively so that
 * `{b:2,a:1}` and `{a:1,b:2}` produce identical strings.
 */
const stableStringify = (value: unknown): string => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return JSON.stringify(value);
	}
	const obj = value as Record<string, unknown>;
	const pairs = Object.keys(obj)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
	return `{${pairs.join(",")}}`;
};

const cacheKeyFor = (
	request: SearchRequest,
	options: SearchPipelineOptions,
): string => {
	const mode = request.mode ?? options.defaultMode ?? DEFAULT_MODE;
	const limit = request.limit ?? options.defaultLimit ?? DEFAULT_LIMIT;
	const offset = request.offset ?? 0;
	const filters = stableStringify(request.filters ?? {});
	const context = stableStringify(request.context ?? {});
	return `search:${mode}:${limit}:${offset}:${request.query}:${filters}:${context}`;
};

const wrapStage = async <T>(
	stage: string,
	fn: () => Promise<T>,
): Promise<T> => {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof SearchError) throw error;
		throw new SearchError(
			`[${stage}] ${error instanceof Error ? error.message : String(error)}`,
			stage,
			error,
		);
	}
};

/**
 * Core search orchestration engine.
 *
 * Wires together the full retrieval pipeline: planning → embedding →
 * retrieval → deduplication → reranking → synthesis, with optional caching
 * and telemetry at each step.
 *
 * @remarks
 * Prefer {@link SearchClient} over constructing `SearchPipeline` directly —
 * `SearchClient` adds input validation, empty-query guards, and Standard
 * Schema support on top of the raw pipeline.
 */
export class SearchPipeline {
	private readonly options: SearchPipelineOptions;

	constructor(
		private readonly modules: SearchPipelineModules,
		options: SearchPipelineOptions = {},
	) {
		this.options = options;
	}

	public async search(request: SearchRequest): Promise<SearchResponse> {
		const startedAt = Date.now();
		const cacheKey = cacheKeyFor(request, this.options);

		// Per-stage timing accumulated for telemetry.
		const stageDurations: Record<string, number> = {};
		const timedStage = async <T>(
			stage: string,
			fn: () => Promise<T>,
		): Promise<T> => {
			const t = Date.now();
			const result = await wrapStage(stage, fn);
			stageDurations[stage] = Date.now() - t;
			return result;
		};

		if (this.modules.cache) {
			const cache = this.modules.cache;
			const cached = await timedStage("cache.get", () =>
				cache.get<SearchResponse>(cacheKey),
			);
			if (cached) {
				return {
					...cached,
					durationMs: Date.now() - startedAt,
					metadata: {
						...(cached.metadata ?? { resultCount: 0 }),
						cacheHit: true,
					},
				};
			}
		}

		const plan = await timedStage("planner", () =>
			this.modules.planner.plan(request),
		);
		const context: SearchPipelineContext = {
			request,
			plan: {
				// Merge order: request > options defaults > planner result.
				// The planner may compute its own defaults (e.g. limit=10, mode="hybrid");
				// options-level defaults take precedence over those.
				...plan,
				mode: request.mode ?? this.options.defaultMode ?? plan.mode,
				targetLimit:
					request.limit ?? this.options.defaultLimit ?? plan.targetLimit,
			},
			candidates: [],
			results: [],
			metadata: {},
			startedAt,
		};

		if (this.modules.intentClassifier) {
			const intentClassifier = this.modules.intentClassifier;
			const detectedIntent = await timedStage("intent-classifier", () =>
				intentClassifier.classify(context.plan.normalizedQuery),
			);
			context.plan.intent = detectedIntent;
		}

		if (
			this.modules.embedder &&
			(context.plan.mode === "vector" || context.plan.mode === "hybrid")
		) {
			const embedder = this.modules.embedder;
			context.embeddings = await timedStage("embedder", () =>
				embedder.embed(context.plan.normalizedQuery),
			);
		}

		context.candidates = await timedStage("retriever", () =>
			this.modules.retriever.retrieve(context),
		);
		context.results = [...context.candidates];

		if (this.modules.deduplicator) {
			context.results = this.modules.deduplicator.deduplicate(context.results);
		}

		if (this.modules.reranker) {
			const reranker = this.modules.reranker;
			context.results = await timedStage("reranker", () =>
				reranker.rerank(context.results, context),
			);
		}

		const offset = request.offset ?? 0;
		const limit = request.limit ?? context.plan.targetLimit;
		const totalCandidates = context.results.length;
		context.results = context.results.slice(offset, offset + limit);

		const pagination: SearchPagination = { offset, limit, totalCandidates };

		if (this.modules.synthesizer) {
			const synthesizer = this.modules.synthesizer;
			context.answer = await timedStage("synthesizer", () =>
				synthesizer.synthesize(context),
			);
		}

		const response: SearchResponse = {
			answer: context.answer,
			durationMs: Date.now() - startedAt,
			metadata: {
				resultCount: context.results.length,
			},
			pagination,
			plan: context.plan,
			request,
			results: context.results,
		};

		if (this.modules.cache) {
			const cache = this.modules.cache;
			await timedStage("cache.set", () =>
				cache.set(
					cacheKey,
					response,
					this.options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL,
				),
			);
		}

		if (this.modules.telemetry) {
			// Telemetry failures must never surface to callers.
			try {
				await this.modules.telemetry.track("search.completed", {
					durationMs: response.durationMs,
					mode: context.plan.mode,
					resultCount: response.results.length,
					stageDurations,
				});
			} catch (error) {
				this.options.logger?.warn("[telemetry] Tracking call failed.", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return response;
	}
}
