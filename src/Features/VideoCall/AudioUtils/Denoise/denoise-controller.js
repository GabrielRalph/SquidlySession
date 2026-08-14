import { createRealtimeDenoiseSession } from "./denoise-session.js";
import { DENOISER_MODES } from "./denoiser-mode.js";

function makeTrackChangedEvent(oldTrack, newTrack) {
	const event = new Event("trackchanged");
	event.oldTrack = oldTrack;
	event.newTrack = newTrack;
	return event;
}

function replaceStreamTrack(stream, newTrack) {
	if (!newTrack) return false;
	const oldTrack = stream
		.getTracks()
		.find(({ kind }) => kind === newTrack.kind);
	if (!oldTrack || oldTrack === newTrack) return false;

	newTrack.enabled = oldTrack.enabled;
	stream.removeTrack(oldTrack);
	stream.addTrack(newTrack);
	stream.dispatchEvent(makeTrackChangedEvent(oldTrack, newTrack));
	return true;
}

function getDenoiser(mode, denoisers) {
	if (mode === DENOISER_MODES.OFF) return null;
	const denoiser = denoisers?.[mode];
	if (!denoiser) {
		throw new Error(`No denoiser implementation is registered for "${mode}".`);
	}
	return denoiser;
}

/**
 * Owns one stable published MediaStream while allowing its audio processor to
 * be replaced without restarting WebRTC. The input stream remains owned by
 * the webcam subsystem and is never stopped by this controller.
 */
export async function createRealtimeDenoiseController(
	inputStream,
	{ mode = DENOISER_MODES.OFF, denoisers = {}, context = null, onError = null } = {},
) {
	if (!inputStream || typeof inputStream.getAudioTracks !== "function") {
		throw new TypeError("inputStream must be a MediaStream.");
	}
	if (!inputStream.getAudioTracks()[0]) {
		throw new Error("inputStream must contain an audio track.");
	}

	let activeMode = mode;
	let adapter = null;
	let closed = false;

	const createAdapter = async (nextMode) => {
		const denoiser = getDenoiser(nextMode, denoisers);
		return denoiser
			? createRealtimeDenoiseSession(inputStream, {
					denoiser,
					context,
					onError,
				})
			: null;
	};

	adapter = await createAdapter(activeMode);
	const initialStream = adapter?.stream || inputStream;
	const publishedStream = new MediaStream(initialStream.getTracks());

	const onInputTrackChanged = ({ newTrack }) => {
		if (closed || !newTrack) return;
		if (
			newTrack.kind === "video" ||
			(newTrack.kind === "audio" && activeMode === DENOISER_MODES.OFF)
		) {
			replaceStreamTrack(publishedStream, newTrack);
		}
	};
	inputStream.addEventListener("trackchanged", onInputTrackChanged);

	const switchMode = async (nextMode) => {
		if (closed) throw new Error("The denoiser controller is closed.");
		if (nextMode === activeMode) return activeMode;

		const nextAdapter = await createAdapter(nextMode);
		const nextStream = nextAdapter?.stream || inputStream;
		const nextAudioTrack = nextStream.getAudioTracks()[0];
		if (!nextAudioTrack) {
			await nextAdapter?.close();
			throw new Error("The selected denoiser did not produce an audio track.");
		}

		const previousAdapter = adapter;
		replaceStreamTrack(publishedStream, nextAudioTrack);
		adapter = nextAdapter;
		activeMode = nextMode;
		await previousAdapter?.close();
		return activeMode;
	};

	const close = async () => {
		if (closed) return;
		closed = true;
		inputStream.removeEventListener("trackchanged", onInputTrackChanged);
		await adapter?.close();
		adapter = null;
	};

	return {
		stream: publishedStream,
		get audioTrack() {
			return publishedStream.getAudioTracks()[0] || null;
		},
		get mode() {
			return activeMode;
		},
		switchMode,
		close,
	};
}
