import assert from "node:assert/strict";
import test from "node:test";
import { RunContext } from "@openai/agents";
import { agent } from "../src/agents/agent.ts";
import { BoardContextSchema } from "../src/schema/context.ts";

test("context retains unknown, partial, and complete requirements", () => {
	for (const requirements of [
		{ topic: null, rows: null, columns: null },
		{ topic: "Food", rows: 3, columns: null },
		{ topic: "Food", rows: 3, columns: 4 },
	]) {
		assert.deepEqual(BoardContextSchema.parse({ requirements }).requirements, requirements);
	}
});

test("dynamic instructions expose only this run's saved requirements", async () => {
	const prompt = await agent.getSystemPrompt(new RunContext({
		requirements: { topic: "Food", rows: 3, columns: null },
		board: null,
		privateValue: "not-for-the-model",
	}));

	assert.ok(prompt.includes('{"topic":"Food","rows":3,"columns":null}'));
	assert.equal(prompt.includes("not-for-the-model"), false);

	const anotherPrompt = await agent.getSystemPrompt(new RunContext({
		requirements: { topic: "Travel", rows: null, columns: 2 }, board: null,
	}));
	assert.ok(anotherPrompt.includes('{"topic":"Travel","rows":null,"columns":2}'));
	assert.equal(anotherPrompt.includes('"topic":"Food"'), false);
});
