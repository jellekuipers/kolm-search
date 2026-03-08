import type { Retriever } from "../contracts/ports";
import type { SearchDocument, SearchPipelineContext } from "../contracts/types";
import { SearchError } from "../contracts/types";
import { mergeWithRrf } from "../core/rrf";

// ---------------------------------------------------------------------------
// createFulltextRetriever
// ---------------------------------------------------------------------------

/**
 * Options for {@link createFulltextRetriever}.
 * @template TRow - The raw row type returned by your database driver.
 */
export interface FulltextRetrieverOptions<TRow> {
	/**
	 * Execute a fulltext search against your database and return raw rows.
	 *
	 * @param query - The normalised search query string.
	 * @param limit - Maximum number of rows to return.
	 * @param context - The full pipeline context, including request filters.
	 */
	search(
		query: string,
		limit: number,
		context: SearchPipelineContext,
	): Promise<TRow[]>;
	/**
	 * Map a raw database row to a {@link SearchDocument}.
	 *
	 * @param row - A single row returned by {@link FulltextRetrieverOptions.search}.
	 */
	toDocument(row: TRow): SearchDocument;
	/**
	 * How many times the first expanded query (the primary / base query) is
	 * counted in the RRF merge relative to every other expanded variant.
	 *
	 * Defaults to `1` (all queries carry equal weight). Set to `2` to give the
	 * primary query double the RRF signal so exact-intent matches are not
	 * outranked by documents that appear across many tangentially-related
	 * expanded variants.
	 *
	 * @example
	 * ```ts
	 * createFulltextRetriever({ search, toDocument, primaryQueryBoost: 2 });
	 * ```
	 */
	primaryQueryBoost?: number;
}

/**
 * Creates a {@link Retriever} backed by any fulltext-capable database using a
 * callback factory pattern. Your application code provides the query function;
 * this adapter handles pipeline wiring.
 *
 * @example Using Prisma `$queryRaw` with PostgreSQL tsvector
 * ```ts
 * const retriever = createFulltextRetriever({
 *   async search(query, limit) {
 *     return prisma.$queryRaw<{ id: string; title: string; content: string; rank: number }[]>`
 *       SELECT id, title, content, ts_rank(search_vector, plainto_tsquery(${query})) AS rank
 *       FROM articles
 *       WHERE search_vector @@ plainto_tsquery(${query})
 *       ORDER BY rank DESC
 *       LIMIT ${limit}
 *     `;
 *   },
 *   toDocument: (row) => ({
 *     id: row.id,
 *     title: row.title,
 *     content: row.content,
 *     score: row.rank,
 *   }),
 * });
 * ```
 */
export const createFulltextRetriever = <TRow>(
	options: FulltextRetrieverOptions<TRow>,
): Retriever => ({
	async retrieve(context: SearchPipelineContext): Promise<SearchDocument[]> {
		const queries =
			context.plan.expandedQueries && context.plan.expandedQueries.length > 0
				? context.plan.expandedQueries
				: [context.plan.normalizedQuery];
		const limit = context.plan.targetLimit * 2;

		// Single-query fast path — no RRF overhead needed
		if (queries.length === 1) {
			const rows = await options.search(queries[0] as string, limit, context);
			return rows.map(options.toDocument);
		}

		// Fan out to one DB call per expanded query, then RRF-merge the ranked lists
		const rankedLists = await Promise.all(
			queries.map(async (query) => {
				const rows = await options.search(query, limit, context);
				return rows.map(options.toDocument);
			}),
		);

		// Repeat the primary (first) query's ranked list N-1 extra times so it
		// accumulates proportionally more RRF score than the expanded variants.
		// primaryQueryBoost=2 means the base query has 2x the signal of each
		// expanded variant, preventing an exact-match result from being outranked
		// by a document that scores mediocrely-but-consistently across expansions.
		const boost = options.primaryQueryBoost ?? 1;
		const [primaryList] = rankedLists;
		const mergeInput =
			boost > 1 && primaryList !== undefined
				? [
						...Array.from({ length: boost - 1 }, () => primaryList),
						...rankedLists,
					]
				: rankedLists;

		const docMap = new Map<string, SearchDocument>();
		return mergeWithRrf(mergeInput, docMap, limit);
	},
});

// ---------------------------------------------------------------------------
// createVectorRetriever
// ---------------------------------------------------------------------------

/**
 * Options for {@link createVectorRetriever}.
 * @template TRow - The raw row type returned by your database driver.
 */
export interface VectorRetrieverOptions<TRow> {
	/**
	 * Execute a vector (ANN) search using pre-computed query embeddings.
	 *
	 * @param embeddings - The query embedding vector produced by the pipeline's
	 *   {@link Embedder}. Guaranteed to be non-empty when this callback is called.
	 * @param limit - Maximum number of rows to return.
	 * @param context - The full pipeline context.
	 */
	search(
		embeddings: number[],
		limit: number,
		context: SearchPipelineContext,
	): Promise<TRow[]>;
	/**
	 * Map a raw database row to a {@link SearchDocument}.
	 *
	 * @param row - A single row returned by {@link VectorRetrieverOptions.search}.
	 */
	toDocument(row: TRow): SearchDocument;
}

/**
 * Creates a {@link Retriever} backed by any vector-capable database using a
 * callback factory pattern.
 *
 * Throws {@link SearchError} when no query embeddings are present on the
 * context (i.e. no {@link Embedder} is wired into the pipeline).
 *
 * @example Using Prisma `$queryRaw` with pgvector
 * ```ts
 * const retriever = createVectorRetriever({
 *   async search(embeddings, limit) {
 *     const vector = `[${embeddings.join(",")}]`;
 *     return prisma.$queryRaw<{ id: string; title: string; content: string; similarity: number }[]>`
 *       SELECT id, title, content,
 *              1 - (embedding <=> ${vector}::vector) AS similarity
 *       FROM articles
 *       ORDER BY embedding <=> ${vector}::vector
 *       LIMIT ${limit}
 *     `;
 *   },
 *   toDocument: (row) => ({
 *     id: row.id,
 *     title: row.title,
 *     content: row.content,
 *     score: row.similarity,
 *   }),
 * });
 * ```
 */
export const createVectorRetriever = <TRow>(
	options: VectorRetrieverOptions<TRow>,
): Retriever => ({
	async retrieve(context: SearchPipelineContext): Promise<SearchDocument[]> {
		if (!context.embeddings || context.embeddings.length === 0) {
			throw new SearchError(
				"[retriever] createVectorRetriever requires query embeddings. " +
					"Make sure an Embedder is wired into the pipeline.",
				"retriever",
			);
		}
		const limit = context.plan.targetLimit * 2;
		const rows = await options.search(context.embeddings, limit, context);
		return rows.map(options.toDocument);
	},
});
