import * as THREE from 'three';
import { waveHeight } from './water.js';

// ---------------------------------------------------------------------------
// Flight tuning (arcade, not a simulator)
// ---------------------------------------------------------------------------
const MAX_SPEED = 70;          // m/s at full throttle in level flight
const THRUST = 22;             // m/s² at full throttle
const AIR_DRAG = THRUST / (MAX_SPEED * MAX_SPEED);
const WATER_DRAG = AIR_DRAG * 2.2;
const STALL_SPEED = 24;        // below this the wings stop holding you up
const PITCH_RATE = 0.85;       // rad/s
const ROLL_RATE = 2.0;         // rad/s
const TURN_RATE = 0.9;         // how hard banking turns the plane
const WATER_TURN_RATE = 0.7;   // steering while taxiing
const THROTTLE_RATE = 0.5;     // per second
const FLOAT_HEIGHT = 1.9;      // fuselage height above the water when floating
const CEILING = 320;
const WORLD_RADIUS = 360;      // planes turn back past this (water ends at 400)

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Model (nose points +z)
// ---------------------------------------------------------------------------
function buildModel(mat) {
  const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const plane = new THREE.Group();
  const body = mat(0xe6dfcf);
  const red = mat(0xb5332c);
  const dark = mat(0x2b2f36);
  const glass = new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.15, metalness: 0.6 });

  const fuselage = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 7, 12), body));
  fuselage.rotation.x = Math.PI / 2;
  fuselage.scale.set(1, 1, 1.1); // slightly taller than wide
  plane.add(fuselage);

  const nose = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.75, 0.9, 12), red));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 3.9;
  plane.add(nose);

  const cockpit = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.6), glass));
  cockpit.position.set(0, 0.75, 1.2);
  plane.add(cockpit);

  const wing = shadowed(new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 1.8), red));
  wing.position.set(0, 0.85, 0.9);
  plane.add(wing);

  const stab = shadowed(new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 1.0), red));
  stab.position.set(0, 0.25, -3.2);
  plane.add(stab);

  const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 1.2), red));
  fin.position.set(0, 1.0, -3.2);
  plane.add(fin);

  // Propeller
  const prop = new THREE.Group();
  prop.position.z = 4.4;
  const hub = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 10), dark));
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.15;
  prop.add(hub);
  for (const angle of [0, Math.PI / 2]) {
    const blade = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.06), dark));
    blade.rotation.z = angle;
    prop.add(blade);
  }
  plane.add(prop);

  // Floats + struts
  for (const side of [-1, 1]) {
    const float = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 6), body));
    float.position.set(side * 1.6, -1.8, 0.4);
    plane.add(float);
    const floatNose = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.3, 0.9, 4), body));
    floatNose.rotation.x = Math.PI / 2;
    floatNose.rotation.y = Math.PI / 4;
    floatNose.position.set(side * 1.6, -1.8, 3.85);
    plane.add(floatNose);
    for (const z of [-0.8, 1.8]) {
      const strut = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), dark));
      strut.position.set(side * 1.05, -0.9, z);
      strut.rotation.z = side * 0.55;
      plane.add(strut);
    }
  }

  return { plane, prop };
}

// ---------------------------------------------------------------------------
// Seaplane with arcade flight physics
// ---------------------------------------------------------------------------
export class Seaplane {
  /**
   * @param {object} opts
   * @param {(x:number, z:number) => boolean} opts.isOpenWater  can the plane float at x, z?
   * @param {(x:number, z:number) => number} opts.groundHeight  terrain height (below sea level offshore)
   * @param {(x:number, y:number, z:number) => boolean} opts.hitsObstacle  lighthouse, trees, dock, boats...
   */
  constructor({ x, z, heading = 0, waterLevel, mat, isOpenWater, groundHeight, hitsObstacle }) {
    const parts = buildModel(mat);
    this.mesh = parts.plane;
    this.prop = parts.prop;
    this.waterLevel = waterLevel;
    this.isOpenWater = isOpenWater;
    this.groundHeight = groundHeight;
    this.hitsObstacle = hitsObstacle;
    this.home = { x, z, heading };

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.reset();
  }

