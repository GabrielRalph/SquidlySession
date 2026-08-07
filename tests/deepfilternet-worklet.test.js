import assert from "node:assert/strict";
import test from "node:test";

import {
	DeepFilterNetWorkletBridge,
} from "../src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet-core.js";

test("worklet assembles 480 mono samples and permits one frame in flight", () => {
	const sent = [];
	const bridge = new DeepFilterNetWorkletBridge((frame) =>
		sent.push(frame.slice()),
	);

	for (let block = 0; block < 4; block += 1) {
		bridge.process(
			[new Float32Array(128).fill(block + 1)],
			new Float32Array(128),
		);
	}

	assert.equal(sent.length, 1);
	assert.equal(sent[0].length, 480);
	assert.deepEqual(
		[...sent[0].slice(0, 128)],
		new Array(128).fill(1),
	);
	assert.deepEqual(
		[...sent[0].slice(128, 256)],
		new Array(128).fill(2),
	);
});

test("worklet averages input channels to mono", () => {
	const sent = [];
	const bridge = new DeepFilterNetWorkletBridge((frame) =>
		sent.push(frame.slice()),
	);

	bridge.process(
		[
			new Float32Array(480).fill(1),
			new Float32Array(480).fill(3),
		],
		new Float32Array(480),
	);

	assert.deepEqual(sent[0], new Float32Array(480).fill(2));
});

test("worklet emits silence until enhanced samples arrive", () => {
	const output = new Float32Array(128).fill(1);
	const bridge = new DeepFilterNetWorkletBridge(() => {});

	bridge.process([new Float32Array(128)], output);

	assert.deepEqual(output, new Float32Array(128));
});

test("worklet emits returned samples in order across render boundaries", () => {
	const bridge = new DeepFilterNetWorkletBridge(() => {});
	const enhanced = Float32Array.from(
		{ length: 480 },
		(_, index) => index + 1,
	);
	bridge.receiveProcessedFrame(enhanced);
	const first = new Float32Array(128);
	const second = new Float32Array(128);

	bridge.process([], first);
	bridge.process([], second);

	assert.deepEqual(first, enhanced.slice(0, 128));
	assert.deepEqual(second, enhanced.slice(128, 256));
});

test("a returned frame releases exactly one queued input frame", () => {
	const sent = [];
	const bridge = new DeepFilterNetWorkletBridge((frame) =>
		sent.push(frame.slice()),
	);
	bridge.process(
		[new Float32Array(480).fill(1)],
		new Float32Array(0),
	);
	bridge.process(
		[new Float32Array(480).fill(2)],
		new Float32Array(0),
	);
	bridge.process(
		[new Float32Array(480).fill(3)],
		new Float32Array(0),
	);

	bridge.receiveProcessedFrame(new Float32Array(480).fill(10));

	assert.equal(sent.length, 2);
	assert.equal(sent[0][0], 1);
	assert.equal(sent[1][0], 2);
});

test("a ninth pending frame discards the oldest queued frame", () => {
	const sent = [];
	const bridge = new DeepFilterNetWorkletBridge((frame) =>
		sent.push(frame.slice()),
	);

	for (let marker = 0; marker < 10; marker += 1) {
		bridge.process(
			[new Float32Array(480).fill(marker)],
			new Float32Array(0),
		);
	}
	bridge.receiveProcessedFrame(new Float32Array(480));

	assert.equal(sent.length, 2);
	assert.equal(sent[0][0], 0);
	assert.equal(sent[1][0], 2);
});

test("worklet transfers frames over its MessagePort and forwards errors", () => {
	const messages = [];
	let workerMessage = null;
	const port = {
		onmessage: null,
		closed: false,
		postMessage(message, transfer) {
			messages.push({ message, transfer });
		},
		start() {},
		close() {
			this.closed = true;
		},
	};
	const errors = [];
	const bridge = new DeepFilterNetWorkletBridge(null, (message) =>
		errors.push(message),
	);
	bridge.connect(port);
	bridge.process(
		[new Float32Array(480).fill(0.5)],
		new Float32Array(0),
	);
	workerMessage = messages[0].message;

	assert.equal(workerMessage.type, "process");
	assert.deepEqual(messages[0].transfer, [workerMessage.samples]);
	port.onmessage({ data: { type: "error", message: "inference failed" } });
	assert.deepEqual(errors, ["inference failed"]);
	bridge.close();
	assert.equal(port.closed, true);
});
