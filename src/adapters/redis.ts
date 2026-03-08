import type { CacheStore } from "../contracts/ports";

/**
 * Minimal interface for a Redis client compatible with {@link RedisCacheStore}.
 *
 * Both `ioredis` and `redis` (node-redis v4+) satisfy this interface — pass
 * either client directly to the constructor.
 */
export interface RedisClientLike {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, ex: "EX", ttl: number): Promise<unknown>;
	set(key: string, value: string): Promise<unknown>;
	del(key: string): Promise<unknown>;
}

/**
 * {@link CacheStore} backed by a Redis client.
 *
 * Values are JSON-serialised before storage. Accepts any client that
 * implements {@link RedisClientLike} — compatible with `ioredis` and
 * `redis` (node-redis v4+).
 *
 * @example Using ioredis
 * ```ts
 * import Redis from "ioredis";
 * import { RedisCacheStore } from "kolm-search/adapters/redis";
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const cache = new RedisCacheStore(redis);
 * ```
 *
 * @example Using node-redis
 * ```ts
 * import { createClient } from "redis";
 * import { RedisCacheStore } from "kolm-search/adapters/redis";
 *
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 * const cache = new RedisCacheStore(redis);
 * ```
 *
 * @remarks
 * For multi-instance deployments where a shared cache is required (e.g.
 * multiple Node.js workers or Cloudflare Workers using a Redis-backed store),
 * `RedisCacheStore` replaces {@link InMemoryCache} so all instances share the
 * same cached responses.
 */
export class RedisCacheStore implements CacheStore {
	constructor(private readonly client: RedisClientLike) {}

	public async get<T>(key: string): Promise<T | undefined> {
		const raw = await this.client.get(key);
		if (raw === null) return undefined;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return undefined;
		}
	}

	public async set<T>(
		key: string,
		value: T,
		ttlSeconds?: number,
	): Promise<void> {
		const serialized = JSON.stringify(value);
		if (ttlSeconds !== undefined) {
			await this.client.set(key, serialized, "EX", ttlSeconds);
		} else {
			await this.client.set(key, serialized);
		}
	}
}
