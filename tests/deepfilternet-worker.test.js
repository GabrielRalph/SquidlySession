import assert from "node:assert/strict";
import test from "node:test";

import { DFN_FRAME_SIZE, DFN_STATE_SIZE } from "../src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-model.js";
import {
	DeepFilterNetWorkerClient,
} from "../src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-client.js";
import {
	DeepFilterNetWorkerHost,
} from "../src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-host.js";

class FakeRuntime {
	constructor() {
		this.initializedWith = null;
		this.stateMarkers = [];
	}

	async initialize(modelUrl, wasmUrl) {
		this.initializedWith = { modelUrl, wasmUrl };
	}

	async processFrame(frame, state) {
		this.stateMarkers.push(state[0]);
		const nextState = state.slice();
		nextState[0] += 1;
		return { frame: frame.slice(), state: nextState };
	}
}

class FakePort {
	constructor() {
		this.onmessage = null;
		this.messages = [];
		this.started = false;
	}

	postMessage(message, transfer = []) {
		this.messages.push({ message, transfer });
	}

	start() {
		this.started = true;
	}
}

class FakeWorker {
	constructor() {
		this.onmessage = null;
		this.onerror = null;
		this.requests = [];
		this.terminated = false;
	}

	postMessage(message, transfer = []) {
		this.requests.push({ message, transfer });
	}

	terminate() {
		this.terminated = true;
	}
}

test("Worker resets after its startup probe and chains recurrent state", async () => {
	const runtime = new FakeRuntime();
	const host = new DeepFilterNetWorkerHost(() => runtime);

	await host.initialize("/model.onnx", "/ort.wasm");
	await host.process(new Float32Array(DFN_FRAME_SIZE));
	await host.process(new Float32Array(DFN_FRAME_SIZE));

	assert.deepEqual(runtime.initializedWith, {
		modelUrl: "/model.onnx",
		wasmUrl: "/ort.wasm",
	});
	assert.deepEqual(runtime.stateMarkers, [0, 0, 1]);
});

test("Worker host rejects inference before initialization", async () => {
	const host = new DeepFilterNetWorkerHost(() => new FakeRuntime());

	await assert.rejects(
		() => host.process(new Float32Array(DFN_FRAME_SIZE)),
		/not initialized/i,
	);
});

test("Worker host transfers processed frames and reports inference errors", async () => {
	const runtime = new FakeRuntime();
	const host = new DeepFilterNetWorkerHost(() => runtime);
	const port = new FakePort();
	await host.initialize("/model.onnx", "/ort.wasm");
	host.attachPort(port);

	const samples = new Float32Array(DFN_FRAME_SIZE).fill(0.25);
	port.onmessage({ data: { type: "process", samples: samples.buffer } });
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(port.started, true);
	assert.equal(port.messages[0].message.type, "processed");
	assert.deepEqual(
		new Float32Array(port.messages[0].message.samples),
		samples,
	);
	assert.deepEqual(port.messages[0].transfer, [port.messages[0].message.samples]);

	runtime.processFrame = async () => {
		throw new Error("inference failed");
	};
	port.onmessage({
		data: { type: "process", samples: new Float32Array(DFN_FRAME_SIZE).buffer },
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.deepEqual(port.messages[1].message, {
		type: "error",
		message: "inference failed",
	});
});

test("Worker host rejects malformed runtime results", async () => {
	const runtime = new FakeRuntime();
	const host = new DeepFilterNetWorkerHost(() => runtime);
	await host.initialize("/model.onnx", "/ort.wasm");
	runtime.processFrame = async () => ({
		frame: new Float32Array(DFN_FRAME_SIZE - 1),
		state: new Float32Array(DFN_STATE_SIZE),
	});

	await assert.rejects(
		() => host.process(new Float32Array(DFN_FRAME_SIZE)),
		/output frame/i,
	);
});

test("Worker client resolves matching requests, transfers a port, and closes once", async () => {
	const worker = new FakeWorker();
	const client = new DeepFilterNetWorkerClient(worker);
	const initialization = client.initialize("/model.onnx", "/ort.wasm");
	const initializationRequest = worker.requests[0].message;
	worker.onmessage({ data: { id: initializationRequest.id, type: "ready" } });
	await initialization;

	const port = new FakePort();
	const connection = client.connect(port);
	const connectionRequest = worker.requests[1].message;
	assert.deepEqual(worker.requests[1].transfer, [port]);
	worker.onmessage({ data: { id: connectionRequest.id, type: "connected" } });
	await connection;

	client.close();
	client.close();
	assert.equal(worker.terminated, true);
	await assert.rejects(
		() => client.initialize("/model.onnx", "/ort.wasm"),
		/closed/i,
	);
});

test("Worker client propagates protocol and Worker errors", async () => {
	const worker = new FakeWorker();
	const client = new DeepFilterNetWorkerClient(worker);
	const protocolFailure = client.initialize("/model.onnx", "/ort.wasm");
	worker.onmessage({
		data: {
			id: worker.requests[0].message.id,
			type: "error",
			message: "model failed",
		},
	});
	await assert.rejects(() => protocolFailure, /model failed/);

	const workerFailure = client.initialize("/model.onnx", "/ort.wasm");
	worker.onerror({ message: "worker crashed" });
	await assert.rejects(() => workerFailure, /worker crashed/);
});
