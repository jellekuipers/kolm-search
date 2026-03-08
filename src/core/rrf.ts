import type { SearchDocument } from "../contracts/types";

/**
 * Reciprocal Rank Fusion score for a single document at the given rank.
 *
 * @param rank - Zero-based rank position of the document in a results list.
 * @param k - Smoothing constant; `60` is the standard default from the
 *   original Cormack et al. (2009) paper.
 * @returns RRF score in the range `(0, 1]`. Higher is better.
 */
export const rrfScore = (rank: number, k = 60): number => 1 / (k + rank + 1);

/**
 * Merge multiple ranked result lists into a single deduplicated list using
 * Reciprocal Rank Fusion.
 *
 * @param rankedLists - One entry per retriever; each inner array is ordered
 *   best-first (index 0 = rank 0).
 * @param scoreMap - Optional pre-built `id → accumulated score` map to extend.
 *   Pass `undefined` / omit to start fresh.
 * @param limit - Maximum number of documents to return.
 * @param k - RRF smoothing constant forwarded to {@link rrfScore}.
 * @returns Merged list of {@link SearchDocument}, ordered by descending RRF
 *   score, each carrying the fused `score` on the document.
 */
export const mergeWithRrf = (
	rankedLists: SearchDocument[][],
	docMap: Map<string, SearchDocument>,
	limit: number,
	k = 60,
): SearchDocument[] => {
	const accumulated = new Map<string, number>();

	for (const list of rankedLists) {
		for (let index = 0; index < list.length; index++) {
			const document = list[index] as SearchDocument;
			accumulated.set(
				document.id,
				(accumulated.get(document.id) ?? 0) + rrfScore(index, k),
			);
			if (!docMap.has(document.id)) {
				docMap.set(document.id, document);
			}
		}
	}

	return Array.from(accumulated.entries())
		.sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
		.slice(0, limit)
		.map(([id, score]) => ({ ...(docMap.get(id) as SearchDocument), score }));
};
