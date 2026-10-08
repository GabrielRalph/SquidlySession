import { BackgroundRenderer } from "./background-renderer.js";
import { Segmenter } from "./background-segmenter.js";

// 借用 Squidly 的输入流；只创建和管理自己的背景处理资源。
export async function createBackgroundEffect(inputStream, onError) {
  // 1. 内部 video 读取原始画面，不是通话界面的输出预览。
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("aria-hidden", "true");
  video.style.cssText =
    "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.append(video);

  const frame = document.createElement("canvas");
  const frameContext = frame.getContext("2d");
  const output = document.createElement("canvas");
  const outputContext = output.getContext("2d");


  frame.width = 480;
  let renderer = null;
  let segmenter = null;
  let outputTrack = null;
  let callbackId = null;
  let stopped = false;
  let sourceVersion = 0;
  let mode = "blur";
  let backgroundImage = null;
  let modelName = "standard";
  let switching = false;
  

  // 2. 绘制一帧：原图直接画；背景效果先分割，再合成。
  function drawFrame() {
    if (video.readyState < 2 || (outputTrack && !outputTrack.enabled)) return;

    const height = Math.round(480 * video.videoHeight / video.videoWidth);
    if (frame.height !== height) frame.height = height;
    if (output.width !== 480) output.width = 480;
    if (output.height !== height) output.height = height;

    if (mode === "none") {
      outputContext.drawImage(video, 0, 0, output.width, output.height);
    } else {
      frameContext.drawImage(video, 0, 0, frame.width, frame.height);
      const mask = segmenter.segment(frame, performance.now());
      renderer.draw(frame, mask, mode === "image" ? backgroundImage : null);
    }
  }

  // 3. 只保留一个待执行回调；收到下一帧后继续。
  // 所有恢复入口都从这里申请下一帧，确保只有一套循环。
function scheduleFrame() {
  if (!stopped && !switching && callbackId === null) {
    callbackId = video.requestVideoFrameCallback(processFrame);
  }
}

function processFrame() {
  callbackId = null;

  if (stopped || switching) return;

  try {
    drawFrame();
    scheduleFrame();
  } catch (error) {
    fail(error);
  }
}

  function cancelFrame() {
    if (callbackId !== null) {
      video.cancelVideoFrameCallback(callbackId);
      callbackId = null;
    }
  }

  // 4. 换摄像头只更换输入，输出轨道不变。
  function onTrackChanged(event) {
    if (stopped || event.newTrack?.kind !== "video") return;

    const version = ++sourceVersion;
    cancelFrame();
    video.srcObject = inputStream;

    video.play().then(() => {
      if (!stopped && version === sourceVersion) scheduleFrame();
    }).catch(error => {
      if (!stopped && version === sourceVersion) fail(error);
    });
  }

  // 5. 停止自己的资源；绝不停止借来的摄像头和音频轨道。
  function stop() {
    if (stopped) return;
    stopped = true;

    cancelFrame();
    inputStream.removeEventListener("trackchanged", onTrackChanged);
    window.removeEventListener("pagehide", stop);

    outputTrack?.stop();
    segmenter?.close();
    segmenter = null;
    backgroundImage = null;

    video.pause();
    video.srcObject = null;
    video.remove();
  }

  function fail(error) {
    stop();
    onError(error);
  }
  // 创建完成后再使用；加载期间退出时，释放迟到的模型。
async function loadSegmenter(name) {
  const next = new Segmenter(name); 
  await next.load();

  renderer = new BackgroundRenderer(output, next.webglContext, next.invertMask);

  if (stopped) {
    next.close();
    throw new Error("Background processing has stopped.");
  }

  segmenter = next;
  modelName = name;
}

// 暂停处理 → 释放旧模型 → 加载新模型 → 恢复处理。
async function setModel(name) {
  if (stopped) {
    throw new Error("Background processing has stopped.");
  }

  if (switching) {
    throw new Error("A model switch is already in progress.");
  }

  if (!["standard", "lightweight"].includes(name)) {
    throw new Error("Unknown background model.");
  }

  if (name === modelName) return;

  const previousName = modelName;

  switching = true;
  cancelFrame();

  try {
    // 先关闭旧模型，不同时保留两个背景模型。
    segmenter.close();
    segmenter = null;

    try {
      await loadSegmenter(name);
    } catch (error) {
      // 新模型失败时，尝试恢复旧模型。
      if (!stopped) {
        try {
          await loadSegmenter(previousName);
        } catch (recoveryError) {
          fail(recoveryError);
        }
      }

      throw error;
    }
  } finally {
    switching = false;
    scheduleFrame();
  }
}

  // 6. 启动一次模型和输出流；初始化失败时释放已创建的资源。
  window.addEventListener("pagehide", stop);

  try {
    video.srcObject = inputStream;
    await video.play();

  if (stopped) {
  throw new Error("Background start cancelled.");
  }  

  await loadSegmenter(modelName);

    drawFrame();
    outputTrack = output.captureStream().getVideoTracks()[0];
    outputTrack.enabled = inputStream.getVideoTracks()[0].enabled;

    // 仅替换视频，保留现有音频降噪输出。
    const stream = new MediaStream([
      outputTrack,
      ...inputStream.getAudioTracks(),
    ]);

    inputStream.addEventListener("trackchanged", onTrackChanged);
    scheduleFrame();

    return {
      stream,

      setMode(value) {
        if (stopped) throw new Error("Background processing has stopped.");
        if (!["none", "blur", "image"].includes(value)) {
          throw new Error("Unknown background mode.");
        }
        if (value === "image" && !backgroundImage) {
          throw new Error("Choose an image first.");
        }
        mode = value;
      },

      setImage(image) {
        if (stopped) throw new Error("Background processing has stopped.");
        backgroundImage = image;
        mode = "image";
      },

      setModel,
      getState: () => ({
        model: modelName,
        running: !stopped,
      }),
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}