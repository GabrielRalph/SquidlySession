import { z } from "zod";

// AI draft only: IDs, resolved images, format, and grid order are added during post-processing.
// URL fields are excluded to avoid invented links.
const nullableString = z.string().nullable().default(null);
const relativeCoordinate = z.number().min(0).max(1).nullable().default(null);

export const OpenBoardImageSchema = z.object({
	search_keyword: z
		.string()
		.trim()
		.min(1)
		.describe(
			"Semantic search query that will be sent to a vector database to find this button's image. Describe what the intended image depicts, such as 'glass of water' or 'person waving hello'; not an ID, filename, URL, or resolved asset reference.",
		),
});

// OBAction.toJSON() serializes actions as strings, not { mode, value } objects.
export const OpenBoardActionSchema = z
	.string()
	.describe(
		"Behavior only: :home or :speak for commands, +text to append, &text to insert. Never encode board, button, or image IDs here; IDs are assigned during post-processing.",
	);

export const OpenBoardButtonSchema = z.object({
	font_size: z
		.enum(["tiny", "small", "medium", "large", "huge", "giant"])
		.default("medium"),
	label: nullableString,
	image: OpenBoardImageSchema,
	actions: z.array(OpenBoardActionSchema).nullable().default(null),
	action: OpenBoardActionSchema.nullable().default(null),
	bold: z.boolean().default(false),
	label_at_bottom: z.boolean().default(false),
	italic: z.boolean().default(false),
	background_color: nullableString,
	border_color: nullableString,
	text_color: nullableString,
	feature_color: nullableString,
	vocalization: nullableString,
	top: relativeCoordinate,
	left: relativeCoordinate,
});

export const OpenBoardGridSchema = z.object({
	rows: z.number().int().nonnegative(),
	columns: z.number().int().nonnegative(),
});

export const OpenBoardSchema = z.object({
	grid: OpenBoardGridSchema,
	name: nullableString,
	description_html: nullableString,
	locale: z.string().default("en"),
	buttons: z
		.array(OpenBoardButtonSchema)
		.default([])
		.describe(
			"Buttons in row-major display order: left to right across each row, then top to bottom. Each button contains its own image query; no IDs or separate grid.order mapping are needed.",
		),
});

export type OpenBoard = z.infer<typeof OpenBoardSchema>;
