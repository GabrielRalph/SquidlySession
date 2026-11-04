// agent implementation

import { Agent } from "@openai/agents";
import { z } from "zod";
import { OpenBoardSchema } from "../schema/openboard.js";
import { AAC_AGENT_INSTRUCTIONS } from "./instructions.js";

const status = z.literal(["success", "needs_clarification"]);

export const AgentOutputType = z.union([
	z.object({ status: status, requestId: z.string(), question: z.string() }),
	z.object({ status: status, board: OpenBoardSchema }),
]);

const agent = new Agent({
	name: "AAC Board Generator Agent",
	instructions: AAC_AGENT_INSTRUCTIONS,
	model: "gpt-6.1-terra",
	outputType: z.object({
		result: AgentOutputType,
	}),
});

export { agent };

// const result = await run(agent, "When did the Roman Empire fall?");
// console.log(result.finalOutput);
