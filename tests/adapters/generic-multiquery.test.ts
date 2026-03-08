import { describe, expect, it, vi } from "vitest";
import {
	createFulltextRetriever,
	createVectorRetriever,
} from "../../src/adapters/generic";
import type { SearchPipelineContext } from "../../src/contracts/types";
import { SearchError } from "../../src/contracts/types";

const makeContext = (
	overrides: Partial<SearchPipelineContext> = {},
): SearchPipelineContext => ({
	request: { query: "bread" },
	plan: {
		mode: "fulltext",
		normalizedQuery: "bread",
		targetLimit: 5,
		expandedQueries: ["bread"],
	},
	candidates: [],
	results: [],
	metadata: {},
	startedAt: Date.now(),
	...overrides,
});

describe("createFulltextRetriever – single-query fast path", () => {
	it("calls search once with the normalizedQuery", async () => {
		const search = vi
			.fn()
			.mockResolvedValue([{ id: "doc1", content: "sourdough bread" }]);

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row: { id: string; content: string }) => ({
				id: row.id,
				content: row.content,
			}),
		});

		await retriever.retrieve(makeContext());

		expect(search).toHaveBeenCalledTimes(1);
		expect(search).toHaveBeenCalledWith(
			"bread",
			expect.any(Number),
			expect.any(Object),
		);
	});

	it("maps rows through toDocument", async () => {
		const raw = [{ uid: "x1", body: "dense crumb" }];
		const search = vi.fn().mockResolvedValue(raw);

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row) => ({
				id: (row as (typeof raw)[0]).uid,
				content: (row as (typeof raw)[0]).body,
			}),
		});

		const results = await retriever.retrieve(makeContext());

		expect(results[0]?.id).toBe("x1");
		expect(results[0]?.content).toBe("dense crumb");
	});
});

describe("createFulltextRetriever – multi-query RRF fan-out", () => {
	it("calls search once per expanded query", async () => {
		const search = vi.fn().mockResolvedValue([]);

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row: { id: string; content: string }) => ({
				id: row.id,
				content: "",
			}),
		});

		await retriever.retrieve(
			makeContext({
				plan: {
					mode: "fulltext",
					normalizedQuery: "bread",
					targetLimit: 5,
					expandedQueries: ["bread", "sourdough", "loaf"],
				},
			}),
		);

		expect(search).toHaveBeenCalledTimes(3);
	});

	it("fuses multi-query results with RRF so a doc appearing in multiple queries ranks higher", async () => {
		const search = vi.fn().mockImplementation(async (query: string) => {
			if (query === "bread") {
				return [
					{ id: "shared", content: "shared result" },
					{ id: "only-bread", content: "only in bread" },
				];
			}
			if (query === "sourdough") {
				return [
					{ id: "shared", content: "shared result" },
					{ id: "only-sourdough", content: "only in sourdough" },
				];
			}
			return [];
		});

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row: { id: string; content: string }) => ({
				id: row.id,
				content: row.content,
			}),
		});

		const results = await retriever.retrieve(
			makeContext({
				plan: {
					mode: "fulltext",
					normalizedQuery: "bread",
					targetLimit: 10,
					expandedQueries: ["bread", "sourdough"],
				},
			}),
		);

		const sharedResult = results.find((r) => r.id === "shared");
		const onlyBreadResult = results.find((r) => r.id === "only-bread");

		expect(sharedResult).toBeDefined();
		// "shared" appears in both query results → higher fused score
		expect(sharedResult?.score ?? 0).toBeGreaterThan(
			onlyBreadResult?.score ?? 0,
		);
	});

	it("uses single-query fast path when expandedQueries has exactly one entry", async () => {
		const search = vi.fn().mockResolvedValue([]);

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row: { id: string; content: string }) => ({
				id: row.id,
				content: "",
			}),
		});

		await retriever.retrieve(
			makeContext({
				plan: {
					mode: "fulltext",
					normalizedQuery: "rye",
					targetLimit: 5,
					expandedQueries: ["rye"],
				},
			}),
		);

		// Should only call search once (fast path, not fan-out)
		expect(search).toHaveBeenCalledTimes(1);
	});
});

