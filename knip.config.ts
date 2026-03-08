import type { KnipConfig } from "knip";

const config: KnipConfig = {
	ignore: ["examples/**"],
	ignoreDependencies: ["bumpp"],
	vitest: {
		config: ["vitest.config.ts"],
		entry: ["tests/**/*.test.ts", "tests/**/*.test-d.ts"],
	},
};

export default config;
