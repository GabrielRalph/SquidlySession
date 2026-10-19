import { relURL } from "../../Utilities/usefull-funcs.js";

// 脸部柔焦：独立于背景模型，用软蒙版保护五官，不做精确皮肤 / 遮挡分割。
const FACE_OUTLINE = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];
const PROTECTED_FEATURES = [
  [33, 133, 159, 145, 70, 63, 105, 66, 107],
  [362, 263, 386, 374, 336, 296, 334, 293, 300],
  [61, 291, 0, 17, 13, 14, 40, 270, 91, 321],
];
const DETECTION_INTERVAL_MS = 1000 / 15;
const LOST_FACE_FADE_MS = 160; // 从最后一次有效定位起计时，不长期沿用旧位置。
const MAX_BLEND = 0.6;        // 滑杆 100：最多混入 60% 柔化图像。
const MAX_BLUR_PX = 2.4;      // 480 像素宽处理画布上的模糊上限。

function bounds(points, width, height) {
  if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return null;
  }
  const xs = points.map(p => p.x * width);
  const ys = points.map(p => p.y * height);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export class FaceSoftener {
  // 只在用户第一次将柔焦调到 0 以上时调用。
  static async create() {
    const { FaceLandmarker, FilesetResolver } = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs"
    );
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
    );
    const model = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        // 复用项目已有的模型文件，但不复用 EyeGaze 的运行实例。
        modelAssetPath: relURL("../EyeGaze/Algorithm/Utils/face_landmarker.task", import.meta),
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    try {
      return new FaceSoftener(model);
    } catch (error) {
      model.close();
      throw error;
    }
  }

  constructor(model) {
    this.model = model;
    this.output = document.createElement("canvas");
    this.context = this.output.getContext("2d");
    if (!this.context || !("filter" in this.context)) {
      throw new Error("This browser does not support Canvas face softening.");
    }
    // 只保留输出与蒙版两张画布；蒙版只在定位更新时重画。
    this.mask = document.createElement("canvas");
    this.maskContext = this.mask.getContext("2d");
    this.reset();
  }

  reset() {
    this.face = null;
    this.tracking = false;
    this.lastDetection = -Infinity;
    this.lastSeen = -Infinity;
  }

  // 1. 准备渐变透明度，而不是把脸和五官切成硬边区域。
  updateMask(points, width, height) {
    if (!points) return false;
    const outline = FACE_OUTLINE.map(i => points[i]);
    const face = bounds(outline, width, height);
    const holes = PROTECTED_FEATURES.map(indices =>
      bounds(indices.map(i => points[i]), width, height)
    );
    // 允许部分脸出画；只有无效、过小或完全离开画面时才跳过。
    if (!face || holes.some(hole => !hole) || face.width < 32 || face.height < 32 ||
        face.x >= width || face.y >= height || face.x + face.width <= 0 ||
        face.y + face.height <= 0) return false;

    const ctx = this.maskContext;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    try {
      // 轮廓内缩后羽化：中心保留效果，靠近头发 / 下颌处逐渐减弱。
      ctx.fillStyle = "white";
      ctx.filter = `blur(${Math.min(8, Math.max(1, face.width * 0.04))}px)`;
      const centerX = face.x + face.width / 2;
      const centerY = face.y + face.height / 2;
      ctx.beginPath();
      outline.forEach((point, index) => {
        const x = centerX + (point.x * width - centerX) * 0.88;
        const y = centerY + (point.y * height - centerY) * 0.88;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();

      // 五官中心保持清晰，周围渐变，而不是留下三个清晰的硬边“洞”。
      ctx.filter = "none";
      ctx.globalCompositeOperation = "destination-out";
      for (const hole of holes) {
        // 每次直接设置位置与缩放，不累加变换，也无需逐个 save / restore。
        ctx.setTransform(Math.max(2, hole.width * 0.85), 0, 0, Math.max(2, hole.height),
          hole.x + hole.width / 2, hole.y + hole.height / 2);
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        gradient.addColorStop(0, "white");
        gradient.addColorStop(0.65, "white");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(-1, -1, 2, 2);
      }
    } finally {
      ctx.restore();
    }
    this.face = face;
    return true;
  }

  apply(frame, strength, timestampMs) {
    // 关闭时直接返回原图，不推理，也不增加绘图。
    if (!this.model || !(strength > 0)) {
      this.reset();
      return frame;
    }
    const { width, height } = frame;
    if (this.output.width !== width || this.output.height !== height) {
      for (const canvas of [this.output, this.mask]) {
        canvas.width = width;
        canvas.height = height;
      }
      this.reset();
    }

    // 2. 定位最多 15 次/秒。丢失时仅短暂淡出，不冻结或长期沿用旧脸。
    if (timestampMs - this.lastDetection >= DETECTION_INTERVAL_MS) {
      this.lastDetection = timestampMs;
      const points = this.model.detectForVideo(frame, timestampMs).faceLandmarks[0];
      this.tracking = this.updateMask(points, width, height);
      if (this.tracking) this.lastSeen = timestampMs;
    }
    const visibility = this.tracking ? 1 : Math.max(0,
      1 - (timestampMs - this.lastSeen) / LOST_FACE_FADE_MS);
    if (!this.face || visibility === 0) {
      this.face = null;
      return frame;
    }

    // 3. 同一张画布完成：柔化 → 用蒙版限定范围 → 在后面补原图。
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    try {
      ctx.filter = `blur(${Math.min(MAX_BLUR_PX, Math.max(0.8, this.face.width * 0.012))}px)`;
      ctx.globalAlpha = Math.min(100, strength) / 100 * MAX_BLEND * visibility;
      ctx.drawImage(frame, 0, 0, width, height);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(this.mask, 0, 0);
      ctx.globalCompositeOperation = "destination-over";
      ctx.drawImage(frame, 0, 0, width, height);
    } finally {
      ctx.restore();
    }
    return this.output;
  }

  close() {
    this.model?.close();
    this.model = null;
    this.reset();
    for (const canvas of [this.output, this.mask]) {
      canvas.width = canvas.height = 1;
    }
  }
}