describe("createFulltextRetriever – primaryQueryBoost", () => {
	it("primary query ranks higher than expanded-only match when boost > 1", async () => {
		// "primary-only" appears only in queries[0] (the base query) at rank 0.
		// "expanded-only" appears in queries[1] and queries[2] at rank 0 each.
		// Without boost, expanded-only wins (2 × 1/61 > 1 × 1/61).
		// With primaryQueryBoost: 2, primary-only gets counted twice → 2/61 ≈ 0.0328,
		// and expanded-only still gets 2/61, but primary-only ties or wins on first rank.
		// With primaryQueryBoost: 3, primary-only wins clearly (3/61 > 2/61).
		const search = vi.fn().mockImplementation(async (query: string) => {
			if (query === "bread")
				return [{ id: "primary-only", content: "base result" }];
			return [{ id: "expanded-only", content: "expanded result" }];
		});

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row: { id: string; content: string }) => ({
				id: row.id,
				content: row.content,
			}),
			primaryQueryBoost: 3,
		});

		const results = await retriever.retrieve(
			makeContext({
				plan: {
					mode: "fulltext",
					normalizedQuery: "bread",
					targetLimit: 10,
					expandedQueries: ["bread", "bread problem", "bread cause"],
				},
			}),
		);

		expect(results[0]?.id).toBe("primary-only");
	});

	it("no boost (default 1): expanded-only doc beats primary-only when it appears in more queries", async () => {
		const search = vi.fn().mockImplementation(async (query: string) => {
			if (query === "bread")
				return [{ id: "primary-only", content: "base result" }];
			return [{ id: "expanded-only", content: "expanded result" }];
		});

		const retriever = createFulltextRetriever({
			search,
			toDocument: (row: { id: string; content: string }) => ({
				id: row.id,
				content: row.content,
			}),
			// no primaryQueryBoost — default is 1 (equal weight)
		});

		const results = await retriever.retrieve(
			makeContext({
				plan: {
					mode: "fulltext",
					normalizedQuery: "bread",
					targetLimit: 10,
					expandedQueries: ["bread", "bread problem", "bread cause"],
				},
			}),
		);

		// expanded-only appears in 2 of 3 lists → wins without boost
		expect(results[0]?.id).toBe("expanded-only");
	});
});

describe("createVectorRetriever", () => {
	it("throws SearchError without embeddings on context", async () => {
		const retriever = createVectorRetriever({
			async search(): Promise<{ id: string }[]> {
				return [];
			},
			toDocument: (row) => ({ id: row.id, content: "" }),
		});

		await expect(retriever.retrieve(makeContext())).rejects.toSatisfy(
			(err: unknown) => err instanceof SearchError && err.stage === "retriever",
		);
	});

	it("passes embeddings to the search callback", async () => {
		let capturedEmbeddings: number[] | undefined;

		const retriever = createVectorRetriever({
			async search(embeddings) {
				capturedEmbeddings = embeddings;
				return [];
			},
			toDocument: () => ({ id: "x", content: "" }),
		});

		await retriever.retrieve(
			makeContext({
				embeddings: [0.1, 0.9, 0.3],
				plan: { mode: "vector", normalizedQuery: "bread", targetLimit: 5 },
			}),
		);

		expect(capturedEmbeddings).toEqual([0.1, 0.9, 0.3]);
	});

	it("maps rows through toDocument", async () => {
		const raw = [{ vector_id: "v1", snippet: "crusty loaf" }];

		const retriever = createVectorRetriever({
			async search() {
				return raw;
			},
			toDocument: (row) => ({
				id: (row as (typeof raw)[0]).vector_id,
				content: (row as (typeof raw)[0]).snippet,
			}),
		});

		const results = await retriever.retrieve(
			makeContext({
				embeddings: [0.5, 0.5],
				plan: { mode: "vector", normalizedQuery: "bread", targetLimit: 5 },
			}),
		);

		expect(results[0]?.id).toBe("v1");
		expect(results[0]?.content).toBe("crusty loaf");
	});
});
