import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import z from "zod";
import { Button } from "#/components/button";
import { SearchField } from "#/components/search-field";

const searchFormSchema = z.object({
	query: z.string().min(2).max(500),
});

export function SearchForm() {
	const navigate = useNavigate();

	const { Field, handleSubmit, Subscribe } = useForm({
		defaultValues: {
			query: "",
		},
		onSubmit: ({ value: { query } }) =>
			navigate({
				search: () => ({ query }),
				to: "/",
			}),
		validators: {
			onSubmit: searchFormSchema,
		},
	});

	return (
		<form
			className="flex w-full items-center justify-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				handleSubmit();
			}}
		>
			<Field name="query">
				{(field) => (
					<SearchField
						defaultValue={field.state.value}
						name={field.name}
						onBlur={field.handleBlur}
						onChange={(value) => field.handleChange(value)}
						onClear={field.clearValues}
					/>
				)}
			</Field>
			<Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
				{([canSubmit, isSubmitting]) => (
					<Button
						isDisabled={!canSubmit}
						isPending={isSubmitting}
						type="submit"
					>
						Submit
					</Button>
				)}
			</Subscribe>
		</form>
	);
}
