import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/contracts/standard-schema.ts"],
			reporter: ["text", "lcovonly", "html"],
			thresholds: {
				lines: 80,
				branches: 80,
				functions: 80,
			},
		},
		typecheck: {
			enabled: true,
			include: ["tests/**/*.test-d.ts"],
		},
	},
});
