import assert from "node:assert/strict";
import test from "node:test";

class FakeTrack {
	constructor(kind, id) {
		this.kind = kind;
		this.id = id;
		this.enabled = true;
		this.stopped = false;
	}

	getSettings() {
		return this.kind === "audio"
			? { sampleRate: 48_000, channelCount: 2, echoCancellation: true }
			: {};
	}

	stop() {
		this.stopped = true;
	}
}

class FakeMediaStream extends EventTarget {
	constructor(tracks = []) {
		super();
		this.tracks = [...tracks];
	}

	getTracks() {
		return [...this.tracks];
	}

	getAudioTracks() {
		return this.tracks.filter((track) => track.kind === "audio");
	}

	getVideoTracks() {
		return this.tracks.filter((track) => track.kind === "video");
	}

	addTrack(track) {
		this.tracks.push(track);
	}

	removeTrack(track) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
}

class FakePort {
	constructor(name) {
		this.name = name;
		this.messages = [];
		this.closed = false;
		this.onmessage = null;
	}

	postMessage(message, transfer = []) {
		this.messages.push({ message, transfer });
	}

	close() {
		this.closed = true;
	}
}

class FakeMessageChannel {
	constructor() {
		this.port1 = new FakePort("worker");
		this.port2 = new FakePort("worklet");
	}
}

class FakeNode {
	constructor() {
		this.connections = [];
		this.disconnected = false;
	}

	connect(node) {
		this.connections.push(node);
		return node;
	}

	disconnect() {
		this.disconnected = true;
	}
}

class FakeAudioContext {
	constructor(sampleRate = 48_000) {
		this.sampleRate = sampleRate;
		this.state = "suspended";
		this.sources = [];
		this.loadedWorklets = [];
		this.closedCount = 0;
		this.processedTrack = new FakeTrack("audio", "deepfilternet-audio");
		this.audioWorklet = {
			addModule: async (url) => this.loadedWorklets.push(url),
		};
	}

	createMediaStreamSource(stream) {
		const node = new FakeNode();
		node.stream = stream;
		this.sources.push(node);
		return node;
	}

	createMediaStreamDestination() {
		const node = new FakeNode();
		node.stream = new FakeMediaStream([this.processedTrack]);
		return node;
	}

	async resume() {
		this.state = "running";
	}

	async close() {
		this.closedCount += 1;
		this.state = "closed";
	}
}

class FakeAudioWorkletNode extends FakeNode {
	constructor(context, processorName, options) {
		super();
		this.context = context;
		this.processorName = processorName;
		this.options = options;
		this.port = new FakePort("node");
		this.onprocessorerror = null;
	}
}

class FakeClient {
	constructor({ initializeError = null } = {}) {
		this.initializeError = initializeError;
		this.initializedWith = null;
		this.connectedPort = null;
		this.closedCount = 0;
		this.fatalErrorHandler = null;
	}

	async initialize(modelUrl, wasmUrl) {
		if (this.initializeError) throw this.initializeError;
		this.initializedWith = { modelUrl, wasmUrl };
	}

	async connect(port) {
		this.connectedPort = port;
	}

	setFatalErrorHandler(handler) {
		this.fatalErrorHandler = handler;
	}

	fail(error) {
		this.fatalErrorHandler(error);
	}

	close() {
		this.closedCount += 1;
	}
}

function dispatchTrackChange(stream, oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	stream.dispatchEvent(event);
}

async function createDeepFilterNetSession(inputStream, options = {}) {
	const { createRealtimeDenoiseSession } = await import(
		"../src/Features/VideoCall/AudioUtils/Denoise/denoise-session.js"
	);
	const { createDeepFilterNetDenoiser } = await import(
		"../src/Features/VideoCall/AudioUtils/Denoise/DeepFilterNet/deepfilternet.js"
	);
	const { context = null, onError = null, ...denoiserOptions } = options;
	return createRealtimeDenoiseSession(inputStream, {
		context,
		onError,
		denoiser: createDeepFilterNetDenoiser(denoiserOptions),
	});
}

