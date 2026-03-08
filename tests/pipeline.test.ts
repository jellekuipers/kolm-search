import { describe, expect, it } from "vitest";
import { D1FulltextRetriever } from "../src/adapters/cloudflare/d1-fulltext";
import { WorkersAISynthesizer } from "../src/adapters/cloudflare/workers-ai";
import {
	createFulltextRetriever,
	createVectorRetriever,
} from "../src/adapters/generic";
import {
	InMemoryCache,
	InMemoryDeduplicator,
	InMemoryFulltextRetriever,
	InMemoryVectorRetriever,
	ScoreReranker,
} from "../src/adapters/in-memory";
import { SearchError } from "../src/contracts/types";
import { CompositeRetriever } from "../src/core/composite-retriever";
import { DefaultQueryPlanner } from "../src/core/default-planner";
import { SearchPipeline } from "../src/core/pipeline";
import { SearchClient } from "../src/core/search-client";
import { createBasicSearchClient } from "../src/presets/basic";

const docs = [
	{
		id: "1",
		title: "Cloudflare Workers",
		content: "Workers run JavaScript and TypeScript at the edge.",
	},
	{
		id: "2",
		title: "PostgreSQL tuning",
		content: "Indexes and query plans improve performance.",
	},
	{
		id: "3",
		title: "TypeScript generics",
		content: "Generics allow reusable, type-safe TypeScript code.",
	},
];

describe("basic pipeline", () => {
	it("returns fulltext matches", async () => {
		const result = await createBasicSearchClient(docs).search({
			query: "workers typescript",
			limit: 5,
		});
		expect(result.results.length).toBeGreaterThan(0);
		expect(result.results[0]?.id).toBe("1");
	});
	it("respects limit", async () => {
		const result = await createBasicSearchClient(docs).search({
			query: "typescript",
			limit: 1,
		});
		expect(result.results.length).toBe(1);
	});
	it("applies offset pagination", async () => {
		const full = await createBasicSearchClient(docs).search({
			query: "typescript",
			limit: 10,
		});
		const paged = await createBasicSearchClient(docs).search({
			query: "typescript",
			limit: 10,
			offset: 1,
		});
		if (full.results.length > 1)
			expect(paged.results[0]?.id).toBe(full.results[1]?.id);
	});
});

describe("cache", () => {
	it("returns hit on second identical request", async () => {
		const p = createBasicSearchClient(docs);
		await p.search({ query: "workers typescript", limit: 5 });
		expect(
			(await p.search({ query: "workers typescript", limit: 5 })).metadata
				?.cacheHit,
		).toBe(true);
	});
	it("different context = cache miss", async () => {
		const p = createBasicSearchClient(docs);
		await p.search({ query: "typescript", limit: 5, context: { user: "a" } });
		expect(
			(
				await p.search({
					query: "typescript",
					limit: 5,
					context: { user: "b" },
				})
			).metadata?.cacheHit,
		).toBeUndefined();
	});
	it("stable key regardless of filter key ordering", async () => {
		const p = createBasicSearchClient(docs);
		await p.search({ query: "typescript", filters: { a: 1, b: 2 }, limit: 5 });
		expect(
			(
				await p.search({
					query: "typescript",
					filters: { b: 2, a: 1 },
					limit: 5,
				})
			).metadata?.cacheHit,
		).toBe(true);
	});
	it("stable key regardless of context key ordering", async () => {
		const p = createBasicSearchClient(docs);
		await p.search({ query: "typescript", context: { z: 9, m: 3 }, limit: 5 });
		expect(
			(
				await p.search({
					query: "typescript",
					context: { m: 3, z: 9 },
					limit: 5,
				})
			).metadata?.cacheHit,
		).toBe(true);
	});
});

describe("deduplication", () => {
	it("removes duplicate document ids", async () => {
		const duplicated = [...docs, ...docs.slice(0, 1)];
		const result = await createBasicSearchClient(duplicated).search({
			query: "workers",
			limit: 10,
		});
		const ids = result.results.map((r) => r.id);
		expect(ids).toEqual([...new Set(ids)]);
	});
});

