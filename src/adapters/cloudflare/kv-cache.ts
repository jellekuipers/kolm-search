import type { CacheStore } from "../../contracts/ports";

/**
 * Shape of a Cloudflare KV namespace binding as exposed in a Worker's `env`.
 * Matches the subset used by {@link KVCacheStore}.
 */
interface KVNamespaceBinding {
	get<T = string>(
		key: string,
		options?: { type: "json" | "text" },
	): Promise<T | null>;
	put(
		key: string,
		value: string,
		options?: { expirationTtl?: number },
	): Promise<void>;
}

/**
 * {@link CacheStore} backed by a Cloudflare KV namespace binding.
 *
 * @example
 * ```ts
 * // In a Cloudflare Worker handler:
 * const cache = new KVCacheStore(env.SEARCH_CACHE);
 * ```
 *
 * @remarks
 * Values are JSON-serialised before being stored. The `expirationTtl` option
 * is forwarded directly to the KV `put` call. KV has a minimum TTL of 60 s.
 */
export class KVCacheStore implements CacheStore {
	constructor(private readonly kv: KVNamespaceBinding) {}

	public async get<T>(key: string): Promise<T | undefined> {
		const value = await this.kv.get<T>(key, { type: "json" });
		return value ?? undefined;
	}

	public async set<T>(
		key: string,
		value: T,
		ttlSeconds?: number,
	): Promise<void> {
		await this.kv.put(key, JSON.stringify(value), {
			expirationTtl: ttlSeconds,
		});
	}
}
