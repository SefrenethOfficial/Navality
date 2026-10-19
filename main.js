import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createWater } from './water.js';
import { SailBoat } from './boat.js';
import { Seaplane } from './plane.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WALK_RADIUS = 57;      // how far from the centre you can walk on the island
const WATER_LEVEL = -1.2;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 6;
const SPRINT_SPEED = 11;
const JUMP_SPEED = 7;
const GRAVITY = 20;

// Dock (walkable rectangle sticking out of the island)
const DOCK = { minX: -3, maxX: 3, minZ: 50, maxZ: 95 };
const LH = { x: -32, z: -30 }; // lighthouse position

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const SKY_TOP = new THREE.Color(0x2f7fd0);
const SKY_HORIZON = new THREE.Color(0xcfe6f2);

const scene = new THREE.Scene();
scene.background = SKY_HORIZON.clone();
scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 120, 430);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);
camera.position.set(0, EYE_HEIGHT, 25);
camera.lookAt(0, EYE_HEIGHT, 80);

// ---------------------------------------------------------------------------
// Lighting (low afternoon sun out over the harbour)
// ---------------------------------------------------------------------------
const SUN_DIR = new THREE.Vector3(40, 45, 120).normalize();

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6a5a3a, 0.85));

const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
sun.position.copy(SUN_DIR).multiplyScalar(140);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 300 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun);

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: SKY_TOP },
      uHorizon: { value: SKY_HORIZON },
      uSunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uHorizon, uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(uHorizon, uTop, pow(clamp(d.y, 0.0, 1.0), 0.6));
        float s = max(dot(d, uSunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * (pow(s, 8.0) * 0.35 + pow(s, 1500.0) * 8.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
);
sky.renderOrder = -1;
scene.add(sky);

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function loadTex(file, repeat = [1, 1]) {
  const tex = loader.load(`textures/${file}`);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}
const grassTex = loadTex('grass.jpg');
const dirtTex = loadTex('dirt.jpg');
const sandTex = loadTex('sand.jpg');
const leavesTex = loadTex('leaves.jpg', [3, 1.5]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const boxColliders = [];    // { minX, maxX, minZ, maxZ }
const circleColliders = []; // { x, z, r }

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts });
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Small seeded RNG so the island looks the same every load
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Island terrain: flat top, wobbly beach sloping into the sea.
// Grass, dirt and sand are blended in the shader by position.
// ---------------------------------------------------------------------------
function shoreStart(x, z) {
  const a = Math.atan2(z, x);
  return 62 + 2.5 * Math.sin(3 * a) + 1.5 * Math.sin(7 * a + 1);
}
function terrainHeight(x, z) {
  const s = shoreStart(x, z);
  return -3.5 * smoothstep(s, s + 12, Math.hypot(x, z));
}

const terrainGeo = new THREE.RingGeometry(0.001, 84, 200, 72);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  terrainGeo.computeVertexNormals();
}

const terrainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
terrainMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, {
    tGrass: { value: grassTex },
    tDirt: { value: dirtTex },
    tSand: { value: sandTex },
    uLighthouse: { value: new THREE.Vector2(LH.x, LH.z) },
  });

  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPos = position;');

  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', /* glsl */ `
      #include <common>
      uniform sampler2D tGrass, tDirt, tSand;
      uniform vec2 uLighthouse;
      varying vec3 vTerrainPos;
      float thash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float tnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(thash(i), thash(i + vec2(1, 0)), u.x), mix(thash(i + vec2(0, 1)), thash(i + vec2(1, 1)), u.x), u.y);
      }
      float tfbm(vec2 p) { return 0.5 * tnoise(p) + 0.3 * tnoise(p * 2.1 + 7.3) + 0.2 * tnoise(p * 4.3 + 3.1); }
    `)
    .replace('#include <map_fragment>', /* glsl */ `
      vec2 wp = vTerrainPos.xz;
      float macro = tfbm(wp * 0.03);
      float n = tfbm(wp * 0.15) * 2.0 - 1.0;

      // Two scales of each texture hide the tiling
      vec3 grass = mix(texture2D(tGrass, wp / 7.0).rgb, texture2D(tGrass, wp / 23.0 + 0.37).rgb, 0.35);
      grass *= mix(0.82, 1.12, macro);
      vec3 dirt = mix(texture2D(tDirt, wp / 5.0).rgb, texture2D(tDirt, wp / 17.0 + 0.5).rgb, 0.3) * 1.15;
      vec3 sand = mix(texture2D(tSand, wp / 4.0).rgb, texture2D(tSand, wp / 13.0 + 0.5).rgb, 0.4);

      // Beach ring follows the wobbly shoreline
      float r = length(wp);
      float ang = atan(wp.y, wp.x);
      float shore = 62.0 + 2.5 * sin(3.0 * ang) + 1.5 * sin(7.0 * ang + 1.0);
      float sandW = smoothstep(shore - 10.0, shore - 6.0, r + n * 2.5);

      // Dirt: random patches, a winding path to the dock, ground around the lighthouse
      float patches = smoothstep(0.6, 0.72, tfbm(wp * 0.04 + 17.0) + n * 0.04);
      float pathX = wp.x - sin(wp.y * 0.12) * 2.2 * (1.0 - smoothstep(38.0, 52.0, wp.y));
      float path = (1.0 - smoothstep(1.3, 2.6, abs(pathX) + n * 0.7)) * smoothstep(3.0, 8.0, wp.y);
      float lh = 1.0 - smoothstep(4.5, 8.0, length(wp - uLighthouse) + n * 1.2);
      float dirtW = clamp(max(max(patches, path), lh), 0.0, 1.0);

      vec3 col = mix(grass, dirt, dirtW);
      col = mix(col, sand, sandW);
      col *= mix(1.0, 0.6, smoothstep(-0.7, -1.6, vTerrainPos.y)); // wet sand
      diffuseColor.rgb *= col;
    `);
};

const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

// Sea floor beyond the island
const seabedTex = loadTex('sand.jpg', [90, 90]);
const seabed = new THREE.Mesh(
  new THREE.CircleGeometry(460, 64),
  new THREE.MeshStandardMaterial({ map: seabedTex, color: 0x9a9a9a, roughness: 1 })
);
seabed.rotation.x = -Math.PI / 2;
seabed.position.y = -3.52;
scene.add(seabed);

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
const water = createWater({ sunDir: SUN_DIR, skyTop: SKY_TOP, skyHorizon: SKY_HORIZON });
water.position.y = WATER_LEVEL;
scene.add(water);

// ---------------------------------------------------------------------------
// Dock
// ---------------------------------------------------------------------------
const wood = mat(0x8a6038);
const darkWood = mat(0x5e3f22);

const deckLength = DOCK.maxZ - DOCK.minZ;
const deck = shadowed(new THREE.Mesh(
  new THREE.BoxGeometry(DOCK.maxX - DOCK.minX, 0.3, deckLength),
  wood
));
deck.position.set(0, -0.15, (DOCK.minZ + DOCK.maxZ) / 2);
scene.add(deck);

for (let z = DOCK.minZ + 4; z <= DOCK.maxZ; z += 5) {
  for (const x of [DOCK.minX + 0.2, DOCK.maxX - 0.2]) {
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5, 8), darkWood));
    post.position.set(x, -2.3, z);
    scene.add(post);
  }
}

// ---------------------------------------------------------------------------
// Crates
// ---------------------------------------------------------------------------
const crateMat = mat(0xa8773f);
function addCrate(x, z, size = 1.4, y = 0, rotY = 0) {
  const crate = shadowed(new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat));
  crate.position.set(x, y + size / 2, z);
  crate.rotation.y = rotY;
  scene.add(crate);
  if (y === 0) {
    const h = size / 2 + 0.1;
    boxColliders.push({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h });
  }
}
addCrate(6, 48);
addCrate(7.5, 48.3, 1.4, 0, 0.3);
addCrate(6.6, 48.1, 1.2, 1.4, 0.6);
addCrate(-6, 46, 1.6);
addCrate(1.8, 80, 1.1);
addCrate(-1.9, 88, 1.0, 0, 0.5);

// ---------------------------------------------------------------------------
// Lighthouse
// ---------------------------------------------------------------------------
const lighthouse = new THREE.Group();
const segments = 4, segH = 4, rBottom = 3, rTop = 2.1;
for (let i = 0; i < segments; i++) {
  const r0 = rBottom - ((rBottom - rTop) * i) / segments;
  const r1 = rBottom - ((rBottom - rTop) * (i + 1)) / segments;
  const seg = shadowed(new THREE.Mesh(
    new THREE.CylinderGeometry(r1, r0, segH, 24),
    mat(i % 2 === 0 ? 0xf2f2f2 : 0xc9332e)
  ));
  seg.position.y = segH * i + segH / 2;
  lighthouse.add(seg);
}
const topY = segments * segH;
const gallery = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.3, 24), mat(0x333333)));
gallery.position.y = topY + 0.15;
lighthouse.add(gallery);

const lamp = new THREE.Mesh(
  new THREE.CylinderGeometry(1.6, 1.6, 2, 16),
  new THREE.MeshStandardMaterial({ color: 0xfff4b0, emissive: 0xffd65a, emissiveIntensity: 1.5 })
);
lamp.position.y = topY + 1.3;
lighthouse.add(lamp);

const cap = shadowed(new THREE.Mesh(new THREE.ConeGeometry(2.2, 2, 16), mat(0x333333)));
cap.position.y = topY + 3.3;
lighthouse.add(cap);

const lampLight = new THREE.PointLight(0xffd65a, 40, 40);
lampLight.position.y = topY + 1.3;
lighthouse.add(lampLight);

lighthouse.position.set(LH.x, 0, LH.z);
scene.add(lighthouse);
circleColliders.push({ x: LH.x, z: LH.z, r: rBottom + 0.1, h: topY + 4.5 });

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------
const trunkMat = mat(0x6b4a2b);
const leafMats = [0xffffff, 0xd8ebc6, 0xbcd8a4].map(
  (c) => new THREE.MeshStandardMaterial({ map: leavesTex, color: c, roughness: 0.8 })
);
function addTree(x, z) {
  const scale = 0.8 + rand() * 0.7;
  const tree = new THREE.Group();
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 2.4, 6), trunkMat));
  trunk.position.y = 1.2;
  tree.add(trunk);
  const leafMat = leafMats[Math.floor(rand() * leafMats.length)];
  for (let i = 0; i < 3; i++) {
    const cone = shadowed(new THREE.Mesh(new THREE.ConeGeometry(2 - i * 0.5, 2.4, 9), leafMat));
    cone.position.y = 2.6 + i * 1.2;
    tree.add(cone);
  }
  tree.scale.setScalar(scale);
  tree.rotation.y = rand() * Math.PI;
  tree.position.set(x, 0, z);
  scene.add(tree);
  circleColliders.push({ x, z, r: 0.45 * scale, h: 8.5 * scale });
}

let placed = 0, attempts = 0;
while (placed < 45 && attempts < 1000) {
  attempts++;
  const a = rand() * Math.PI * 2;
  const d = 8 + rand() * 38;
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  if (Math.abs(x) < 10 && z > 0) continue;            // keep the path to the dock clear
  if (Math.hypot(x - LH.x, z - LH.z) < 9) continue;   // not on the lighthouse
  if (circleColliders.some((c) => Math.hypot(c.x - x, c.z - z) < 3)) continue;
  addTree(x, z);
  placed++;
}

// ---------------------------------------------------------------------------
// Rocks in the shallows (decoration only)
// ---------------------------------------------------------------------------
const rockMat = mat(0x7b7f86);
const rocks = []; // { x, z, r } so boats can bump into them
for (let i = 0; i < 25; i++) {
  const a = rand() * Math.PI * 2;
  const d = 66 + rand() * 14;
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  if (Math.abs(x) < 14 && z > 40) continue; // keep the harbour clear
  const size = 0.8 + rand() * 1.8;
  const rock = shadowed(new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockMat));
  rock.position.set(x, WATER_LEVEL - 0.3, z);
  rocks.push({ x, z, r: size });
  rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
  scene.add(rock);
}

// ---------------------------------------------------------------------------
// Sailboat
// ---------------------------------------------------------------------------
const WORLD_RADIUS = 400;

/** Can a boat hull be at x, z? (deep enough, not hitting the dock or rocks) */
function isOpenWater(x, z) {
  const r = Math.hypot(x, z);
  if (r > WORLD_RADIUS) return false;
  if (r < shoreStart(x, z) + 6.5) return false; // too shallow near the beach
  if (x > DOCK.minX - 1.6 && x < DOCK.maxX + 1.6 && z > DOCK.minZ - 1.6 && z < DOCK.maxZ + 1.6) return false;
  for (const rock of rocks) {
    if (Math.hypot(x - rock.x, z - rock.z) < rock.r + 1.3) return false;
  }
  return true;
}

const boat = new SailBoat({
  x: 6.2, z: 78, heading: 0,
  waterLevel: WATER_LEVEL, mat, darkWood, isOpenWater,
});
scene.add(boat.mesh);

// Wind slowly shifts direction and strength. angle = direction it blows TO.
const wind = { angle: 0, strength: 1 };
function updateWind(t) {
  wind.angle = Math.PI * 0.5 + Math.sin(t * 0.03) * 0.35;
  wind.strength = 0.85 + Math.sin(t * 0.07) * 0.15;
}

// ---------------------------------------------------------------------------
// Seaplane
// ---------------------------------------------------------------------------
/** Would a plane at x, y, z hit something solid? (wings ~5.5 m each side) */
function hitsObstacle(x, y, z) {
  const WING = 5;
  for (const c of circleColliders) {
    if (y < c.h && Math.hypot(x - c.x, z - c.z) < c.r + WING) return true;
  }
  if (y < 1.5 && x > DOCK.minX - WING && x < DOCK.maxX + WING && z > DOCK.minZ - WING && z < DOCK.maxZ + WING) return true;
  if (y < WATER_LEVEL + 9 && Math.hypot(x - boat.x, z - boat.z) < 4.5 + WING) return true;
  return false;
}

const plane = new Seaplane({
  x: -9.5, z: 76, heading: 0,
  waterLevel: WATER_LEVEL, mat, isOpenWater, groundHeight: terrainHeight, hitsObstacle,
});
scene.add(plane.mesh);

// ---------------------------------------------------------------------------
// Collision / walkable area
// ---------------------------------------------------------------------------
function isWalkable(x, z) {
  const onIsland = x * x + z * z <= WALK_RADIUS ** 2;
  const onDock =
    x >= DOCK.minX + PLAYER_RADIUS && x <= DOCK.maxX - PLAYER_RADIUS &&
    z >= DOCK.minZ && z <= DOCK.maxZ - PLAYER_RADIUS;
  return onIsland || onDock;
}

function collides(x, z) {
  for (const c of circleColliders) {
    if (Math.hypot(x - c.x, z - c.z) < c.r + PLAYER_RADIUS) return true;
  }
  for (const b of boxColliders) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    if (Math.hypot(x - cx, z - cz) < PLAYER_RADIUS) return true;
  }
  return false;
}

const canStand = (x, z) => isWalkable(x, z) && !collides(x, z);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const controls = new PointerLockControls(camera, document.body);
const $ = (id) => document.getElementById(id);
const overlay = $('overlay');
const hud = $('hud');
const promptEl = $('prompt');
const crosshair = $('crosshair');
const sailHud = $('sailhud');
const windArrow = $('wind-arrow');
const speedEl = $('speed');
const sailEl = $('sail');
const trimEl = $('trim');
const flightHud = $('flighthud');
const airspeedEl = $('airspeed');
const altitudeEl = $('altitude');
const throttleEl = $('throttle');
const throttleBar = $('throttle-bar');
const flightWarnEl = $('flight-warn');

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

let mode = 'walk'; // 'walk', 'sail' or 'fly'
const keys = {};
let velocityY = 0;
let onGround = true;

// Chase camera (used in the boat and the plane)
const chase = { yaw: 0, pitch: 0.32, dist: 18 };
const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3();

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!controls.isLocked) return;
  if (e.code === 'Space' && mode === 'walk' && onGround) {
    velocityY = JUMP_SPEED;
    onGround = false;
  }
  if (e.code === 'KeyE' && !e.repeat) {
    if (mode === 'walk') {
      const v = nearestVehicle();
      if (v === 'plane') enterPlane();
      else if (v === 'boat') enterBoat();
    } else {
      leaveVehicle();
    }
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

document.addEventListener('mousemove', (e) => {
  if (mode === 'walk' || !controls.isLocked) return;
  chase.yaw -= e.movementX * 0.003;
  chase.pitch = THREE.MathUtils.clamp(chase.pitch + e.movementY * 0.003, -0.4, 1.3);
});
document.addEventListener('wheel', (e) => {
  if (mode === 'walk') return;
  chase.dist = THREE.MathUtils.clamp(chase.dist + e.deltaY * 0.02, 9, 60);
});

// ---------------------------------------------------------------------------
// Getting in and out of vehicles
// ---------------------------------------------------------------------------
let messageUntil = 0;
let message = '';
function flash(text, seconds = 2.5) {
  message = text;
  messageUntil = performance.now() + seconds * 1000;
}

/** 'boat', 'plane' or null, whichever is in reach (closest wins). */
function nearestVehicle() {
  const p = camera.position;
  const dBoat = Math.hypot(p.x - boat.x, p.z - boat.z);
  const dPlane = plane.onWater ? Math.hypot(p.x - plane.x, p.z - plane.z) : Infinity;
  if (dPlane < 9 && dPlane <= dBoat) return 'plane';
  if (dBoat < 7) return 'boat';
  return null;
}

function enterVehicle(newMode, dist) {
  mode = newMode;
  controls.enabled = false;
  chase.yaw = 0;
  chase.pitch = newMode === 'fly' ? 0.2 : 0.32;
  chase.dist = dist;
  crosshair.classList.add('hidden');
  sailHud.classList.toggle('hidden', newMode !== 'sail');
  flightHud.classList.toggle('hidden', newMode !== 'fly');
}
const enterBoat = () => enterVehicle('sail', 18);
const enterPlane = () => enterVehicle('fly', 24);

/** Closest spot on land (island or dock) the player could stand, or null. */
function nearestLanding(x, z) {
  const candidates = [];
  const r = Math.hypot(x, z) || 1;
  const k = (WALK_RADIUS - 1) / r;
  candidates.push({ x: x * k, z: z * k });
  candidates.push({
    x: THREE.MathUtils.clamp(x, DOCK.minX + 0.6, DOCK.maxX - 0.6),
    z: THREE.MathUtils.clamp(z, DOCK.minZ + 0.6, DOCK.maxZ - 0.6),
  });
  let best = null, bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestDist && canStand(c.x, c.z)) { best = c; bestDist = d; }
  }
  return best && bestDist < 16 ? best : null;
}

function canLeave() {
  if (mode === 'fly' && (!plane.onWater || Math.abs(plane.speed) > 4)) return null;
  const v = mode === 'fly' ? plane : boat;
  return nearestLanding(v.x, v.z);
}

function goAshore(spot, lookAt) {
  mode = 'walk';
  controls.enabled = true;
  sailHud.classList.add('hidden');
  flightHud.classList.add('hidden');
  crosshair.classList.remove('hidden');
  velocityY = 0;
  camera.position.set(spot.x, EYE_HEIGHT, spot.z);
  camera.lookAt(lookAt.x, EYE_HEIGHT, lookAt.z);
}

function leaveVehicle() {
  if (mode === 'fly' && !plane.onWater) { flash("You can't jump out mid-air! Land on the water first."); return; }
  if (mode === 'fly' && Math.abs(plane.speed) > 4) { flash('Slow down first (F to cut the throttle).'); return; }
  const spot = canLeave();
  if (!spot) { flash('Too far from land. Get closer to the dock or beach.'); return; }
  goAshore(spot, mode === 'fly' ? plane : boat);
}

function onPlaneCrash() {
  flash('You crashed! The seaplane has been towed back to the dock.', 3.5);
  if (mode === 'fly') {
    const spot = nearestLanding(plane.x, plane.z) || { x: 0, z: DOCK.minZ + 10 };
    goAshore(spot, plane);
  }
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();

function updatePlayer(dt) {
  if (!controls.isLocked) return;

  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  right.crossVectors(forward, camera.up).normalize();

  const mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const mz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const speed = keys.ShiftLeft || keys.ShiftRight ? SPRINT_SPEED : WALK_SPEED;

  move.set(0, 0, 0).addScaledVector(forward, mz).addScaledVector(right, mx);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

  // Move each axis separately so you slide along obstacles instead of sticking
  const p = camera.position;
  if (canStand(p.x + move.x, p.z)) p.x += move.x;
  if (canStand(p.x, p.z + move.z)) p.z += move.z;

  // Gravity / jumping (walkable ground is flat at y = 0 for now)
  velocityY -= GRAVITY * dt;
  let feetY = p.y - EYE_HEIGHT + velocityY * dt;
  if (feetY <= 0) {
    feetY = 0;
    velocityY = 0;
    onGround = true;
  }
  p.y = feetY + EYE_HEIGHT;
}

// ---------------------------------------------------------------------------
// Vehicle input, camera and HUDs
// ---------------------------------------------------------------------------
const axis = (pos, neg) => (pos.some((k) => keys[k]) ? 1 : 0) - (neg.some((k) => keys[k]) ? 1 : 0);

function sailInput() {
  if (mode !== 'sail' || !controls.isLocked) return null;
  return {
    sail: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
    steer: axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']),
  };
}

function flightInput() {
  if (mode !== 'fly' || !controls.isLocked) return null;
  return {
    pitch: axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']), // W = nose down, like pushing a stick
    roll: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']),
    throttle: axis(['KeyR', 'ShiftLeft', 'ShiftRight'], ['KeyF']),
  };
}

function updateChaseCamera(dt, x, y, z, heading, lookHeight) {
  const yaw = heading + chase.yaw;
  const horiz = Math.cos(chase.pitch) * chase.dist;
  camTarget.set(
    x - Math.sin(yaw) * horiz,
    y + 2 + Math.sin(chase.pitch) * chase.dist,
    z - Math.cos(yaw) * horiz
  );
  camTarget.y = Math.max(camTarget.y, WATER_LEVEL + 1); // never dip under the sea
  camera.position.lerp(camTarget, Math.min(1, dt * 5));
  camLook.set(x, y + lookHeight, z);
  camera.lookAt(camLook);
}

function updateSailHud() {
  const rel = Math.atan2(Math.sin(wind.angle - boat.heading), Math.cos(wind.angle - boat.heading));
  // Arrow shows where the wind blows, relative to the bow (up = toward the bow)
  windArrow.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  speedEl.textContent = `${(Math.max(boat.speed, 0) * 1.944).toFixed(1)} kn`;
  sailEl.textContent = `${Math.round(boat.sailLevel * 100)}%`;
  const e = boat.efficiency;
  trimEl.textContent = e < 0.05 ? 'In irons (too close to the wind)' : e > 0.9 ? 'Great angle' : e > 0.75 ? 'Good angle' : 'Weak angle';
}

function updateFlightHud() {
  airspeedEl.textContent = `${(Math.max(plane.speed, 0) * 1.944).toFixed(0)} kn`;
  altitudeEl.textContent = `${Math.max(plane.altitude - 1.9, 0).toFixed(0)} m`;
  throttleEl.textContent = `${Math.round(plane.throttle * 100)}%`;
  throttleBar.style.width = `${plane.throttle * 100}%`;
  let warn = '';
  if (plane.onWater) {
    warn = plane.speed < 20 ? 'On the water. R for throttle, then S to lift off at speed' : 'Fast enough: hold S to take off';
  } else if (plane.stalling) {
    warn = 'STALL! Lower the nose (W) and add throttle';
  } else if (plane.altitude < 15 && plane.forward().y < -0.3) {
    warn = 'PULL UP! Too steep to land';
  }
  flightWarnEl.textContent = warn;
  flightWarnEl.classList.toggle('danger', !plane.onWater && warn !== '');
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
const start = last;

function animate(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = (now - start) / 1000;

  water.update(t);
  updateWind(t);
  boat.update(dt, t, wind, sailInput());
  if (plane.update(dt, t, flightInput()) === 'crash') onPlaneCrash();

  if (mode === 'walk') {
    updatePlayer(dt);
  } else if (mode === 'sail') {
    updateChaseCamera(dt, boat.x, WATER_LEVEL, boat.z, boat.heading, 3);
    updateSailHud();
  } else {
    updateChaseCamera(dt, plane.x, plane.position.y, plane.z, plane.yaw, 1);
    updateFlightHud();
  }
  sky.position.copy(camera.position);

  // Interaction prompt
  let promptText = '';
  if (now < messageUntil) promptText = message;
  else if (mode === 'walk') {
    const v = nearestVehicle();
    if (v === 'plane') promptText = 'Press E to fly the seaplane';
    else if (v === 'boat') promptText = 'Press E to board';
  } else if (canLeave()) promptText = 'Press E to go ashore';
  promptEl.textContent = promptText;
  promptEl.classList.toggle('hidden', !promptText || !controls.isLocked);

  // Slowly pulse the lighthouse lamp
  lampLight.intensity = 30 + Math.sin(t * 2) * 15;

  const p = mode === 'walk' ? camera.position : mode === 'sail' ? boat : plane;
  hud.textContent = `x ${p.x.toFixed(1)}  z ${p.z.toFixed(1)}`;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
