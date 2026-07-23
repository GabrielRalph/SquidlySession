import { relURL } from "../../../../Utilities/usefull-funcs.js";

const PROCESSOR_NAME = "NoiseSuppressorWorklet";
const RNNOISE_FRAME_SIZE = 480;
const WORKLET_RENDER_QUANTUM = 128;
const WORKLET_LATENCY =
	RNNOISE_FRAME_SIZE - (RNNOISE_FRAME_SIZE % WORKLET_RENDER_QUANTUM);
const DEFAULT_WORKLET_URL = relURL(
	"./noise-suppression-worklet.js",
	import.meta,
);

/**
 * Processes a decoded AudioBuffer through the same RNNoise worklet used by WebRTC.
 *
 * @param {AudioBuffer} inputBuffer - Decoded 48 kHz audio to denoise.
 * @param {object} [options] - Offline rendering dependencies and worklet URL.
 * @param {string} [options.workletUrl] - Standalone RNNoise worklet URL.
 * @param {typeof OfflineAudioContext} [options.OfflineAudioContextClass]
 * Offline context implementation, injectable for tests.
 * @param {typeof AudioWorkletNode} [options.AudioWorkletNodeClass]
 * Worklet node implementation, injectable for tests.
 * @returns {Promise<Float32Array>} Denoised mono samples matching the input length.
 * @throws {RangeError} If the decoded audio is not sampled at 48 kHz.
 * @throws {Error} If offline Web Audio is unavailable.
 */
export async function processAudioBufferWithRnnoise(
	inputBuffer,
	{
		workletUrl = DEFAULT_WORKLET_URL,
		OfflineAudioContextClass = globalThis.OfflineAudioContext ||
			globalThis.webkitOfflineAudioContext,
		AudioWorkletNodeClass = globalThis.AudioWorkletNode,
	} = {},
) {
	// Step 1: Validate the format and browser APIs required by the RNNoise worklet.
	// RNNoise consumes fixed 480-sample frames from a 48 kHz mono signal.
	if (inputBuffer.sampleRate !== 48000) {
		throw new RangeError("RNNoise file processing requires 48 kHz audio.");
	}
	if (!OfflineAudioContextClass || !AudioWorkletNodeClass) {
		throw new Error("Offline AudioWorklet processing is not supported.");
	}

	// Step 2: Add enough silence for RNNoise to finish its last 480-sample frame
	// and for the worklet's buffered output to pass through 128-sample render calls.
	const frameRemainder = inputBuffer.length % RNNOISE_FRAME_SIZE;
	const framePadding = frameRemainder ? RNNOISE_FRAME_SIZE - frameRemainder : 0;
	const renderPadding = Math.max(WORKLET_LATENCY, framePadding);

	// Step 3: Create a mono offline context long enough for the source audio plus
	// the padding. Unlike AudioContext, this renders as quickly as the browser can.
	const context = new OfflineAudioContextClass(
		1,
		inputBuffer.length + renderPadding,
		inputBuffer.sampleRate,
	);

	// Step 4: Downmix every input channel to mono by adding an equal share of each
	// channel into one Float32Array. Mono input is copied at its original level.
	const monoBuffer = context.createBuffer(
		1,
		inputBuffer.length,
		inputBuffer.sampleRate,
	);
	const monoSamples = monoBuffer.getChannelData(0);
	const channelScale = 1 / inputBuffer.numberOfChannels;
	for (
		let channelIndex = 0;
		channelIndex < inputBuffer.numberOfChannels;
		channelIndex += 1
	) {
		const channel = inputBuffer.getChannelData(channelIndex);
		for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
			monoSamples[sampleIndex] += channel[sampleIndex] * channelScale;
		}
	}

	// Step 5: Load the worklet module that owns the RNNoise WebAssembly processor.
	await context.audioWorklet.addModule(workletUrl);

	// Step 6: Build the offline audio graph:
	// mono AudioBuffer source -> RNNoise worklet -> offline destination.
	const source = context.createBufferSource();
	source.buffer = monoBuffer;
	const suppressor = new AudioWorkletNodeClass(context, PROCESSOR_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
	});
	source.connect(suppressor).connect(context.destination);
	source.start();

	// Step 7: Render the graph. Web Audio sends 128 samples to process() at a time;
	// the worklet buffers those calls into 480-sample frames, denoises each frame
	// in RNNoise, and writes the processed samples to the offline destination.
	const rendered = await context.startRendering();

	// Step 8: Remove the known worklet startup latency and any end padding so the
	// returned mono Float32Array has exactly the same sample count as the input.
	return rendered
		.getChannelData(0)
		.slice(WORKLET_LATENCY, WORKLET_LATENCY + inputBuffer.length);
}
