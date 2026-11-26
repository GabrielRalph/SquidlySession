import assert from "node:assert/strict";
import test from "node:test";

import { processAudioBufferWithRnnoise } from "../src/Features/VideoCall/AudioUtils/NoiseSuppress/noise-suppression-offline.js";

class FakeAudioBuffer {
	constructor(channels, sampleRate = 48000) {
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
		this.destination = {};
		this.loadedWorklets = [];
		this.audioWorklet = {
			addModule: async (url) => this.loadedWorklets.push(url),
		};
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
		this.source = {
			buffer: null,
			started: false,
			connect: (node) => {
				this.source.connectedTo = node;
				return node;
			},
			start: () => {
				this.source.started = true;
			},
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

class FakeAudioWorkletNode {
	constructor(context, processorName, options) {
		this.context = context;
		this.processorName = processorName;
		this.options = options;
		context.workletNode = this;
	}

	connect(node) {
		this.connectedTo = node;
		return node;
	}
}

test("offline RNNoise downmixes to mono and trims worklet latency", async () => {
	const input = new FakeAudioBuffer([
		new Float32Array([1, -1, 0.5]),
		new Float32Array([0, 1, -0.5]),
	]);

	const output = await processAudioBufferWithRnnoise(input, {
		workletUrl: "rnnoise-worklet.js",
		OfflineAudioContextClass: FakeOfflineAudioContext,
		AudioWorkletNodeClass: FakeAudioWorkletNode,
	});

	const context = FakeOfflineAudioContext.instance;
	assert.equal(context.channelCount, 1);
	assert.equal(context.length, 480);
	assert.equal(context.sampleRate, 48000);
	assert.deepEqual(context.loadedWorklets, ["rnnoise-worklet.js"]);
	assert.deepEqual(
		context.createdBuffer.getChannelData(0),
		new Float32Array([0.5, 0, 0]),
	);
	assert.equal(context.workletNode.processorName, "NoiseSuppressorWorklet");
	assert.deepEqual(context.workletNode.options.outputChannelCount, [1]);
	assert.equal(context.source.started, true);
	assert.equal(context.source.connectedTo, context.workletNode);
	assert.equal(context.workletNode.connectedTo, context.destination);
	assert.deepEqual(output, new Float32Array([1, 2, 3]));
});
