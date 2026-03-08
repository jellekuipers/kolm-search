import { describe, expect, it, vi } from "vitest";
import { KVCacheStore } from "../../src/adapters/cloudflare/kv-cache";
import { VectorizeRetriever } from "../../src/adapters/cloudflare/vectorize";
import {
	WorkersAIEmbedder,
	WorkersAISynthesizer,
} from "../../src/adapters/cloudflare/workers-ai";
import type { SearchPipelineContext } from "../../src/contracts/types";
import { SearchError } from "../../src/contracts/types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const makeContext = (
	overrides: Partial<SearchPipelineContext> = {},
): SearchPipelineContext => ({
	request: { query: "fermentation" },
	plan: { mode: "hybrid", normalizedQuery: "fermentation", targetLimit: 5 },
	candidates: [],
	results: [],
	metadata: {},
	startedAt: Date.now(),
	...overrides,
});

// ---------------------------------------------------------------------------
// KVCacheStore
// ---------------------------------------------------------------------------

describe("KVCacheStore", () => {
	it("returns a stored value on get", async () => {
		const kv = {
			get: vi.fn().mockResolvedValue({ name: "sourdough" }),
			put: vi.fn().mockResolvedValue(undefined),
		};
		const cache = new KVCacheStore(kv);

		const result = await cache.get<{ name: string }>("my-key");

		expect(result).toEqual({ name: "sourdough" });
		expect(kv.get).toHaveBeenCalledWith("my-key", { type: "json" });
	});

	it("returns undefined when the KV key is not found (null from KV)", async () => {
		const kv = {
			get: vi.fn().mockResolvedValue(null),
			put: vi.fn().mockResolvedValue(undefined),
		};
		const cache = new KVCacheStore(kv);

		const result = await cache.get<string>("missing");

		expect(result).toBeUndefined();
	});

	it("serialises the value as JSON and forwards expirationTtl on set", async () => {
		const kv = {
			get: vi.fn(),
			put: vi.fn().mockResolvedValue(undefined),
		};
		const cache = new KVCacheStore(kv);

		await cache.set("cache-key", { score: 42 }, 300);

		expect(kv.put).toHaveBeenCalledWith(
			"cache-key",
			JSON.stringify({ score: 42 }),
			{ expirationTtl: 300 },
		);
	});

	it("sets without expirationTtl when no ttl is provided", async () => {
		const kv = {
			get: vi.fn(),
			put: vi.fn().mockResolvedValue(undefined),
		};
		const cache = new KVCacheStore(kv);

		await cache.set("k", "v");

		// TTL-less put: expirationTtl should be absent or undefined
		const [, , options] = kv.put.mock.calls[0] as [
			string,
			string,
			{ expirationTtl?: number } | undefined,
		];
		expect(options?.expirationTtl).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// VectorizeRetriever
// ---------------------------------------------------------------------------

describe("VectorizeRetriever", () => {
	it("returns an empty array (not a throw) when no embeddings are on context", async () => {
		const index = {
			query: vi.fn().mockResolvedValue({ matches: [] }),
		};
		const retriever = new VectorizeRetriever(index);

		const results = await retriever.retrieve(makeContext());

		expect(results).toEqual([]);
		expect(index.query).not.toHaveBeenCalled();
	});

	it("calls query with returnMetadata: true", async () => {
		const index = {
			query: vi.fn().mockResolvedValue({ matches: [] }),
		};
		const retriever = new VectorizeRetriever(index);

		await retriever.retrieve(makeContext({ embeddings: [0.1, 0.2, 0.3] }));

		expect(index.query).toHaveBeenCalledWith(
			[0.1, 0.2, 0.3],
			expect.objectContaining({ returnMetadata: true }),
		);
	});

	it("maps metadata fields onto SearchDocument", async () => {
		const index = {
			query: vi.fn().mockResolvedValue({
				matches: [
					{
						id: "vec1",
						score: 0.9,
						metadata: {
							title: "Sourdough Starter",
							content: "A mixture of flour and water.",
							source: "handbook",
						},
					},
				],
			}),
		};
		const retriever = new VectorizeRetriever(index);

		const results = await retriever.retrieve(
			makeContext({ embeddings: [1, 0] }),
		);

		expect(results[0]?.id).toBe("vec1");
		expect(results[0]?.title).toBe("Sourdough Starter");
		expect(results[0]?.content).toBe("A mixture of flour and water.");
		expect(results[0]?.source).toBe("handbook");
	});

	it("queries with topK of at least max(targetLimit * 2, 20)", async () => {
		const index = {
			query: vi.fn().mockResolvedValue({ matches: [] }),
		};
		const retriever = new VectorizeRetriever(index);

		// targetLimit = 3 → topK should be max(3*2, 20) = 20
		await retriever.retrieve(
			makeContext({
				embeddings: [0.5],
				plan: { mode: "vector", normalizedQuery: "test", targetLimit: 3 },
			}),
		);

		const callOptions = (
			index.query.mock.calls[0] as [number[], { topK: number }]
		)[1];
		expect(callOptions.topK).toBeGreaterThanOrEqual(20);
	});
});

// ---------------------------------------------------------------------------
// WorkersAIEmbedder
// ---------------------------------------------------------------------------

describe("WorkersAIEmbedder", () => {
	it("returns the first embedding vector from AI output", async () => {
		const ai = {
			run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
		};
		const embedder = new WorkersAIEmbedder(ai);

		const embedding = await embedder.embed("sourdough");

		expect(embedding).toEqual([0.1, 0.2, 0.3]);
		expect(ai.run).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ text: ["sourdough"] }),
		);
	});

	it("throws SearchError when output.data[0] is missing", async () => {
		const ai = {
			run: vi.fn().mockResolvedValue({ data: [] }),
		};
		const embedder = new WorkersAIEmbedder(ai);

		await expect(embedder.embed("missing")).rejects.toSatisfy(
			(err: unknown) => err instanceof SearchError,
		);
	});

	it("uses a custom model when provided", async () => {
		const ai = {
			run: vi.fn().mockResolvedValue({ data: [[0.5]] }),
		};
		const embedder = new WorkersAIEmbedder(ai, "@cf/custom/embed-model");

		await embedder.embed("test");

		expect(ai.run).toHaveBeenCalledWith(
			"@cf/custom/embed-model",
			expect.any(Object),
		);
	});
});

// ---------------------------------------------------------------------------
// WorkersAISynthesizer
// ---------------------------------------------------------------------------

describe("WorkersAISynthesizer", () => {
	it("returns undefined when results are empty (no AI call made)", async () => {
		const ai = { run: vi.fn() };
		const synthesizer = new WorkersAISynthesizer(ai);

		const result = await synthesizer.synthesize(makeContext({ results: [] }));

		expect(result).toBeUndefined();
		expect(ai.run).not.toHaveBeenCalled();
	});

	it("calls Workers AI with the default prompt when results are present", async () => {
		const ai = { run: vi.fn().mockResolvedValue({ response: "42" }) };
		const synthesizer = new WorkersAISynthesizer(ai);

		const result = await synthesizer.synthesize(
			makeContext({
				results: [{ id: "1", content: "fermentation produces CO2" }],
			}),
		);

		expect(result).toBe("42");
		expect(ai.run).toHaveBeenCalledOnce();
	});

	it("uses a custom promptBuilder", async () => {
		let capturedPrompt = "";
		const ai = {
			run: vi
				.fn()
				.mockImplementation(
					async (_model: string, input: Record<string, unknown>) => {
						capturedPrompt = input.prompt as string;
						return { response: "custom" };
					},
				),
		};

		const synthesizer = new WorkersAISynthesizer(ai, undefined, {
			promptBuilder: (ctx) => `CUSTOM|${ctx.request.query}`,
		});

		await synthesizer.synthesize(
			makeContext({ results: [{ id: "1", content: "dough" }] }),
		);

		expect(capturedPrompt).toBe("CUSTOM|fermentation");
	});

	it("uses a custom model when provided", async () => {
		const ai = { run: vi.fn().mockResolvedValue({ response: "ok" }) };
		const synthesizer = new WorkersAISynthesizer(ai, "@cf/custom/llama");

		await synthesizer.synthesize(
			makeContext({ results: [{ id: "1", content: "yeast" }] }),
		);

		expect(ai.run).toHaveBeenCalledWith("@cf/custom/llama", expect.any(Object));
	});
});
