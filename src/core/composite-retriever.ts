import type { Retriever } from "../contracts/ports";
import type {
	Logger,
	SearchDocument,
	SearchPipelineContext,
} from "../contracts/types";
import { SearchError } from "../contracts/types";
import { mergeWithRrf } from "./rrf";

/**
 * Strategy used when one or more retrievers fail.
 *
 * - `"fail-fast"` — any retriever failure immediately rejects the whole
 *   `retrieve` call (default, using `Promise.all`).
 * - `"best-effort"` — failed retrievers are logged and skipped; the fusion
 *   proceeds with results from the remaining retrievers.
 */
export type CompositeRetrieverStrategy = "fail-fast" | "best-effort";

/** Options passed to {@link CompositeRetriever}. */
export interface CompositeRetrieverOptions {
	/**
	 * RRF smoothing constant. `60` is the standard default.
	 * @defaultValue `60`
	 */
	k?: number;
	/**
	 * What to do when a retriever throws.
	 * @defaultValue `"fail-fast"`
	 */
	strategy?: CompositeRetrieverStrategy;
	/**
	 * Optional logger. Used by `"best-effort"` to surface retriever failures
	 * as warnings without propagating them to the caller.
	 */
	logger?: Logger;
}

/**
 * A {@link Retriever} that fans out to multiple child retrievers in parallel
 * and fuses their results using Reciprocal Rank Fusion (RRF).
 *
 * @example Hybrid fulltext + vector search with graceful degradation
 * ```ts
 * const retriever = new CompositeRetriever(
 *   [fulltextRetriever, vectorRetriever],
 *   { strategy: "best-effort", logger },
 * );
 * ```
 */
export class CompositeRetriever implements Retriever {
	private readonly k: number;
	private readonly strategy: CompositeRetrieverStrategy;
	private readonly logger: Logger | undefined;

	constructor(
		private readonly retrievers: Retriever[],
		options: CompositeRetrieverOptions = {},
	) {
		this.k = options.k ?? 60;
		this.strategy = options.strategy ?? "fail-fast";
		this.logger = options.logger;
	}

	public async retrieve(
		context: SearchPipelineContext,
	): Promise<SearchDocument[]> {
		const limit = context.plan.targetLimit * 2;

		if (this.strategy === "fail-fast") {
			const rankedLists = await Promise.all(
				this.retrievers.map((retriever) => retriever.retrieve(context)),
			);
			const docMap = new Map<string, SearchDocument>();
			return mergeWithRrf(rankedLists, docMap, limit, this.k);
		}

		// best-effort: collect settled results, log failures, fuse survivors
		const settled = await Promise.allSettled(
			this.retrievers.map((retriever) => retriever.retrieve(context)),
		);

		const rankedLists: SearchDocument[][] = [];
		for (const result of settled) {
			if (result.status === "fulfilled") {
				rankedLists.push(result.value);
			} else {
				const reason = result.reason;
				const message =
					reason instanceof Error ? reason.message : String(reason);
				this.logger?.warn("[composite-retriever] A retriever failed.", {
					error: message,
					stage: reason instanceof SearchError ? reason.stage : "unknown",
				});
			}
		}

		if (rankedLists.length === 0) {
			throw new SearchError(
				"[composite-retriever] All retrievers failed.",
				"composite-retriever",
			);
		}

		const docMap = new Map<string, SearchDocument>();
		return mergeWithRrf(rankedLists, docMap, limit, this.k);
	}
}
