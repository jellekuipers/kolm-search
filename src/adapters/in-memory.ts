import type {
	CacheStore,
	Deduplicator,
	IntentClassifier,
	Reranker,
	Retriever,
} from "../contracts/ports";
import type { SearchDocument, SearchPipelineContext } from "../contracts/types";
import { SearchError } from "../contracts/types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Splits text into lowercase alphanumeric tokens, discarding punctuation and whitespace.
const tokenize = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/[^a-z0-9]+/i)
		.filter((token) => token.length > 0);

// Token-overlap score: fraction of query tokens found anywhere in the content token set.
const scoreFulltextMatch = (query: string, content: string): number => {
	const queryTokens = tokenize(query);
	const contentTokens = new Set(tokenize(content));
	if (queryTokens.length === 0) return 0;
	const matches = queryTokens.filter((token) =>
		contentTokens.has(token),
	).length;
	return matches / queryTokens.length;
};

// Standard cosine similarity. Returns 0 for mismatched lengths or zero-magnitude vectors.
const cosineSimilarity = (a: number[], b: number[]): number => {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let index = 0; index < a.length; index++) {
		const valueA = a[index] as number;
		const valueB = b[index] as number;
		dot += valueA * valueB;
		normA += valueA * valueA;
		normB += valueB * valueB;
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
};

// ---------------------------------------------------------------------------
// Retrievers
// ---------------------------------------------------------------------------

/**
 * Fulltext-only in-memory retriever for development and testing.
 *
 * Scores documents by the fraction of query tokens present in the combined
 * `title + content` field and returns up to `targetLimit × 2` candidates.
 *
 * Throws {@link SearchError} when mode is `"vector"` — use
 * {@link InMemoryVectorRetriever} for vector search, or compose both with
 * `CompositeRetriever` for hybrid search.
 *
 * @remarks
 * Documents are held in the process memory of the running Node.js / worker
 * process. For a shared, durable cache across instances use a remote store
 * (e.g. {@link KVCacheStore} or a Redis adapter).
 */
export class InMemoryFulltextRetriever implements Retriever {
	constructor(private readonly documents: SearchDocument[]) {}

	public async retrieve(
		context: SearchPipelineContext,
	): Promise<SearchDocument[]> {
		/**
		 * @throws {@link SearchError} When `context.plan.mode` is `"vector"` — this
		 *   retriever only supports fulltext and hybrid modes.
		 */
		if (context.plan.mode === "vector") {
			throw new SearchError(
				'[retriever] InMemoryFulltextRetriever does not support mode "vector". ' +
					"Use InMemoryVectorRetriever or compose both with CompositeRetriever.",
				"retriever",
			);
		}

		const query =
			context.plan.expandedQueries?.[0] ?? context.plan.normalizedQuery;

		return this.documents
			.map((document) => ({
				...document,
				score: scoreFulltextMatch(
					query,
					`${document.title ?? ""} ${document.content}`,
				),
			}))
			.filter((document) => (document.score ?? 0) > 0)
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
			.slice(0, context.plan.targetLimit * 2);
	}
}

/** A document paired with its pre-computed embedding vector. */
export interface DocumentWithEmbedding {
	document: SearchDocument;
	embedding: number[];
}

/**
 * Vector-only in-memory retriever using cosine similarity.
 *
 * Requires the pipeline to have an {@link Embedder} so that
 * `context.embeddings` (the query vector) is populated before retrieval.
 * Throws {@link SearchError} when embeddings are absent.
 *
 * @remarks
 * Documents and embeddings are held in process memory. Not suitable for
 * production workloads with large corpora.
 */
export class InMemoryVectorRetriever implements Retriever {
	constructor(private readonly documents: DocumentWithEmbedding[]) {}

