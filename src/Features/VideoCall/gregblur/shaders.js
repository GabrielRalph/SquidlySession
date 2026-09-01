/*
 * Derived from gregblur 0.1.3 by Gregory D. Ceccarelli.
 * Modified for Squidly to support GPU image-background compositing.
 * Licensed under Apache-2.0; see ./LICENSE.
 */

export const VERTEX_SHADER = `#version 300 es
in vec2 position;
out vec2 texCoords;
void main() {
  texCoords = (position + 1.0) / 2.0;
  texCoords.y = 1.0 - texCoords.y;
  gl_Position = vec4(position, 0, 1.0);
}
`;

export const VERTEX_SHADER_NO_FLIP = `#version 300 es
in vec2 position;
out vec2 texCoords;
void main() {
  texCoords = (position + 1.0) / 2.0;
  gl_Position = vec4(position, 0, 1.0);
}
`;

export const BILATERAL_FILTER_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_mask;
uniform sampler2D u_guideFrame;
uniform vec2 u_texelSize;
uniform float u_sigmaSpace;
uniform float u_sigmaColor;
out vec4 fragColor;

void main() {
  vec3 centerColor = texture(u_guideFrame, texCoords).rgb;
  float totalWeight = 0.0;
  float result = 0.0;
  const int RADIUS = 5;

  for (int dy = -RADIUS; dy <= RADIUS; dy++) {
    for (int dx = -RADIUS; dx <= RADIUS; dx++) {
      vec2 offset = vec2(float(dx), float(dy)) * u_texelSize;
      vec2 sampleCoord = texCoords + offset;
      vec3 sampleColor = texture(u_guideFrame, sampleCoord).rgb;
      float sampleMask = 1.0 - texture(u_mask, sampleCoord).r;
      float spatialDist = length(vec2(float(dx), float(dy)));
      float spaceW = exp(
        -(spatialDist * spatialDist) /
        (2.0 * u_sigmaSpace * u_sigmaSpace)
      );
      float colorDist = length(centerColor - sampleColor);
      float colorW = exp(
        -(colorDist * colorDist) /
        (2.0 * u_sigmaColor * u_sigmaColor)
      );
      float weight = spaceW * colorW;
      result += sampleMask * weight;
      totalWeight += weight;
    }
  }

  float refined = result / max(totalWeight, 0.001);
  fragColor = vec4(refined, refined, refined, 1.0);
}
`;

export const TEMPORAL_BLEND_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_currentMask;
uniform sampler2D u_previousMask;
uniform float u_blendFactor;
out vec4 fragColor;
void main() {
  float current = texture(u_currentMask, texCoords).r;
  float previous = texture(u_previousMask, texCoords).r;

  // Keep smoothing for small confidence noise, but stop dragging the previous
  // silhouette through pixels whose foreground probability changed sharply.
  float maskChange = abs(current - previous);
  float motion = smoothstep(0.04, 0.28, maskChange);
  float historyWeight = u_blendFactor * (1.0 - motion);
  float blended = mix(current, previous, historyWeight);
  fragColor = vec4(blended, blended, blended, 1.0);
}
`;

export const COPY_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
  fragColor = texture(u_texture, texCoords);
}
`;

/*
 * One lightweight pass smooths skin inside the detected face region.
 * Eye and mouth regions are protected so the result stays natural.
 */
export const BEAUTY_SHADER = `#version 300 es
precision highp float;
in vec2 texCoords;
uniform sampler2D u_texture;
uniform vec2 u_texelSize;
uniform vec2 u_faceCenter;
uniform vec2 u_faceRadii;
uniform vec2 u_leftEye;
uniform vec2 u_rightEye;
uniform vec2 u_mouth;
uniform float u_strength;
uniform float u_hasFace;
out vec4 fragColor;

float ellipseMask(vec2 point, vec2 center, vec2 radii) {
  return 1.0 - smoothstep(
    0.78,
    1.0,
    length((point - center) / max(radii, vec2(0.0001)))
  );
}

