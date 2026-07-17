import { describe, expect, it, vi } from "vitest";
import type { QueryExpander } from "../../src/contracts/ports";
import type { Logger } from "../../src/contracts/types";
import { ExpandingQueryPlanner } from "../../src/core/expanding-planner";

const makeLogger = (): Logger => ({
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
});

const expanderOf = (expansions: string[]): QueryExpander => ({
	expand: vi.fn().mockResolvedValue(expansions),
});

describe("ExpandingQueryPlanner", () => {
	it("keeps the normalised primary query at index 0", async () => {
		const planner = new ExpandingQueryPlanner(
			expanderOf(["sourdough starter", "wild yeast"]),
		);

		const plan = await planner.plan({ query: "  Bread   Starter " });

		expect(plan.normalizedQuery).toBe("bread starter");
		expect(plan.expandedQueries?.[0]).toBe("bread starter");
		expect(plan.expandedQueries).toEqual([
			"bread starter",
			"sourdough starter",
			"wild yeast",
		]);
	});

	it("passes the normalised query to the expander", async () => {
		const expander = expanderOf([]);
		const planner = new ExpandingQueryPlanner(expander);

		await planner.plan({ query: "  Wild   YEAST " });

		expect(expander.expand).toHaveBeenCalledWith("wild yeast");
	});

	it("normalises and deduplicates expansions, including against the primary query", async () => {
		const planner = new ExpandingQueryPlanner(
			expanderOf(["  BREAD  starter ", "wild yeast", "Wild  Yeast", ""]),
		);

		const plan = await planner.plan({ query: "bread starter" });

		expect(plan.expandedQueries).toEqual(["bread starter", "wild yeast"]);
	});

	it("caps expandedQueries at maxQueries including the primary", async () => {
		const planner = new ExpandingQueryPlanner(
			expanderOf(["one", "two", "three", "four", "five"]),
			{ maxQueries: 3 },
		);

		const plan = await planner.plan({ query: "base" });

		expect(plan.expandedQueries).toEqual(["base", "one", "two"]);
	});

	it("defaults to 4 queries total", async () => {
		const planner = new ExpandingQueryPlanner(
			expanderOf(["one", "two", "three", "four", "five"]),
		);

		const plan = await planner.plan({ query: "base" });

		expect(plan.expandedQueries).toHaveLength(4);
	});

	it("falls back to the primary query and warns when the expander throws", async () => {
		const logger = makeLogger();
		const planner = new ExpandingQueryPlanner(
			{ expand: vi.fn().mockRejectedValue(new Error("LLM down")) },
			{ logger },
		);

		const plan = await planner.plan({ query: "bread" });

		expect(plan.expandedQueries).toEqual(["bread"]);
		expect(logger.warn).toHaveBeenCalledOnce();
	});

	it("returns just the primary query when the expander yields nothing", async () => {
		const planner = new ExpandingQueryPlanner(expanderOf([]));

		const plan = await planner.plan({ query: "bread" });

		expect(plan.expandedQueries).toEqual(["bread"]);
	});

	it("resolves mode and targetLimit from the request with defaults", async () => {
		const planner = new ExpandingQueryPlanner(expanderOf([]));

		const defaultPlan = await planner.plan({ query: "bread" });
		expect(defaultPlan.mode).toBe("hybrid");
		expect(defaultPlan.targetLimit).toBe(10);

		const explicitPlan = await planner.plan({
			query: "bread",
			mode: "fulltext",
			limit: 3,
		});
		expect(explicitPlan.mode).toBe("fulltext");
		expect(explicitPlan.targetLimit).toBe(3);
	});
});
