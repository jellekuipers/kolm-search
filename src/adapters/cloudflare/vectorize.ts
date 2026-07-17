import type { Retriever } from "../../contracts/ports";
import type {
	JsonValue,
	SearchDocument,
	SearchPipelineContext,
} from "../../contracts/types";
import { mergeWithRrf } from "../../core/rrf";

/** A single match returned by Cloudflare Vectorize. */
interface VectorizeMatch {
	id: string;
	score?: number;
	metadata?: Record<string, JsonValue>;
}

interface VectorizeQueryResult {
	matches: VectorizeMatch[];
}

// Reconstruct a SearchDocument from the metadata stored alongside the vector.
const toDocument = (match: VectorizeMatch): SearchDocument => ({
	content: String(match.metadata?.content ?? ""),
	id: match.id,
	metadata: match.metadata,
	score: match.score,
	source: match.metadata?.source ? String(match.metadata.source) : undefined,
	title: match.metadata?.title ? String(match.metadata.title) : undefined,
});

/**
 * Shape of a Cloudflare Vectorize index binding as exposed in a Worker's `env`.
 */
interface VectorizeIndexBinding {
	query(
		vector: number[],
		options?: { topK?: number; returnMetadata?: boolean },
	): Promise<VectorizeQueryResult>;
}

/**
 * {@link Retriever} backed by a Cloudflare Vectorize index.
 *
 * Returns an empty list (rather than throwing) when no query embeddings are
 * present on the context. Pair with an {@link Embedder} — such as
 * {@link WorkersAIEmbedder} — to populate `context.embeddings`.
 *
 * @remarks
 * `returnMetadata` is always set to `true` so that title, content, and source
 * can be reconstructed from the stored metadata without an extra database
 * round-trip.
 */
export class VectorizeRetriever implements Retriever {
	constructor(private readonly index: VectorizeIndexBinding) {}

	public async retrieve(
		context: SearchPipelineContext,
	): Promise<SearchDocument[]> {
		if (!context.embeddings || context.embeddings.length === 0) {
			return [];
		}

		const vectors =
			context.expandedEmbeddings && context.expandedEmbeddings.length > 0
				? context.expandedEmbeddings
				: [context.embeddings];
		const topK = Math.max(context.plan.targetLimit * 2, 20);

		// Single-vector fast path — no RRF overhead needed
		if (vectors.length === 1) {
			const result = await this.index.query(vectors[0] as number[], {
				returnMetadata: true,
				topK,
			});
			return result.matches.map(toDocument);
		}

		// Fan out to one Vectorize query per expanded-query embedding, then RRF-merge
		const rankedLists = await Promise.all(
			vectors.map(async (vector) => {
				const result = await this.index.query(vector, {
					returnMetadata: true,
					topK,
				});
				return result.matches.map(toDocument);
			}),
		);

		const docMap = new Map<string, SearchDocument>();
		return mergeWithRrf(rankedLists, docMap, topK);
	}
}
