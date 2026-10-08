import {
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs";
// 只负责合成画面，不负责模型、摄像头或通话连接。


export class BackgroundRenderer {
  constructor(outputCanvas, webglContext, invertMask = false) {
    this.outputCanvas = outputCanvas;
    this.outputContext = outputCanvas.getContext("2d");

    this.drawingUtils = new DrawingUtils(this.outputContext, webglContext);

    this.background = document.createElement("canvas");
    this.backgroundContext = this.background.getContext("2d");

    this.alphaImage = null;
    this.invertMask = invertMask;
  }

  draw(frame, mask, backgroundImage = null) {
    if (!backgroundImage) {
      this.resize(this.outputCanvas, frame.width, frame.height);
      this.resize(this.background, frame.width, frame.height);
      this.backgroundContext.filter = "blur(8px)";
      this.backgroundContext.drawImage(frame, 0, 0, frame.width, frame.height);
      this.backgroundContext.filter = "none";
      backgroundImage = this.background;
    }

    this.invertMask ? this.drawingUtils.drawConfidenceMask(
      mask,
      frame,
      backgroundImage,
    ) : this.drawingUtils.drawConfidenceMask(
      mask,
      backgroundImage,
      frame,
    );
  }

  resize(canvas, width, height) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
}


// export function createBackgroundRenderer(outputCanvas) {
//   const outputContext = outputCanvas.getContext("2d");
//   const drawingUtils = new DrawingUtils(ctx);

//   const background = document.createElement("canvas");
//   const backgroundContext = background.getContext("2d");

//   // const foregroundCanvas = document.createElement("canvas");
//   // const foregroundContext = foregroundCanvas.getContext("2d");

//   let alphaImage = null;

//   // 只有尺寸真的变化时才重设画布，避免每帧重置。
//   function resize(canvas, width, height) {
//     if (canvas.width !== width) canvas.width = width;
//     if (canvas.height !== height) canvas.height = height;
//   }

//   return {
//     draw(frame, mask, backgroundImage = null) {
//       if (!backgroundImage) {
//         resize(outputCanvas, frame.width, frame.height);
//         backgroundContext.filter = "blur(8px)";
//         backgroundContext.drawImage(frame, 0, 0, frame.width, frame.height);
//         backgroundContext.filter = "none";
//         backgroundImage = background;
//       } 

//       DrawingUtils.drawConfidenceMask(
//         mask, 
//         backgroundImage,
//         frame
//       );

//       // const width = frame.width;
//       // const height = frame.height;

//       // // 1. 复用画布和像素缓冲区。
//       // resize(outputCanvas, width, height);
//       // resize(foregroundCanvas, width, height);
//       // resize(alphaCanvas, mask.width, mask.height);

//       // if (
//       //   !alphaImage ||
//       //   alphaImage.width !== mask.width ||
//       //   alphaImage.height !== mask.height
//       // ) {
//       //   alphaImage = new ImageData(mask.width, mask.height);
//       //   alphaImage.data.fill(255);
//       // }

//       // // 2. RGB 保持白色；每帧只更新人物透明度。
//       // for (let i = 0; i < mask.confidence.length; i++) {
//       //   alphaImage.data[i * 4 + 3] =
//       //     Math.round(mask.confidence[i] * 255);
//       // }

//       // alphaContext.putImageData(alphaImage, 0, 0);

//       // // 3. 清掉上一帧，绘制当前清晰画面，再按蒙版保留人物。
//       // foregroundContext.globalCompositeOperation = "source-over";
//       // foregroundContext.clearRect(0, 0, width, height);
//       // foregroundContext.drawImage(frame, 0, 0, width, height);

//       // foregroundContext.globalCompositeOperation = "destination-in";
//       // foregroundContext.drawImage(alphaCanvas, 0, 0, width, height);
//       // foregroundContext.globalCompositeOperation = "source-over";

//       // // 4. 不再靠重设尺寸清空，因此这里明确清理输出。
//       // outputContext.filter = "none";
//       // outputContext.clearRect(0, 0, width, height);

//       // if (backgroundImage) {
//       //   const scale = Math.max(
//       //     width / backgroundImage.naturalWidth,
//       //     height / backgroundImage.naturalHeight
//       //   );

//       //   const imageWidth = backgroundImage.naturalWidth * scale;
//       //   const imageHeight = backgroundImage.naturalHeight * scale;

//       //   outputContext.fillStyle = "#222";
//       //   outputContext.fillRect(0, 0, width, height);

//       //   outputContext.drawImage(
//       //     backgroundImage,
//       //     (width - imageWidth) / 2,
//       //     (height - imageHeight) / 2,
//       //     imageWidth,
//       //     imageHeight
//       //   );
//       // } else {
//       //   // 本轮保持原来的模糊强度和处理尺寸。
//       //   outputContext.filter = "blur(8px)";
//       //   outputContext.drawImage(frame, 0, 0, width, height);
//       //   outputContext.filter = "none";
//       // }

//       // // 5. 在底图上叠加清晰人物。
//       // outputContext.drawImage(
//       //   foregroundCanvas, 0, 0, width, height
//       // );
//     },
//   };
// }