describe("ScoreReranker", () => {
	it("orders results by descending score", async () => {
		const result = await createBasicSearchClient(docs).search({
			query: "typescript",
			limit: 10,
		});
		for (let i = 1; i < result.results.length; i++) {
			expect(result.results[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(
				result.results[i]?.score ?? 0,
			);
		}
	});
});

describe("mode", () => {
	it("fulltext mode works with InMemoryFulltextRetriever", async () => {
		const result = await createBasicSearchClient(docs).search({
			query: "typescript",
			mode: "fulltext",
			limit: 10,
		});
		expect(result.plan.mode).toBe("fulltext");
		expect(result.results.length).toBeGreaterThan(0);
	});
	it("vector mode throws SearchError for InMemoryFulltextRetriever", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
		});
		await expect(
			pipeline.search({ query: "typescript", mode: "vector" }),
		).rejects.toSatisfy(
			(err) => err instanceof SearchError && err.stage === "retriever",
		);
	});
});

describe("synthesizer", () => {
	it("answer is included in response", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
			synthesizer: {
				async synthesize(ctx) {
					return `Answer for: ${ctx.request.query}`;
				},
			},
		});
		expect(
			(
				await pipeline.search({
					query: "typescript",
					mode: "fulltext",
					limit: 5,
				})
			).answer,
		).toBe("Answer for: typescript");
	});
});

describe("telemetry", () => {
	it("failure does not propagate to caller", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
			telemetry: {
				async track() {
					throw new Error("telemetry down");
				},
			},
		});
		expect(
			typeof (
				await pipeline.search({
					query: "typescript",
					mode: "fulltext",
					limit: 5,
				})
			).durationMs,
		).toBe("number");
	});
	it("logger.warn is called when telemetry throws", async () => {
		const warnings: Array<{ msg: string; payload: unknown }> = [];
		const pipeline = new SearchPipeline(
			{
				planner: new DefaultQueryPlanner(),
				retriever: new InMemoryFulltextRetriever(docs),
				telemetry: {
					async track() {
						throw new Error("telemetry down");
					},
				},
			},
			{
				logger: {
					debug() {},
					info() {},
					warn(msg, payload) {
						warnings.push({ msg, payload });
					},
					error() {},
				},
			},
		);
		await pipeline.search({ query: "typescript", mode: "fulltext", limit: 5 });
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.msg.toLowerCase()).toContain("telemetry");
	});
});

describe("SearchPipelineOptions", () => {
	it("defaultLimit applies when request omits limit", async () => {
		const result = await createBasicSearchClient(docs, {
			defaultLimit: 1,
		}).search({ query: "typescript" });
		expect(result.results.length).toBe(1);
		expect(result.plan.targetLimit).toBe(1);
	});
	it("defaultMode applies when request omits mode", async () => {
		expect(
			(
				await createBasicSearchClient(docs, { defaultMode: "fulltext" }).search(
					{ query: "typescript" },
				)
			).plan.mode,
		).toBe("fulltext");
	});
	it("request-level mode overrides defaultMode", async () => {
		expect(
			(
				await createBasicSearchClient(docs, { defaultMode: "fulltext" }).search(
					{ query: "typescript", mode: "hybrid" },
				)
			).plan.mode,
		).toBe("hybrid");
	});
	it("cacheTtlSeconds is passed to the cache store", async () => {
		let capturedTtl: number | undefined;
		const pipeline = new SearchPipeline(
			{
				planner: new DefaultQueryPlanner(),
				retriever: new InMemoryFulltextRetriever(docs),
				cache: {
					async get() {
						return undefined;
					},
					async set(_k: string, _v: unknown, ttl?: number) {
						capturedTtl = ttl;
					},
				},
			},
			{ cacheTtlSeconds: 120 },
		);
		await pipeline.search({ query: "typescript", mode: "fulltext", limit: 5 });
		expect(capturedTtl).toBe(120);
	});
	it("request-level limit overrides defaultLimit", async () => {
		expect(
			(
				await createBasicSearchClient(docs, { defaultLimit: 1 }).search({
					query: "typescript",
					limit: 3,
				})
			).plan.targetLimit,
		).toBe(3);
	});
});

