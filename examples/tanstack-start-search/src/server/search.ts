import { createServerFn } from "@tanstack/react-start";
import type { SearchDocument } from "kolm-search";
import { createBasicSearchClient } from "kolm-search/presets/basic";
import z from "zod";

// ---------------------------------------------------------------------------
// Seed corpus
// ---------------------------------------------------------------------------

const DOCUMENTS: SearchDocument[] = [
	{
		id: "1",
		title: "Getting Started",
		content:
			"Learn how to install and configure kolm-search. Add it to your project with pnpm add kolm-search.",
		tags: ["install", "setup"],
	},
	{
		id: "2",
		title: "Pipeline Architecture",
		content:
			"Explore the modular pipeline with pluggable stages: QueryPlanner, Embedder, Retriever, Reranker, Synthesizer, and more.",
		tags: ["architecture", "pipeline"],
	},
	{
		id: "3",
		title: "Cloudflare Workers Integration",
		content:
			"Deploy search to the edge with Workers AI embeddings and Cloudflare Vectorize for fast ANN retrieval.",
		tags: ["cloudflare", "edge", "vectorize"],
	},
	{
		id: "4",
		title: "PostgreSQL Setup",
		content:
			"Wire up fulltext search with pg_trgm and vector search with pgvector using the generic adapter factory.",
		tags: ["postgres", "pgvector", "fulltext"],
	},
	{
		id: "5",
		title: "Custom Adapters",
		content:
			"Build your own Retriever, Reranker, Synthesizer, or CacheStore by implementing the plugin interfaces.",
		tags: ["adapters", "extensibility"],
	},
	{
		id: "6",
		title: "CompositeRetriever",
		content:
			"Run multiple retrievers in parallel and fuse their ranked lists with Reciprocal Rank Fusion for hybrid search.",
		tags: ["hybrid", "rrf", "composite"],
	},
	{
		id: "7",
		title: "Redis Cache Adapter",
		content:
			"Share cached search responses across multiple instances with RedisCacheStore, compatible with ioredis and node-redis.",
		tags: ["cache", "redis"],
	},
	{
		id: "8",
		title: "Schema Validation",
		content:
			"Validate search requests and responses with any Standard Schema V1-compatible library: Zod, Valibot, ArkType.",
		tags: ["validation", "schema", "zod"],
	},
];

// ---------------------------------------------------------------------------
// Search client
// ---------------------------------------------------------------------------

/**
 * createBasicSearchClient wires an in-memory fulltext retriever — suitable
 * for demos and local development. For production, swap in
 * createCloudflareSearchClient or createPostgresSearchClient.
 *
 * To demonstrate Standard Schema integration, pass a Zod schema as the
 * inputSchema option:
 *
 *   const client = createBasicSearchClient(DOCUMENTS, {
 *     inputSchema: requestSchema,   // Zod schema satisfies Standard Schema V1
 *     defaultLimit: 5,
 *     maxQueryLength: 500,
 *   });
 *
 * We skip that here to keep input validation in Hono's layer (one clear
 * location for HTTP concerns), but both approaches are valid.
 */
const client = createBasicSearchClient(DOCUMENTS, {
	defaultLimit: 5,
	maxQueryLength: 500,
});

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const searchBodySchema = z.object({
	query: z.string().min(1, "Query must not be empty").max(500),
	limit: z.number().int().min(1).max(50).optional(),
});

export const search = createServerFn({ method: "GET" })
	.inputValidator(searchBodySchema)
	.handler(async ({ data }) => {
		const response = await client.search({
			query: data.query,
			limit: data.limit,
		});

		return {
			query: data.query,
			results: response.results,
			total: response.pagination.totalCandidates,
			durationMs: response.durationMs,
		};
	});
