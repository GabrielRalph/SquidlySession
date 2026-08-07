/**
 * Replaces a failed denoised track with the still-live microphone track.
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
	const failedTrack = publishedStream?.getAudioTracks?.()[0];
	if (!microphone || !failedTrack || microphone === failedTrack) return false;

	microphone.enabled = failedTrack.enabled;
	connection?.replaceTrack?.(failedTrack, microphone);
	publishedStream.removeTrack(failedTrack);
	if (!publishedStream.getTracks().includes(microphone)) {
		publishedStream.addTrack(microphone);
	}
	return true;
}
