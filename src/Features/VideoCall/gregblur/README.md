# Squidly Gregblur extension

This directory is derived from Gregblur 0.1.3 by Gregory D. Ceccarelli and is
licensed under Apache-2.0. See `LICENSE` and the upstream project at
<https://github.com/gregce/gregblur>.

Squidly adds a native `image` effect mode to Gregblur's WebGL2 pipeline. The
uploaded image is prepared and uploaded once, then selected as the background
texture by Gregblur's final composite shader. Blur and image replacement share
the same joint-bilateral and temporal foreground matte; the image path does not
read mask pixels back to the CPU.

## Squidly integration

`background.js` supplies the MediaPipe segmentation provider, shared face
landmarks, adaptive frame budget, and effect controls. `raw.js` converts an
input `MediaStreamTrack` into frame callbacks and an output track;
`pipeline.js` owns WebGL programs, textures, framebuffers, compositing, and
beauty geometry. The provider's cached result remains alive while Gregblur uses
its borrowed WebGL texture and is closed when replaced or destroyed.

Gregblur uploads the current camera frame on each output update. When
segmentation skips a slot, it may reuse the last mask with newer video. This is
different from the Lite engine's same-source-frame contract. The startup
benchmark compares the resulting local mask age and output cadence, then locks
one engine for the call.

Current Squidly defaults are a 25-pixel blur radius, 2x background downsampling,
joint-bilateral refinement, and a maximum temporal history weight of `0.12`.
History decays with elapsed source time, rejects strong confidence changes, and
resets after a 250 ms gap or a backwards timestamp. Cached masks skip redundant
refinement and history-copy passes.

See [`../README_Background.md`](../README_Background.md) for selection,
resource scheduling, public diagnostics, ownership, and validation.
