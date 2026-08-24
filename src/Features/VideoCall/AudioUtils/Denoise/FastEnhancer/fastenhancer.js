// Path B — package owns stream graph; no createProcessor.
import { loadModel } from "fastenhancer-web";
import { relURL } from "../../../../../Utilities/usefull-funcs.js";

const SAMPLE_RATE = 48_000;
const CHANNEL_COUNT = 1;
const MODEL_SIZE = "tiny";

const DEFAULT_WORKLET_URL = relURL(
	"../../../../../../node_modules/fastenhancer-web/dist/worklet/processor.js",
	import.meta,
);

export function createFastEnhancerDenoiser({
	modelSize = MODEL_SIZE,
	loadModelImpl = loadModel,
	workletUrl = DEFAULT_WORKLET_URL,
	audioContext = undefined,
} = {}) {
	if (modelSize !== "tiny") {
		throw new Error("FastEnhancer currently ships only the tiny model.");
	}

	let modelPromise = null;
	const getModel = () => {
		if (!modelPromise) modelPromise = loadModelImpl("tiny");
		return modelPromise;
	};

	return {
		id: "fastenhancer-tiny",
		sampleRate: SAMPLE_RATE,
		channelCount: CHANNEL_COUNT,
		realtime: {
			async attachStream(
				inputStream,
				{ onError, audioContext: streamContext } = {},
			) {
				const audioTracks = inputStream.getAudioTracks?.() ?? [];
				if (!audioTracks.length) {
					throw new Error("inputStream must contain an audio track.");
				}
				const injectedContext = streamContext || audioContext;
				if (injectedContext && injectedContext.sampleRate !== SAMPLE_RATE) {
					throw new RangeError(
						`fastenhancer-tiny requires a ${SAMPLE_RATE / 1000} kHz AudioContext.`,
					);
				}
				const audioOnlyStream = new MediaStream(audioTracks);
				try {
					const model = await getModel();
					const streamDenoiser = await model.createStreamDenoiser(audioOnlyStream, {
						workletUrl,
						...(injectedContext ? { audioContext: injectedContext } : {}),
						onWarning: (message) => {
							console.warn(
								"[fastenhancer-tiny]",
								message instanceof Error ? message.message : String(message),
							);
						},
						onAutoBypass: (enabled) => {
							console.warn(
								"[fastenhancer-tiny] auto-bypass",
								enabled ? "enabled (silence passthrough)" : "disabled",
							);
						},
					});
					const stream = streamDenoiser.outputStream;
					const audioTrack = stream?.getAudioTracks?.()[0];
					if (!audioTrack) {
						await streamDenoiser.destroyAsync?.();
						throw new Error("FastEnhancer did not produce an audio track.");
					}
					return {
						stream,
						audioTrack,
						close: async () => {
							if (typeof streamDenoiser.destroyAsync === "function") {
								await streamDenoiser.destroyAsync();
								return;
							}
							streamDenoiser.destroy?.();
						},
					};
				} catch (error) {
					const wrapped =
						error instanceof Error
							? error
							: new Error(`FastEnhancer failed to load: ${error}`);
					throw wrapped;
				}
			},
		},
	};
}

export const fastEnhancerTinyDenoiser = createFastEnhancerDenoiser();
