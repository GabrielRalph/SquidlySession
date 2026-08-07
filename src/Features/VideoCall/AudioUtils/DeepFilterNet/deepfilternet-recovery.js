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

/**
 * Replaces a failed denoised track with the live microphone and keeps later
 * microphone/camera device changes connected to the published stream.
 *
 * @param {object} options
 * @param {MediaStream} options.rawStream
 * @param {MediaStream} options.publishedStream
 * @param {{replaceTrack?: function(MediaStreamTrack, MediaStreamTrack): void}} options.connection
 * @returns {boolean} Whether a microphone fallback was installed.
 */
export function recoverDeepFilterNetAudio({
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
