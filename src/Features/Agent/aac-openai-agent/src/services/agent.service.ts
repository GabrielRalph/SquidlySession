import type { AgentInputItem } from "@openai/agents";
import { run } from "@openai/agents";
import type { z } from "zod";
import type { AgentOutputType, agent as aacAgent } from "../agents/agent.js";

type AgentOutput = z.infer<typeof AgentOutputType>;
class AgentService {
	private readonly agent: typeof aacAgent;
	private requestMessageMap: Map<string, AgentInputItem[]> = new Map();

	constructor(agent: typeof aacAgent) {
		this.agent = agent;
	}

	async generateBoard(query: string, requestId: string): Promise<AgentOutput> {
		const messages: AgentInputItem[] = [
			...(this.requestMessageMap.get(requestId) ?? []),
			{ content: query, role: "user" },
		];

		const result = await run(this.agent, messages);
		if (!result.finalOutput) throw new Error("No final output");

		this.requestMessageMap.set(requestId, result.history);

		return result.finalOutput.result;
	}
}

export { AgentService };
