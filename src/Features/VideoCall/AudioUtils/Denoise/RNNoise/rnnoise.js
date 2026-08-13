import { relURL } from "../../../../../Utilities/usefull-funcs.js";

const PROCESSOR_NAME = "NoiseSuppressorWorklet";
const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 480;
const CHANNEL_COUNT = 1;
const RENDER_QUANTUM = 128;
const LATENCY_SAMPLES = FRAME_SIZE - (FRAME_SIZE % RENDER_QUANTUM);
const DEFAULT_WORKLET_URL = relURL(
	"./rnnoise-worklet.js",
	import.meta,
);

/** Creates an RNNoise plugin for realtime and offline denoise sessions. */
export function createRnnoiseDenoiser(
	{
		workletUrl = DEFAULT_WORKLET_URL,
		processorOptions = {},
		AudioWorkletNodeClass = null,
	} = {},
) {
	const createProcessor = async ({ context }) => {
		const WorkletNodeClass =
			AudioWorkletNodeClass || globalThis.AudioWorkletNode;
		if (!WorkletNodeClass) {
			throw new Error("AudioWorklet is not supported by this browser.");
		}
		await context.audioWorklet.addModule(workletUrl);
		return {
			node: new WorkletNodeClass(context, PROCESSOR_NAME, {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [CHANNEL_COUNT],
				processorOptions: {
					...processorOptions,
					channelCount: CHANNEL_COUNT,
				},
			}),
		};
	};

	return {
		id: "rnnoise",
		sampleRate: SAMPLE_RATE,
		channelCount: CHANNEL_COUNT,
		realtime: { createProcessor },
		offline: {
			channelCount: CHANNEL_COUNT,
			frameSize: FRAME_SIZE,
			latencySamples: LATENCY_SAMPLES,
			createProcessor,
		},
	};
}

export const rnnoiseDenoiser = createRnnoiseDenoiser();
