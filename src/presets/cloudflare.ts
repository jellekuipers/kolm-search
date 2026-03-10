import { D1FulltextRetriever } from "../adapters/cloudflare/d1-fulltext";
import { KVCacheStore } from "../adapters/cloudflare/kv-cache";
import { VectorizeRetriever } from "../adapters/cloudflare/vectorize";
import type { PromptBuilder } from "../adapters/cloudflare/workers-ai";
import {
	WorkersAIEmbedder,
	WorkersAISynthesizer,
} from "../adapters/cloudflare/workers-ai";
import { InMemoryDeduplicator, ScoreReranker } from "../adapters/in-memory";
import type { SearchDocument, SearchPipelineOptions } from "../contracts/types";
import { CompositeRetriever } from "../core/composite-retriever";
import { DefaultQueryPlanner } from "../core/default-planner";
import { SearchClient } from "../core/search-client";

/** Cloudflare Worker environment bindings used by {@link createCloudflareSearchClient}. */
export interface CloudflarePresetEnv {
	AI: {
		run(
			model: string,
			input: Record<string, unknown>,
		): Promise<{
			response?: string;
			data?: number[][];
		}>;
	};
	VECTOR_INDEX: {
		query(
			vector: number[],
			options?: { topK?: number; returnMetadata?: boolean },
		): Promise<{
			matches: Array<{
				id: string;
				score?: number;
				metadata?: Record<string, NonNullable<unknown>>;
			}>;
		}>;
	};
	/** Optional KV namespace for caching responses. */
	SEARCH_CACHE?: {
		get<T = string>(
			key: string,
			options?: { type: "json" | "text" },
		): Promise<T | null>;
		put(
			key: string,
			value: string,
			options?: { expirationTtl?: number },
		): Promise<void>;
	};
	/**
	 * Optional D1 database binding. When present together with
	 * {@link CloudflarePresetOptions.d1Table} and
	 * {@link CloudflarePresetOptions.toDocument}, a {@link D1FulltextRetriever}
	 * is wired in parallel with the {@link VectorizeRetriever} via
	 * {@link CompositeRetriever} using the `"best-effort"` strategy.
	 */
	D1_DATABASE?: {
		prepare(query: string): {
			bind(...values: unknown[]): {
				all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
			};
		};
	};
}

/** Options for {@link createCloudflareSearchClient}. */
export interface CloudflarePresetOptions extends SearchPipelineOptions {
	/** Workers AI model used for embeddings. Default: `"@cf/baai/bge-base-en-v1.5"`. */
	embeddingModel?: string;
	/** Workers AI model used for answer synthesis. Default: `"@cf/meta/llama-3.1-8b-instruct"`. */
	synthesisModel?: string;
	/** Custom prompt builder for the synthesizer. */
	promptBuilder?: PromptBuilder;
	/**
	 * Name of the D1 FTS5 virtual table to use for fulltext retrieval.
	 * Requires `env.D1_DATABASE` to be present.
	 */
	d1Table?: string;
	/**
	 * Map a raw D1 result row to a {@link SearchDocument}.
	 * Required when `d1Table` and `env.D1_DATABASE` are both provided.
	 */
	toDocument?: (
		row: Record<string, unknown> & { score: number },
	) => SearchDocument;
}

/**
 * Create a {@link SearchClient} optimised for Cloudflare Workers.
 *
 * Uses Workers AI for embeddings and synthesis, Vectorize for vector
 * retrieval, and optionally KV for caching. When `env.D1_DATABASE`,
 * `options.d1Table`, and `options.toDocument` are all provided, a
 * {@link D1FulltextRetriever} is composed with the {@link VectorizeRetriever}
 * via {@link CompositeRetriever} for hybrid fulltext + vector search.
 *
 * @param env - Worker environment bindings.
 * @param options - Preset options (models, table names, pipeline settings).
 */
export const createCloudflareSearchClient = (
	env: CloudflarePresetEnv,
	options: CloudflarePresetOptions = {},
): SearchClient => {
	const {
		embeddingModel,
		synthesisModel,
		promptBuilder,
		d1Table,
		toDocument,
		...pipelineOptions
	} = options;

	const vectorizeRetriever = new VectorizeRetriever(env.VECTOR_INDEX);

	const retriever =
		env.D1_DATABASE && d1Table && toDocument
			? new CompositeRetriever(
					[
						new D1FulltextRetriever(env.D1_DATABASE, {
							table: d1Table,
							toDocument,
						}),
						vectorizeRetriever,
					],
					{ strategy: "best-effort", logger: pipelineOptions.logger },
				)
			: vectorizeRetriever;

	return new SearchClient(
		{
			cache: env.SEARCH_CACHE ? new KVCacheStore(env.SEARCH_CACHE) : undefined,
			deduplicator: new InMemoryDeduplicator(),
			embedder: new WorkersAIEmbedder(env.AI, embeddingModel),
			planner: new DefaultQueryPlanner(),
			reranker: new ScoreReranker(),
			retriever,
			synthesizer: new WorkersAISynthesizer(env.AI, synthesisModel, {
				promptBuilder,
			}),
		},
		pipelineOptions,
	);
};
