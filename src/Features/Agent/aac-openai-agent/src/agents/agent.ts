import { Agent } from "@openai/agents";
import type { BoardContext } from "../schema/context.js";
import { AAC_AGENT_INSTRUCTIONS } from "./instructions.js";
import { updateBoardContext } from "./tools.js";

const agent = new Agent<BoardContext>({
	name: "AAC Board Generator Agent",
	instructions: ({ context }) =>
		`${AAC_AGENT_INSTRUCTIONS}\n<saved_requirements>\n${JSON.stringify(context.requirements)}\n</saved_requirements>`,
	model: "gpt-6.1-terra",
	tools: [updateBoardContext],
	modelSettings: { toolChoice: "required", parallelToolCalls: false },
	resetToolChoice: true,
});

export { agent };
