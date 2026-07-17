import type { QueryPlanner } from "../contracts/ports";
import type { QueryPlan, SearchRequest } from "../contracts/types";

/**
 * Normalise a query string the way the built-in planners do:
 * 1. Trim leading/trailing whitespace.
 * 2. Lowercase the entire string.
 * 3. Collapse consecutive whitespace to a single space.
 */
export const normalizeQuery = (query: string): string =>
	query.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Minimal {@link QueryPlanner} that normalises the query string and sets
 * sensible defaults.
 *
 * Normalisation follows {@link normalizeQuery}.
 *
 * `expandedQueries` is seeded with the single normalised query.
 * No term splitting, synonym expansion, or spell-checking is performed —
 * use `ExpandingQueryPlanner` with a {@link QueryExpander} for multi-query
 * expansion, or substitute a custom `QueryPlanner` implementation.
 */
export class DefaultQueryPlanner implements QueryPlanner {
	public async plan(request: SearchRequest): Promise<QueryPlan> {
		const normalizedQuery = normalizeQuery(request.query);
		return {
			expandedQueries: [normalizedQuery],
			mode: request.mode ?? "hybrid",
			normalizedQuery,
			targetLimit: request.limit ?? 10,
		};
	}
}
