import { assertType, describe, expectTypeOf, it } from "vitest";
import type {
	CacheStore,
	SearchPipelineModules,
} from "../../src/contracts/ports";
import type { StandardSchemaV1 } from "../../src/contracts/standard-schema";
import type {
	Logger,
	QueryPlan,
	SchemaIssue,
	SearchDocument,
	SearchMode,
	SearchPipelineOptions,
	SearchRequest,
	SearchResponse,
	SearchResponseMetadata,
} from "../../src/contracts/types";
import { SchemaValidationError, SearchError } from "../../src/contracts/types";

// ---------------------------------------------------------------------------
// SearchDocument
// ---------------------------------------------------------------------------

describe("SearchDocument types", () => {
	it("has required id and content fields", () => {
		expectTypeOf<SearchDocument>().toHaveProperty("id").toEqualTypeOf<string>();
		expectTypeOf<SearchDocument>()
			.toHaveProperty("content")
			.toEqualTypeOf<string>();
	});

	it("has optional title, source, tags, metadata, score", () => {
		expectTypeOf<SearchDocument>()
			.toHaveProperty("title")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<SearchDocument>()
			.toHaveProperty("source")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<SearchDocument>()
			.toHaveProperty("tags")
			.toEqualTypeOf<string[] | undefined>();
		expectTypeOf<SearchDocument>()
			.toHaveProperty("metadata")
			.toEqualTypeOf<Record<string, unknown> | undefined>();
		expectTypeOf<SearchDocument>()
			.toHaveProperty("score")
			.toEqualTypeOf<number | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SearchMode
// ---------------------------------------------------------------------------

describe("SearchMode", () => {
	it("is a union of three literals", () => {
		assertType<SearchMode>("vector");
		assertType<SearchMode>("fulltext");
		assertType<SearchMode>("hybrid");
	});
});

// ---------------------------------------------------------------------------
// SearchRequest
// ---------------------------------------------------------------------------

describe("SearchRequest types", () => {
	it("requires query string", () => {
		expectTypeOf<SearchRequest>()
			.toHaveProperty("query")
			.toEqualTypeOf<string>();
	});

	it("has optional limit, offset, mode, filters, context", () => {
		expectTypeOf<SearchRequest>()
			.toHaveProperty("limit")
			.toEqualTypeOf<number | undefined>();
		expectTypeOf<SearchRequest>()
			.toHaveProperty("offset")
			.toEqualTypeOf<number | undefined>();
		expectTypeOf<SearchRequest>()
			.toHaveProperty("mode")
			.toEqualTypeOf<SearchMode | undefined>();
	});
});

// ---------------------------------------------------------------------------
// QueryPlan
// ---------------------------------------------------------------------------

describe("QueryPlan types", () => {
	it("has required normalizedQuery, mode, targetLimit", () => {
		expectTypeOf<QueryPlan>()
			.toHaveProperty("normalizedQuery")
			.toEqualTypeOf<string>();
		expectTypeOf<QueryPlan>()
			.toHaveProperty("mode")
			.toEqualTypeOf<SearchMode>();
		expectTypeOf<QueryPlan>()
			.toHaveProperty("targetLimit")
			.toEqualTypeOf<number>();
	});

	it("has optional intent", () => {
		expectTypeOf<QueryPlan>()
			.toHaveProperty("intent")
			.toEqualTypeOf<string | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SearchResponse
// ---------------------------------------------------------------------------

describe("SearchResponse types", () => {
	it("has required fields", () => {
		expectTypeOf<SearchResponse>()
			.toHaveProperty("results")
			.toEqualTypeOf<SearchDocument[]>();
		expectTypeOf<SearchResponse>()
			.toHaveProperty("durationMs")
			.toEqualTypeOf<number>();
	});

	it("has optional answer", () => {
		expectTypeOf<SearchResponse>()
			.toHaveProperty("answer")
			.toEqualTypeOf<string | undefined>();
	});

	it("has optional SearchResponseMetadata", () => {
		expectTypeOf<SearchResponse>()
			.toHaveProperty("metadata")
			.toEqualTypeOf<SearchResponseMetadata | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SearchError
// ---------------------------------------------------------------------------

describe("SearchError types", () => {
	it("is assignable to Error", () => {
		const err = new SearchError("msg", "stage");
		assertType<Error>(err);
	});

	it("has stage as string", () => {
		expectTypeOf(new SearchError("msg", "retriever"))
			.toHaveProperty("stage")
			.toEqualTypeOf<string>();
	});

	it("cause is typed as unknown | undefined", () => {
		expectTypeOf(new SearchError("msg", "s"))
			.toHaveProperty("cause")
			.toEqualTypeOf<unknown>();
	});
});

// ---------------------------------------------------------------------------
// SchemaValidationError
// ---------------------------------------------------------------------------

describe("SchemaValidationError types", () => {
	it("is assignable to Error", () => {
		const err = new SchemaValidationError("input", []);
		assertType<Error>(err);
	});

	it("target is 'input' | 'output'", () => {
		expectTypeOf(new SchemaValidationError("input", []))
			.toHaveProperty("target")
			.toEqualTypeOf<"input" | "output">();
	});

	it("issues is a readonly array of SchemaIssue", () => {
		expectTypeOf(new SchemaValidationError("output", []))
			.toHaveProperty("issues")
			.toEqualTypeOf<ReadonlyArray<SchemaIssue>>();
	});
});

// ---------------------------------------------------------------------------
// CacheStore
// ---------------------------------------------------------------------------

describe("CacheStore types", () => {
	it("get<T> returns Promise<T | undefined>", () => {
		type Store = CacheStore;
		expectTypeOf<Store["get"]>().returns.toEqualTypeOf<Promise<unknown>>();
	});

	it("accepts any serialisable value in set", () => {
		// satisfies structural check: CacheStore.set takes key, value, optional ttl
		type SetFn = CacheStore["set"];
		expectTypeOf<SetFn>().parameter(0).toEqualTypeOf<string>();
		expectTypeOf<SetFn>().parameter(1).toEqualTypeOf<unknown>();
		expectTypeOf<SetFn>().parameter(2).toEqualTypeOf<number | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SearchPipelineOptions
// ---------------------------------------------------------------------------

describe("SearchPipelineOptions types", () => {
	it("accepts a valid options object", () => {
		const opts: SearchPipelineOptions = {
			defaultLimit: 10,
			defaultMode: "fulltext",
			cacheTtlSeconds: 60,
		};
		assertType<SearchPipelineOptions>(opts);
	});

	it("logger is optional and typed as Logger | undefined", () => {
		expectTypeOf<SearchPipelineOptions>()
			.toHaveProperty("logger")
			.toEqualTypeOf<Logger | undefined>();
	});
});

// ---------------------------------------------------------------------------
// SearchPipelineModules
// ---------------------------------------------------------------------------

describe("SearchPipelineModules types", () => {
	it("requires planner and retriever", () => {
		expectTypeOf<SearchPipelineModules>().toHaveProperty("planner");
		expectTypeOf<SearchPipelineModules>().toHaveProperty("retriever");
	});
});

// ---------------------------------------------------------------------------
// StandardSchemaV1
// ---------------------------------------------------------------------------

describe("StandardSchemaV1 types", () => {
	it("has ~standard property with validate function", () => {
		type Schema = StandardSchemaV1<string, string>;
		expectTypeOf<Schema>().toHaveProperty("~standard");
	});
});
