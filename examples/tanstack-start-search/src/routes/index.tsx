import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "#/components/badge";
import { Card } from "#/components/card";
import { SearchForm } from "#/components/search-form";
import { Spinner } from "#/components/spinner";
import { searchQueryOptions, searchSchema } from "#/queries/search";

export const Route = createFileRoute("/")({
	component: RouteComponent,
	validateSearch: searchSchema,
	loaderDeps: ({ search: { query, limit } }) => ({ query, limit }),
	loader: async ({ context: { queryClient }, deps: { query, limit } }) =>
		queryClient.prefetchQuery(searchQueryOptions({ limit, query })),
});

function RouteComponent() {
	const search = Route.useSearch();
	const { data, isLoading } = useQuery(searchQueryOptions(search));

	return (
		<main className="py-8">
			<section className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center pb-32 space-y-8">
				<h1 className="font-bold">kolm-search</h1>
				<SearchForm />
				<section className="space-y-4 w-full flex flex-col items-center">
					{search.query ? (
						<p className="font-semibold">
							Showing results for <i className="font-normal">{search.query}</i>
						</p>
					) : null}
					{isLoading ? (
						<Spinner />
					) : data?.results.length ? (
						<ul className="flex flex-col gap-4 w-full">
							{data?.results.map((result) => (
								<li key={result.id}>
									<Card className="flex flex-col gap-2">
										<header className="flex gap-1 items-center justify-between">
											<h3 className="font-bold">{result.title}</h3>
											<Badge color="success">Score {result.score}</Badge>
										</header>
										<p className="text-sm">{result.content}</p>
										<footer className="flex gap-1 items-center">
											<ul className="flex gap-1">
												{result.tags?.map((tag) => (
													<li key={tag}>
														<Badge>{tag}</Badge>
													</li>
												))}
											</ul>
										</footer>
									</Card>
								</li>
							))}
						</ul>
					) : (
						<p className="font-semibold">
							No results for <i className="font-normal">{data?.query}</i>
						</p>
					)}
				</section>
			</section>
		</main>
	);
}
