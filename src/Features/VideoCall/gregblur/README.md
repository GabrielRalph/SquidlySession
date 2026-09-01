# Squidly Gregblur extension

This directory is derived from Gregblur 0.1.3 by Gregory D. Ceccarelli and is
licensed under Apache-2.0. See `LICENSE` and the upstream project at
<https://github.com/gregce/gregblur>.

Squidly adds a native `image` effect mode to Gregblur's WebGL2 pipeline. The
uploaded image is prepared and uploaded once, then selected as the background
texture by Gregblur's final composite shader. Blur and image replacement share
the same joint-bilateral and motion-adaptive temporal foreground matte; the
image path does not read mask pixels back to the CPU. Small confidence changes
retain smoothing, while moving edges favour the newest mask.