	public async retrieve(
		context: SearchPipelineContext,
	): Promise<SearchDocument[]> {
		/**
		 * @throws {@link SearchError} When `context.embeddings` is absent — an
		 *   {@link Embedder} must be wired into the pipeline.
		 */
		if (!context.embeddings || context.embeddings.length === 0) {
			throw new SearchError(
				"[retriever] InMemoryVectorRetriever requires query embeddings. " +
					"Make sure an Embedder is wired into the pipeline.",
				"retriever",
			);
		}

		return this.documents
			.map(({ document, embedding }) => ({
				...document,
				score: cosineSimilarity(context.embeddings as number[], embedding),
			}))
			.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
			.slice(0, context.plan.targetLimit * 2);
	}
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * In-process LRU-free cache backed by a plain `Map`.
 *
 * Respects optional per-entry TTLs. Expired entries are evicted lazily on
 * the next `get` call.
 *
 * @remarks
 * Data lives only in the memory of the current process. It is not shared
 * across workers, replicas, or restarts. For shared caching use
 * {@link KVCacheStore} or a Redis-backed adapter.
 */
export class InMemoryCache implements CacheStore {
	private readonly storage = new Map<
		string,
		{ value: unknown; expiresAt?: number }
	>();

	public async get<T>(key: string): Promise<T | undefined> {
		const entry = this.storage.get(key);
		if (!entry) return undefined;

		if (entry.expiresAt && entry.expiresAt < Date.now()) {
			this.storage.delete(key);
			return undefined;
		}

		return entry.value as T;
	}

	public async set<T>(
		key: string,
		value: T,
		ttlSeconds?: number,
	): Promise<void> {
		this.storage.set(key, {
			value,
			expiresAt:
				ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : undefined,
		});
	}
}

// ---------------------------------------------------------------------------
// Deduplicator
// ---------------------------------------------------------------------------

/** Removes documents with duplicate `id` values, keeping the first occurrence. */
export class InMemoryDeduplicator implements Deduplicator {
	public deduplicate(documents: SearchDocument[]): SearchDocument[] {
		const seen = new Set<string>();
		const deduplicated: SearchDocument[] = [];

		for (const document of documents) {
			if (seen.has(document.id)) continue;
			seen.add(document.id);
			deduplicated.push(document);
		}

		return deduplicated;
	}
}

// ---------------------------------------------------------------------------
// Reranker
// ---------------------------------------------------------------------------

/** Sorts documents by descending `score`, leaving ties in their original order. */
export class ScoreReranker implements Reranker {
	public async rerank(documents: SearchDocument[]): Promise<SearchDocument[]> {
		return [...documents].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
	}
}

// ---------------------------------------------------------------------------
// IntentClassifier
// ---------------------------------------------------------------------------

/** A rule that maps a set of trigger keywords to an intent label. */
export interface KeywordIntentRule {
	/** The intent label this rule resolves to. */
	intent: string;
	/**
	 * Keywords that trigger this rule. The classifier performs a
	 * case-insensitive substring match on the normalised query.
	 */
	keywords: string[];
}

/**
 * Keyword-based {@link IntentClassifier} for development and simple
 * production use-cases.
 *
 * Iterates the provided rules in order and returns the `intent` of the
 * first rule whose keywords contain a match in the normalised query.
 * Returns `undefined` when no rule matches.
 *
 * @example
 * ```ts
 * const classifier = new BasicKeywordIntentClassifier([
 *   { intent: "pricing", keywords: ["price", "cost", "plan", "subscription"] },
 *   { intent: "tutorial", keywords: ["how", "guide", "setup", "install"] },
 * ]);
 * ```
 *
 * @remarks
 * For higher precision, replace with a model-based classifier (e.g. a
 * zero-shot text classification endpoint) while keeping the same
 * {@link IntentClassifier} interface.
 */
export class BasicKeywordIntentClassifier implements IntentClassifier {
	constructor(private readonly rules: KeywordIntentRule[]) {}

	public async classify(query: string): Promise<string | undefined> {
		for (const rule of this.rules) {
			if (rule.keywords.some((kw) => query.includes(kw))) {
				return rule.intent;
			}
		}
		return undefined;
	}
}
