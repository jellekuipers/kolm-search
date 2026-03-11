import type { SearchPipelineModules } from "../contracts/ports";
import type { StandardSchemaV1 } from "../contracts/standard-schema";
import type {
	SearchPipelineOptions,
	SearchRequest,
	SearchResponse,
} from "../contracts/types";
import { SchemaValidationError, SearchError } from "../contracts/types";
import { SearchPipeline } from "./pipeline";

async function validateSchema<T>(
	schema: StandardSchemaV1<unknown, T>,
	value: unknown,
	target: "input" | "output",
): Promise<T> {
	const result = await schema["~standard"].validate(value);
	if ("value" in result) {
		return result.value;
	}
	throw new SchemaValidationError(target, result.issues);
}

/**
 * Public entry point for the search pipeline.
 *
 * Wraps {@link SearchPipeline} with input guards (empty-query check),
 * optional Standard Schema validation for both request and response, and
 * consistent {@link SearchError} wrapping for unexpected failures.
 *
 * @remarks
 * Construct via a preset (`createBasicSearchClient`,
 * `createCloudflareSearchClient`, etc.) rather than instantiating directly.
 */
export class SearchClient<TRequest extends SearchRequest = SearchRequest> {
	private readonly pipeline: SearchPipeline;
	private readonly options: SearchPipelineOptions<TRequest>;

	constructor(
		modules: SearchPipelineModules,
		options: SearchPipelineOptions<TRequest> = {},
	) {
		this.pipeline = new SearchPipeline(modules, options);
		this.options = options;
	}

	/**
	 * Execute a search request through the full pipeline.
	 *
	 * @param request - The search request. `query` must be non-empty and within
	 *   `maxQueryLength` if configured.
	 * @returns The pipeline response with ranked results, pagination, and optional answer.
	 * @throws {@link SearchError} When the query is empty, exceeds the max length, or any
	 *   pipeline stage fails.
	 * @throws {@link SchemaValidationError} When `inputSchema` or `outputSchema` is
	 *   configured and validation fails.
	 */
	public async search(request: TRequest): Promise<SearchResponse> {
		if (!request.query || request.query.trim() === "") {
			throw new SearchError(
				"[client] Search query must not be empty.",
				"client",
			);
		}

		if (
			this.options.maxQueryLength !== undefined &&
			request.query.length > this.options.maxQueryLength
		) {
			throw new SearchError(
				`[client] Search query exceeds the maximum allowed length of ${this.options.maxQueryLength} characters.`,
				"client",
			);
		}

		const validatedRequest = this.options.inputSchema
			? await validateSchema(this.options.inputSchema, request, "input")
			: request;

		let response: SearchResponse;
		try {
			response = await this.pipeline.search(validatedRequest);
		} catch (error) {
			if (error instanceof SearchError) throw error;
			throw new SearchError(
				`[client] Unexpected search failure: ${error instanceof Error ? error.message : String(error)}`,
				"client",
				error,
			);
		}

		if (this.options.outputSchema) {
			return validateSchema(this.options.outputSchema, response, "output");
		}

		return response;
	}
}
