import assert from "node:assert/strict";
import test from "node:test";

import {
	RnnoiseProcessor,
	processAudioChannels,
} from "../src/Features/VideoCall/AudioUtils/Denoise/RNNoise/rnnoise-core.js";
import { encodeWav } from "../src/Features/VideoCall/AudioUtils/Denoise/RNNoise/rnnoise-wav.js";

test("RnnoiseProcessor passes input samples through without changing the input", () => {
	const processor = new RnnoiseProcessor({ sampleRate: 48000, channelCount: 1 });
	const input = new Float32Array([0.25, -0.5, 0.75]);
	const original = input.slice();
	const output = new Float32Array(input.length);

	processor.process([input], [output]);

	assert.deepEqual(output, input);
	assert.deepEqual(input, original);
});

test("processAudioChannels processes every block including a partial final block", () => {
	const input = [new Float32Array([0, 0.1, 0.2, 0.3, 0.4])];

	const output = processAudioChannels(input, {
		sampleRate: 48000,
		blockSize: 2,
	});

	assert.equal(output.length, 1);
	assert.deepEqual(output[0], input[0]);
});

test("processAudioChannels supports independent stereo channels", () => {
	const left = new Float32Array([0.1, 0.2, 0.3]);
	const right = new Float32Array([-0.1, -0.2, -0.3]);

	const output = processAudioChannels([left, right], {
		sampleRate: 44100,
		blockSize: 128,
	});

	assert.deepEqual(output[0], left);
	assert.deepEqual(output[1], right);
});

test("processAudioChannels rejects channels with different lengths", () => {
	assert.throws(
		() =>
			processAudioChannels(
				[new Float32Array(2), new Float32Array(3)],
				{ sampleRate: 48000 },
			),
		/channels must have the same length/i,
	);
});

test("encodeWav writes a PCM WAV header and interleaved samples", () => {
	const wav = encodeWav(
		[
			new Float32Array([1, -1]),
			new Float32Array([0.5, -0.5]),
		],
		48000,
	);
	const view = new DataView(wav);
	const text = (offset, length) =>
		String.fromCharCode(
			...new Uint8Array(wav, offset, length),
		);

	assert.equal(text(0, 4), "RIFF");
	assert.equal(text(8, 4), "WAVE");
	assert.equal(view.getUint16(22, true), 2);
	assert.equal(view.getUint32(24, true), 48000);
	assert.equal(view.getInt16(44, true), 32767);
	assert.equal(view.getInt16(46, true), 16384);
	assert.equal(view.getInt16(48, true), -32768);
	assert.equal(view.getInt16(50, true), -16384);
});
