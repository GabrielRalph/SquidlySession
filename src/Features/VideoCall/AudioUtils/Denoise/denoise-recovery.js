const recoveryListeners = new WeakMap();

function replacePublishedTrack(publishedStream, connection, newTrack) {
	const oldTrack = publishedStream
		.getTracks()
		.find(({ kind }) => kind === newTrack.kind);
	if (!oldTrack || oldTrack === newTrack) return false;

	newTrack.enabled = oldTrack.enabled;
	connection?.replaceTrack?.(oldTrack, newTrack);
	publishedStream.removeTrack(oldTrack);
	if (!publishedStream.getTracks().includes(newTrack)) {
		publishedStream.addTrack(newTrack);
	}
	return true;
}

/** Restores raw tracks after any realtime denoiser fails. */
export function recoverDenoisedAudio({
	rawStream,
	publishedStream,
	connection,
}) {
	const microphone = rawStream?.getAudioTracks?.()[0];
	if (
		!microphone ||
		!publishedStream ||
		!replacePublishedTrack(publishedStream, connection, microphone)
	) {
		return false;
	}

	if (!recoveryListeners.has(publishedStream)) {
		const onTrackChanged = ({ newTrack }) => {
			if (newTrack) {
				replacePublishedTrack(publishedStream, connection, newTrack);
			}
		};
		rawStream.addEventListener("trackchanged", onTrackChanged);
		recoveryListeners.set(publishedStream, onTrackChanged);
	}

	return true;
}
