import { describe, expect, it } from "vitest";
import type { SearchDocument } from "../../src/contracts/types";
import { mergeWithRrf, rrfScore } from "../../src/core/rrf";

describe("rrfScore", () => {
	it("uses k=60 by default", () => {
		expect(rrfScore(0)).toBeCloseTo(1 / 61);
	});

	it("rank 0 with default k=60 equals 1/61", () => {
		expect(rrfScore(0, 60)).toBeCloseTo(1 / 61);
	});

	it("rank 1 with default k=60 equals 1/62", () => {
		expect(rrfScore(1, 60)).toBeCloseTo(1 / 62);
	});

	it("higher rank gives lower score", () => {
		expect(rrfScore(0)).toBeGreaterThan(rrfScore(1));
		expect(rrfScore(1)).toBeGreaterThan(rrfScore(10));
	});

	it("respects custom k value", () => {
		expect(rrfScore(0, 10)).toBeCloseTo(1 / 11);
		expect(rrfScore(0, 100)).toBeCloseTo(1 / 101);
	});

	it("score is always positive", () => {
		expect(rrfScore(0)).toBeGreaterThan(0);
		expect(rrfScore(1000)).toBeGreaterThan(0);
	});
});

describe("mergeWithRrf", () => {
	const makeDoc = (id: string, score?: number): SearchDocument => ({
		id,
		content: `content for ${id}`,
		score,
	});

	it("accumulates scores for a document appearing in multiple lists", () => {
		const shared = makeDoc("shared");
		const onlyA = makeDoc("onlyA");
		const onlyB = makeDoc("onlyB");

		const listA = [shared, onlyA];
		const listB = [shared, onlyB];
		const docMap = new Map<string, SearchDocument>();

		const results = mergeWithRrf([listA, listB], docMap, 10);

		// "shared" appears at rank 0 in both lists so its fused score > either single-list doc
		const sharedResult = results.find((r) => r.id === "shared");
		const onlyAResult = results.find((r) => r.id === "onlyA");
		const onlyBResult = results.find((r) => r.id === "onlyB");

		expect(sharedResult?.score).toBeDefined();
		expect(onlyAResult?.score).toBeDefined();
		expect(onlyBResult?.score).toBeDefined();
		expect(sharedResult?.score ?? 0).toBeGreaterThan(onlyAResult?.score ?? 0);
		expect(sharedResult?.score ?? 0).toBeGreaterThan(onlyBResult?.score ?? 0);
	});

	it("returns results sorted by descending fused score", () => {
		const docs = [makeDoc("a"), makeDoc("b"), makeDoc("c")];
		const docMap = new Map<string, SearchDocument>();

		const results = mergeWithRrf([docs], docMap, 10);

		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(
				results[i]?.score ?? 0,
			);
		}
	});

	it("respects the limit parameter", () => {
		const list = Array.from({ length: 10 }, (_, i) => makeDoc(String(i)));
		const docMap = new Map<string, SearchDocument>();

		const results = mergeWithRrf([list], docMap, 3);

		expect(results).toHaveLength(3);
	});

	it("handles a single ranked list correctly", () => {
		const list = [makeDoc("x"), makeDoc("y"), makeDoc("z")];
		const docMap = new Map<string, SearchDocument>();

		const results = mergeWithRrf([list], docMap, 10);

		expect(results).toHaveLength(3);
		// First item in list gets highest score
		expect(results[0]?.score ?? 0).toBeGreaterThan(results[1]?.score ?? 0);
	});

	it("handles empty lists without throwing", () => {
		const docMap = new Map<string, SearchDocument>();
		const results = mergeWithRrf([[], []], docMap, 10);

		expect(results).toHaveLength(0);
	});

	it("attaches fused score onto the returned document", () => {
		const list = [makeDoc("doc1")];
		const docMap = new Map<string, SearchDocument>();

		const results = mergeWithRrf([list], docMap, 10);

		expect(results[0]?.id).toBe("doc1");
		expect(typeof results[0]?.score).toBe("number");
	});

	it("respects custom k value", () => {
		const list = [makeDoc("a"), makeDoc("b")];
		const docMap1 = new Map<string, SearchDocument>();
		const docMap2 = new Map<string, SearchDocument>();

		const resultsDefaultK = mergeWithRrf([list], docMap1, 10, 60);
		const resultsLowK = mergeWithRrf([list], docMap2, 10, 1);

		// Lower k amplifies rank differences
		const scoreDiffDefault =
			(resultsDefaultK[0]?.score ?? 0) - (resultsDefaultK[1]?.score ?? 0);
		const scoreDiffLowK =
			(resultsLowK[0]?.score ?? 0) - (resultsLowK[1]?.score ?? 0);

		expect(scoreDiffLowK).toBeGreaterThan(scoreDiffDefault);
	});
});
