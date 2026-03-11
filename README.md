# kolm-search

> **Headless RAG search orchestration for your existing stack.**
> Build production-grade search pipelines using your own databases and LLM providers. Zero vendor lock-in, edge-ready, and fully type-safe.

[![npm version](https://img.shields.io/npm/v/kolm-search)](https://www.npmjs.com/package/kolm-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

`kolm-search` is a TypeScript library for building professional search and Retrieval-Augmented Generation (RAG) pipelines.

It is designed as a headless search engine, providing the orchestration logic—query expansion, hybrid retrieval (vector + fulltext), reranking, and LLM synthesis—while letting you keep your data where it lives. Designed for developers who need complete control over their retrieval logic, `kolm-search` offers a transparent, minimal-dependency alternative to larger, generalized AI frameworks.

- ✅ **Full RAG Pipeline:** Hybrid search, Reciprocal Rank Fusion (RRF), and query normalization out-of-the-box.
- ✅ **Zero Vendor Lock-in:** Bring your own database (Postgres, D1, etc.) and your own LLM provider (OpenAI, Anthropic, Workers AI).
- ✅ **Edge-Ready Performance:** Designed for high-performance Node.js, Bun, and Edge environments (Cloudflare Workers).
- ✅ **Strictly Type-Safe:** Built with TypeScript and [Standard Schema V1](https://standardschema.dev/) support for validated inputs/outputs.

---

## Installation

```bash
pnpm add kolm-search
```

---

## Quick Start (Presets)

Presets are pre-configured search clients for specific environments.

### 1. In-Memory (Dev/Testing)
```typescript
import { createBasicSearchClient } from "kolm-search/presets/basic";

const client = createBasicSearchClient([
  { id: "1", title: "Setup", content: "Install via pnpm add kolm-search" },
]);

const { results } = await client.search({ query: "how to install" });
```

### 2. Cloudflare (Workers + Vectorize + D1)
```typescript
import { createCloudflareSearchClient } from "kolm-search/presets/cloudflare";

export default {
  async fetch(request, env) {
    const client = createCloudflareSearchClient(env, { d1Table: "docs_fts" });
    const response = await client.search({ query: "hybrid search", mode: "hybrid" });
    return Response.json(response);
  },
};
```

---

## Example: Custom RAG Implementation

`kolm-search` is adapter-driven. You can mix and match providers for different stages of the lifecycle by implementing simple interfaces.

```typescript
import { SearchClient } from "kolm-search";
import { createFulltextRetriever } from "kolm-search/adapters/generic";

const client = new SearchClient({
  // 1. Convert text to vector
  embedder: {
    async embed(text) {
      const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: text });
      return res.data[0].embedding;
    }
  },

  // 2. Fetch documents from your own database
  retriever: createFulltextRetriever({
    async search(query, limit) {
      return db.query("SELECT id, content FROM docs WHERE text @@ to_tsquery($1) LIMIT $2", [query, limit]);
    },
    toDocument: (row) => ({ id: row.id, content: row.content })
  }),

  // 3. (Optional) Synthesize an LLM answer
  synthesizer: {
    async synthesize({ plan, results }) {
      const context = results.map(r => r.content).join("\n");
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: `Context: ${context}` }, { role: "user", content: plan.normalizedQuery }]
      });
      return res.choices[0].message.content;
    }
  }
});
```

---

## Features

- **Hybrid Search:** Combine Fulltext (keyword) and Vector (semantic) search with [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) for superior relevance.
- **Smart Query Planning:** Multi-query expansion and intent classification to understand what users *actually* want.
- **Production Orchestration:** Built-in parallel retrieval, response caching with TTLs, and deduplication.
- **Framework Agnostic:** Runs anywhere (Node, Bun, Edge, Deno). No heavy dependencies.
- **Observability:** Detailed stage-level telemetry (track duration and success per-stage).
- **Schema Validation:** Native support for Zod, Valibot, and ArkType via Standard Schema.

---

## Architecture: The Headless Engine

`kolm-search` follows a modular port-and-adapter architecture. You provide the **adapters** (how to talk to your DB/LLM), and the library handles the **pipeline** (the logic of how a search should run).

```text
Request ──▶ [ SearchClient ] ──▶ [ QueryPlanner ] ──▶ [ IntentClassifier ]
                                                              │
    ┌─────────────────────────────────────────────────────────┘
    ▼
[ Embedder ] ──▶ [ Retriever (Vector/Fulltext/Hybrid) ] ──▶ [ Deduplicator ]
                                                              │
    ┌─────────────────────────────────────────────────────────┘
    ▼
[ Reranker ] ──▶ [ Pagination ] ──▶ [ Synthesizer (LLM) ] ──▶ SearchResponse
```

---

## Advanced Configuration

### Error Handling
Identify exactly which stage of the RAG pipeline failed using `PIPELINE_STAGES` constants.

```typescript
import { SearchError, PIPELINE_STAGES } from "kolm-search";

try {
  await client.search({ query: "..." });
} catch (error) {
  if (error instanceof SearchError && error.stage === PIPELINE_STAGES.EMBEDDER) {
    console.error("The LLM embedding service is down.");
  }
}
```

### Telemetry
Monitor your search performance with millisecond precision per-stage.

```typescript
const telemetry: Telemetry = {
  async track(event, payload) {
    // payload.stageDurations = { planner: 5, retriever: 42, reranker: 12, ... }
    console.log(`Search completed in ${payload.durationMs}ms`);
  },
};
```

---

## Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes.

## License

[MIT](LICENSE) © Jelle Kuipers