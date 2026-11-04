import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";
import { OpenBoardSchema } from "./openboard.js";

export const BoardRequirementsSchema = z.object({
	topic: z.string().trim().min(1).nullable(),
	rows: z.number().int().positive().nullable(),
	columns: z.number().int().positive().nullable(),
});

export const BoardContextSchema = z
	.object({
		requirements: BoardRequirementsSchema,
		board: OpenBoardSchema.nullable().default(null),
	})
	.superRefine(({ requirements, board }, ctx) => {
		if (board === null) return;

		const { topic, rows, columns } = requirements;
		if (
			topic === null ||
			rows === null ||
			columns === null ||
			board.grid.rows !== rows ||
			board.grid.columns !== columns
		) {
			ctx.addIssue({
				code: "custom",
				path: ["board"],
				message: "Board does not match complete requirements",
			});
		}
	});

export type BoardRequirements = z.infer<typeof BoardRequirementsSchema>;
export type BoardContext = z.infer<typeof BoardContextSchema>;

export type RequestMessageState = {
	history: AgentInputItem[];
	context: BoardContext;
};

export type AgentContextState = RequestMessageState;