describe("SearchClient", () => {
	it("throws SearchError for empty query", async () => {
		const client = new SearchClient({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
		});
		await expect(client.search({ query: "   " })).rejects.toSatisfy(
			(err: unknown) => err instanceof SearchError && err.stage === "client",
		);
	});
	it("returns results for valid query", async () => {
		const client = new SearchClient({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
			deduplicator: new InMemoryDeduplicator(),
			reranker: new ScoreReranker(),
			cache: new InMemoryCache(),
		});
		expect(
			(await client.search({ query: "typescript", mode: "fulltext", limit: 5 }))
				.results.length,
		).toBeGreaterThan(0);
	});
	it("forwards defaultLimit to pipeline", async () => {
		const client = new SearchClient(
			{
				planner: new DefaultQueryPlanner(),
				retriever: new InMemoryFulltextRetriever(docs),
			},
			{ defaultLimit: 1 },
		);
		expect(
			(await client.search({ query: "typescript" })).plan.targetLimit,
		).toBe(1);
	});
});

describe("DefaultQueryPlanner", () => {
	it("normalizes query and sets expandedQueries", async () => {
		const plan = await new DefaultQueryPlanner().plan({
			query: "  Hello   World  ",
		});
		expect(plan.normalizedQuery).toBe("hello world");
		expect(plan.expandedQueries).toEqual(["hello world"]);
	});
});

describe("stage error wrapping", () => {
	it("non-SearchError from retriever is wrapped with stage name", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: {
				async retrieve() {
					throw new Error("db connection refused");
				},
			},
		});
		await expect(
			pipeline.search({ query: "typescript", mode: "fulltext" }),
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SearchError &&
				err.stage === "retriever" &&
				err.message.includes("db connection refused"),
		);
	});
	it("SearchError from retriever propagates unchanged", async () => {
		const original = new SearchError("custom error", "retriever");
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: {
				async retrieve() {
					throw original;
				},
			},
		});
		await expect(
			pipeline.search({ query: "typescript", mode: "fulltext" }),
		).rejects.toBe(original);
	});
});

describe("InMemoryCache", () => {
	it("returns value before TTL expires", async () => {
		const cache = new InMemoryCache();
		await cache.set("k", "hello", 60);
		expect(await cache.get("k")).toBe("hello");
	});
	it("expires entry after TTL", async () => {
		const cache = new InMemoryCache();
		await cache.set("k", "hello", 0);
		await new Promise((r) => setTimeout(r, 5));
		expect(await cache.get("k")).toBeUndefined();
	});
	it("keeps entry indefinitely when no TTL given", async () => {
		const cache = new InMemoryCache();
		await cache.set("k", "persist");
		await new Promise((r) => setTimeout(r, 5));
		expect(await cache.get("k")).toBe("persist");
	});
});

const vectorDocs = [
	{
		document: { id: "v1", content: "Rust systems programming" },
		embedding: [1, 0, 0],
	},
	{
		document: { id: "v2", content: "Python data science" },
		embedding: [0, 1, 0],
	},
	{
		document: { id: "v3", content: "TypeScript web development" },
		embedding: [0, 0, 1],
	},
];

describe("InMemoryVectorRetriever", () => {
	it("retrieves by cosine similarity", async () => {
		const results = await new InMemoryVectorRetriever(vectorDocs).retrieve({
			request: { query: "rust" },
			plan: { mode: "vector", normalizedQuery: "rust", targetLimit: 3 },
			embeddings: [1, 0, 0],
			candidates: [],
			results: [],
			metadata: {},
			startedAt: Date.now(),
		});
		expect(results[0]?.id).toBe("v1");
	});
	it("throws SearchError without embeddings", async () => {
		await expect(
			new InMemoryVectorRetriever(vectorDocs).retrieve({
				request: { query: "rust" },
				plan: { mode: "vector", normalizedQuery: "rust", targetLimit: 3 },
				candidates: [],
				results: [],
				metadata: {},
				startedAt: Date.now(),
			}),
		).rejects.toSatisfy(
			(err: unknown) => err instanceof SearchError && err.stage === "retriever",
		);
	});
});

