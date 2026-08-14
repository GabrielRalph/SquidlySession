import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeDenoiseController } from "../src/Features/VideoCall/AudioUtils/Denoise/denoise-controller.js";

class FakeTrack {
	constructor(kind, id) {
		this.kind = kind;
		this.id = id;
		this.label = id;
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
		if (!this.tracks.includes(track)) this.tracks.push(track);
	}

	removeTrack(track) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
}

class FakeNode {
	connect() {}
	 disconnect() {}
}

let contextCount = 0;
class FakeAudioContext {
	constructor() {
		this.sampleRate = 48_000;
		this.state = "suspended";
		this.outputTrack = new FakeTrack("audio", `processed-${++contextCount}`);
		this.closed = false;
	}

	createMediaStreamSource() {
		return new FakeNode();
	}

	createMediaStreamDestination() {
		return {
			channelCount: 1,
			channelCountMode: "explicit",
			stream: new FakeMediaStream([this.outputTrack]),
			disconnect() {},
		};
	}

	async resume() {
		this.state = "running";
	}

	async close() {
		this.closed = true;
		this.state = "closed";
	}
}

function makeDenoiser(id, closed) {
	return {
		id,
		sampleRate: 48_000,
		channelCount: 1,
		realtime: {
			async createProcessor() {
				return {
					node: new FakeNode(),
					close() {
						closed.push(id);
					},
				};
			},
		},
	};
}

test("realtime denoiser controller switches the published track live", async () => {
	const originalMediaStream = globalThis.MediaStream;
	const originalAudioContext = globalThis.AudioContext;
	globalThis.MediaStream = FakeMediaStream;
	globalThis.AudioContext = FakeAudioContext;
	contextCount = 0;

	try {
		const microphone = new FakeTrack("audio", "microphone");
		const camera = new FakeTrack("video", "camera");
		const inputStream = new FakeMediaStream([microphone, camera]);
		const closed = [];
		const controller = await createRealtimeDenoiseController(inputStream, {
			mode: "deepfilternet",
			denoisers: {
				rnnoise: makeDenoiser("rnnoise", closed),
				deepfilternet: makeDenoiser("deepfilternet", closed),
			},
		});

		const publishedStream = controller.stream;
		const initialAudio = publishedStream.getAudioTracks()[0];
		assert.match(initialAudio.id, /^processed-/);
		assert.deepEqual(publishedStream.getVideoTracks(), [camera]);

		const changes = [];
		publishedStream.addEventListener("trackchanged", ({ oldTrack, newTrack }) => {
			changes.push([oldTrack.id, newTrack.id]);
		});

		await controller.switchMode("rnnoise");
		const rnnoiseAudio = publishedStream.getAudioTracks()[0];
		assert.notEqual(rnnoiseAudio, initialAudio);
		assert.deepEqual(changes, [[initialAudio.id, rnnoiseAudio.id]]);
		assert.deepEqual(closed, ["deepfilternet"]);

		await controller.switchMode("off");
		assert.deepEqual(publishedStream.getAudioTracks(), [microphone]);
		assert.deepEqual(changes, [
			[initialAudio.id, rnnoiseAudio.id],
			[rnnoiseAudio.id, microphone.id],
		]);
		assert.deepEqual(closed, ["deepfilternet", "rnnoise"]);

		const replacementMicrophone = new FakeTrack("audio", "microphone-2");
		const event = new Event("trackchanged");
		event.oldTrack = microphone;
		event.newTrack = replacementMicrophone;
		inputStream.dispatchEvent(event);
		assert.deepEqual(publishedStream.getAudioTracks(), [replacementMicrophone]);

		await controller.close();
		await controller.close();
	} finally {
		globalThis.MediaStream = originalMediaStream;
		globalThis.AudioContext = originalAudioContext;
	}
});
