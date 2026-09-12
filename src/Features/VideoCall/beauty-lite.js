// Lightweight skin-tone softening without another vision model. Resources are
// allocated only when enabled, and reused. Colour is a heuristic, not a face mask.
export function createLiteBeauty(width, height) {
  let strength = 0;
  let buffers = null;
  let lastDurationMs = 0;
  const sampleWidth = 160, sampleHeight = 90;
  const ramp = (lo, hi, x) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  const surface = (w, h, read = false) => {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const context = canvas.getContext("2d", read ? {willReadFrequently:true} : {});
    if (!context) throw new Error("Beauty Canvas 2D unavailable");
    return {canvas, context};
  };
  return {
    setStrength(value) {
      const number = Number(value);
      strength = Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
    },
    getState() { return {strength, lastDurationMs, method:"skin-tone-softening"}; },
    process(source) {
      if (!strength) return source;
      const started = performance.now();
      buffers ??= {
        source:surface(width,height), soft:surface(width,height),
        sample:surface(sampleWidth,sampleHeight,true), mask:surface(sampleWidth,sampleHeight),
      };
      const b = buffers;
      const sw = source.videoWidth || source.naturalWidth || source.width;
      const sh = source.videoHeight || source.naturalHeight || source.height;
      if (!sw || !sh) return source;
      const scale = Math.max(width/sw, height/sh);
      // Snapshot once so the colour sample and softened overlay cannot straddle
      // two camera frames. Completed Lite pairs already supply a fixed canvas.
      b.source.context.clearRect(0,0,width,height);
      b.source.context.drawImage(source,(width-sw*scale)/2,(height-sh*scale)/2,sw*scale,sh*scale);
      b.sample.context.drawImage(b.source.canvas,0,0,sampleWidth,sampleHeight);
      const pixels = b.sample.context.getImageData(0,0,sampleWidth,sampleHeight).data;
      b.mask.image ??= b.mask.context.createImageData(sampleWidth,sampleHeight);
      const mask = b.mask.image.data;
      const luminance = i => .299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2];
      for (let y=0; y<sampleHeight; y++) for (let x=0; x<sampleWidth; x++) {
        const i=(y*sampleWidth+x)*4;
        const r=pixels[i], g=pixels[i+1], blue=pixels[i+2];
        const luma=luminance(i);
        const cb=128-.168736*r-.331264*g+.5*blue;
        const cr=128+.5*r-.418688*g-.081312*blue;
        const skin=ramp(72,92,cb)*(1-ramp(126,140,cb))*
          ramp(130,143,cr)*(1-ramp(174,187,cr))*
          ramp(16,42,luma)*(1-ramp(235,253,luma));
        // Reduce smoothing around strong detail such as eyes, lips and hair.
        const contrast=Math.max(
          x>0?Math.abs(luma-luminance(i-4)):0,
          x+1<sampleWidth?Math.abs(luma-luminance(i+4)):0,
          y>0?Math.abs(luma-luminance(i-sampleWidth*4)):0,
          y+1<sampleHeight?Math.abs(luma-luminance(i+sampleWidth*4)):0,
        );
        mask[i]=mask[i+1]=mask[i+2]=255;
        mask[i+3]=Math.round(255*.45*(strength/100)*skin*(1-ramp(8,30,contrast)));
      }
      b.mask.context.putImageData(b.mask.image,0,0);
      const soft=b.soft.context;
      soft.save();
      try {
        soft.clearRect(0,0,width,height);
        soft.filter="blur(1.2px)";
        soft.drawImage(b.source.canvas,0,0);
        soft.filter="none";
        soft.globalCompositeOperation="destination-in";
        soft.drawImage(b.mask.canvas,0,0,width,height);
      } finally { soft.restore(); }
      b.source.context.drawImage(b.soft.canvas,0,0);
      lastDurationMs=Number((performance.now()-started).toFixed(1));
      return b.source.canvas;
    },
    destroy() {
      if (buffers) for (const buffer of Object.values(buffers)) {
        buffer.canvas.width=buffer.canvas.height=0;
      }
      buffers=null;
    },
  };
}
