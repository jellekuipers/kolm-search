import type { Retriever } from "../../contracts/ports";
import type {
	SearchDocument,
	SearchPipelineContext,
} from "../../contracts/types";

/** A Cloudflare D1 statement after arguments have been bound. */
interface D1BoundStatement {
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

/** Shape of a Cloudflare D1 prepared statement. */
interface D1PreparedStatement {
	bind(...values: unknown[]): D1BoundStatement;
}

/**
 * Shape of a Cloudflare D1 database binding as exposed in a Worker's `env`.
 * Matches the subset used by {@link D1FulltextRetriever}.
 */
interface D1DatabaseBinding {
	prepare(query: string): D1PreparedStatement;
}

/**
 * Options for {@link D1FulltextRetriever}.
 * @template TRow - The raw row type returned by D1. Must include the fields
 *   that {@link toDocument} maps to a {@link SearchDocument}.
 */
export interface D1FulltextRetrieverOptions<TRow> {
	/**
	 * Name of the FTS5 virtual table in your D1 database.
	 *
	 * @example `"articles_fts"`
	 */
	table: string;
	/**
	 * Map a raw D1 result row to a {@link SearchDocument}.
	 *
	 * @param row - A row returned by the FTS5 MATCH query. The row includes all
	 *   columns from the virtual table plus a `score` field — a **positive**
	 *   BM25 score (higher = more relevant). D1's native `rank` column is
	 *   negative; this adapter negates it for you.
	 */
	toDocument(row: TRow & { score: number }): SearchDocument;
}

/**
 * {@link Retriever} backed by a Cloudflare D1 FTS5 virtual table.
 *
 * Issues a parameterised `... WHERE "{table}" MATCH ? ORDER BY rank LIMIT ?`
 * query. D1 FTS5 `rank` is a negative BM25 value (more negative = more
 * relevant); this adapter negates it to a positive `score` so that
 * {@link ScoreReranker} and {@link CompositeRetriever} behave consistently.
 *
 * @example
 * ```ts
 * const retriever = new D1FulltextRetriever(env.DB, {
 *   table: "articles_fts",
 *   toDocument: (row) => ({
 *     id: row.id,
 *     title: row.title,
 *     content: row.body,
 *     score: row.score,
 *   }),
 * });
 * ```
 *
 * @remarks
 * The FTS5 table must be created with `content=""` or as a content table that
 * includes the columns referenced in `toDocument`. Refer to the SQLite FTS5
 * documentation for setup.
 */
export class D1FulltextRetriever<TRow extends Record<string, unknown>>
	implements Retriever
{
	constructor(
		private readonly db: D1DatabaseBinding,
		private readonly options: D1FulltextRetrieverOptions<TRow>,
	) {}

	public async retrieve(
		context: SearchPipelineContext,
	): Promise<SearchDocument[]> {
		const query =
			context.plan.expandedQueries?.[0] ?? context.plan.normalizedQuery;
		const limit = context.plan.targetLimit * 2;
		const { table } = this.options;

		const sql = `SELECT *, -rank AS score FROM "${table}" WHERE "${table}" MATCH ? ORDER BY rank LIMIT ?`;
		const { results } = await this.db
			.prepare(sql)
			.bind(query, limit)
			.all<TRow & { score: number }>();

		return results.map(this.options.toDocument);
	}
}
