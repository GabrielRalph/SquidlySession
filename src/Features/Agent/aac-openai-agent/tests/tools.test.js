import assert from "node:assert/strict";
import test from "node:test";
import { RunContext } from "@openai/agents";
import * as tools from "../src/agents/tools.ts";
import { BoardContextSchema } from "../src/schema/context.ts";

const food = { topic: "Food", rows: 3, columns: 4 };
const board = {
	name: "Food",
	grid: { rows: 3, columns: 4 },
	buttons: [{ label: "Eat", image: { search_keyword: "person eating" }, actions: ["&Eat"] }],
};

async function invoke(context, input) {
	assert.ok(tools.updateBoardContext, "Context update tool is not implemented");
	return tools.updateBoardContext.invoke(context, typeof input === "string" ? input : JSON.stringify(input));
}

test("requirements-only context defaults its board to null", () => {
	assert.deepEqual(BoardContextSchema.parse({ requirements: food }).board, null);
});

test("the tool updates partial requirements without replacing the application object", async () => {
	const context = { requirements: { topic: null, rows: null, columns: null }, board: null };
	const runContext = new RunContext(context);
	const result = await invoke(runContext, {
		requirements: { topic: "Food", rows: null, columns: null }, board: null,
	});

	assert.equal(runContext.context, context);
	assert.deepEqual(context, { requirements: { topic: "Food", rows: null, columns: null }, board: null });
	assert.deepEqual(typeof result === "string" ? JSON.parse(result) : result, {
		topic: "Food", rows: null, columns: null,
	});
});

test("the tool stores a matching board and repeating the update is idempotent", async () => {
	const runContext = new RunContext({ requirements: { topic: null, rows: null, columns: null }, board: null });
	await invoke(runContext, { requirements: food, board });
	assert.deepEqual(runContext.context.requirements, { topic: "Food", rows: 3, columns: 4 });
	assert.deepEqual(runContext.context.board.grid, { rows: 3, columns: 4 });
	assert.equal(runContext.context.board.buttons[0].label, "Eat");
	const saved = structuredClone(runContext.context);
	await invoke(runContext, { requirements: food, board });
	assert.deepEqual(runContext.context, saved);
});

test("the tool clears a dimension and a prior board explicitly", async () => {
	const runContext = new RunContext({ requirements: food, board });
	await invoke(runContext, { requirements: { topic: "Food", rows: null, columns: 4 }, board: null });
	assert.deepEqual(runContext.context, {
		requirements: { topic: "Food", rows: null, columns: 4 }, board: null,
	});
});

for (const [name, input] of [
	["blank topic", { requirements: { ...food, topic: " " }, board: null }],
	["zero rows", { requirements: { ...food, rows: 0 }, board: null }],
	["negative rows", { requirements: { ...food, rows: -1 }, board: null }],
	["fractional columns", { requirements: { ...food, columns: 1.5 }, board: null }],
	["malformed JSON", "{bad"],
	["board without topic", { requirements: { ...food, topic: null }, board }],
	["board without rows", { requirements: { ...food, rows: null }, board }],
	["board without columns", { requirements: { ...food, columns: null }, board }],
	["mismatched rows", { requirements: food, board: { ...board, grid: { rows: 2, columns: 4 } } }],
	["mismatched columns", { requirements: food, board: { ...board, grid: { rows: 3, columns: 2 } } }],
]) {
	if (typeof input !== "string") {
		test(`the context schema rejects ${name}`, () => {
			const parsed = BoardContextSchema.safeParse(input);
			assert.equal(parsed.success, false);
			if (input.board !== null) {
				assert.deepEqual(parsed.error.issues[0].path, ["board"]);
			}
		});
	}

	test(`the tool rejects ${name} without mutating context`, async () => {
		const context = { requirements: structuredClone(food), board: structuredClone(board) };
		const original = structuredClone(context);
		await assert.rejects(invoke(new RunContext(context), input), (error) => error.code !== "ERR_ASSERTION");
		assert.deepEqual(context, original);
	});
}

test("the tool rejects an absent run context", async () => {
	await assert.rejects(invoke(undefined, { requirements: food, board }), (error) => error.code !== "ERR_ASSERTION");
});
