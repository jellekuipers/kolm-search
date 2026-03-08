import type { QueryPlanner } from "../contracts/ports";
import type { QueryPlan, SearchRequest } from "../contracts/types";

/**
 * Minimal {@link QueryPlanner} that normalises the query string and sets
 * sensible defaults.
 *
 * Normalisation steps:
 * 1. Trim leading/trailing whitespace.
 * 2. Lowercase the entire string.
 * 3. Collapse consecutive whitespace to a single space.
 *
 * `expandedQueries` is seeded with the single normalised query.
 * No term splitting, synonym expansion, or spell-checking is performed —
 * substitute a custom `QueryPlanner` implementation for those features.
 */
export class DefaultQueryPlanner implements QueryPlanner {
	public async plan(request: SearchRequest): Promise<QueryPlan> {
		const normalizedQuery = request.query
			.trim()
			.toLowerCase()
			.replace(/\s+/g, " ");
		return {
			expandedQueries: [normalizedQuery],
			mode: request.mode ?? "hybrid",
			normalizedQuery,
			targetLimit: request.limit ?? 10,
		};
	}
}
