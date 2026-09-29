import {
  FilesetResolver,
  ImageSegmenter,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/" +
  "selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

// 1. 加载运行环境和模型。创建一次，后续检测重复使用。
export async function createPersonSegmenter() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  const model = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });

  return {
    // 2. 输入一帧画面，输出每个位置属于人物的置信度。
    segment(frame, timestampMs) {
      let output = null;

      model.segmentForVideo(frame, timestampMs, (result) => {
        // 这个模型的第 0 类是背景。
        const backgroundMask = result.confidenceMasks?.[0];

        if (!backgroundMask) {
          throw new Error("模型没有返回背景蒙版。");
        }

        const background = backgroundMask.getAsFloat32Array();
        const person = new Float32Array(background.length);

        for (let i = 0; i < background.length; i++) {
          person[i] = 1 - background[i];
        }

        // 复制到我们自己的数组，回调结束后仍可使用。
        output = {
          width: backgroundMask.width,
          height: backgroundMask.height,
          confidence: person,
        };
      });

      return output;
    },

    // 3. 页面退出时释放模型。
    close() {
      model.close();
    },
  };
}