import { DeepFilterNetWorkletBridge } from "./deepfilternet-worklet-core.js";

class DeepFilterNetWorkletProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.bridge = new DeepFilterNetWorkletBridge(null, (message) => {
			this.port.postMessage({ type: "error", message });
		});
		this.port.onmessage = ({ data }) => {
			if (data?.type === "connect" && data.port) {
				this.bridge.connect(data.port);
			}
		};
	}

	process(inputs, outputs) {
		const output = outputs[0]?.[0];
		if (output) this.bridge.process(inputs[0] || [], output);
		return true;
	}
}

registerProcessor(
	"DeepFilterNetWorkletProcessor",
	DeepFilterNetWorkletProcessor,
);
