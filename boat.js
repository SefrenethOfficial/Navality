import * as THREE from 'three';
import { waveHeight } from './water.js';

// ---------------------------------------------------------------------------
// Sailing tuning
// ---------------------------------------------------------------------------
const MAX_SPEED = 10;        // m/s at full sail on the best point of sail
const ACCEL = 0.45;          // how quickly speed approaches its target
const TURN_RATE = 0.55;      // rad/s at full rudder (scaled by speed)
const SAIL_RATE = 0.6;       // how fast the sail goes up/down (per second)
const HULL_HALF_LENGTH = 4.2;

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}
function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * How well the boat sails for a given angle between the boat's heading and
 * where the wind is blowing to. 0 = wind straight from behind, PI = straight
 * into the wind. Best on a beam reach (wind from the side), nothing in the
 * "no-go zone" pointing into the wind.
 */
export function sailEfficiency(relAngle) {
  const a = Math.abs(relAngle);
  const reach = 0.7 + 0.3 * Math.sin(Math.min(a, Math.PI / 2));
  return reach * (1 - smoothstep(0.7 * Math.PI, 0.8 * Math.PI, a));
}

// ---------------------------------------------------------------------------
// Boat model
// ---------------------------------------------------------------------------
function buildModel(mat, darkWood) {
  const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const boat = new THREE.Group();
  boat.rotation.order = 'YXZ'; // yaw, then pitch, then roll

  const hullMat = mat(0x6b3b1f);
  const hull = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 9), hullMat));
  hull.position.y = 0.3;
  boat.add(hull);

  const bow = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.2, 1.4, 4, 1), hullMat));
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 1.6);
  bow.position.set(0, 0.3, 5.2);
  boat.add(bow);

  const trimMat = mat(0xe8e1cf);
  const trim = shadowed(new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.2, 9.1), trimMat));
  trim.position.y = 1.0;
  boat.add(trim);

  const cabin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2.5), trimMat));
  cabin.position.set(0, 1.6, -2.5);
  boat.add(cabin);

  const mast = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 8), darkWood));
  mast.position.set(0, 4.5, 1);
  boat.add(mast);

  // Boom + sail swing around the mast
  const boomPivot = new THREE.Group();
  boomPivot.position.set(0, 2.5, 1);
  boat.add(boomPivot);

  const boom = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), darkWood));
  boom.rotation.x = Math.PI / 2;
  boom.position.z = -1.7;
  boomPivot.add(boom);

  // Sail grows upward from the boom as it's raised
  const sailGeo = new THREE.PlaneGeometry(3.2, 4.6);
  sailGeo.translate(0, 2.3, 0);
  const sail = new THREE.Mesh(
    sailGeo,
    new THREE.MeshStandardMaterial({ color: 0xf5f0e1, side: THREE.DoubleSide, roughness: 0.9 })
  );
  sail.castShadow = true;
  sail.rotation.y = Math.PI / 2;
  sail.position.set(0, 0.05, -1.65);
  boomPivot.add(sail);

  // Little flag at the top of the mast that points where the wind blows
  const pennantPivot = new THREE.Group();
  pennantPivot.position.set(0, 7.9, 1);
  boat.add(pennantPivot);
  const pennantGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(0, 0, 1.4),
  ]);
  pennantGeo.computeVertexNormals();
  const pennant = new THREE.Mesh(
    pennantGeo,
    new THREE.MeshStandardMaterial({ color: 0xc9332e, side: THREE.DoubleSide })
  );
  pennantPivot.add(pennant);

  return { boat, boomPivot, sail, pennantPivot };
}

// ---------------------------------------------------------------------------
// Boat with sailing physics
// ---------------------------------------------------------------------------
export class SailBoat {
  /**
   * @param {object} opts
   * @param {(x:number, z:number) => boolean} opts.isOpenWater  true if the hull can be at x, z
   */
  constructor({ x, z, heading = 0, waterLevel, mat, darkWood, isOpenWater }) {
    const parts = buildModel(mat, darkWood);
    this.mesh = parts.boat;
    this.boomPivot = parts.boomPivot;
    this.sail = parts.sail;
    this.pennantPivot = parts.pennantPivot;

    this.x = x;
    this.z = z;
    this.heading = heading;  // radians, 0 = facing +z
    this.speed = 0;          // m/s along the heading (negative after bumping)
    this.sailLevel = 0;      // 0 = furled, 1 = fully raised
    this.rudder = 0;         // -1 (right) .. 1 (left)
    this.boomAngle = 0;
    this.efficiency = 0;
    this.waterLevel = waterLevel;
    this.isOpenWater = isOpenWater;

    this.sail.scale.y = 0.06;
    this.mesh.position.set(x, waterLevel, z);
  }

  forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  /** True if the whole hull (bow, middle, stern) fits at this pose. */
  fits(x, z, heading) {
    const fx = Math.sin(heading) * HULL_HALF_LENGTH;
    const fz = Math.cos(heading) * HULL_HALF_LENGTH;
    return this.isOpenWater(x, z) && this.isOpenWater(x + fx, z + fz) && this.isOpenWater(x - fx, z - fz);
  }

  /**
   * @param {number} dt
   * @param {number} time
   * @param {{angle:number, strength:number}} wind  angle = direction the wind blows TO
   * @param {{sail:number, steer:number}|null} input  sail: +1 raise / -1 lower, steer: +1 left / -1 right
   */
  update(dt, time, wind, input) {
    // --- Controls
    const steer = input ? input.steer : 0;
    this.rudder += (steer - this.rudder) * Math.min(1, dt * 4);
    if (input && input.sail) {
      this.sailLevel = THREE.MathUtils.clamp(this.sailLevel + input.sail * SAIL_RATE * dt, 0, 1);
    }

    // --- Wind and speed
    const rel = wrapAngle(wind.angle - this.heading); // 0 = wind from behind
    this.efficiency = sailEfficiency(rel);
    const target = this.sailLevel * this.efficiency * wind.strength * MAX_SPEED;
    this.speed += (target - this.speed) * Math.min(1, ACCEL * dt);

    // --- Steering (works better with speed, but you can always turn slowly)
    const newHeading = this.heading + this.rudder * TURN_RATE * (0.25 + Math.min(Math.abs(this.speed), 6) * 0.13) * dt;
    if (this.fits(this.x, this.z, newHeading)) this.heading = newHeading;

    // --- Move, bouncing off land, the dock and rocks
    const f = this.forward();
    const nx = this.x + f.x * this.speed * dt;
    const nz = this.z + f.z * this.speed * dt;
    if (this.fits(nx, nz, this.heading)) {
      this.x = nx;
      this.z = nz;
    } else {
      this.speed = -this.speed * 0.3;
    }

    // --- Sail visuals: boom swings out to leeward, further when running downwind
    const side = Math.sign(Math.sin(rel)) || 1;
    const targetBoom = -side * Math.min((Math.PI - Math.abs(rel)) * 0.5, 1.35) * (0.3 + 0.7 * this.sailLevel);
    this.boomAngle += (targetBoom - this.boomAngle) * Math.min(1, dt * 2);
    this.boomPivot.rotation.y = this.boomAngle;
    this.sail.scale.y = 0.06 + 0.94 * this.sailLevel;
    this.pennantPivot.rotation.y = wind.angle - this.heading + Math.sin(time * 9) * 0.08;

    // --- Float on the waves
    const bowX = this.x + f.x * 4, bowZ = this.z + f.z * 4;
    const sternX = this.x - f.x * 4, sternZ = this.z - f.z * 4;
    const rx = f.z * 1.5, rz = -f.x * 1.5; // boat's local +x in world space
    const h = waveHeight(this.x, this.z, time);
    const pitch = (waveHeight(sternX, sternZ, time) - waveHeight(bowX, bowZ, time)) * 0.12;
    const roll = (waveHeight(this.x + rx, this.z + rz, time) - waveHeight(this.x - rx, this.z - rz, time)) * 0.3;
    const heel = -side * this.sailLevel * this.efficiency * wind.strength * 0.18; // lean away from the wind

    this.mesh.position.set(this.x, this.waterLevel + h - 0.2, this.z);
    this.mesh.rotation.set(pitch, this.heading, roll + heel);
  }
}
