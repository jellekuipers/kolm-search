import type { Retriever } from "../../contracts/ports";
import type {
	SearchDocument,
	SearchPipelineContext,
} from "../../contracts/types";

/** A single match returned by Cloudflare Vectorize. */
interface VectorizeMatch {
	id: string;
	score?: number;
	metadata?: Record<string, NonNullable<unknown>>;
}

interface VectorizeQueryResult {
	matches: VectorizeMatch[];
}

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

		const topK = Math.max(context.plan.targetLimit * 2, 20);
		const result = await this.index.query(context.embeddings, {
			returnMetadata: true,
			topK,
		});

		return result.matches.map((match) => ({
			content: String(match.metadata?.content ?? ""),
			id: match.id,
			metadata: match.metadata,
			score: match.score,
			source: match.metadata?.source
				? String(match.metadata.source)
				: undefined,
			title: match.metadata?.title ? String(match.metadata.title) : undefined,
		}));
	}
}