test("DeepFilterNet adapter returns a stable WebRTC stream and closes owned resources", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;

	try {
		const microphone = new FakeTrack("audio", "microphone-1");
		const camera = new FakeTrack("video", "camera-1");
		const rawStream = new FakeMediaStream([microphone, camera]);
		const context = new FakeAudioContext();
		const client = new FakeClient();
		const channel = new FakeMessageChannel();
		const adapter = await createDeepFilterNetSession(rawStream, {
			context,
			workletUrl: "deepfilternet-worklet.js",
			modelUrl: "denoiser_model.onnx",
			wasmUrl: "ort.wasm",
			createClient: () => client,
			createMessageChannel: () => channel,
		});

		assert.deepEqual(adapter.stream.getAudioTracks(), [context.processedTrack]);
		assert.deepEqual(adapter.stream.getVideoTracks(), [camera]);
		assert.deepEqual(context.loadedWorklets, ["deepfilternet-worklet.js"]);
		assert.equal(adapter.node.processorName, "DeepFilterNetWorkletProcessor");
		assert.deepEqual(adapter.node.options.outputChannelCount, [1]);
		assert.deepEqual(client.initializedWith, {
			modelUrl: "denoiser_model.onnx",
			wasmUrl: "ort.wasm",
		});
		assert.equal(client.connectedPort, channel.port1);
		assert.deepEqual(adapter.node.port.messages[0], {
			message: { type: "connect", port: channel.port2 },
			transfer: [channel.port2],
		});
		assert.equal(context.state, "running");

		const replacementMicrophone = new FakeTrack("audio", "microphone-2");
		dispatchTrackChange(rawStream, microphone, replacementMicrophone);
		assert.equal(context.sources.length, 2);
		assert.equal(context.sources[0].disconnected, true);
		assert.deepEqual(adapter.stream.getAudioTracks(), [context.processedTrack]);

		const replacementCamera = new FakeTrack("video", "camera-2");
		dispatchTrackChange(rawStream, camera, replacementCamera);
		assert.deepEqual(adapter.stream.getVideoTracks(), [replacementCamera]);

		await adapter.close();
		await adapter.close();
		assert.deepEqual(adapter.node.port.messages.at(-1).message, {
			type: "close",
		});
		assert.equal(client.closedCount, 1);
		assert.equal(context.closedCount, 1);
		assert.equal(context.processedTrack.stopped, true);
		assert.equal(microphone.stopped, false);
		assert.equal(camera.stopped, false);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet adapter rejects non-48 kHz contexts", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;
	try {
		const rawStream = new FakeMediaStream([
			new FakeTrack("audio", "microphone"),
		]);
		await assert.rejects(
			() =>
				createDeepFilterNetSession(rawStream, {
					context: new FakeAudioContext(44_100),
					createClient: () => new FakeClient(),
					createMessageChannel: () => new FakeMessageChannel(),
				}),
			/48 kHz/i,
		);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet adapter cleans up when Worker initialization fails", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;
	try {
		const microphone = new FakeTrack("audio", "microphone");
		const rawStream = new FakeMediaStream([microphone]);
		const context = new FakeAudioContext();
		const client = new FakeClient({
			initializeError: new Error("model failed"),
		});

		await assert.rejects(
			() =>
				createDeepFilterNetSession(rawStream, {
					context,
					createClient: () => client,
					createMessageChannel: () => new FakeMessageChannel(),
				}),
			/model failed/,
		);
		assert.equal(client.closedCount, 1);
		assert.equal(context.closedCount, 1);
		assert.equal(microphone.stopped, false);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet adapter stops its output and reports inference failures", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;
	try {
		const microphone = new FakeTrack("audio", "microphone");
		const context = new FakeAudioContext();
		const client = new FakeClient();
		const errors = [];
		const adapter = await createDeepFilterNetSession(
			new FakeMediaStream([microphone]),
			{
				context,
				createClient: () => client,
				createMessageChannel: () => new FakeMessageChannel(),
				onError: (error) => errors.push(error),
			},
		);

		adapter.node.port.onmessage({
			data: { type: "error", message: "inference failed" },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(errors.length, 1);
		assert.match(errors[0].message, /inference failed/);
		assert.equal(adapter.audioTrack.stopped, true);
		assert.equal(context.closedCount, 1);
		assert.equal(client.closedCount, 1);
		assert.equal(microphone.stopped, false);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet adapter handles a Worker crash after startup", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;
	try {
		const context = new FakeAudioContext();
		const client = new FakeClient();
		const errors = [];
		const adapter = await createDeepFilterNetSession(
			new FakeMediaStream([new FakeTrack("audio", "microphone")]),
			{
				context,
				createClient: () => client,
				createMessageChannel: () => new FakeMessageChannel(),
				onError: (error) => errors.push(error),
			},
		);

		client.fail(new Error("worker crashed"));
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(errors.length, 1);
		assert.match(errors[0].message, /worker crashed/);
		assert.equal(adapter.audioTrack.stopped, true);
		assert.equal(context.closedCount, 1);
		assert.equal(client.closedCount, 1);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet adapter handles an AudioWorklet processor crash", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;
	try {
		const context = new FakeAudioContext();
		const client = new FakeClient();
		const errors = [];
		const adapter = await createDeepFilterNetSession(
			new FakeMediaStream([new FakeTrack("audio", "microphone")]),
			{
				context,
				createClient: () => client,
				createMessageChannel: () => new FakeMessageChannel(),
				onError: (error) => errors.push(error),
			},
		);

		adapter.node.onprocessorerror(new Event("processorerror"));
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(errors.length, 1);
		assert.match(errors[0].message, /processor/i);
		assert.equal(adapter.audioTrack.stopped, true);
		assert.equal(context.closedCount, 1);
		assert.equal(client.closedCount, 1);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet can be selected as a realtime denoiser plugin", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;
	try {
		const { createRealtimeDenoiseSession } = await import(
			"../src/Features/VideoCall/AudioUtils/Denoise/denoise-session.js"
		);
		const { createDeepFilterNetDenoiser } = await import(
			"../src/Features/VideoCall/AudioUtils/Denoise/DeepFilterNet/deepfilternet.js"
		);
		const context = new FakeAudioContext();
		const client = new FakeClient();
		const channel = new FakeMessageChannel();
		const denoiser = createDeepFilterNetDenoiser({
			workletUrl: "selected-deepfilternet-worklet.js",
			modelUrl: "selected-model.onnx",
			wasmUrl: "selected-ort.wasm",
			createClient: () => client,
			createMessageChannel: () => channel,
		});

		const session = await createRealtimeDenoiseSession(
			new FakeMediaStream([new FakeTrack("audio", "microphone")]),
			{ denoiser, context },
		);

		assert.deepEqual(context.loadedWorklets, [
			"selected-deepfilternet-worklet.js",
		]);
		assert.deepEqual(client.initializedWith, {
			modelUrl: "selected-model.onnx",
			wasmUrl: "selected-ort.wasm",
		});
		assert.equal(client.connectedPort, channel.port1);
		assert.equal(session.node.processorName, "DeepFilterNetWorkletProcessor");
		await session.close();
		assert.equal(client.closedCount, 1);
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});

test("DeepFilterNet defaults to shared generated and model assets", async () => {
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;

	try {
		const { createDeepFilterNetDenoiser } = await import(
			"../src/Features/VideoCall/AudioUtils/Denoise/DeepFilterNet/deepfilternet.js"
		);
		const context = new FakeAudioContext();
		const client = new FakeClient();
		const channel = new FakeMessageChannel();
		const processor = await createDeepFilterNetDenoiser({
			createClient: () => client,
			createMessageChannel: () => channel,
		}).realtime.createProcessor({
			context,
			onError: null,
		});

		assert.match(
			context.loadedWorklets[0],
			/\/Denoise\/DeepFilterNet\/deepfilternet-worklet\.js$/,
		);
		assert.match(client.initializedWith.modelUrl, /\/DeepFilterNet\/denoiser_model\.onnx$/);
		assert.match(client.initializedWith.wasmUrl, /\/DeepFilterNet\/ort-wasm-simd-threaded\.wasm$/);
		await processor.close();
	} finally {
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});
