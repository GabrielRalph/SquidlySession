import assert from "node:assert/strict";
import test from "node:test";

import { renderOfflineDenoise } from "../src/Features/VideoCall/AudioUtils/Denoise/denoise-offline.js";
import { createRealtimeDenoiseSession } from "../src/Features/VideoCall/AudioUtils/Denoise/denoise-session.js";

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
		return this.tracks.filter(({ kind }) => kind === "audio");
	}

	getVideoTracks() {
		return this.tracks.filter(({ kind }) => kind === "video");
	}

	addTrack(track) {
		this.tracks.push(track);
	}

	removeTrack(track) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
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
	constructor({ sampleRate = 48_000 } = {}) {
		this.sampleRate = sampleRate;
		this.state = "suspended";
		this.sources = [];
		this.outputTrack = new FakeTrack("audio", "processed");
		this.closedCount = 0;
	}

	createMediaStreamSource(stream) {
		const source = new FakeNode();
		source.stream = stream;
		this.sources.push(source);
		return source;
	}

	createMediaStreamDestination() {
		const destination = new FakeNode();
		destination.stream = new FakeMediaStream([this.outputTrack]);
		return destination;
	}

	async resume() {
		this.state = "running";
	}

	async close() {
		this.closedCount += 1;
		this.state = "closed";
	}
}

function dispatchTrackChange(stream, oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	stream.dispatchEvent(event);
}

test("realtime session runs an arbitrary denoiser and keeps its output stable", async () => {
	const originalMediaStream = globalThis.MediaStream;
	globalThis.MediaStream = FakeMediaStream;

	try {
		const microphone = new FakeTrack("audio", "microphone-1");
		const camera = new FakeTrack("video", "camera-1");
		const input = new FakeMediaStream([microphone, camera]);
		const context = new FakeAudioContext();
		const processorNode = new FakeNode();
		let processorClosed = 0;
		const denoiser = {
			id: "test-denoiser",
			sampleRate: 48_000,
			channelCount: 1,
			realtime: {
				async createProcessor() {
					return {
						node: processorNode,
						close() {
							processorClosed += 1;
						},
					};
				},
			},
		};

		const session = await createRealtimeDenoiseSession(input, {
			denoiser,
			context,
		});

		assert.deepEqual(session.stream.getAudioTracks(), [context.outputTrack]);
		assert.deepEqual(session.stream.getVideoTracks(), [camera]);
		assert.equal(context.sources[0].connections[0], processorNode);
		assert.equal(processorNode.connections.length, 1);
		assert.equal(context.state, "running");

		const replacementMicrophone = new FakeTrack("audio", "microphone-2");
		dispatchTrackChange(input, microphone, replacementMicrophone);
		assert.equal(context.sources[0].disconnected, true);
		assert.equal(context.sources[1].connections[0], processorNode);
		assert.deepEqual(session.stream.getAudioTracks(), [context.outputTrack]);

		const replacementCamera = new FakeTrack("video", "camera-2");
		dispatchTrackChange(input, camera, replacementCamera);
		assert.deepEqual(session.stream.getVideoTracks(), [replacementCamera]);

		await session.close();
		await session.close();
		assert.equal(processorClosed, 1);
		assert.equal(context.outputTrack.stopped, true);
		assert.equal(context.closedCount, 1);
		assert.equal(microphone.stopped, false);
		assert.equal(camera.stopped, false);
	} finally {
		globalThis.MediaStream = originalMediaStream;
	}
});

