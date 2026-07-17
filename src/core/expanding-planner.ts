import type { QueryExpander, QueryPlanner } from "../contracts/ports";
import type { Logger, QueryPlan, SearchRequest } from "../contracts/types";
import { normalizeQuery } from "./default-planner";

/** Options for {@link ExpandingQueryPlanner}. */
export interface ExpandingQueryPlannerOptions {
	/**
	 * Maximum total number of queries in {@link QueryPlan.expandedQueries},
	 * including the primary query at index 0. Values `<= 1` disable expansion
	 * entirely — the expander is not invoked and the plan contains only the
	 * primary query.
	 * @defaultValue `4`
	 */
	maxQueries?: number;
	/**
	 * Optional logger. Expander failures are surfaced as warnings here while
	 * the planner falls back to the primary query alone.
	 */
	logger?: Logger;
}

const DEFAULT_MAX_QUERIES = 4;

/**
 * {@link QueryPlanner} that performs multi-query expansion via an injected
 * {@link QueryExpander}.
 *
 * The primary query is normalised with {@link normalizeQuery} and always kept
 * at index 0 of {@link QueryPlan.expandedQueries}. Expansions returned by the
 * expander are normalised the same way, deduplicated (against each other and
 * the primary query), and capped at `maxQueries` total.
 *
 * Expander failures and empty expansions degrade gracefully: the plan falls
 * back to the primary query alone and a warning is emitted via the optional
 * logger — degraded relevance is preferred over a failed search.
 *
 * @example LLM-backed expansion
 * ```ts
 * const planner = new ExpandingQueryPlanner({
 *   async expand(query) {
 *     const alternatives = await llm.rewrite(query);
 *     return alternatives; // e.g. ["install kolm-search", "kolm-search setup"]
 *   },
 * });
 * ```
 */
export class ExpandingQueryPlanner implements QueryPlanner {
	private readonly maxQueries: number;
	private readonly logger: Logger | undefined;

	constructor(
		private readonly expander: QueryExpander,
		options: ExpandingQueryPlannerOptions = {},
	) {
		this.maxQueries = options.maxQueries ?? DEFAULT_MAX_QUERIES;
		this.logger = options.logger;
	}

	public async plan(request: SearchRequest): Promise<QueryPlan> {
		const normalizedQuery = normalizeQuery(request.query);

		let expansions: string[] = [];
		if (this.maxQueries > 1) {
			try {
				expansions = await this.expander.expand(normalizedQuery);
			} catch (error) {
				this.logger?.warn(
					"[planner] Query expansion failed; continuing with the primary query only.",
					{ error: error instanceof Error ? error.message : String(error) },
				);
			}
		}

		const expandedQueries = [normalizedQuery];
		for (const expansion of expansions) {
			if (expandedQueries.length >= this.maxQueries) break;
			const normalized = normalizeQuery(expansion);
			if (normalized.length === 0) continue;
			if (expandedQueries.includes(normalized)) continue;
			expandedQueries.push(normalized);
		}

		return {
			expandedQueries,
			mode: request.mode ?? "hybrid",
			normalizedQuery,
			targetLimit: request.limit ?? 10,
		};
	}
}
