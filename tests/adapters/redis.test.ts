import { describe, expect, it, vi } from "vitest";
import { RedisCacheStore } from "../../src/adapters/redis";

const makeClient = () => ({
	get: vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null),
	set: vi
		.fn<
			| ((key: string, value: string, ex: "EX", ttl: number) => Promise<string>)
			| ((key: string, value: string) => Promise<string>)
		>()
		.mockResolvedValue("OK"),
	del: vi.fn<(key: string) => Promise<number>>().mockResolvedValue(1),
});

describe("RedisCacheStore", () => {
	it("returns undefined on cache miss (null from redis)", async () => {
		const client = makeClient();
		const cache = new RedisCacheStore(client);
		expect(await cache.get("missing-key")).toBeUndefined();
		expect(client.get).toHaveBeenCalledWith("missing-key");
	});

	it("deserialises a stored JSON value on hit", async () => {
		const client = makeClient();
		client.get.mockResolvedValueOnce(JSON.stringify({ hello: "world" }));
		const cache = new RedisCacheStore(client);
		expect(await cache.get("key")).toEqual({ hello: "world" });
	});

	it("returns undefined when the stored value is invalid JSON", async () => {
		const client = makeClient();
		client.get.mockResolvedValueOnce("not-json{{{");
		const cache = new RedisCacheStore(client);
		expect(await cache.get("key")).toBeUndefined();
	});

	it("serialises and stores a value with EX when ttlSeconds is provided", async () => {
		const client = makeClient();
		const cache = new RedisCacheStore(client);
		await cache.set("key", { foo: 1 }, 60);
		expect(client.set).toHaveBeenCalledWith(
			"key",
			JSON.stringify({ foo: 1 }),
			"EX",
			60,
		);
	});

	it("stores a value without EX when no ttlSeconds provided", async () => {
		const client = makeClient();
		const cache = new RedisCacheStore(client);
		await cache.set("key", "value");
		expect(client.set).toHaveBeenCalledWith("key", '"value"');
	});

	it("stores primitive values (number)", async () => {
		const client = makeClient();
		client.get.mockResolvedValueOnce("42");
		const cache = new RedisCacheStore(client);
		expect(await cache.get("num")).toBe(42);
	});

	it("stores arrays", async () => {
		const client = makeClient();
		client.get.mockResolvedValueOnce(JSON.stringify([1, 2, 3]));
		const cache = new RedisCacheStore(client);
		expect(await cache.get("arr")).toEqual([1, 2, 3]);
	});
});
