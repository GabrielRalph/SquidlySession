// 可选的真实 Canvas 检查：需可解析的 playwright 包及本机 Edge。
// 不访问摄像头或网络；模拟关键点，只验证绘图，不验证真人定位 / 美颜观感。
// node tests/face-softening-render-check.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const source = fs.readFileSync(new URL("../src/Features/VideoCall/face-softener.js", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1460, height: 450 } });
  const result = await page.evaluate(async code => {
    // 加载实际绘图实现，但不调用会下载模型的 create()。
    const moduleURL = URL.createObjectURL(new Blob([code.replace(/^import[^\n]+\n/, "")],
      { type: "text/javascript" }));
    const { FaceSoftener } = await import(moduleURL);
    URL.revokeObjectURL(moduleURL);
    const frame = document.createElement("canvas");
    frame.width = 480;
    frame.height = 360;
    const ctx = frame.getContext("2d");
    ctx.fillStyle = "#253449";
    ctx.fillRect(0, 0, 480, 360);
    ctx.fillStyle = "#356979";
    ctx.fillRect(110, 290, 260, 70);
    ctx.fillStyle = "#211e25";
    ctx.beginPath(); ctx.ellipse(240, 175, 100, 120, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#cca48c";
    ctx.beginPath(); ctx.ellipse(240, 180, 96, 108, 0, 0, Math.PI * 2); ctx.fill();
    // 可重复的细小纹理，验证柔化确实改变了脸颊，而不是只调用了 API。
    for (let y = 80; y < 280; y += 2) for (let x = 150; x < 330; x += 2) {
      if (((x - 240) / 92) ** 2 + ((y - 180) / 102) ** 2 > 1) continue;
      const n = (x * 17 + y * 31) % 37;
      ctx.fillStyle = `rgb(${190 + n},${148 + n},${126 + n})`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.fillStyle = "#292129";
    ctx.fillRect(181, 140, 32, 7);
    ctx.fillRect(267, 140, 32, 7);
    ctx.fillRect(225, 230, 30, 5);

    const outline = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,
      152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
    const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    outline.forEach((index, i) => {
      const angle = i / outline.length * Math.PI * 2 - Math.PI / 2;
      points[index] = { x: 0.5 + 0.2 * Math.cos(angle), y: 0.5 + 0.3 * Math.sin(angle) };
    });
    for (const [indices, x, y] of [
      [[33,133,159,145,70,63,105,66,107], 0.41, 0.41],
      [[362,263,386,374,336,296,334,293,300], 0.59, 0.41],
      [[61,291,0,17,13,14,40,270,91,321], 0.5, 0.64],
    ]) indices.forEach((index, i) => {
      points[index] = { x: x + (i % 2 ? 0.04 : -0.04), y: y + (i % 3 ? 0.02 : -0.02) };
    });
    const model = { points, detectForVideo() { return { faceLandmarks: this.points ? [this.points] : [] }; }, close() {} };
    const effect = new FaceSoftener(model);
    const pixels = canvas => canvas.getContext("2d").getImageData(0, 0, 480, 360).data;
    const original = pixels(frame);
    function difference(actual, x1, y1, x2, y2) {
      let sum = 0, count = 0;
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
        for (let c = 0; c < 3; c++) { sum += Math.abs(actual[(y * 480 + x) * 4 + c] - original[(y * 480 + x) * 4 + c]); count++; }
      }
      return sum / count;
    }
    const bypass = effect.apply(frame, 0, 0) === frame;
    const low = pixels(effect.apply(frame, 25, 0));
    const high = pixels(effect.apply(frame, 100, 70));
    const mask = pixels(effect.mask);
    const alpha = (x, y) => mask[(y * 480 + x) * 4 + 3];
    const edge = Array.from({ length: 75 }, (_, i) => alpha(110 + i, 180));
    const figures = [["Original (synthetic)", frame], ["Softening 100", effect.output], ["Feathered mask", effect.mask]];
    document.body.style.cssText = "margin:8px;background:#131820;color:#eee;font:16px sans-serif;display:flex;gap:6px";
    for (const [title, canvas] of figures) {
      const panel = document.createElement("div");
      const label = document.createElement("p"); label.textContent = title;
      const copy = document.createElement("canvas"); copy.width = 480; copy.height = 360;
      copy.getContext("2d").drawImage(canvas, 0, 0);
      panel.append(label, copy); document.body.append(panel);
    }
    model.points = null;
    const fading = pixels(effect.apply(frame, 100, 140));
    const expired = effect.apply(frame, 100, 231) === frame;
    effect.reset();
    model.points = points.map(p => ({ x: p.x - 0.4, y: p.y }));
    const partialFace = effect.apply(frame, 100, 300) !== frame;
    effect.close();
    return {
      bypass, expired, partialFace,
      cheekLow: difference(low, 170, 180, 200, 210),
      cheekHigh: difference(high, 170, 180, 200, 210),
      cheekFading: difference(fading, 170, 180, 200, 210),
      protectedEye: difference(high, 190, 141, 205, 147),
      outsideFace: difference(high, 0, 0, 100, 360),
      clothing: difference(high, 110, 325, 370, 360),
      maskEye: alpha(197, 148), maskMouth: alpha(240, 230), maskCheek: alpha(175, 195),
      featherLevels: new Set(edge.filter(a => a > 0 && a < 255)).size,
      largestEdgeStep: Math.max(...edge.slice(1).map((a, i) => Math.abs(a - edge[i]))),
    };
  }, source);
  if (process.env.FACE_SOFTENING_QA_IMAGE) {
    await page.screenshot({ path: process.env.FACE_SOFTENING_QA_IMAGE });
  }
  console.log(JSON.stringify(result, null, 2));
  assert(result.bypass && result.expired && result.partialFace);
  assert(result.cheekHigh > 0.5, "must actually soften pixels");
  assert(result.cheekHigh > result.cheekLow, "slider must change the result");
  assert(result.cheekFading < result.cheekHigh && result.cheekFading > 0);
  assert.equal(result.outsideFace, 0);
  assert.equal(result.clothing, 0);
  assert(result.protectedEye < 0.1);
  assert(result.maskEye < 2 && result.maskMouth < 2 && result.maskCheek > 100);
  assert(result.featherLevels > 15 && result.largestEdgeStep < 24, "mask edge must be gradual");
  console.log("Real Canvas render checks passed (synthetic face; no camera/model/performance verification).");
} finally {
  await browser.close();
}
