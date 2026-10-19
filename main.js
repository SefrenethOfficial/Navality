import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ISLAND_RADIUS = 60;
const WATER_LEVEL = -1.2;
const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const WALK_SPEED = 6;
const SPRINT_SPEED = 11;
const JUMP_SPEED = 7;
const GRAVITY = 20;

// Dock (walkable rectangle sticking out of the island)
const DOCK = { minX: -3, maxX: 3, minZ: 50, maxZ: 95 };

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = 0x8ec9ef;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, 340);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, EYE_HEIGHT, 25);
camera.lookAt(0, EYE_HEIGHT, 80);

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a4a32, 0.9));

const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 10, far: 260 });
sun.shadow.bias = -0.0005;
scene.add(sun);

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

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------
const sand = shadowed(new THREE.Mesh(
  new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 8, 6, 64),
  mat(0xe3cf95)
));
sand.position.y = -3; // top surface at y = 0
scene.add(sand);

const grass = new THREE.Mesh(new THREE.CircleGeometry(ISLAND_RADIUS - 8, 64), mat(0x6fa84a));
grass.rotation.x = -Math.PI / 2;
grass.position.y = 0.02;
grass.receiveShadow = true;
scene.add(grass);

// ---------------------------------------------------------------------------
// Water (animated low-poly waves)
// ---------------------------------------------------------------------------
const waterGeo = new THREE.PlaneGeometry(800, 800, 120, 120);
waterGeo.rotateX(-Math.PI / 2);
const waterBase = waterGeo.attributes.position.array.slice();
const water = new THREE.Mesh(
  waterGeo,
  new THREE.MeshStandardMaterial({
    color: 0x1e6f9f, roughness: 0.3, metalness: 0.1,
    transparent: true, opacity: 0.92, flatShading: true,
  })
);
water.position.y = WATER_LEVEL;
water.receiveShadow = true;
scene.add(water);

function waveHeight(x, z, t) {
  return (
    Math.sin(x * 0.08 + t * 0.9) * 0.35 +
    Math.sin(z * 0.11 + t * 1.3) * 0.25 +
    Math.sin((x + z) * 0.05 + t * 0.6) * 0.3
  );
}

function updateWater(t) {
  const pos = waterGeo.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i + 1] = waveHeight(waterBase[i], waterBase[i + 2], t);
  }
  waterGeo.attributes.position.needsUpdate = true;
}

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
const LH = { x: -32, z: -30 };
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
circleColliders.push({ x: LH.x, z: LH.z, r: rBottom + 0.1 });

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------
const trunkMat = mat(0x6b4a2b);
const leafMats = [mat(0x3f7f3a), mat(0x4e9442), mat(0x356b30)];
function addTree(x, z) {
  const scale = 0.8 + rand() * 0.7;
  const tree = new THREE.Group();
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 2.4, 6), trunkMat));
  trunk.position.y = 1.2;
  tree.add(trunk);
  const leafMat = leafMats[Math.floor(rand() * leafMats.length)];
  for (let i = 0; i < 3; i++) {
    const cone = shadowed(new THREE.Mesh(new THREE.ConeGeometry(2 - i * 0.5, 2.4, 7), leafMat));
    cone.position.y = 2.6 + i * 1.2;
    tree.add(cone);
  }
  tree.scale.setScalar(scale);
  tree.rotation.y = rand() * Math.PI;
  tree.position.set(x, 0, z);
  scene.add(tree);
  circleColliders.push({ x, z, r: 0.45 * scale });
}

let placed = 0, attempts = 0;
while (placed < 45 && attempts < 1000) {
  attempts++;
  const a = rand() * Math.PI * 2;
  const d = 8 + rand() * (ISLAND_RADIUS - 14);
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  if (Math.abs(x) < 10 && z > 15) continue;           // keep path to dock clear
  if (Math.hypot(x - LH.x, z - LH.z) < 8) continue;   // not on the lighthouse
  if (circleColliders.some(c => Math.hypot(c.x - x, c.z - z) < 3)) continue;
  addTree(x, z);
  placed++;
}

// ---------------------------------------------------------------------------
// Rocks in the shallows (decoration only)
// ---------------------------------------------------------------------------
const rockMat = mat(0x7b7f86);
for (let i = 0; i < 25; i++) {
  const a = rand() * Math.PI * 2;
  const d = ISLAND_RADIUS + 3 + rand() * 12;
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  if (Math.abs(x) < 14 && z > 40) continue; // keep the harbour clear
  const rock = shadowed(new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 + rand() * 1.8, 0), rockMat));
  rock.position.set(x, WATER_LEVEL - 0.3, z);
  rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
  scene.add(rock);
}

// ---------------------------------------------------------------------------
// Moored boat (placeholder for the future ship models)
// ---------------------------------------------------------------------------
function createBoat() {
  const boat = new THREE.Group();
  const hull = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 9), mat(0x6b3b1f)));
  hull.position.y = 0.3;
  boat.add(hull);

  const bow = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.2, 1.4, 4, 1), mat(0x6b3b1f)));
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 1.6);
  bow.position.set(0, 0.3, 5.2);
  boat.add(bow);

  const trim = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.2, 9.1), mat(0xe8e1cf)));
  trim.position.y = 1.0;
  boat.add(trim);

  const cabin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2.5), mat(0xe8e1cf)));
  cabin.position.set(0, 1.6, -2.5);
  boat.add(cabin);

  const mast = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 8), darkWood));
  mast.position.set(0, 4.5, 1);
  boat.add(mast);

  const sail = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 5),
    new THREE.MeshStandardMaterial({ color: 0xf5f0e1, side: THREE.DoubleSide, roughness: 0.9 })
  );
  sail.castShadow = true;
  sail.rotation.y = Math.PI / 2;
  sail.position.set(0, 4.6, 2.6);
  boat.add(sail);

  return boat;
}

const boat = createBoat();
const BOAT_POS = { x: 6.2, z: 78 };
boat.position.set(BOAT_POS.x, WATER_LEVEL, BOAT_POS.z);
scene.add(boat);

// ---------------------------------------------------------------------------
// Collision / walkable area
// ---------------------------------------------------------------------------
function isWalkable(x, z) {
  const onIsland = x * x + z * z <= (ISLAND_RADIUS - 1) ** 2;
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
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => overlay.classList.add('hidden'));
controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

const keys = {};
let velocityY = 0;
let onGround = true;

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' && onGround && controls.isLocked) {
    velocityY = JUMP_SPEED;
    onGround = false;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

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

  // Gravity / jumping (ground is flat at y = 0 for now)
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

  updateWater(t);
  updatePlayer(dt);

  // Boat bobs and rolls with the waves
  const h = waveHeight(BOAT_POS.x, BOAT_POS.z, t);
  boat.position.y = WATER_LEVEL + h - 0.2;
  boat.rotation.z = Math.sin(t * 1.1) * 0.04;
  boat.rotation.x = (waveHeight(BOAT_POS.x, BOAT_POS.z + 4, t) - waveHeight(BOAT_POS.x, BOAT_POS.z - 4, t)) * 0.08;

  // Slowly pulse the lighthouse lamp
  lampLight.intensity = 30 + Math.sin(t * 2) * 15;

  const p = camera.position;
  hud.textContent = `x ${p.x.toFixed(1)}  z ${p.z.toFixed(1)}`;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
