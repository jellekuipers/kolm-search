import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/adapters/generic.ts",
		"src/adapters/in-memory.ts",
		"src/adapters/cloudflare/index.ts",
		"src/adapters/redis.ts",
		"src/presets/basic.ts",
		"src/presets/cloudflare.ts",
		"src/presets/postgres.ts",
	],
	exports: true,
});