describe("CompositeRetriever", () => {
	it("merges fulltext and vector via RRF", async () => {
		const retriever = new CompositeRetriever([
			new InMemoryFulltextRetriever(vectorDocs.map(({ document }) => document)),
			new InMemoryVectorRetriever(vectorDocs),
		]);
		const results = await retriever.retrieve({
			request: { query: "typescript" },
			plan: { mode: "hybrid", normalizedQuery: "typescript", targetLimit: 3 },
			embeddings: [0, 0, 1],
			candidates: [],
			results: [],
			metadata: {},
			startedAt: Date.now(),
		});
		expect(results[0]?.id).toBe("v3");
	});
	it("fail-fast rethrows when a retriever throws", async () => {
		const retriever = new CompositeRetriever(
			[
				new InMemoryFulltextRetriever(
					vectorDocs.map(({ document }) => document),
				),
				{
					async retrieve() {
						throw new Error("broken");
					},
				},
			],
			{ strategy: "fail-fast" },
		);
		await expect(
			retriever.retrieve({
				request: { query: "typescript" },
				plan: { mode: "hybrid", normalizedQuery: "typescript", targetLimit: 3 },
				candidates: [],
				results: [],
				metadata: {},
				startedAt: Date.now(),
			}),
		).rejects.toThrow();
	});
	it("best-effort proceeds despite a retriever failure", async () => {
		const warnings: string[] = [];
		const retriever = new CompositeRetriever(
			[
				new InMemoryFulltextRetriever(
					vectorDocs.map(({ document }) => document),
				),
				{
					async retrieve() {
						throw new Error("broken");
					},
				},
			],
			{
				strategy: "best-effort",
				logger: {
					debug() {},
					info() {},
					warn(msg: string) {
						warnings.push(msg);
					},
					error() {},
				},
			},
		);
		const results = await retriever.retrieve({
			request: { query: "typescript" },
			plan: { mode: "hybrid", normalizedQuery: "typescript", targetLimit: 3 },
			candidates: [],
			results: [],
			metadata: {},
			startedAt: Date.now(),
		});
		expect(results.length).toBeGreaterThan(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("[composite-retriever]");
	});
});

describe("createFulltextRetriever", () => {
	it("invokes search callback and maps rows", async () => {
		const retriever = createFulltextRetriever({
			async search(query, limit) {
				return [{ id: "g1", title: query, content: "match", limit }];
			},
			toDocument: (row) => ({
				id: row.id,
				title: row.title,
				content: row.content,
			}),
		});
		expect(
			(
				await retriever.retrieve({
					request: { query: "test" },
					plan: { mode: "fulltext", normalizedQuery: "test", targetLimit: 5 },
					candidates: [],
					results: [],
					metadata: {},
					startedAt: Date.now(),
				})
			)[0]?.id,
		).toBe("g1");
	});
});

describe("createVectorRetriever", () => {
	it("throws SearchError without embeddings", async () => {
		const retriever = createVectorRetriever<{ id: string; content: string }>({
			async search(): Promise<{ id: string; content: string }[]> {
				return [];
			},
			toDocument: (row) => ({ id: row.id, content: "" }),
		});
		await expect(
			retriever.retrieve({
				request: { query: "test" },
				plan: { mode: "vector", normalizedQuery: "test", targetLimit: 5 },
				candidates: [],
				results: [],
				metadata: {},
				startedAt: Date.now(),
			}),
		).rejects.toSatisfy(
			(err: unknown) => err instanceof SearchError && err.stage === "retriever",
		);
	});
	it("invokes search callback with embeddings", async () => {
		let capturedEmbeddings: number[] | undefined;
		const retriever = createVectorRetriever({
			async search(emb: number[]) {
				capturedEmbeddings = emb;
				return [{ id: "vec1", content: "vector result" }];
			},
			toDocument: (row) => ({ id: row.id, content: row.content }),
		});
		await retriever.retrieve({
			request: { query: "test" },
			plan: { mode: "vector", normalizedQuery: "test", targetLimit: 5 },
			embeddings: [0.1, 0.2, 0.3],
			candidates: [],
			results: [],
			metadata: {},
			startedAt: Date.now(),
		});
		expect(capturedEmbeddings).toEqual([0.1, 0.2, 0.3]);
	});
});

describe("D1FulltextRetriever", () => {
	it("issues correct SQL with bindings", async () => {
		let sql = "";
		let bindings: unknown[] = [];
		const mockDb = {
			prepare(s: string) {
				sql = s;
				return {
					bind(...a: unknown[]) {
						bindings = a;
						return {
							async all() {
								return { results: [] };
							},
						};
					},
				};
			},
		};
		await new D1FulltextRetriever(mockDb as never, {
			table: "articles_fts",
			toDocument: (row: Record<string, unknown>) => ({
				id: String(row.id),
				content: "",
			}),
		}).retrieve({
			request: { query: "test" },
			plan: { mode: "fulltext", normalizedQuery: "test", targetLimit: 5 },
			candidates: [],
			results: [],
			metadata: {},
			startedAt: Date.now(),
		});
		expect(sql).toContain("articles_fts");
		expect(sql).toContain("MATCH");
		expect(sql).toContain("-rank AS score");
		expect(bindings[0]).toBe("test");
		expect(bindings[1]).toBe(10);
	});
});

describe("pagination", () => {
	it("totalCandidates reflects pre-slice count", async () => {
		const manyDocs = Array.from({ length: 10 }, (_, i) => ({
			id: String(i + 1),
			content: "typescript code",
		}));
		const result = await createBasicSearchClient(manyDocs).search({
			query: "typescript",
			limit: 3,
			offset: 0,
		});
		expect(result.results.length).toBeLessThanOrEqual(3);
		expect(result.pagination.totalCandidates).toBeGreaterThanOrEqual(
			result.results.length,
		);
		expect(result.pagination.limit).toBe(3);
		expect(result.pagination.offset).toBe(0);
	});
});

const makeAI = (response: string) => ({
	async run(_m: string, _i: unknown) {
		return { response };
	},
});

describe("WorkersAISynthesizer", () => {
	it("returns AI response using default prompt builder", async () => {
		expect(
			await new WorkersAISynthesizer(makeAI("The answer is 42.")).synthesize({
				request: { query: "what is the answer" },
				plan: {
					mode: "fulltext",
					normalizedQuery: "what is the answer",
					targetLimit: 5,
				},
				candidates: [],
				results: [{ id: "1", content: "The answer is 42." }],
				metadata: {},
				startedAt: Date.now(),
			}),
		).toBe("The answer is 42.");
	});
	it("returns undefined when results are empty", async () => {
		expect(
			await new WorkersAISynthesizer(makeAI("should not be called")).synthesize(
				{
					request: { query: "anything" },
					plan: {
						mode: "fulltext",
						normalizedQuery: "anything",
						targetLimit: 5,
					},
					candidates: [],
					results: [],
					metadata: {},
					startedAt: Date.now(),
				},
			),
		).toBeUndefined();
	});
	it("uses custom promptBuilder", async () => {
		let capturedPrompt = "";
		const ai = {
			async run(_m: string, input: { prompt: string }) {
				capturedPrompt = input.prompt;
				return { response: "custom answer" };
			},
		};
		const synth = new WorkersAISynthesizer(ai as never, undefined, {
			promptBuilder: (ctx) => `CUSTOM|${ctx.request.query}`,
		});
		await synth.synthesize({
			request: { query: "hello" },
			plan: { mode: "fulltext", normalizedQuery: "hello", targetLimit: 5 },
			candidates: [],
			results: [{ id: "1", content: "something" }],
			metadata: {},
			startedAt: Date.now(),
		});
		expect(capturedPrompt).toBe("CUSTOM|hello");
	});
});

describe("IntentClassifier", () => {
	it("result is attached to plan.intent", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
			intentClassifier: {
				async classify() {
					return "technique";
				},
			},
		});
		expect(
			(
				await pipeline.search({
					query: "how to knead dough",
					mode: "fulltext",
					limit: 5,
				})
			).plan.intent,
		).toBe("technique");
	});
	it("plan.intent is undefined when no intentClassifier is provided", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
		});
		expect(
			(
				await pipeline.search({
					query: "typescript",
					mode: "fulltext",
					limit: 5,
				})
			).plan.intent,
		).toBeUndefined();
	});
	it("failure is wrapped as SearchError with stage intent-classifier", async () => {
		const pipeline = new SearchPipeline({
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
			intentClassifier: {
				async classify() {
					throw new Error("classifier service unavailable");
				},
			},
		});
		await expect(
			pipeline.search({ query: "typescript", mode: "fulltext", limit: 5 }),
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SearchError && err.stage === "intent-classifier",
		);
	});
});
