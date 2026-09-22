// The finishing pass of the "toon" look. It works on the finished picture (already tone-mapped, in display
// colours) plus the depth and normals the ambient-occlusion pass has drawn anyway:
//   - ink: a warm dark line wherever depth or surface direction jumps, thinning out with distance;
//   - cel: light gathered into a few soft-edged bands, as if laid down in flat washes;
//   - warmth: shadows lifted towards plum and umber, highlights towards cream, a little more colour;
//   - paper: a breath of grain and a gentle vignette.

import * as THREE from 'three';

export const ToonShader = {
  name: 'JevToon',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 9000 },
    uInk: { value: 1 },
    uCel: { value: 0.8 },
    uNight: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float uInk;
    uniform float uCel;
    uniform float uNight;
    uniform float uTime;
    varying vec2 vUv;

    float away(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
    vec3 facing(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float raw = texture2D(tDepth, vUv).x;
      float sky = step(0.99995, raw);
      float d = away(vUv);

      // --- Ink: a cross of four taps, a little over a pixel apart.
      vec2 px = 1.25 / resolution;
      float dA = away(vUv + px);
      float dB = away(vUv - px);
      float dC = away(vUv + vec2(-px.x, px.y));
      float dD = away(vUv + vec2(px.x, -px.y));
      float nearest = min(min(dA, dB), min(dC, dD));
      float depthEdge = smoothstep(0.035, 0.11, (abs(dA - dB) + abs(dC - dD)) / max(nearest, 0.2));
      float turnEdge = smoothstep(0.55, 1.15, length(facing(vUv + px) - facing(vUv - px)) + length(facing(vUv + vec2(-px.x, px.y)) - facing(vUv + vec2(px.x, -px.y))));
      // Far away every window would become a blot: the line fades as things recede.
      float edge = max(depthEdge, turnEdge * (1.0 - sky)) * (1.0 - smoothstep(120.0, 700.0, nearest));

      // --- Cel: gather the light into bands with soft edges. The sky keeps most of its gradient, and so does
      // whatever is within arm's reach: flat washes suit a town, not a face sixty centimetres away.
      float y = luma(c);
      float bands = mix(5.0, 4.0, uNight);
      float b = y * bands;
      float near = 1.0 - smoothstep(1.2, 5.0, nearest);
      float q = (floor(b) + smoothstep(mix(0.32, 0.0, near), mix(0.68, 1.0, near), fract(b))) / bands;
      vec3 flat_ = c * (q / max(y, 0.004));
      c = mix(c, flat_, uCel * (1.0 - sky * 0.75));

      // --- Warmth: white balance, then a split tone.
      // The sky keeps its blue: warmth is for what the sun falls on.
      float warm = (1.0 - uNight * 0.7) * (1.0 - sky * 0.75);
      c *= mix(vec3(1.0), vec3(1.075, 1.0, 0.885), warm);
      float l = luma(c);
      c += vec3(0.085, 0.04, 0.062) * (1.0 - smoothstep(0.0, 0.55, l)) * warm;
      c = mix(c, c * vec3(1.03, 0.975, 0.86), smoothstep(0.5, 1.0, l) * warm);
      c = mix(vec3(luma(c)), c, 1.2 + sky * 0.25);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);

      // --- The line itself: warm sepia by day, deep blue at night; never pure black.
      vec3 ink = mix(vec3(0.17, 0.085, 0.075), vec3(0.03, 0.04, 0.09), uNight);
      c = mix(c, ink, edge * uInk * 0.92);

      // --- Paper.
      vec2 v = vUv - 0.5;
      c *= 1.0 - dot(v, v) * 0.55;
      c += (grain(vUv * resolution + uTime) - 0.5) * 0.028;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
