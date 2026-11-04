import assert from "node:assert/strict";
import test from "node:test";
import { setTracingDisabled, Usage } from "@openai/agents";
import { agent } from "../src/agents/agent.ts";
import { AgentService } from "../src/services/agent.service.ts";

setTracingDisabled(true);

const food = { topic: "Food", rows: 3, columns: 4 };
const partial = { topic: "Food", rows: null, columns: null };
const board = {
	name: "Food", locale: "en", description_html: null,
	grid: { rows: 3, columns: 4 },
	buttons: [{ label: "Eat", image: { search_keyword: "person eating" }, actions: ["&Eat"] }],
};
let callId = 0;

function update(requirements, draft = null) {
	return {
		type: "function_call", name: "update_board_context", callId: `update-${++callId}`,
		status: "completed", arguments: JSON.stringify({ requirements, board: draft }),
	};
}

function reply(text) {
	return {
		type: "message", role: "assistant", status: "completed",
		content: [{ type: "output_text", text }],
	};
}

// Only the external model is scripted; tools, runner, parsing, and history remain real.
function scriptedService(outputs, overrides = {}) {
	const requests = [];
	const model = {
		async getResponse(request) {
			requests.push(structuredClone(request));
			assert.ok(outputs.length > 0, "Unexpected model call");
			const next = outputs.shift();
			if (next instanceof Error) throw next;
			return { usage: new Usage(), output: Array.isArray(next) ? next : [next] };
		},
		async *getStreamedResponse() {
			throw new Error("Streaming is not used by AgentService");
		},
	};
	return { service: new AgentService(agent.clone({ ...overrides, model })), requests };
}

function savedRequirements(request) {
	const match = request.systemInstructions.match(/<saved_requirements>\n([\s\S]*?)\n<\/saved_requirements>/);
	assert.ok(match, "Saved requirements must be visible to the model");
	return JSON.parse(match[1]);
}

function userMessages(request) {
	return request.input.filter((item) => item.role === "user").map((item) => item.content);
}

function toolFeedback(request) {
	const result = request.input.findLast((item) => item.type === "function_call_result");
	assert.ok(result, "The next model call must see the tool result");
	const output = typeof result.output === "string" ? result.output : result.output.text;
	return JSON.parse(output);
}

test("tool updates are visible within the run and survive clarification turns", async () => {
	const { service, requests } = scriptedService([
		update(partial), reply("What grid size?"),
		update(food), update(food, board), reply("Your board is ready."),
	]);

	assert.deepEqual(await service.generateBoard("A food board", "user_abc"), {
		message: "What grid size?", outputBoard: null,
	});
	const result = await service.generateBoard("3 rows and 4 columns", "user_abc");
	assert.equal(result.message, "Your board is ready.");
	assert.deepEqual(Object.keys(result).sort(), ["message", "outputBoard"]);
	assert.deepEqual(result.outputBoard.grid, { rows: 3, columns: 4 });
	assert.equal(result.outputBoard.buttons[0].image.search_keyword, "person eating");

	assert.deepEqual(savedRequirements(requests[0]), { topic: null, rows: null, columns: null });
	assert.deepEqual(toolFeedback(requests[1]), { topic: "Food", rows: null, columns: null });
	assert.deepEqual(savedRequirements(requests[2]), { topic: "Food", rows: null, columns: null });
	assert.deepEqual(toolFeedback(requests[3]), { topic: "Food", rows: 3, columns: 4 });
	assert.deepEqual(userMessages(requests[2]), ["A food board", "3 rows and 4 columns"]);
	assert.equal(requests[0].outputType, "text");
	assert.equal(requests[0].modelSettings.toolChoice, "required");
	assert.equal(requests[0].modelSettings.parallelToolCalls, false);
	assert.notEqual(requests[1].modelSettings.toolChoice, "required");
	assert.equal(requests[2].modelSettings.toolChoice, "required");
});

