// 创建绘图工具：只负责处理画面，不负责加载模型或打开摄像头。
export function createBackgroundRenderer(outputCanvas) {
  const outputContext = outputCanvas.getContext("2d");

  // 内部画布一：保存透明度蒙版，不需要显示到页面。
  const alphaCanvas = document.createElement("canvas");
  const alphaContext = alphaCanvas.getContext("2d");

  // 内部画布二：保存抠出的人物，不需要显示到页面。
  const foregroundCanvas = document.createElement("canvas");
  const foregroundContext = foregroundCanvas.getContext("2d");

  return {
    // frame：送给模型的原始截图。
    // mask：模型返回的人物置信度。
    draw(frame, mask, backgroundImage = null) {
      const width = frame.width;
      const height = frame.height;

      // 1. 设置画布尺寸。
      // 设置 width / height 也会清空旧画面并重置绘图状态。
      outputCanvas.width = width;
      outputCanvas.height = height;

      foregroundCanvas.width = width;
      foregroundCanvas.height = height;

      alphaCanvas.width = mask.width;
      alphaCanvas.height = mask.height;

      // 2. 将人物置信度写入透明度通道。
      // 人物越确定，越不透明；背景越确定，越透明。
      const alphaImage = new ImageData(mask.width, mask.height);

      for (let i = 0; i < mask.confidence.length; i++) {
        const p = i * 4;

        alphaImage.data[p] = 255;
        alphaImage.data[p + 1] = 255;
        alphaImage.data[p + 2] = 255;
        alphaImage.data[p + 3] = Math.round(
          mask.confidence[i] * 255
        );
      }

      alphaContext.putImageData(alphaImage, 0, 0);

      // 3. 先画完整的清晰截图，再通过蒙版只保留人物。
      foregroundContext.drawImage(frame, 0, 0, width, height);

      foregroundContext.globalCompositeOperation = "destination-in";
      foregroundContext.drawImage(
        alphaCanvas, 0, 0, width, height
      );

      // 4. 根据是否传入图片，选择底图。
     if (backgroundImage) {
  // 等比例缩放，让图片铺满画布；超出的部分由画布裁掉。
  const scale = Math.max(
    width / backgroundImage.naturalWidth,
    height / backgroundImage.naturalHeight
  );

  const imageWidth = backgroundImage.naturalWidth * scale;
  const imageHeight = backgroundImage.naturalHeight * scale;

  // 图片如果带有透明区域，用深灰色填底。
  outputContext.fillStyle = "#222";
  outputContext.fillRect(0, 0, width, height);

  outputContext.drawImage(
    backgroundImage,
    (width - imageWidth) / 2,
    (height - imageHeight) / 2,
    imageWidth,
    imageHeight
  );
} else {
  // 没有图片：使用整张截图的模糊版本作为底图。
  outputContext.filter = "blur(8px)";
  outputContext.drawImage(frame, 0, 0, width, height);
  outputContext.filter = "none";
}

// 5. 两种底图都叠加同一份清晰人物。
outputContext.drawImage(
  foregroundCanvas, 0, 0, width, height
);
    },
  };
}