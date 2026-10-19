import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Wave settings (shared by the GPU shader and the CPU, so boats can float)
// ---------------------------------------------------------------------------
const WAVES = [
  { dir: [1.0, 0.35], steepness: 0.16, length: 38 },
  { dir: [-0.45, 1.0], steepness: 0.13, length: 23 },
  { dir: [0.75, -0.6], steepness: 0.10, length: 13 },
  { dir: [-0.85, -0.35], steepness: 0.07, length: 7.5 },
].map((w) => {
  const len = Math.hypot(w.dir[0], w.dir[1]);
  return { ...w, dir: [w.dir[0] / len, w.dir[1] / len] };
});

const TIME_SCALE = 0.8;

// Waves are calmer close to the island (a sheltered harbour)
const CALM_INNER = 66;
const CALM_OUTER = 150;
const CALM_MIN = 0.3;

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function waveAtten(x, z) {
  return CALM_MIN + (1 - CALM_MIN) * smoothstep(CALM_INNER, CALM_OUTER, Math.hypot(x, z));
}

/** Height of the water surface (relative to the water mesh) at x, z. */
export function waveHeight(x, z, time) {
  const t = time * TIME_SCALE;
  const atten = waveAtten(x, z);
  let y = 0;
  for (const w of WAVES) {
    const k = (2 * Math.PI) / w.length;
    const c = Math.sqrt(9.8 / k);
    const f = k * (w.dir[0] * x + w.dir[1] * z - c * t);
    y += ((w.steepness * atten) / k) * Math.sin(f);
  }
  return y;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const f = (n) => n.toFixed(5);
const waveDefs = WAVES.map(
  (w, i) => `const vec4 W${i} = vec4(${f(w.dir[0])}, ${f(w.dir[1])}, ${f(w.steepness)}, ${f(w.length)});`
).join('\n');
const waveCalls = WAVES.map((_, i) => `gerstner(W${i}, p.xz, atten, t, disp, T, B, ampSum);`).join('\n    ');

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;
  #include <fog_pars_vertex>

  ${waveDefs}

  void gerstner(vec4 w, vec2 p, float atten, float t,
                inout vec3 disp, inout vec3 T, inout vec3 B, inout float ampSum) {
    vec2 d = w.xy;
    float k = 6.2831853 / w.w;
    float c = sqrt(9.8 / k);
    float f = k * (dot(d, p) - c * t);
    float q = w.z * atten;
    float a = q / k;
    float s = sin(f), co = cos(f);
    disp += vec3(d.x * a * co, a * s, d.y * a * co);
    T += vec3(-d.x * d.x * q * s, d.x * q * co, -d.x * d.y * q * s);
    B += vec3(-d.x * d.y * q * s, d.y * q * co, -d.y * d.y * q * s);
    ampSum += a;
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    float t = uTime * ${f(TIME_SCALE)};
    float atten = ${f(CALM_MIN)} + ${f(1 - CALM_MIN)} * smoothstep(${f(CALM_INNER)}, ${f(CALM_OUTER)}, length(p.xz));

    vec3 disp = vec3(0.0);
    vec3 T = vec3(1.0, 0.0, 0.0);
    vec3 B = vec3(0.0, 0.0, 1.0);
    float ampSum = 0.0;
    ${waveCalls}

    vec3 wp = p + disp;
    vWorldPos = wp;
    vNormal = normalize(cross(B, T));
    vCrest = disp.y / max(ampSum, 0.0001) * 0.5 + 0.5; // 0 = trough, 1 = crest

    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;
  #include <common>
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return v;
  }
  float ripples(vec2 p) {
    return fbm(p * 0.35 + uTime * vec2(0.30, 0.12))
         + 0.5 * fbm(p * 0.9 - uTime * vec2(0.18, 0.33));
  }
  vec3 skyColor(vec3 dir) {
    float h = clamp(dir.y, 0.0, 1.0);
    return mix(uSkyHorizon, uSkyTop, pow(h, 0.6));
  }

  void main() {
    vec2 p = vWorldPos.xz;

    // Small ripples layered over the big waves
    float e = 0.12;
    float r0 = ripples(p);
    float rx = ripples(p + vec2(e, 0.0));
    float rz = ripples(p + vec2(0.0, e));
    vec3 N = normalize(normalize(vNormal) + vec3(-(rx - r0) / e, 0.0, -(rz - r0) / e) * 0.3);

    vec3 V = normalize(cameraPosition - vWorldPos);
    float NdotV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

    // Shallow turquoise near the island, deep blue further out
    float dist = length(p);
    float ang = atan(p.y, p.x);
    float shoreR = 66.4 + 2.5 * sin(3.0 * ang) + 1.5 * sin(7.0 * ang + 1.0);
    float shallow = 1.0 - smoothstep(shoreR - 2.0, shoreR + 28.0, dist);
    vec3 water = mix(uDeep, uShallow, shallow * 0.9);

    // Light shining through the wave crests
    float sss = pow(clamp(dot(V, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.45, 1.0, vCrest);
    water += vec3(0.04, 0.32, 0.28) * sss * 0.8;
    water *= 0.6 + 0.4 * max(dot(N, uSunDir), 0.0);

    // Sky reflection
    vec3 col = mix(water, skyColor(reflect(-V, N)), fresnel * 0.9);

    // Sun glints
    vec3 H = normalize(uSunDir + V);
    float NdotH = max(dot(N, H), 0.0);
    col += uSunColor * (pow(NdotH, 400.0) * 8.0 + pow(NdotH, 50.0) * 0.18);

    // Foam on crests and along the shore
    float fn = fbm(p * 0.55 + uTime * vec2(0.25, -0.15));
    float streaks = smoothstep(0.35, 0.75, fbm(p * 1.7 - uTime * vec2(0.2, 0.35)));
    float crestFoam = smoothstep(0.8, 1.0, vCrest + (fn - 0.5) * 0.4) * streaks;
    float d = dist - shoreR;
    float bands = smoothstep(0.55, 1.0, sin(d * 2.0 - uTime * 1.6 + fn * 4.0)) * (1.0 - smoothstep(0.0, 7.0, d));
    float edge = 1.0 - smoothstep(-0.5, 1.8, d);
    float shoreFoam = max(bands * 0.8, edge) * smoothstep(0.25, 0.6, fn + 0.15);
    float foam = clamp(max(crestFoam, shoreFoam), 0.0, 1.0);
    vec3 foamCol = vec3(0.93, 0.97, 1.0) * (0.75 + 0.25 * max(dot(N, uSunDir), 0.0));
    col = mix(col, foamCol, foam * 0.9);

    float alpha = clamp(mix(0.96, 0.72, shallow) + foam * 0.3 + fresnel * 0.2, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ---------------------------------------------------------------------------
// Mesh
// ---------------------------------------------------------------------------
export function createWater({ size = 900, segments = 300, sunDir, skyTop, skyHorizon }) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(0xfff0d0) },
        uDeep: { value: new THREE.Color(0x06324f) },
        uShallow: { value: new THREE.Color(0x1aa6a0) },
        uSkyTop: { value: skyTop.clone() },
        uSkyHorizon: { value: skyHorizon.clone() },
      },
    ]),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // vertices move in the shader
  mesh.update = (time) => { material.uniforms.uTime.value = time; };
  return mesh;
}