test("realtime session uses attachStream and reattaches video tracks", async () => {
	const originalMediaStream = globalThis.MediaStream;
	globalThis.MediaStream = FakeMediaStream;

	try {
		const microphone = new FakeTrack("audio", "microphone-1");
		const camera = new FakeTrack("video", "camera-1");
		const processed = new FakeTrack("audio", "processed-audio");
		const input = new FakeMediaStream([microphone, camera]);
		let closed = 0;
		const context = new FakeAudioContext();
		let attachCalls = 0;
		const denoiser = {
			id: "fastenhancer-small",
			sampleRate: 48_000,
			channelCount: 1,
			realtime: {
				async attachStream(stream, { audioContext }) {
					assert.equal(stream, input);
					assert.equal(audioContext, context);
					attachCalls += 1;
					const track =
						attachCalls === 1
							? processed
							: new FakeTrack("audio", "processed-audio-2");
					return {
						stream: new FakeMediaStream([track]),
						audioTrack: track,
						close: async () => {
							closed += 1;
						},
					};
				},
			},
		};

		const session = await createRealtimeDenoiseSession(input, {
			denoiser,
			context,
		});

		assert.deepEqual(session.stream.getAudioTracks(), [processed]);
		assert.deepEqual(session.stream.getVideoTracks(), [camera]);
		assert.equal(session.audioTrack, processed);
		assert.equal(session.context, context);
		assert.equal(session.node, null);
		assert.equal(context.state, "running");

		const replacementMicrophone = new FakeTrack("audio", "microphone-2");
		dispatchTrackChange(input, microphone, replacementMicrophone);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(attachCalls, 2);
		assert.equal(closed, 1);
		assert.equal(session.stream.getAudioTracks()[0].id, "processed-audio-2");
		assert.deepEqual(session.stream.getVideoTracks(), [camera]);

		const replacementCamera = new FakeTrack("video", "camera-2");
		dispatchTrackChange(input, camera, replacementCamera);
		assert.deepEqual(session.stream.getVideoTracks(), [replacementCamera]);

		await session.close();
		assert.equal(closed, 2);
		assert.equal(context.closedCount, 0);
	} finally {
		globalThis.MediaStream = originalMediaStream;
	}
});

test("realtime session rejects attachStream with a non-48 kHz context", async () => {
	const originalMediaStream = globalThis.MediaStream;
	globalThis.MediaStream = FakeMediaStream;

	try {
		await assert.rejects(
			() =>
				createRealtimeDenoiseSession(
					new FakeMediaStream([new FakeTrack("audio", "mic")]),
					{
						denoiser: {
							id: "fastenhancer-small",
							sampleRate: 48_000,
							channelCount: 1,
							realtime: {
								async attachStream() {
									throw new Error("should not attach");
								},
							},
						},
						context: new FakeAudioContext({ sampleRate: 44_100 }),
					},
				),
			/48 kHz AudioContext/i,
		);
	} finally {
		globalThis.MediaStream = originalMediaStream;
	}
});

test("realtime session owns cleanup after a denoiser runtime failure", async () => {
	const originalMediaStream = globalThis.MediaStream;
	globalThis.MediaStream = FakeMediaStream;

	try {
		const context = new FakeAudioContext();
		let reportError = null;
		let processorClosed = 0;
		const errors = [];
		const denoiser = {
			id: "fallible-denoiser",
			sampleRate: 48_000,
			channelCount: 1,
			realtime: {
				async createProcessor({ onError }) {
					reportError = onError;
					return {
						node: new FakeNode(),
						close() {
							processorClosed += 1;
						},
					};
				},
			},
		};
		const session = await createRealtimeDenoiseSession(
			new FakeMediaStream([new FakeTrack("audio", "microphone")]),
			{ denoiser, context, onError: (error) => errors.push(error) },
		);

		reportError(new Error("processor failed"));
		reportError(new Error("duplicate failure"));
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(errors.length, 1);
		assert.match(errors[0].message, /processor failed/);
		assert.equal(processorClosed, 1);
		assert.equal(session.audioTrack.stopped, true);
		assert.equal(context.closedCount, 1);
	} finally {
		globalThis.MediaStream = originalMediaStream;
	}
});

class FakeAudioBuffer {
	constructor(channels, sampleRate = 48_000) {
		this.channels = channels;
		this.numberOfChannels = channels.length;
		this.length = channels[0].length;
		this.sampleRate = sampleRate;
	}

	getChannelData(channelIndex) {
		return this.channels[channelIndex];
	}
}

class FakeOfflineAudioContext {
	static instance = null;

	constructor(channelCount, length, sampleRate) {
		this.channelCount = channelCount;
		this.length = length;
		this.sampleRate = sampleRate;
		this.destination = new FakeNode();
		FakeOfflineAudioContext.instance = this;
	}

