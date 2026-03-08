import { describe, expect, it } from "vitest";
import { InMemoryFulltextRetriever } from "../../src/adapters/in-memory";
import type { StandardSchemaV1 } from "../../src/contracts/standard-schema";
import type { SearchRequest, SearchResponse } from "../../src/contracts/types";
import { SchemaValidationError, SearchError } from "../../src/contracts/types";
import { DefaultQueryPlanner } from "../../src/core/default-planner";
import { SearchClient } from "../../src/core/search-client";

// ---------------------------------------------------------------------------
// Minimal Standard Schema helpers
// ---------------------------------------------------------------------------

/**
 * Creates a Standard Schema that always passes and returns the value as-is.
 */
function passingSchema<T>(): StandardSchemaV1<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: (value) => ({ value: value as T }),
		},
	};
}

/**
 * Creates a Standard Schema that always fails with the given issues.
 */
function failingSchema<T>(
	issues: Array<{ message: string }>,
): StandardSchemaV1<unknown, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "test",
			validate: () => ({ issues }),
		},
	};
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const docs = [{ id: "1", content: "levain bread recipe" }];

const makeClient = (options: {
	inputSchema?: StandardSchemaV1<unknown, SearchRequest>;
	outputSchema?: StandardSchemaV1<unknown, SearchResponse>;
}) =>
	new SearchClient(
		{
			planner: new DefaultQueryPlanner(),
			retriever: new InMemoryFulltextRetriever(docs),
		},
		options,
	);

// ---------------------------------------------------------------------------
// inputSchema
// ---------------------------------------------------------------------------

describe("inputSchema validation", () => {
	it("passes through the request when schema validates successfully", async () => {
		const client = makeClient({ inputSchema: passingSchema<SearchRequest>() });
		const result = await client.search({ query: "levain", mode: "fulltext" });

		expect(result.results.length).toBeGreaterThanOrEqual(0);
	});

	it("throws SchemaValidationError with target 'input' when input schema fails", async () => {
		const client = makeClient({
			inputSchema: failingSchema<SearchRequest>([
				{ message: "query is required" },
				{ message: "mode must be fulltext or vector" },
			]),
		});

		await expect(
			client.search({ query: "levain", mode: "fulltext" }),
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SchemaValidationError && err.target === "input",
		);
	});

	it("includes all issue messages in the SchemaValidationError", async () => {
		const client = makeClient({
			inputSchema: failingSchema<SearchRequest>([
				{ message: "issue one" },
				{ message: "issue two" },
			]),
		});

		let caught: unknown;
		try {
			await client.search({ query: "test", mode: "fulltext" });
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(SchemaValidationError);
		const error = caught as SchemaValidationError;
		expect(error.issues).toHaveLength(2);
		expect(error.issues[0]?.message).toBe("issue one");
		expect(error.issues[1]?.message).toBe("issue two");
		expect(error.message).toContain("issue one");
		expect(error.message).toContain("issue two");
	});

	it("does not run the pipeline when inputSchema rejects", async () => {
		const retriever = {
			retrieve: () => {
				throw new Error("should not be called");
			},
		};
		const client = new SearchClient(
			{ planner: new DefaultQueryPlanner(), retriever },
			{
				inputSchema: failingSchema<SearchRequest>([{ message: "bad input" }]),
			},
		);

		await expect(
			client.search({ query: "anything", mode: "fulltext" }),
		).rejects.toBeInstanceOf(SchemaValidationError);
	});
});

// ---------------------------------------------------------------------------
// outputSchema
// ---------------------------------------------------------------------------

describe("outputSchema validation", () => {
	it("passes through the response when schema validates successfully", async () => {
		const client = makeClient({
			outputSchema: passingSchema<SearchResponse>(),
		});
		const result = await client.search({ query: "levain", mode: "fulltext" });

		expect(typeof result.durationMs).toBe("number");
	});

	it("throws SchemaValidationError with target 'output' when output schema fails", async () => {
		const client = makeClient({
			outputSchema: failingSchema<SearchResponse>([
				{ message: "durationMs must be positive" },
			]),
		});

		await expect(
			client.search({ query: "levain", mode: "fulltext" }),
		).rejects.toSatisfy(
			(err: unknown) =>
				err instanceof SchemaValidationError && err.target === "output",
		);
	});
});

// ---------------------------------------------------------------------------
// SchemaValidationError class
// ---------------------------------------------------------------------------

describe("SchemaValidationError", () => {
	it("sets target correctly", () => {
		const err = new SchemaValidationError("input", [{ message: "bad" }]);
		expect(err.target).toBe("input");
	});

	it("sets issues array", () => {
		const issues = [{ message: "required" }, { message: "too short" }];
		const err = new SchemaValidationError("output", issues);
		expect(err.issues).toEqual(issues);
	});

	it("is an instance of Error", () => {
		const err = new SchemaValidationError("input", [{ message: "x" }]);
		expect(err).toBeInstanceOf(Error);
	});

	it("has name SchemaValidationError", () => {
		const err = new SchemaValidationError("input", [{ message: "x" }]);
		expect(err.name).toBe("SchemaValidationError");
	});

	it("includes issue messages in the error message string", () => {
		const err = new SchemaValidationError("input", [
			{ message: "field a is missing" },
			{ message: "field b is invalid" },
		]);
		expect(err.message).toContain("field a is missing");
		expect(err.message).toContain("field b is invalid");
	});
});

// ---------------------------------------------------------------------------
// SearchError class
// ---------------------------------------------------------------------------

describe("SearchError", () => {
	it("is an instance of Error", () => {
		const err = new SearchError("something failed", "retriever");
		expect(err).toBeInstanceOf(Error);
	});

	it("has name SearchError", () => {
		const err = new SearchError("msg", "planner");
		expect(err.name).toBe("SearchError");
	});

	it("exposes stage", () => {
		const err = new SearchError("msg", "embedder");
		expect(err.stage).toBe("embedder");
	});

	it("exposes cause when provided", () => {
		const cause = new Error("original");
		const err = new SearchError("wrapped", "retriever", cause);
		expect(err.cause).toBe(cause);
	});

	it("cause is undefined when not provided", () => {
		const err = new SearchError("msg", "cache.get");
		expect(err.cause).toBeUndefined();
	});
});