  /** Put the plane back at its mooring, engine off. */
  reset() {
    this.position.set(this.home.x, this.waterLevel + FLOAT_HEIGHT, this.home.z);
    this.heading = this.home.heading; // used while on the water
    this.waterPitch = 0;              // nose-up angle while on the water
    this.quaternion.setFromAxisAngle(Y_AXIS, this.heading);
    this.speed = 0;
    this.throttle = 0;
    this.verticalSpeed = 0;           // extra sink when stalling
    this.onWater = true;
    this.stalling = false;
  }

  get x() { return this.position.x; }
  get z() { return this.position.z; }
  get altitude() { return this.position.y - this.waterLevel; }
  get outOfBounds() { return Math.hypot(this.position.x, this.position.z) > WORLD_RADIUS; }

  forward(out = new THREE.Vector3()) {
    return out.copy(Z_AXIS).applyQuaternion(this.quaternion);
  }

  /** Heading in radians from the nose direction (0 = +z). */
  get yaw() {
    const f = this.forward(_v);
    return Math.atan2(f.x, f.z);
  }

  /** Positive = banked right (right wing down). */
  get bank() {
    // The plane's right is local -x
    const right = _v.set(-1, 0, 0).applyQuaternion(this.quaternion);
    return Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1));
  }

  /**
   * @param {{pitch:number, roll:number, throttle:number}|null} input
   *   pitch +1 = nose up, roll +1 = bank/steer right, throttle +1 = more power
   * @returns {null | 'crash'} 'crash' if the plane crashed this frame
   */
  update(dt, time, input) {
    const pitchIn = input ? input.pitch : 0;
    const rollIn = input ? input.roll : 0;
    if (input && input.throttle) {
      this.throttle = THREE.MathUtils.clamp(this.throttle + input.throttle * THROTTLE_RATE * dt, 0, 1);
    }
    this.prop.rotation.z += (this.throttle > 0 ? 6 + this.throttle * 45 : 0) * dt;

    return this.onWater ? this.updateOnWater(dt, time, pitchIn, rollIn) : this.updateInAir(dt, pitchIn, rollIn);
  }

  updateOnWater(dt, time, pitchIn, rollIn) {
    // Speed: thrust against heavy water drag
    this.speed += (this.throttle * THRUST - WATER_DRAG * this.speed * Math.abs(this.speed) - 0.4 * this.speed) * dt;

    // Steering with the water rudder
    const newHeading = this.heading - rollIn * WATER_TURN_RATE * (0.3 + Math.min(this.speed, 15) / 15) * dt;
    if (this.fits(this.position.x, this.position.z, newHeading)) this.heading = newHeading;

    // You can only lift the nose once you're going fast enough
    const canRotate = this.speed > STALL_SPEED * 0.85;
    const targetPitch = canRotate && pitchIn > 0 ? 0.15 : 0;
    this.waterPitch += (targetPitch - this.waterPitch) * Math.min(1, dt * 2);

    // Move, bouncing off the shore / dock / rocks
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const nx = this.position.x + fx * this.speed * dt;
    const nz = this.position.z + fz * this.speed * dt;
    if (this.fits(nx, nz, this.heading)) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      this.speed = -this.speed * 0.3;
    }

    // Ride the waves
    const x = this.position.x, z = this.position.z;
    const h = waveHeight(x, z, time);
    const pitchWave = (waveHeight(x - fx * 3, z - fz * 3, time) - waveHeight(x + fx * 3, z + fz * 3, time)) * 0.1;
    const rx = fz * 1.6, rz = -fx * 1.6;
    const rollWave = (waveHeight(x + rx, z + rz, time) - waveHeight(x - rx, z - rz, time)) * 0.25;
    this.position.y = this.waterLevel + h + FLOAT_HEIGHT;

    const e = new THREE.Euler(pitchWave - this.waterPitch, this.heading, rollWave, 'YXZ');
    this.quaternion.setFromEuler(e);

    // Take off!
    if (this.speed >= STALL_SPEED && this.waterPitch > 0.1) {
      this.onWater = false;
      this.verticalSpeed = 0;
      this.position.y += 0.3;
    }

    this.stalling = false;
    this.syncMesh();
    return null;
  }

  updateInAir(dt, pitchIn, rollIn) {
    const forward = this.forward();
    const lift = smoothstep(STALL_SPEED * 0.6, STALL_SPEED, this.speed); // 0 = stalled, 1 = flying
    const authority = THREE.MathUtils.clamp(this.speed / STALL_SPEED, 0.25, 1);
    this.stalling = lift < 0.99;

    // Speed: thrust, drag, and gravity when climbing / diving
    this.speed += (this.throttle * THRUST - AIR_DRAG * this.speed * this.speed - 9.8 * forward.y) * dt;
    this.speed = Math.max(this.speed, 0);

    // Pitch and roll around the plane's own axes
    // Stalls drop the nose (until it's pointing ~35° down, so you regain speed)
    const stallDrop = (1 - lift) * 1.2 * smoothstep(-0.6, -0.2, forward.y);
    const pitch = -pitchIn * PITCH_RATE * authority + stallDrop;
    const bank = this.bank;
    const roll = rollIn !== 0 ? rollIn * ROLL_RATE * authority : -bank * 0.8; // auto-level when you let go
    this.quaternion.multiply(_q.setFromAxisAngle(X_AXIS, pitch * dt));
    this.quaternion.multiply(_q.setFromAxisAngle(Z_AXIS, roll * dt));

    // Banking turns the plane (around the world's up axis)
    this.quaternion.premultiply(_q.setFromAxisAngle(Y_AXIS, -Math.sin(bank) * TURN_RATE * lift * dt));

    // Past the edge of the map, gently turn back toward the island
    if (Math.hypot(this.position.x, this.position.z) > WORLD_RADIUS) {
      const back = Math.atan2(-this.position.x, -this.position.z);
      const diff = Math.atan2(Math.sin(back - this.yaw), Math.cos(back - this.yaw));
      this.quaternion.premultiply(_q.setFromAxisAngle(Y_AXIS, Math.sign(diff) * 0.8 * dt));
    }
    this.quaternion.normalize();

    // Move along the nose, sinking when stalled
    this.verticalSpeed += (-9.8 * (1 - lift)) * dt;
    this.verticalSpeed += (0 - this.verticalSpeed) * lift * Math.min(1, dt * 2);
    this.verticalSpeed = Math.max(this.verticalSpeed, -12);
    this.forward(forward);
    this.position.addScaledVector(forward, this.speed * dt);
    this.position.y += this.verticalSpeed * dt;
    if (this.position.y > this.waterLevel + CEILING) this.position.y = this.waterLevel + CEILING;

    this.syncMesh();

    // --- Ground / water contact
    const { x, y, z } = this.position;
    if (this.hitsObstacle(x, y, z)) return this.crash();

    const ground = this.groundHeight(x, z);
    const surface = this.waterLevel + FLOAT_HEIGHT;
    if (ground + 2 > surface && y < ground + 2) return this.crash(); // hit the island or beach
    if (y <= surface) {
      const descent = forward.y * this.speed + this.verticalSpeed;
      const gentle = descent > -7 && forward.y > -0.3 && Math.abs(this.bank) < 0.35;
      if (!gentle || !this.isOpenWater(x, z)) return this.crash();
      // Splashdown
      this.onWater = true;
      this.heading = this.yaw;
      this.waterPitch = Math.max(0, Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)));
      this.speed *= 0.75;
      this.verticalSpeed = 0;
      this.position.y = surface;
    }
    return null;
  }

  crash() {
    this.reset();
    this.syncMesh();
    return 'crash';
  }

  /** Nose and tail must both be in open water while floating. */
  fits(x, z, heading) {
    const fx = Math.sin(heading) * 4, fz = Math.cos(heading) * 4;
    return this.isOpenWater(x, z) && this.isOpenWater(x + fx, z + fz) && this.isOpenWater(x - fx, z - fz);
  }

  syncMesh() {
    this.mesh.position.copy(this.position);
    this.mesh.quaternion.copy(this.quaternion);
  }
}