void main() {
  if (u_hasFace < 0.5 || u_strength <= 0.001) {
    fragColor = texture(u_texture, texCoords);
    return;
  }

  vec2 sampleCoords = texCoords;

  vec2 stepSize = u_texelSize * (1.2 + 1.8 * u_strength);
  vec3 center = texture(u_texture, sampleCoords).rgb;
  vec3 blurred = center * 0.28;
  blurred += texture(u_texture, sampleCoords + vec2(stepSize.x, 0.0)).rgb * 0.12;
  blurred += texture(u_texture, sampleCoords - vec2(stepSize.x, 0.0)).rgb * 0.12;
  blurred += texture(u_texture, sampleCoords + vec2(0.0, stepSize.y)).rgb * 0.12;
  blurred += texture(u_texture, sampleCoords - vec2(0.0, stepSize.y)).rgb * 0.12;
  blurred += texture(u_texture, sampleCoords + stepSize).rgb * 0.06;
  blurred += texture(u_texture, sampleCoords - stepSize).rgb * 0.06;
  blurred += texture(
    u_texture,
    sampleCoords + vec2(stepSize.x, -stepSize.y)
  ).rgb * 0.06;
  blurred += texture(
    u_texture,
    sampleCoords + vec2(-stepSize.x, stepSize.y)
  ).rgb * 0.06;

  float face = ellipseMask(texCoords, u_faceCenter, u_faceRadii);
  vec2 eyeRadii = vec2(u_faceRadii.x * 0.24, u_faceRadii.y * 0.13);
  float protectedFeatures = max(
    ellipseMask(texCoords, u_leftEye, eyeRadii),
    ellipseMask(texCoords, u_rightEye, eyeRadii)
  );
  protectedFeatures = max(
    protectedFeatures,
    ellipseMask(
      texCoords,
      u_mouth,
      vec2(u_faceRadii.x * 0.34, u_faceRadii.y * 0.14)
    )
  );

  float detail = smoothstep(0.035, 0.16, length(center - blurred));
  vec3 smoothed = mix(blurred, center, detail * 0.82);
  float smoothAmount =
    face * (1.0 - protectedFeatures) * u_strength * 0.58;
  fragColor = vec4(mix(center, smoothed, smoothAmount), 1.0);
}
`;

export const MASKED_DOWNSAMPLE_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_texture;
uniform sampler2D u_mask;
uniform vec2 u_sourceTexelSize;
out vec4 fragColor;

void main() {
  vec3 result = vec3(0.0);
  float totalWeight = 0.0;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 sampleCoord =
        texCoords + vec2(float(dx), float(dy)) * u_sourceTexelSize;
      float foreground = texture(u_mask, sampleCoord).r;
      float backgroundWeight = 1.0 - smoothstep(0.12, 0.55, foreground);
      result += texture(u_texture, sampleCoord).rgb * backgroundWeight;
      totalWeight += backgroundWeight;
    }
  }

  if (totalWeight < 0.001) {
    result = texture(u_texture, texCoords).rgb;
    totalWeight = 1.0;
  }
  fragColor = vec4(result / totalWeight, 1.0);
}
`;

export const MASK_WEIGHTED_BLUR_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D u_texture;
uniform sampler2D u_mask;
uniform vec2 u_texelSize;
uniform vec2 u_direction;
uniform float u_radius;
out vec4 fragColor;

void main() {
  float sigma = u_radius;
  float twoSigmaSq = 2.0 * sigma * sigma;
  float totalWeight = 0.0;
  vec3 result = vec3(0.0);
  const int MAX_SAMPLES = 16;
  int radius = int(min(float(MAX_SAMPLES), ceil(u_radius)));

  for (int index = -MAX_SAMPLES; index <= MAX_SAMPLES; ++index) {
    float offset = float(index);
    if (abs(offset) > float(radius)) continue;
    float gaussianWeight = exp(-(offset * offset) / twoSigmaSq);
    vec2 sampleCoord = texCoords + u_direction * u_texelSize * offset;
    float maskValue = texture(u_mask, sampleCoord).r;
    float maskWeight = 1.0 - maskValue;
    float weight = gaussianWeight * max(maskWeight, 0.001);
    result += texture(u_texture, sampleCoord).rgb * weight;
    totalWeight += weight;
  }

  fragColor = vec4(result / max(totalWeight, 0.001), 1.0);
}
`;

/*
 * The background sampler accepts either Gregblur's blurred-frame texture or
 * Squidly's uploaded-image texture. Both modes therefore use the exact same
 * bilateral + temporal foreground matte in the final mix.
 */
export const COMPOSITE_SHADER = `#version 300 es
precision mediump float;
in vec2 texCoords;
uniform sampler2D background;
uniform sampler2D frame;
uniform sampler2D mask;
out vec4 fragColor;
void main() {
  vec4 frameTexture = texture(frame, texCoords);
  vec4 backgroundTexture = texture(background, texCoords);
  float maskValue = texture(mask, texCoords).r;
  float alpha = smoothstep(
    0.26,
    0.72,
    clamp(maskValue + 0.035, 0.0, 1.0)
  );
  fragColor = mix(backgroundTexture, frameTexture, alpha);
}
`;
