import { describe, expect, it, vi } from "vitest";
import { SearchClient } from "../../src/core/search-client";
import { createBasicSearchClient } from "../../src/presets/basic";
import { createCloudflareSearchClient } from "../../src/presets/cloudflare";
import { createPostgresSearchClient } from "../../src/presets/postgres";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const makeMockAI = () => ({
	run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]], response: "ok" }),
});

const makeMockVectorize = () => ({
	query: vi.fn().mockResolvedValue({ matches: [] }),
});

const makeMockKV = () => ({
	get: vi.fn().mockResolvedValue(null),
	put: vi.fn().mockResolvedValue(undefined),
});

const makeMockD1 = () => ({
	prepare: vi.fn().mockReturnValue({
		bind: vi.fn().mockReturnValue({
			all: vi.fn().mockResolvedValue({ results: [] }),
		}),
	}),
});

// ---------------------------------------------------------------------------
// createBasicSearchClient
// ---------------------------------------------------------------------------

describe("createBasicSearchClient", () => {
	const docs = [
		{ id: "1", content: "flour and water" },
		{ id: "2", content: "yeast and salt" },
	];

	it("returns a SearchClient instance", () => {
		const client = createBasicSearchClient(docs);
		expect(client).toBeInstanceOf(SearchClient);
	});

	it("has a callable search method", () => {
		const client = createBasicSearchClient(docs);
		expect(typeof client.search).toBe("function");
	});

	it("returns results for a matching query", async () => {
		const client = createBasicSearchClient(docs);
		const result = await client.search({ query: "flour", mode: "fulltext" });

		expect(result.results.length).toBeGreaterThan(0);
	});

	it("accepts SearchPipelineOptions", async () => {
		const client = createBasicSearchClient(docs, { defaultLimit: 1 });
		const result = await client.search({ query: "flour", mode: "fulltext" });

		expect(result.results.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// createCloudflareSearchClient
// ---------------------------------------------------------------------------

describe("createCloudflareSearchClient", () => {
	it("returns a SearchClient with vector-only setup (no D1)", () => {
		const client = createCloudflareSearchClient({
			AI: makeMockAI(),
			VECTOR_INDEX: makeMockVectorize(),
		});

		expect(client).toBeInstanceOf(SearchClient);
		expect(typeof client.search).toBe("function");
	});

	it("accepts an optional SEARCH_CACHE binding", () => {
		const client = createCloudflareSearchClient({
			AI: makeMockAI(),
			VECTOR_INDEX: makeMockVectorize(),
			SEARCH_CACHE: makeMockKV(),
		});

		expect(client).toBeInstanceOf(SearchClient);
	});

	it("includes D1 fulltext retriever when all D1 options are provided", () => {
		const client = createCloudflareSearchClient(
			{
				AI: makeMockAI(),
				VECTOR_INDEX: makeMockVectorize(),
				D1_DATABASE: makeMockD1(),
			},
			{
				d1Table: "content_fts",
				toDocument: (row) => ({
					id: row.id as string,
					content: row.content as string,
				}),
			},
		);

		expect(client).toBeInstanceOf(SearchClient);
	});

	it("produces a functioning client that resolves search()", async () => {
		const client = createCloudflareSearchClient({
			AI: makeMockAI(),
			VECTOR_INDEX: makeMockVectorize(),
		});

		// Should resolve without throwing even though mocks return empty results
		const result = await client.search({ query: "sourdough" });
		expect(Array.isArray(result.results)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// createPostgresSearchClient
// ---------------------------------------------------------------------------

describe("createPostgresSearchClient", () => {
	const makeFulTextRetriever = () => ({
		retrieve: vi
			.fn()
			.mockResolvedValue([{ id: "pg1", content: "whole wheat" }]),
	});

	it("returns a SearchClient with fulltext-only setup", () => {
		const client = createPostgresSearchClient({
			fulltextRetriever: makeFulTextRetriever(),
		});

		expect(client).toBeInstanceOf(SearchClient);
		expect(typeof client.search).toBe("function");
	});

	it("returns results from the fulltext retriever", async () => {
		const client = createPostgresSearchClient({
			fulltextRetriever: makeFulTextRetriever(),
		});

		const result = await client.search({ query: "wheat", mode: "fulltext" });
		expect(result.results[0]?.id).toBe("pg1");
	});

	it("accepts a vector retriever and embedder for hybrid mode", () => {
		const client = createPostgresSearchClient({
			fulltextRetriever: makeFulTextRetriever(),
			vectorRetriever: {
				retrieve: vi.fn().mockResolvedValue([]),
			},
			embedder: {
				embed: vi.fn().mockResolvedValue([0.1, 0.2]),
			},
		});

		expect(client).toBeInstanceOf(SearchClient);
	});

	it("accepts SearchPipelineOptions", () => {
		const client = createPostgresSearchClient({
			fulltextRetriever: makeFulTextRetriever(),
			defaultLimit: 5,
			defaultMode: "fulltext",
		});

		expect(client).toBeInstanceOf(SearchClient);
	});
});
