import { defineConfig } from "vitepress";

export default defineConfig({
	title: "kolm-search",
	description:
		"Headless RAG search orchestration for your existing stack. Build production-grade search pipelines using your own databases and LLM providers. Zero vendor lock-in, edge-ready, and fully type-safe.",
	cleanUrls: true,
	themeConfig: {
		logo: "/logo.svg",
		nav: [
			{ text: "Guide", link: "/guide/getting-started" },
			{ text: "Reference", link: "/reference/core" },
			{
				text: "Changelog",
				link: "https://github.com/jellekuipers/kolm-search/blob/main/CHANGELOG.md",
			},
		],
		sidebar: {
			"/guide/": [
				{
					text: "Guide",
					items: [
						{ text: "Getting Started", link: "/guide/getting-started" },
						{ text: "Architecture", link: "/guide/architecture" },
						{ text: "Presets", link: "/guide/presets" },
					],
				},
			],
			"/reference/": [
				{
					text: "Reference",
					items: [
						{ text: "Core API", link: "/reference/core" },
						{ text: "Adapters", link: "/reference/adapters" },
						{ text: "Contracts", link: "/reference/contracts" },
						{ text: "Errors and Stages", link: "/reference/errors" },
					],
				},
			],
		},
		socialLinks: [
			{ icon: "github", link: "https://github.com/jellekuipers/kolm-search" },
		],
		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright (c) Jelle Kuipers",
		},
		search: {
			provider: "local",
		},
	},
});
