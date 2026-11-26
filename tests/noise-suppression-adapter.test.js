import assert from "node:assert/strict";
import test from "node:test";

class FakeTrack {
	constructor(kind, id, { channelCount = 1 } = {}) {
		this.kind = kind;
		this.id = id;
		this.channelCount = channelCount;
		this.enabled = true;
		this.stopped = false;
	}

	getSettings() {
		return this.kind === "audio"
			? {
					sampleRate: 48000,
					channelCount: this.channelCount,
					echoCancellation: true,
				}
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
		this.tracks = this.tracks.filter((value) => value !== track);
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
	constructor() {
		this.state = "suspended";
		this.sampleRate = 48000;
		this.sources = [];
		this.loadedWorklets = [];
		this.processedTrack = new FakeTrack("audio", "processed-audio");
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
		this.state = "closed";
	}
}

class FakeAudioWorkletNode extends FakeNode {
	constructor(context, processorName, options) {
		super();
		this.context = context;
		this.processorName = processorName;
		this.options = options;
	}
}

test("live adapter returns a WebRTC-compatible stream and mirrors device changes", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioWorkletNode = globalThis.AudioWorkletNode;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioWorkletNode = FakeAudioWorkletNode;

	try {
		const { createNoiseSuppressionAdapter } = await import(
			"../src/Features/VideoCall/AudioUtils/NoiseSuppress/noise-suppression.js"
		);
		const microphone = new FakeTrack("audio", "microphone-1", {
			channelCount: 2,
		});
		const camera = new FakeTrack("video", "camera-1");
		const inputStream = new FakeMediaStream([microphone, camera]);
		const context = new FakeAudioContext();
		const adapter = await createNoiseSuppressionAdapter(inputStream, {
			context,
			workletUrl: "noise-suppression-worklet.js",
		});

		assert.deepEqual(adapter.stream.getAudioTracks(), [context.processedTrack]);
		assert.deepEqual(adapter.stream.getVideoTracks(), [camera]);
		assert.deepEqual(context.loadedWorklets, ["noise-suppression-worklet.js"]);
		assert.equal(adapter.node.processorName, "NoiseSuppressorWorklet");
		assert.deepEqual(adapter.node.options.outputChannelCount, [1]);
		assert.equal(context.state, "running");

		const replacementMicrophone = new FakeTrack("audio", "microphone-2");
		const audioChange = new Event("trackchanged");
		audioChange.oldTrack = microphone;
		audioChange.newTrack = replacementMicrophone;
		inputStream.dispatchEvent(audioChange);
		assert.equal(context.sources.length, 2);
		assert.equal(context.sources[0].disconnected, true);
		assert.deepEqual(adapter.stream.getAudioTracks(), [context.processedTrack]);

		const replacementCamera = new FakeTrack("video", "camera-2");
		const videoChange = new Event("trackchanged");
		videoChange.oldTrack = camera;
		videoChange.newTrack = replacementCamera;
		inputStream.dispatchEvent(videoChange);
		assert.deepEqual(adapter.stream.getVideoTracks(), [replacementCamera]);

		await adapter.close();
		assert.equal(context.processedTrack.stopped, true);
		assert.equal(context.state, "closed");
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioWorkletNode = originalAudioWorkletNode;
	}
});
