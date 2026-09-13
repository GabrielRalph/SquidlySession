import { relURL } from "../../../../Utilities/usefull-funcs.js";

const PROCESSOR_NAME = "NoiseSuppressorWorklet";
const DEFAULT_WORKLET_URL = relURL(
	"./noise-suppression-worklet.js",
	import.meta,
);

/**
 * Creates the custom event used by the existing stream-switching integration.
 *
 * @param {MediaStreamTrack} oldTrack - Track being replaced.
 * @param {MediaStreamTrack} newTrack - Replacement track.
 * @returns {Event & {oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack}}
 * The event carrying both tracks.
 */
function makeTrackChangedEvent(oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	return event;
}

/**
 * Converts a stream's microphone track into an AudioWorklet-processed track.
 *
 * Native getUserMedia constraints such as echoCancellation run upstream of this
 * adapter. The returned stream preserves video tracks and substitutes only the
 * audio track, so it can be passed to the current RTCPeerConnection flow.
 *
 * @param {MediaStream} inputStream - WebRTC capture stream containing audio.
 * @param {object} [options] - Adapter configuration.
 * @param {AudioContext|null} [options.context=null] - Context to use and close.
 * @param {string} [options.workletUrl] - URL of the worklet module.
 * @param {object} [options.processorOptions] - Values forwarded to the processor.
 * @returns {Promise<{
 * stream: MediaStream,
 * audioTrack: MediaStreamTrack,
 * context: AudioContext,
 * node: AudioWorkletNode,
 * close: function(): Promise<void>
 * }>} Handles for the processed stream and its lifecycle.
 * @throws {TypeError} If inputStream is not a MediaStream.
 * @throws {Error} If audio or required Web Audio support is unavailable.
 */
export async function createNoiseSuppressionAdapter(
	inputStream,
	{
		context = null,
		workletUrl = DEFAULT_WORKLET_URL,
		processorOptions = {},
	} = {},
) {
	if (!(inputStream instanceof MediaStream)) {
		throw new TypeError("inputStream must be a MediaStream.");
	}

	const inputAudioTrack = inputStream.getAudioTracks()[0];
	if (!inputAudioTrack) {
		throw new Error("inputStream must contain an audio track.");
	}

	const settings = inputAudioTrack.getSettings();
	const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!context && !AudioContextClass) {
		throw new Error("Web Audio is not supported by this browser.");
	}

	const audioContext =
		context ||
		new AudioContextClass({
			sampleRate: settings.sampleRate,
		});
	// Register the processor module; its process() calls then run on Web Audio's
	// rendering thread rather than the page's UI thread.
	await audioContext.audioWorklet.addModule(workletUrl);

	// The packaged RNNoise worklet processes only its first (mono) channel.
	const channelCount = 1;
	const workletNode = new AudioWorkletNode(audioContext, PROCESSOR_NAME, {
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [channelCount],
		processorOptions: {
			...processorOptions,
			channelCount,
		},
	});
	const destinationNode = audioContext.createMediaStreamDestination();
	destinationNode.channelCount = channelCount;
	destinationNode.channelCountMode = "explicit";
	workletNode.connect(destinationNode);

	let sourceNode = null;
	/**
	 * Connects a microphone track while keeping the processed output track stable.
	 *
	 * @param {MediaStreamTrack} track - Current microphone track.
	 * @returns {void}
	 */
	const connectInputTrack = (track) => {
		if (sourceNode) sourceNode.disconnect();
		sourceNode = audioContext.createMediaStreamSource(new MediaStream([track]));
		sourceNode.connect(workletNode);
	};
	connectInputTrack(inputAudioTrack);

	// MediaStreamDestination converts processed PCM back into a MediaStreamTrack.
	const processedAudioTrack = destinationNode.stream.getAudioTracks()[0];
	processedAudioTrack.enabled = inputAudioTrack.enabled;
	// Preserve camera tracks and replace only the outgoing microphone track.
	const outputStream = new MediaStream([
		...inputStream.getVideoTracks(),
		processedAudioTrack,
	]);

	/**
	 * Mirrors device changes from the capture stream into the adapted stream.
	 *
	 * @param {Event & {oldTrack?: MediaStreamTrack, newTrack?: MediaStreamTrack}} event
	 * The application's trackchanged event.
	 * @returns {void}
	 */
	const onTrackChanged = (event) => {
		const { oldTrack, newTrack } = event;
		if (!oldTrack || !newTrack || oldTrack.kind !== newTrack.kind) return;

		if (newTrack.kind === "audio") {
			// Reconnect the source but retain processedAudioTrack, avoiding an audio
			// sender replacement or peer renegotiation when microphones change.
			connectInputTrack(newTrack);
		} else if (newTrack.kind === "video") {
			if (outputStream.getTracks().includes(oldTrack)) {
				outputStream.removeTrack(oldTrack);
			}
			outputStream.addTrack(newTrack);
			// Downstream ConnectionManager listeners expect this custom event.
			outputStream.dispatchEvent(makeTrackChangedEvent(oldTrack, newTrack));
		}
	};
	inputStream.addEventListener("trackchanged", onTrackChanged);

	if (audioContext.state === "suspended") {
		await audioContext.resume();
	}
	// A non-running context produces silence, so fail before publishing its track.
	if (audioContext.state !== "running") {
		inputStream.removeEventListener("trackchanged", onTrackChanged);
		sourceNode.disconnect();
		workletNode.disconnect();
		processedAudioTrack.stop();
		await audioContext.close();
		throw new Error(
			"The AudioContext could not start. Resume it from a user interaction before starting WebRTC.",
		);
	}

	let closed = false;
	return {
		stream: outputStream,
		audioTrack: processedAudioTrack,
		context: audioContext,
		node: workletNode,
		/**
		 * Releases worklet resources without stopping the original capture tracks.
		 *
		 * @returns {Promise<void>}
		 */
		async close() {
			if (closed) return;
			closed = true;
			inputStream.removeEventListener("trackchanged", onTrackChanged);
			sourceNode.disconnect();
			workletNode.disconnect();
			destinationNode.disconnect();
			processedAudioTrack.stop();
			await audioContext.close();
		},
	};
}
