import assert from "node:assert/strict";
import test from "node:test";

import { nodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";

async function generateModule(input, plugins = []) {
	const bundle = await rollup({
		input,
		plugins,
		onwarn(warning) {
			throw new Error(warning.message);
		},
	});
	try {
		const { output } = await bundle.generate({
			format: "es",
			inlineDynamicImports: true,
		});
		return output.find((entry) => entry.type === "chunk").code;
	} finally {
		await bundle.close();
	}
}

test("DeepFilterNet Worker bundles ONNX Runtime without a browser bare import", async () => {
	const code = await generateModule(
		"src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worker-source.js",
		[nodeResolve({ browser: true })],
	);

	assert.doesNotMatch(code, /from\s*["']onnxruntime-web/);
	assert.match(code, /DeepFilterNet worker is not initialized/);
});

test("DeepFilterNet worklet bundles its processor registration", async () => {
	const code = await generateModule(
		"src/Features/VideoCall/AudioUtils/DeepFilterNet/deepfilternet-worklet-source.js",
	);

	assert.match(code, /registerProcessor\(\s*["']DeepFilterNetWorkletProcessor/);
});
