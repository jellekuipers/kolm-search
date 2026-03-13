import { queryOptions } from "@tanstack/react-query";
import z from "zod";
import { search } from "#/server/search";

export const searchSchema = z.object({
	query: z.string().min(1).max(500).optional(),
	limit: z.number().int().min(1).max(50).optional(),
});

export const searchQueryOptions = (data: z.infer<typeof searchSchema>) =>
	queryOptions({
		enabled: !!data.query,
		queryFn: async () =>
			await search({ data: { query: data.query ?? "", limit: data.limit } }),
		queryKey: ["search"],
	});
