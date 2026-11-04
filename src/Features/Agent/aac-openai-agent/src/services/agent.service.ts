import type { AgentInputItem } from "@openai/agents";
import { run } from "@openai/agents";
import type { agent as aacAgent } from "../agents/agent.js";
import { updateBoardContext } from "../agents/tools.js";
import {
	type AgentContextState,
	BoardContextSchema,
} from "../schema/context.js";
import type { OpenBoard } from "../schema/openboard.js";

type AgentOutput = {
	message: string | undefined;
	outputBoard: OpenBoard | null;
};
class AgentService {
	private readonly agent: typeof aacAgent;
	// shortcut: volatile, unbounded state; use durable per-thread storage before production.
	// In-memory store for now, will migrate to using firebase
	private userContextStore = new Map<string, AgentContextState>();

	constructor(agent: typeof aacAgent) {
		this.agent = agent;
	}

	async generateBoard(query: string, requestId: string): Promise<AgentOutput> {
		const state = this.userContextStore.get(requestId);
		const context = structuredClone(
			state?.context ?? {
				requirements: { topic: null, rows: null, columns: null },
				board: null,
			},
		);
		context.board = null;
		const messages: AgentInputItem[] = [
			...(state?.history ?? []),
			{ content: query, role: "user" },
		];

		const result = await run(this.agent, messages, { context });
		const reply = result.finalOutput?.trim();
		if (!reply) throw new Error("No final output");
		const updated = result.newItems.some(
			(item) =>
				item.type === "tool_call_output_item" &&
				item.executionStatus === "executed" &&
				item.rawItem.type === "function_call_result" &&
				item.rawItem.name === updateBoardContext.name,
		);
		// Tool call check: must execute updateBoardContext tool at least once
		if (!updated) throw new Error("Context was not updated in this run");

		// Validate the board context. Error throws if required fields are not met (See schema/context.ts for detail rules)
		const updatedContext = BoardContextSchema.parse(result.runContext.context);
		const { topic, rows, columns } = updatedContext.requirements;
		const { board } = updatedContext;
		const complete = topic !== null && rows !== null && columns !== null;
		if (complete && board === null)
			throw new Error("No board submitted for complete requirements");

		// Save the updated context to the user context store
		this.userContextStore.set(requestId, {
			history: result.history,
			context: updatedContext,
		});

		return { message: reply, outputBoard: updatedContext.board };
	}
}

export { AgentService };
