import {
  FilesetResolver,
  ImageSegmenter,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm";

const MODEL_ROOT =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/";


const MODELS = {
  standard: {
    path:
      "selfie_multiclass_256x256/float32/latest/" +
      "selfie_multiclass_256x256.tflite",
    backgroundMask: true,
  },

  lightweight: {
    path:
      "selfie_segmenter_landscape/float16/latest/" +
      "selfie_segmenter_landscape.tflite",
    backgroundMask: false,
  },
};

export class Segmenter {
  constructor(modelName) {

    if (!Object.hasOwn(MODELS, modelName)) {
      throw new Error("Unknown background model.");
    }
    this.modelName = modelName;
    this.webglCavas = document.createElement("canvas");
    this.webglContext = this.webglCavas.getContext("webgl2");
    
  }

  async load() {
    const config = MODELS[this.modelName];
    this.invertMask = config.backgroundMask;
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    this.model = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_ROOT + config.path,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
      canvas: this.webglCavas,
    });
  }


  segment(frame, timestampMs) {
    let output = null;
      this.model.segmentForVideo(frame, timestampMs, (result) => {
        const mask = result.confidenceMasks?.[0];
        output = mask;
      });

      return output;
  }

  close() {
    this.model.close();
    this.model = null;
  }
}

// // 1. 每次只创建所选的一种模型。
// export async function createPersonSegmenter(modelName = "standard") {
//   if (!Object.hasOwn(MODELS, modelName)) {
//     throw new Error("Unknown background model.");
//   }

//   const config = MODELS[modelName];
//   const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

//   const model = await ImageSegmenter.createFromOptions(fileset, {
//     baseOptions: {
//       modelAssetPath: MODEL_ROOT + config.path,
//       delegate: "GPU",
//     },
//     runningMode: "VIDEO",
//     outputConfidenceMasks: true,
//     outputCategoryMask: false,
//   });

//   // 自己持有结果数组，长度不变时重复使用。
//   let person = null;

//   return {
//     // 2. 两种模型统一输出人物置信度。
//     // 返回的数组会在下一次 segment() 时更新，应立即用于绘图。
//     segment(frame, timestampMs) {
//       let output = null;

//       model.segmentForVideo(frame, timestampMs, (result) => {
//         const mask = result.confidenceMasks?.[0];

//         // if (!mask) {
//         //   throw new Error("Model returned no confidence mask.");
//         // }

//         // const confidence = mask.getAsFloat32Array();

//         // if (!person || person.length !== confidence.length) {
//         //   person = new Float32Array(confidence.length);
//         // }

//         // for (let i = 0; i < confidence.length; i++) {
//         //   // Multiclass 第 0 通道是背景；Landscape 的通道是人物。
//         //   person[i] = config.backgroundMask
//         //     ? 1 - confidence[i]
//         //     : confidence[i];
//         // }

//         output = mask;
//         // {
//         //   width: mask.width,
//         //   height: mask.height,
//         //   confidence: person,
//         // };
//       });

//       return output;
//     },

//     // 3. 释放模型和本模块持有的数组。
//     close() {
//       model.close();
//       person = null;
//     },
//   };
// }