test("corrections and explicit clearing replace a prior board without stale success", async () => {
	const corrected = { topic: "Food", rows: 2, columns: 4 };
	const cleared = { topic: "Food", rows: null, columns: 4 };
	const seenBoards = [];
	const { service, requests } = scriptedService([
		update(food, board), reply("Ready."),
		update(corrected, { ...board, grid: { rows: 2, columns: 4 } }), reply("Updated."),
		update(cleared), reply("How many rows?"),
		update(cleared), reply("How many rows?"),
	], {
		instructions: (context) => {
			seenBoards.push(context.context.board?.name ?? null);
			return agent.getSystemPrompt(context);
		},
	});
	await service.generateBoard("A 3x4 food board", "user_abc");
	const correctedResult = await service.generateBoard("Actually, 2 rows", "user_abc");
	assert.deepEqual(correctedResult.outputBoard.grid, { rows: 2, columns: 4 });
	assert.deepEqual(await service.generateBoard("Forget the rows", "user_abc"), {
		message: "How many rows?", outputBoard: null,
	});
	await service.generateBoard("What is missing?", "user_abc");

	assert.equal(seenBoards[2], null, "A new run must not reuse the old working board");
	assert.deepEqual(savedRequirements(requests[4]), { topic: "Food", rows: 2, columns: 4 });
	assert.deepEqual(savedRequirements(requests[6]), { topic: "Food", rows: null, columns: 4 });
});

test("different request IDs retain independent context and tool histories", async () => {
	const travel = { topic: "Travel", rows: null, columns: null };
	const { service, requests } = scriptedService([
		update(food, board), reply("Ready."),
		update(travel), reply("What grid size?"),
		update(food, board), reply("Unchanged."),
	]);
	await service.generateBoard("A 3x4 food board", "food-thread");
	await service.generateBoard("A travel board", "travel-thread");
	await service.generateBoard("Keep the layout", "food-thread");

	assert.deepEqual(savedRequirements(requests[2]), { topic: null, rows: null, columns: null });
	assert.deepEqual(userMessages(requests[2]), ["A travel board"]);
	assert.deepEqual(savedRequirements(requests[4]), { topic: "Food", rows: 3, columns: 4 });
	assert.deepEqual(userMessages(requests[4]), ["A 3x4 food board", "Keep the layout"]);
	const previousTools = requests[4].input.filter((item) => item.type === "function_call");
	assert.equal(previousTools.length, 1);
	assert.equal(JSON.parse(previousTools[0].arguments).requirements.topic, "Food");
});

for (const [name, failedTurn] of [
	["no update tool in this run", [reply("Pretending the old board is ready.")]],
	["complete requirements without a submitted board", [update(food), reply("Ready.")]],
	["SDK error after a valid tool mutation", [update({ topic: "Travel", rows: null, columns: null }), new Error("Test model failure")]],
	["invalid tool requirements", [update({ ...food, rows: 0 })]],
	["board with incomplete requirements", [update({ ...food, topic: null }, board)]],
	["mismatched board rows", [update(food, { ...board, grid: { rows: 2, columns: 4 } })]],
	["mismatched board columns", [update(food, { ...board, grid: { rows: 3, columns: 2 } })]],
	["malformed tool arguments", [{ ...update(food), arguments: "{bad" }]],
	["blank final text", [update(partial), reply("  \n")]],
	["no final output before the SDK turn limit", [update(partial), ...Array.from({ length: 9 }, () => [])]],
]) {
	test(`${name} does not overwrite committed context or history`, async () => {
		const { service, requests } = scriptedService([
			update(food, board), reply("Ready."), ...failedTurn,
			update(food, board), reply("Recovered."),
		]);
		await service.generateBoard("A 3x4 food board", "user_abc");
		await assert.rejects(service.generateBoard("A rejected change", "user_abc"), (error) => error.code !== "ERR_ASSERTION");
		const recoveryStart = requests.length;
		await service.generateBoard("Continue", "user_abc");
		assert.deepEqual(savedRequirements(requests[recoveryStart]), { topic: "Food", rows: 3, columns: 4 });
		assert.deepEqual(userMessages(requests[recoveryStart]), ["A 3x4 food board", "Continue"]);
	});
}
