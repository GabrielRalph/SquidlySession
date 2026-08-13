/**
 * Creates the shared source -> processor -> destination graph used by denoise
 * sessions. Algorithm-specific setup and cleanup stay behind createProcessor.
 *
 * A processor factory receives `{ context, onError }` and returns an object
 * containing its Web Audio `node` plus an optional idempotent `close()` hook.
 */
export async function createDenoiseGraph({
	context,
	destination,
	createProcessor,
	onError,
}) {
	let processor = null;
	try {
		processor = await createProcessor({ context, onError });
		if (!processor?.node) {
			throw new TypeError("A denoiser processor must provide an audio node.");
		}
		processor.node.connect(destination);
	} catch (error) {
		await processor?.close?.();
		throw error;
	}

	let source = null;
	let closed = false;
	return {
		node: processor.node,
		connectSource(nextSource) {
			if (closed) throw new Error("The denoise graph is closed.");
			source?.disconnect();
			source = nextSource;
			source.connect(processor.node);
		},
		async close() {
			if (closed) return;
			closed = true;
			source?.disconnect();
			processor.node.disconnect();
			await processor.close?.();
		},
	};
}
