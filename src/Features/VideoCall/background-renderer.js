import {
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs";

// 只负责准备背景和合成画面，不负责模型、摄像头或通话连接。
export class BackgroundRenderer {
  constructor(outputCanvas, webglContext, invertMask = false) {
    this.outputCanvas = outputCanvas;
    this.outputContext = outputCanvas.getContext("2d");
    this.drawingUtils = new DrawingUtils(
      this.outputContext,
      webglContext
    );
    this.invertMask = invertMask;

    // 同一张小画布用于背景图片或模糊底图。
    this.background = document.createElement("canvas");
    this.backgroundContext = this.background.getContext("2d");

    // 记录画布中已经准备好的图片。
    this.cachedImage = null;
  }

  // foregroundFrame 可以是仅柔化脸部后的画面；背景仍从原始 frame 准备。
  draw(frame, mask, backgroundImage = null, foregroundFrame = frame) {
    const { width, height } = frame;

    // 1. 只有尺寸变化时，才重新设置画布大小。
    const sizeChanged =
      this.background.width !== width ||
      this.background.height !== height;

    this.resize(this.outputCanvas, width, height);
    this.resize(this.background, width, height);

    // 2. 准备背景：静态图片复用，模糊底图每帧更新。
    if (backgroundImage) {
      if (sizeChanged || this.cachedImage !== backgroundImage) {
        this.prepareImage(backgroundImage, width, height);
        this.cachedImage = backgroundImage;
      }
    } else {
      // 模糊会覆盖缓存画布，切回图片时需要重新准备。
      this.cachedImage = null;

      this.backgroundContext.clearRect(0, 0, width, height);
      this.backgroundContext.filter = "blur(8px)";
      this.backgroundContext.drawImage(
        frame, 0, 0, width, height
      );
      this.backgroundContext.filter = "none";
    }

    // 3. 使用小尺寸背景与当前人物画面合成。
    // Standard 的蒙版表示背景，Lightweight 的蒙版表示人物。
    const lowConfidenceImage =
      this.invertMask ? foregroundFrame : this.background;

    const highConfidenceImage =
      this.invertMask ? this.background : foregroundFrame;

    this.drawingUtils.drawConfidenceMask(
      mask,
      lowConfidenceImage,
      highConfidenceImage
    );
  }

  prepareImage(image, width, height) {
    // 等比例铺满画布，多余部分居中裁剪，避免拉伸图片。
    const scale = Math.max(
      width / image.naturalWidth,
      height / image.naturalHeight
    );

    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;

    this.backgroundContext.filter = "none";
    this.backgroundContext.clearRect(0, 0, width, height);

    this.backgroundContext.drawImage(
      image,
      (width - imageWidth) / 2,
      (height - imageHeight) / 2,
      imageWidth,
      imageHeight
    );
  }

  resize(canvas, width, height) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
}
