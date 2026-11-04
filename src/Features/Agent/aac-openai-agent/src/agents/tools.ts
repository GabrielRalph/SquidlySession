import { type RunContext, tool } from "@openai/agents";
import {
	type BoardContext,
	BoardContextSchema,
	BoardRequirementsSchema,
} from "../schema/context.js";

export const updateBoardContext = tool({
	name: "update_board_context",
	description:
		"Save the full board requirements and draft. Preserve known requirements unless changed or cleared. Use board: null until a matching draft is ready.",
	parameters: BoardContextSchema,
	outputSchema: BoardRequirementsSchema,
	errorFunction: null,
	execute: (input, runContext?: RunContext<BoardContext>) => {
		if (!runContext) throw new Error("Run context is required");

		const next = BoardContextSchema.parse(input);
		Object.assign(runContext.context, next);
		return next.requirements;
	},
});
