import { describe, expect, it, vi } from "vitest";
import type {
	SearchDocument,
	SearchPipelineContext,
} from "../../src/contracts/types";
import { SearchError } from "../../src/contracts/types";
import { CompositeRetriever } from "../../src/core/composite-retriever";

const baseContext = (): SearchPipelineContext => ({
	request: { query: "baking" },
	plan: { mode: "hybrid", normalizedQuery: "baking", targetLimit: 5 },
	candidates: [],
	results: [],
	metadata: {},
	startedAt: Date.now(),
});

const makeRetriever = (docs: SearchDocument[]) => ({
	retrieve: vi.fn().mockResolvedValue(docs),
});

const makeFailingRetriever = (message = "retriever error") => ({
	retrieve: vi.fn().mockRejectedValue(new Error(message)),
});

describe("CompositeRetriever – all-fail best-effort path", () => {
	it("throws SearchError when all retrievers fail in best-effort mode", async () => {
		const r1 = makeFailingRetriever("r1 down");
		const r2 = makeFailingRetriever("r2 down");

		const composite = new CompositeRetriever([r1, r2], {
			strategy: "best-effort",
		});

		await expect(composite.retrieve(baseContext())).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SearchError &&
				err.stage === "retriever" &&
				err.message.toLowerCase().includes("all retrievers failed"),
		);
	});

	it("logs a warning for each failing retriever before throwing", async () => {
		const warnMessages: string[] = [];
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn((msg: string) => warnMessages.push(msg)),
			error: vi.fn(),
		};

		const r1 = makeFailingRetriever("network timeout");
		const r2 = makeFailingRetriever("connection refused");

		const composite = new CompositeRetriever([r1, r2], {
			strategy: "best-effort",
			logger,
		});

		await expect(composite.retrieve(baseContext())).rejects.toBeInstanceOf(
			SearchError,
		);

		expect(warnMessages.length).toBeGreaterThanOrEqual(2);
		expect(warnMessages.every((m) => m.includes("[composite-retriever]"))).toBe(
			true,
		);
	});
});

describe("CompositeRetriever – partial best-effort failure", () => {
	it("returns results from surviving retrievers when one of two fails", async () => {
		const doc: SearchDocument = {
			id: "surviving-doc",
			content: "flour and water",
		};
		const good = makeRetriever([doc]);
		const bad = makeFailingRetriever("db unavailable");

		const composite = new CompositeRetriever([good, bad], {
			strategy: "best-effort",
		});

		const results = await composite.retrieve(baseContext());

		expect(results).toHaveLength(1);
		expect(results[0]?.id).toBe("surviving-doc");
	});

	it("logs a warning for the failing retriever", async () => {
		const warnMessages: string[] = [];
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn((msg: string) => warnMessages.push(msg)),
			error: vi.fn(),
		};

		const good = makeRetriever([{ id: "doc1", content: "sourdough" }]);
		const bad = makeFailingRetriever("timeout");

		const composite = new CompositeRetriever([good, bad], {
			strategy: "best-effort",
			logger,
		});

		await composite.retrieve(baseContext());

		expect(warnMessages).toHaveLength(1);
		expect(warnMessages[0]).toContain("[composite-retriever]");
	});

	it("does not call logger.warn when all retrievers succeed", async () => {
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};

		const r1 = makeRetriever([{ id: "a", content: "first" }]);
		const r2 = makeRetriever([{ id: "b", content: "second" }]);

		const composite = new CompositeRetriever([r1, r2], {
			strategy: "best-effort",
			logger,
		});

		await composite.retrieve(baseContext());

		expect(logger.warn).not.toHaveBeenCalled();
	});
});

describe("CompositeRetriever – fail-fast", () => {
	it("rejects immediately when a retriever throws", async () => {
		const good = makeRetriever([{ id: "ok", content: "ok" }]);
		const bad = makeFailingRetriever("catastrophic");

		const composite = new CompositeRetriever([good, bad], {
			strategy: "fail-fast",
		});

		await expect(composite.retrieve(baseContext())).rejects.toThrow();
	});
});