	createBuffer(channelCount, length, sampleRate) {
		this.createdBuffer = new FakeAudioBuffer(
			Array.from({ length: channelCount }, () => new Float32Array(length)),
			sampleRate,
		);
		return this.createdBuffer;
	}

	createBufferSource() {
		this.source = new FakeNode();
		this.source.buffer = null;
		this.source.started = false;
		this.source.start = () => {
			this.source.started = true;
		};
		return this.source;
	}

	async startRendering() {
		const rendered = new Float32Array(this.length);
		for (let index = 0; index < this.source.buffer.length; index += 1) {
			rendered[384 + index] = index + 1;
		}
		return new FakeAudioBuffer([rendered], this.sampleRate);
	}
}

test("offline session uses an optional denoiser capability", async () => {
	const processorNode = new FakeNode();
	let processorClosed = 0;
	const denoiser = {
		id: "offline-denoiser",
		sampleRate: 48_000,
		channelCount: 1,
		offline: {
			frameSize: 480,
			latencySamples: 384,
			async createProcessor() {
				return {
					node: processorNode,
					close() {
						processorClosed += 1;
					},
				};
			},
		},
	};
	const input = new FakeAudioBuffer([
		new Float32Array([1, -1, 0.5]),
		new Float32Array([0, 1, -0.5]),
	]);

	const output = await renderOfflineDenoise(input, {
		denoiser,
		OfflineAudioContextClass: FakeOfflineAudioContext,
	});

	const context = FakeOfflineAudioContext.instance;
	assert.equal(context.channelCount, 1);
	assert.equal(context.length, 480);
	assert.deepEqual(
		context.createdBuffer.getChannelData(0),
		new Float32Array([0.5, 0, 0]),
	);
	assert.equal(context.source.connections[0], processorNode);
	assert.equal(processorNode.connections[0], context.destination);
	assert.equal(context.source.started, true);
	assert.equal(processorClosed, 1);
	assert.deepEqual(output, new Float32Array([1, 2, 3]));
});

test("offline session rejects denoisers without offline support", async () => {
	const input = new FakeAudioBuffer([new Float32Array([1])]);

	await assert.rejects(
		() =>
			renderOfflineDenoise(input, {
				denoiser: {
					id: "realtime-only",
					sampleRate: 48_000,
					channelCount: 1,
				},
				OfflineAudioContextClass: FakeOfflineAudioContext,
			}),
		/realtime-only does not support offline denoising/i,
	);
});

test("offline session validates capability metadata and mono layout", async () => {
	const input = new FakeAudioBuffer([new Float32Array([1])]);
	const createProcessor = async () => ({ node: new FakeNode() });

	await assert.rejects(
		() =>
			renderOfflineDenoise(input, {
				denoiser: {
					id: "invalid-frame-size",
					sampleRate: 48_000,
					channelCount: 1,
					offline: {
						frameSize: 0,
						latencySamples: 0,
						createProcessor,
					},
				},
				OfflineAudioContextClass: FakeOfflineAudioContext,
			}),
		/offline frameSize must be a positive integer/i,
	);

	await assert.rejects(
		() =>
			renderOfflineDenoise(input, {
				denoiser: {
					id: "invalid-latency",
					sampleRate: 48_000,
					channelCount: 1,
					offline: {
						frameSize: 1,
						latencySamples: -1,
						createProcessor,
					},
				},
				OfflineAudioContextClass: FakeOfflineAudioContext,
			}),
		/offline latencySamples must be a non-negative integer/i,
	);

	await assert.rejects(
		() =>
			renderOfflineDenoise(input, {
				denoiser: {
					id: "stereo-denoiser",
					sampleRate: 48_000,
					channelCount: 2,
					offline: {
						channelCount: 2,
						frameSize: 1,
						latencySamples: 0,
						createProcessor,
					},
				},
				OfflineAudioContextClass: FakeOfflineAudioContext,
			}),
		/offline denoising currently requires a mono capability/i,
	);
});
