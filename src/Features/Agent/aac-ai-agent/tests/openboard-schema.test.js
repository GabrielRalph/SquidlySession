import assert from "node:assert/strict";
import test from "node:test";
import { OBButton } from "../../../AAC/OpenBoard/openboard.js";
import {
	openBoardButtonSchema,
	openBoardGridSchema,
	openBoardImageSchema,
	openBoardLoadBoardSchema,
	openBoardSchema,
} from "../src/mastra/schema/openboard.ts";

const minimalBoard = {
	grid: { rows: 1, columns: 2 },
	buttons: [{ label: "Hello" }],
};

test("AI drafts need no IDs, format, image metadata, or grid order", () => {
	const parsed = openBoardSchema.parse(minimalBoard);

	assert.equal(parsed.locale, "en");
	assert.equal(parsed.name, null);
	assert.equal(parsed.buttons[0].font_size, "medium");
	assert.equal(parsed.buttons[0].bold, false);
	assert.equal(parsed.buttons[0].actions, null);
	assert.equal(parsed.buttons[0].image, null);
	assert.deepEqual(parsed.grid, { rows: 1, columns: 2 });
	assert.equal(Object.hasOwn(parsed, "id"), false);
	assert.equal(Object.hasOwn(parsed, "format"), false);
	assert.equal(Object.hasOwn(parsed, "images"), false);
});

test("buttons retain display order and their own image search keywords", () => {
	const parsed = openBoardSchema.parse({
		grid: { rows: 1, columns: 2 },
		buttons: [
			{ label: "Drink", image: { search_keyword: "glass of water" } },
			{ label: "Eat", image: { search_keyword: "person eating with a spoon" } },
		],
	});

	assert.deepEqual(parsed.buttons.map(({ label, image }) => [label, image.search_keyword]), [
		["Drink", "glass of water"],
		["Eat", "person eating with a spoon"],
	]);
});

test("drafts preserve action strings, presentation, and linked-board names and paths", () => {
	const button = {
		label: "Hello",
		font_size: "giant",
		image: { search_keyword: "person waving hello" },
		load_board: { name: "Greetings", path: "boards/greetings.json" },
		action: ":speak",
		actions: ["+Hello", "&world", ":return"],
		bold: true,
		label_at_bottom: true,
		italic: true,
		background_color: "#ffffff",
		border_color: "rgb(0, 0, 0)",
		text_color: "#000000",
		feature_color: "hsl(120, 50%, 50%)",
		vocalization: "Hello world",
		top: 0,
		left: 0,
	};

	assert.deepEqual(openBoardButtonSchema.parse(button), button);
});

test("parsing strips IDs, resolved image metadata, URLs, format, and grid order", () => {
	const parsed = openBoardSchema.parse({
		...minimalBoard,
		id: "board-1",
		format: "open-board-0.1",
		url: "https://example.invalid/board.json",
		images: [{ id: "legacy-image" }],
		grid: { ...minimalBoard.grid, order: [["hello", null]] },
		buttons: [{
			label: "Hello",
			id: "hello",
			image_id: "legacy-image",
			width: 0.5,
			height: 1,
			load_board: {
				id: "next-board",
				name: "Next",
				url: "https://example.invalid/next.json",
				data_url: "data:application/json;base64,e30=",
			},
			image: {
				search_keyword: "person waving hello",
				id: "legacy-image",
				width: 128,
				height: 128,
				name: "Old image name",
				content_type: "image/png",
				license: { name: "CC BY" },
				symbol: { set: "symbols", name: "hello.svg" },
				url: "https://example.invalid/hello.png",
			},
		}],
	});

	assert.deepEqual(parsed.grid, { rows: 1, columns: 2 });
	assert.deepEqual(parsed.buttons[0].image, { search_keyword: "person waving hello" });
	assert.deepEqual(parsed.buttons[0].load_board, { name: "Next", path: null });
	for (const [object, keys] of [
		[parsed, ["id", "format", "url", "images"]],
		[parsed.buttons[0], ["id", "image_id", "width", "height"]],
	]) {
		for (const key of keys) assert.equal(Object.hasOwn(object, key), false, key);
	}
});

test("published JSON schemas omit post-processing fields", () => {
	const removed = [
		"id", "image_id", "width", "height", "content_type", "license", "order",
		"format", "images", "symbol", "url", "data_url",
	];
	for (const schema of [
		openBoardSchema, openBoardButtonSchema, openBoardGridSchema,
		openBoardImageSchema, openBoardLoadBoardSchema,
	]) {
		const jsonSchema = schema.toJSONSchema();
		assert.equal(jsonSchema.type, "object");
		for (const key of removed) assert.equal(Object.hasOwn(jsonSchema.properties, key), false, key);
		assert.doesNotThrow(() => JSON.stringify(jsonSchema));
	}
	assert.deepEqual(Object.keys(openBoardImageSchema.toJSONSchema().properties), ["search_keyword"]);
});

test("image queries require a non-empty search keyword and trim surrounding whitespace", () => {
	assert.deepEqual(openBoardImageSchema.parse({ search_keyword: "  glass of water  " }), {
		search_keyword: "glass of water",
	});
	for (const image of [{}, { search_keyword: null }, { search_keyword: 42 }, { search_keyword: "" }, { search_keyword: "   " }]) {
		assert.equal(openBoardImageSchema.safeParse(image).success, false, JSON.stringify(image));
	}
});

test("schema accepts every font size supported by the existing button model", () => {
	for (const font_size of OBButton.fontSizes) {
		assert.equal(openBoardButtonSchema.parse({ font_size }).font_size, font_size);
	}
});

test("schema still validates grid dimensions and button field types", () => {
	for (const board of [
		{},
		{ grid: { columns: 2 } },
		{ grid: { rows: 1 } },
		{ grid: { rows: -1, columns: 2 } },
		{ grid: { rows: 1, columns: 1.5 } },
	]) {
		assert.equal(openBoardSchema.safeParse(board).success, false, JSON.stringify(board));
	}
	for (const fields of [
		{ font_size: "invalid" },
		{ bold: "true" },
		{ action: { mode: "home" } },
		{ actions: [42] },
		{ image: {} },
		{ top: -0.1 },
		{ left: 1.1 },
	]) {
		assert.equal(openBoardButtonSchema.safeParse(fields).success, false, JSON.stringify(fields));
	}
});
