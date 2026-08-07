import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recoverDeepFilterNetAudio } from "../src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-recovery.js";

class FakeTrack {
	constructor(kind, id, enabled = true) {
		this.kind = kind;
		this.id = id;
		this.enabled = enabled;
	}
}

class FakeMediaStream extends EventTarget {
	constructor(tracks) {
		super();
		this.tracks = [...tracks];
	}

	getTracks() {
		return [...this.tracks];
	}

	getAudioTracks() {
		return this.tracks.filter(({ kind }) => kind === "audio");
	}

	addTrack(track) {
		this.tracks.push(track);
	}

	removeTrack(track) {
		this.tracks = this.tracks.filter((candidate) => candidate !== track);
	}
}

function dispatchTrackChange(stream, oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	stream.dispatchEvent(event);
}

test("video call falls back to the live microphone after a published denoiser failure", () => {
	const microphone = new FakeTrack("audio", "microphone");
	const denoised = new FakeTrack("audio", "deepfilternet", false);
	const camera = new FakeTrack("video", "camera");
	const rawStream = new FakeMediaStream([microphone, camera]);
	const publishedStream = new FakeMediaStream([denoised, camera]);
	const replacements = [];
	const connection = {
		replaceTrack: (oldTrack, newTrack) =>
			replacements.push([oldTrack, newTrack]),
	};

	const recovered = recoverDeepFilterNetAudio({
		rawStream,
		publishedStream,
		connection,
	});

	assert.equal(recovered, true);
	assert.deepEqual(replacements, [[denoised, microphone]]);
	assert.deepEqual(publishedStream.getAudioTracks(), [microphone]);
	assert.equal(microphone.enabled, false);
});

test("fallback keeps publishing later microphone and camera changes", () => {
	const microphone = new FakeTrack("audio", "microphone");
	const denoised = new FakeTrack("audio", "deepfilternet", false);
	const camera = new FakeTrack("video", "camera", false);
	const rawStream = new FakeMediaStream([microphone, camera]);
	const publishedStream = new FakeMediaStream([denoised, camera]);
	const replacements = [];
	const connection = {
		replaceTrack: (oldTrack, newTrack) =>
			replacements.push([oldTrack, newTrack]),
	};

	recoverDeepFilterNetAudio({ rawStream, publishedStream, connection });
	const replacementMicrophone = new FakeTrack(
		"audio",
		"replacement-microphone",
	);
	const replacementCamera = new FakeTrack("video", "replacement-camera");
	dispatchTrackChange(rawStream, microphone, replacementMicrophone);
	dispatchTrackChange(rawStream, camera, replacementCamera);

	assert.deepEqual(replacements, [
		[denoised, microphone],
		[microphone, replacementMicrophone],
		[camera, replacementCamera],
	]);
	assert.deepEqual(publishedStream.getAudioTracks(), [replacementMicrophone]);
	assert.equal(replacementMicrophone.enabled, false);
	assert.equal(replacementCamera.enabled, false);
});

test("video-call wires DeepFilterNet runtime errors into microphone recovery", async () => {
	const source = await readFile(
		"src/Features/VideoCall/video-call.js",
		"utf8",
	);

	assert.match(source, /createDeepFilterNetAdapter\(rawStream,\s*\{/);
	assert.match(source, /onError:\s*\(error\)\s*=>/);
	assert.match(source, /recoverDeepFilterNetAudio\(/);
});
