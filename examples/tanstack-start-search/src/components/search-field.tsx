import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import {
	Button as AriaButton,
	SearchField as AriaSearchField,
	type SearchFieldProps as AriaSearchFieldProps,
	type ValidationResult as AriaValidationResult,
} from "react-aria-components";
import {
	Description,
	FieldError,
	FieldGroup,
	Input,
	Label,
} from "#/components/field";

export interface SearchFieldProps extends AriaSearchFieldProps {
	description?: string;
	errorMessage?: string | ((validation: AriaValidationResult) => string);
	label?: string;
}

export function SearchField({
	description,
	errorMessage,
	label,
	...props
}: SearchFieldProps) {
	return (
		<AriaSearchField
			{...props}
			aria-label="Search"
			className="group flex w-full min-w-10 flex-col gap-1"
		>
			{label ? <Label>{label}</Label> : null}
			<FieldGroup>
				<MagnifyingGlassIcon
					aria-hidden
					className="ml-2 fill-muted-foreground group-disabled:fill-muted-foreground/50"
				/>
				<Input
					className="w-full outline-none [&::-webkit-search-cancel-button]:hidden"
					placeholder="Search for adapter, or retriever"
				/>
				<AriaButton className="mr-1 w-6 group-empty:invisible">
					<XIcon aria-hidden />
				</AriaButton>
			</FieldGroup>
			{description ? <Description>{description}</Description> : null}
			<FieldError>{errorMessage}</FieldError>
		</AriaSearchField>
	);
}
