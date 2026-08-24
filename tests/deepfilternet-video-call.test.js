import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { recoverDenoisedAudio } from "../src/Features/VideoCall/AudioUtils/Denoise/denoise-recovery.js";

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

test("denoise recovery falls back to the live microphone", () => {
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

	const recovered = recoverDenoisedAudio({
		rawStream,
		publishedStream,
		connection,
	});

	assert.equal(recovered, true);
	assert.deepEqual(replacements, [[denoised, microphone]]);
	assert.deepEqual(publishedStream.getAudioTracks(), [microphone]);
	assert.equal(microphone.enabled, false);
});

test("denoise recovery keeps publishing later device changes", () => {
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

	recoverDenoisedAudio({ rawStream, publishedStream, connection });
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

test("video-call selects denoiser modes and wires generic recovery", async () => {
	const source = await readFile(
		"src/Features/VideoCall/video-call.js",
		"utf8",
	);

	assert.match(source, /createAdapterWithFallback\(\s*rawStream,/);
	assert.match(source, /preferredMode:\s*getDenoiserMode\(\)/);
	assert.match(
		source,
		/DENOISER_MODES\.FASTENHANCER_TINY]:\s*fastEnhancerTinyDenoiser/,
	);
	assert.match(source, /DENOISER_MODES\.RNNOISE]:\s*rnnoiseDenoiser/);
	assert.match(
		source,
		/DENOISER_MODES\.DEEPFILTERNET]:\s*deepFilterNetDenoiser/,
	);
	assert.match(source, /getDenoiserMode\(\)/);
	assert.match(source, /subscribeDenoiserMode\(/);
	assert.match(source, /onError:\s*\(error\)\s*=>/);
	assert.match(source, /recoverDenoisedAudio\(/);
});
