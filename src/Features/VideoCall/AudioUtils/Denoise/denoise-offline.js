import { createDenoiseGraph } from "./denoise-graph.js";

function calculateRenderPadding(inputLength, { frameSize, latencySamples }) {
	const remainder = inputLength % frameSize;
	const framePadding = remainder ? frameSize - remainder : 0;
	return Math.max(framePadding, latencySamples);
}

function downmixToMono(context, input) {
	const mono = context.createBuffer(1, input.length, input.sampleRate);
	const output = mono.getChannelData(0);
	const channelScale = 1 / input.numberOfChannels;
	for (
		let channelIndex = 0;
		channelIndex < input.numberOfChannels;
		channelIndex += 1
	) {
		const channel = input.getChannelData(channelIndex);
		for (let sampleIndex = 0; sampleIndex < channel.length; sampleIndex += 1) {
			output[sampleIndex] += channel[sampleIndex] * channelScale;
		}
	}
	return mono;
}

/**
 * Renders a decoded AudioBuffer through a denoiser's optional offline mode.
 *
 * Offline support uses the same processor factory contract as realtime mode,
 * plus `channelCount`, `frameSize`, and `latencySamples` for render layout,
 * padding, and output trimming. The shared renderer currently accepts only a
 * mono capability, so a multichannel plug-in must provide a channel-aware
 * renderer before it can opt into this helper.
 *
 * @param {AudioBuffer} input
 * @param {object} options
 * @param {object} options.denoiser
 * @param {typeof OfflineAudioContext} [options.OfflineAudioContextClass]
 * @returns {Promise<Float32Array>}
 */
export async function renderOfflineDenoise(
	input,
	{
		denoiser,
		OfflineAudioContextClass = globalThis.OfflineAudioContext ||
			globalThis.webkitOfflineAudioContext,
	} = {},
) {
	const offline = denoiser?.offline;
	if (!offline?.createProcessor) {
		throw new Error(
			`${denoiser?.id || "The denoiser"} does not support offline denoising.`,
		);
	}
	if (!Number.isInteger(offline.frameSize) || offline.frameSize < 1) {
		throw new RangeError(
			`${denoiser.id} offline frameSize must be a positive integer.`,
		);
	}
	if (!Number.isInteger(offline.latencySamples) || offline.latencySamples < 0) {
		throw new RangeError(
			`${denoiser.id} offline latencySamples must be a non-negative integer.`,
		);
	}
	const channelCount = offline.channelCount ?? denoiser.channelCount;
	if (channelCount !== 1) {
		throw new RangeError(
			`${denoiser.id} offline denoising currently requires a mono capability.`,
		);
	}
	if (input.sampleRate !== denoiser.sampleRate) {
		throw new RangeError(
			`${denoiser.id} requires ${denoiser.sampleRate} Hz audio.`,
		);
	}
	if (!OfflineAudioContextClass) {
		throw new Error("Offline AudioWorklet processing is not supported.");
	}

	const padding = calculateRenderPadding(input.length, offline);
	const context = new OfflineAudioContextClass(
		channelCount,
		input.length + padding,
		denoiser.sampleRate,
	);
	const source = context.createBufferSource();
	source.buffer = downmixToMono(context, input);
	let graph = null;
	try {
		graph = await createDenoiseGraph({
			context,
			destination: context.destination,
			createProcessor: offline.createProcessor,
			onError: null,
		});
		graph.connectSource(source);
		source.start();
		const rendered = await context.startRendering();
		return rendered
			.getChannelData(0)
			.slice(
				offline.latencySamples,
				offline.latencySamples + input.length,
			);
	} finally {
		await graph?.close();
	}
}
