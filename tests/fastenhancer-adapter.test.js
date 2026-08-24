import assert from "node:assert/strict";
import test from "node:test";

class FakeTrack {
	constructor(kind, id) {
		this.kind = kind;
		this.id = id;
		this.enabled = true;
		this.stopped = false;
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

test("createFastEnhancerDenoiser defaults to tiny / 48 kHz mono", async () => {
	const { createFastEnhancerDenoiser } = await import(
		"../src/Features/VideoCall/AudioUtils/Denoise/FastEnhancer/fastenhancer.js"
	);
	const denoiser = createFastEnhancerDenoiser();
	assert.equal(denoiser.id, "fastenhancer-tiny");
	assert.equal(denoiser.sampleRate, 48_000);
	assert.equal(denoiser.channelCount, 1);
	assert.equal(typeof denoiser.realtime.attachStream, "function");
	assert.equal(denoiser.realtime.createProcessor, undefined);
});

test("attachStream loads model, uses explicit worklet, and close maps to destroyAsync", async () => {
	const originalMediaStream = globalThis.MediaStream;
	globalThis.MediaStream = FakeMediaStream;
	const { createFastEnhancerDenoiser } = await import(
		"../src/Features/VideoCall/AudioUtils/Denoise/FastEnhancer/fastenhancer.js"
	);

	const processed = new FakeTrack("audio", "processed-audio");
	const outputStream = new FakeMediaStream([processed]);
	const destroyCalls = [];
	let createArgs;
	const model = {
		createStreamDenoiser: async (stream, options) => {
			createArgs = { stream, options };
			return {
				outputStream,
				destroyAsync: async () => {
					destroyCalls.push("async");
				},
				destroy() {
					destroyCalls.push("sync");
				},
			};
		},
	};
	let loadedSize;
	const loadModelImpl = async (size) => {
		loadedSize = size;
		return model;
	};

	const workletUrl = "https://example.test/worklet/processor.js";
	const audioContext = { sampleRate: 48_000 };
	const denoiser = createFastEnhancerDenoiser({
		loadModelImpl,
		workletUrl,
	});
	const inputAudio = new FakeTrack("audio", "mic");
	const input = new FakeMediaStream([inputAudio]);
	const onError = () => {};

	try {
		const attached = await denoiser.realtime.attachStream(input, {
			onError,
			audioContext,
		});

		assert.equal(loadedSize, "tiny");
		assert.deepEqual(createArgs.stream.getAudioTracks(), [inputAudio]);
		assert.equal(createArgs.options.workletUrl, workletUrl);
		assert.equal(createArgs.options.audioContext, audioContext);
		assert.equal(typeof createArgs.options.onWarning, "function");
		assert.equal(attached.stream, outputStream);
		assert.equal(attached.audioTrack, processed);
		await attached.close();
		assert.deepEqual(destroyCalls, ["async"]);
	} finally {
		globalThis.MediaStream = originalMediaStream;
	}
});

test("attachStream failures surface as rejected promises", async () => {
	const originalMediaStream = globalThis.MediaStream;
	globalThis.MediaStream = FakeMediaStream;
	const { createFastEnhancerDenoiser } = await import(
		"../src/Features/VideoCall/AudioUtils/Denoise/FastEnhancer/fastenhancer.js"
	);
	const denoiser = createFastEnhancerDenoiser({
		loadModelImpl: async () => {
			throw new Error("wasm missing");
		},
	});
	const input = new FakeMediaStream([new FakeTrack("audio", "mic")]);

	try {
		await assert.rejects(
			() => denoiser.realtime.attachStream(input, { onError() {} }),
			/wasm missing|FastEnhancer|load/i,
		);
	} finally {
		globalThis.MediaStream = originalMediaStream;
	}
});
