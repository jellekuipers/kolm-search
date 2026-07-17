import type {
	Embedder,
	QueryExpander,
	Synthesizer,
} from "../../contracts/ports";
import type { SearchPipelineContext } from "../../contracts/types";
import { SearchError } from "../../contracts/types";

interface WorkersAIRunResult {
	response?: string;
	data?: number[][];
}

interface WorkersAIBinding {
	run(
		model: string,
		input: Record<string, unknown>,
	): Promise<WorkersAIRunResult>;
}

/**
 * Function that builds the LLM prompt string from a pipeline context.
 * Override via {@link WorkersAISynthesizerOptions.promptBuilder}.
 */
export type PromptBuilder = (context: SearchPipelineContext) => string;

const defaultPromptBuilder: PromptBuilder = (context) => {
	const snippets = context.results
		.slice(0, 5)
		.map((result) => `- ${result.title ?? result.id}: ${result.content}`)
		.join("\n");

	return [
		"Answer the query using the provided search snippets.",
		`Query: ${context.request.query}`,
		"Snippets:",
		snippets,
	].join("\n\n");
};

export interface WorkersAISynthesizerOptions {
	/** Custom function to build the LLM prompt from pipeline context. */
	promptBuilder?: PromptBuilder;
}

/**
 * {@link Embedder} backed by a Cloudflare Workers AI text-embedding model.
 *
 * @remarks
 * The default model `@cf/baai/bge-base-en-v1.5` produces 768-dimensional
 * vectors. Change `embeddingModel` if your Vectorize index uses a different
 * dimensionality.
 */
export class WorkersAIEmbedder implements Embedder {
	constructor(
		private readonly ai: WorkersAIBinding,
		private readonly model = "@cf/baai/bge-base-en-v1.5",
	) {}

	/**
	 * @param input - The text string to embed.
	 * @returns A dense float vector produced by the Workers AI embedding model.
	 * @throws {@link SearchError} When the Workers AI binding returns an empty result.
	 */
	public async embed(input: string): Promise<number[]> {
		const output = await this.ai.run(this.model, {
			text: [input],
		});

		const vector = output.data?.[0];
		if (!vector) {
			throw new SearchError(
				"[embedder] Workers AI embedder returned no vector data.",
				"embedder",
			);
		}

		return vector;
	}

	/**
	 * Batch variant used by the pipeline for multi-query expansion — the
	 * Workers AI embedding endpoint accepts an array of texts natively, so all
	 * expanded queries are embedded in a single call.
	 *
	 * @param inputs - The text strings to embed.
	 * @returns One dense float vector per input, index-aligned with `inputs`.
	 * @throws {@link SearchError} When the binding returns a mismatched number of vectors.
	 */
	public async embedMany(inputs: string[]): Promise<number[][]> {
		const output = await this.ai.run(this.model, {
			text: inputs,
		});

		const vectors = output.data;
		if (!vectors || vectors.length !== inputs.length) {
			throw new SearchError(
				`[embedder] Workers AI embedder returned ${vectors?.length ?? 0} vectors for ${inputs.length} inputs.`,
				"embedder",
			);
		}

		return vectors;
	}
}

/** Options for {@link WorkersAIQueryExpander}. */
export interface WorkersAIQueryExpanderOptions {
	/**
	 * Maximum number of alternative phrasings to request from the model.
	 * @defaultValue `3`
	 */
	maxExpansions?: number;
}

/**
 * {@link QueryExpander} backed by a Cloudflare Workers AI chat-completion
 * model. Pair with `ExpandingQueryPlanner` to enable multi-query retrieval.
 *
 * The model is asked for newline-separated alternative phrasings; the output
 * is parsed defensively (list markers and quotes stripped, empties dropped).
 * The planner re-normalises and deduplicates the result, so imperfect model
 * output degrades to fewer expansions rather than failures.
 */
export class WorkersAIQueryExpander implements QueryExpander {
	private readonly maxExpansions: number;

	constructor(
		private readonly ai: WorkersAIBinding,
		private readonly model = "@cf/meta/llama-3.1-8b-instruct",
		options: WorkersAIQueryExpanderOptions = {},
	) {
		this.maxExpansions = options.maxExpansions ?? 3;
	}

	public async expand(query: string): Promise<string[]> {
		const prompt = [
			`Rewrite the following search query into ${this.maxExpansions} alternative phrasings that capture the same intent.`,
			"Rules: one phrasing per line, no numbering, no bullet points, no explanations, no quotes.",
			`Query: ${query}`,
		].join("\n");

		const output = await this.ai.run(this.model, {
			prompt,
			stream: false,
		});

		if (!output.response) {
			return [];
		}

		return output.response
			.split("\n")
			.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
			.map((line) => line.replace(/^["'`]+|["'`]+$/g, ""))
			.filter((line) => line.length > 0)
			.slice(0, this.maxExpansions);
	}
}

/**
 * {@link Synthesizer} backed by a Cloudflare Workers AI chat-completion model.
 *
 * Returns `undefined` when the result set is empty to avoid generating
 * hallucinated answers with no grounding context.
 */
export class WorkersAISynthesizer implements Synthesizer {
	private readonly promptBuilder: PromptBuilder;

	constructor(
		private readonly ai: WorkersAIBinding,
		private readonly model = "@cf/meta/llama-3.1-8b-instruct",
		options: WorkersAISynthesizerOptions = {},
	) {
		this.promptBuilder = options.promptBuilder ?? defaultPromptBuilder;
	}

	public async synthesize(
		context: SearchPipelineContext,
	): Promise<string | undefined> {
		if (context.results.length === 0) {
			return undefined;
		}

		const prompt = this.promptBuilder(context);

		const output = await this.ai.run(this.model, {
			prompt,
			stream: false,
		});

		return output.response?.trim() || undefined;
	}
}
