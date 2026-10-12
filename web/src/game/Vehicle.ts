import * as THREE from 'three';
import { BoxBuilder, recolor } from './geom';
import { World, HALF_ROAD, LANE } from './World';
import { clamp, damp, pick, wrapAngle } from './utils';

export type VehicleKind = 'sedan' | 'sports' | 'muscle' | 'van' | 'taxi' | 'police' | 'pickup' | 'armored';

interface Spec {
  name: string;
  len: number;
  wid: number;
  maxSpeed: number;
  accel: number;
  handling: number;
  mass: number;
  health: number;
  colors: number[];
}

export const SPECS: Record<VehicleKind, Spec> = {
  sedan: { name: 'Cruiser', len: 4.4, wid: 2.0, maxSpeed: 34, accel: 11, handling: 2.0, mass: 1, health: 100, colors: [0xc0392b, 0x2980b9, 0x7f8c8d, 0xecf0f1, 0x27ae60, 0x2c3e50, 0x8e44ad, 0xd35400] },
  sports: { name: 'Vortex GT', len: 4.3, wid: 2.0, maxSpeed: 50, accel: 18, handling: 2.5, mass: 0.9, health: 90, colors: [0xe74c3c, 0xf1c40f, 0x1abc9c, 0x111111, 0xff6b00] },
  muscle: { name: 'Stallion', len: 4.7, wid: 2.1, maxSpeed: 43, accel: 15, handling: 1.9, mass: 1.1, health: 110, colors: [0x111111, 0x8e1b1b, 0x1f4e79, 0xf39c12, 0x4a6741] },
  van: { name: 'Hauler', len: 5.2, wid: 2.2, maxSpeed: 28, accel: 8, handling: 1.6, mass: 1.6, health: 130, colors: [0xffffff, 0xbdc3c7, 0x95a5a6, 0x2c3e50, 0xa04000] },
  taxi: { name: 'Sunvale Cab', len: 4.5, wid: 2.0, maxSpeed: 35, accel: 11, handling: 2.0, mass: 1, health: 100, colors: [0xf7c600] },
  police: { name: 'SVPD Patrol', len: 4.6, wid: 2.05, maxSpeed: 45, accel: 15, handling: 2.3, mass: 1.2, health: 140, colors: [0x111111] },
  pickup: { name: 'Rancher', len: 5.0, wid: 2.1, maxSpeed: 32, accel: 10, handling: 1.8, mass: 1.3, health: 120, colors: [0x6d4c41, 0x1b5e20, 0xbf360c, 0x546e7a, 0xf5f5f5] },
  armored: { name: 'Armored Van', len: 5.6, wid: 2.4, maxSpeed: 30, accel: 9, handling: 1.5, mass: 3, health: 400, colors: [0x37474f] },
};

export const CIVILIAN_KINDS: VehicleKind[] = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'pickup', 'muscle', 'sports'];

export const vehicleMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const wreckMat = new THREE.MeshLambertMaterial({ color: 0x1e1e1e });
const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 10);
wheelGeo.rotateZ(Math.PI / 2);
const redMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
const blueMat = new THREE.MeshBasicMaterial({ color: 0x1a5cff });
const offMat = new THREE.MeshBasicMaterial({ color: 0x333333 });

export type Driver = 'none' | 'ai' | 'player' | 'police';

export interface Controls {
  throttle: number;
  steer: number;
  handbrake: boolean;
}

let nextId = 1;

export class Vehicle {
  id = nextId++;
  root = new THREE.Group();
  spec: Spec;
  body: THREE.Mesh;
  lights: THREE.Mesh;
  wheels: THREE.Object3D[] = [];
  frontPivots: THREE.Group[] = [];
  sirenRed?: THREE.Mesh;
  sirenBlue?: THREE.Mesh;
  color: THREE.Color;

  yaw = 0;
  speed = 0; // signed speed along forward
  velX = 0;
  velZ = 0;
  steerVis = 0;
  health: number;
  wrecked = false;
  wreckT = 0;
  burning = 0;
  driver: Driver = 'none';
  sirenOn = false;
  sirenT = 0;
  missionTarget = false;
  lastImpact = 0;
  /** seconds since a player interaction (for despawn rules) */
  idleFar = 0;
  persistent = false;

  // AI state
  fromI = 0; fromJ = 0; toI = 0; toJ = 0;
  tx = 0; tz = 0;
  phase: 'lane' | 'turn' = 'lane';
  cruise = 14;
  blockedT = 0;
  stuckT = 0;
  reverseT = 0;
  honkT = 0;
  copsInside = 0;

  constructor(public kind: VehicleKind, color?: number) {
    this.spec = SPECS[kind];
    this.health = this.spec.health;
    this.color = new THREE.Color(color ?? pick(this.spec.colors));
    const { len, wid } = this.spec;
    const b = new BoxBuilder();
    const lb = new BoxBuilder();
    const glass = 0x1c2833;
    const trim = 0x2b2b2b;
    const c = this.color.getHex();
    const hl = 0xfffbe0, tl = 0xff2a2a;

    const bodyH = kind === 'sports' ? 0.5 : 0.62;
    const lift = 0.3;
    b.addBox(0, lift, 0, wid, bodyH, len, c);
    b.addBox(0, lift - 0.05, len / 2 + 0.05, wid * 0.98, 0.25, 0.18, trim);
    b.addBox(0, lift - 0.05, -len / 2 - 0.05, wid * 0.98, 0.25, 0.18, trim);
    const top = lift + bodyH;

    if (kind === 'van' || kind === 'armored') {
      b.addBox(0, top, -0.35, wid * 0.98, 1.25, len * 0.8, c);
      b.addBox(0, top + 0.15, len * 0.4 - 0.3 + 0.02, wid * 0.9, 0.7, 0.05, glass);
      b.addBox(wid / 2 + 0.01, top + 0.2, len * 0.28, 0.02, 0.6, 0.9, glass);
      b.addBox(-wid / 2 - 0.01, top + 0.2, len * 0.28, 0.02, 0.6, 0.9, glass);
      if (kind === 'armored') b.addBox(0, top + 0.3, -len * 0.2, wid + 0.02, 0.4, 1.5, 0xc9a227);
    } else if (kind === 'pickup') {
      b.addBox(0, top, len * 0.1, wid * 0.9, 0.7, len * 0.36, glass);
      b.addBox(0, top + 0.7, len * 0.1, wid * 0.92, 0.08, len * 0.34, c);
      b.addBox(wid / 2 - 0.08, top, -len * 0.27, 0.12, 0.4, len * 0.42, c);
      b.addBox(-wid / 2 + 0.08, top, -len * 0.27, 0.12, 0.4, len * 0.42, c);
      b.addBox(0, top, -len / 2 + 0.06, wid, 0.4, 0.12, c);
    } else {
      const cabLen = kind === 'sports' ? len * 0.4 : len * 0.5;
      const cabH = kind === 'sports' ? 0.45 : 0.6;
      const cabZ = kind === 'sports' ? -0.25 : -0.15;
      b.addBox(0, top, cabZ, wid * 0.86, cabH, cabLen, glass);
      b.addBox(0, top + cabH, cabZ, wid * 0.88, 0.08, cabLen * 0.92, c);
      if (kind === 'police') {
        b.addBox(0, lift + 0.15, 0, wid + 0.02, 0.32, len * 0.5, 0xf5f5f5);
        b.addBox(0, top + cabH + 0.08, cabZ, 0.5, 0.1, 0.5, 0x222222);
      }
      if (kind === 'taxi') {
        b.addBox(0, top + cabH + 0.08, cabZ, 0.9, 0.28, 0.35, 0xffffff);
        b.addBox(wid / 2 + 0.01, lift + 0.2, 0, 0.02, 0.15, len * 0.7, 0x111111);
        b.addBox(-wid / 2 - 0.01, lift + 0.2, 0, 0.02, 0.15, len * 0.7, 0x111111);
      }
      if (kind === 'sports') b.addBox(0, top + 0.1, -len / 2 + 0.25, wid * 0.9, 0.08, 0.35, trim); // spoiler
      if (kind === 'muscle') b.addBox(0, top, len * 0.3, 0.6, 0.15, 0.9, trim); // hood scoop
    }
    // lights
    for (const sx of [-1, 1]) {
      lb.addBox(sx * wid * 0.33, lift + bodyH * 0.45, len / 2 + 0.01, 0.42, 0.18, 0.06, hl);
      lb.addBox(sx * wid * 0.36, lift + bodyH * 0.45, -len / 2 - 0.01, 0.38, 0.16, 0.06, tl);
    }

    this.body = new THREE.Mesh(b.build(), vehicleMat);
    this.body.castShadow = true;
    this.lights = new THREE.Mesh(lb.build(), lightMat);
    this.root.add(this.body, this.lights);

    if (kind === 'police') {
      const sy = top + 0.6 + 0.08;
      const zc = -0.15;
      this.sirenRed = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), offMat);
      this.sirenRed.position.set(-0.32, sy + 0.08, zc);
      this.sirenBlue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.3), offMat);
      this.sirenBlue.position.set(0.32, sy + 0.08, zc);
      this.root.add(this.sirenRed, this.sirenBlue);
    }

    const wx = wid / 2 - 0.12, wz = len / 2 - 0.85;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      if (sz > 0) {
        const p = new THREE.Group();
        p.position.set(sx * wx, 0.4, sz * wz);
        p.add(w);
        this.frontPivots.push(p);
        this.root.add(p);
      } else {
        w.position.set(sx * wx, 0.4, sz * wz);
        this.root.add(w);
      }
      this.wheels.push(w);
    }
  }

  get x() { return this.root.position.x; }
  get z() { return this.root.position.z; }
  get fwdX() { return Math.sin(this.yaw); }
  get fwdZ() { return Math.cos(this.yaw); }

  place(x: number, z: number, yaw: number) {
    this.root.position.set(x, 0, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.speed = 0;
    this.velX = this.velZ = 0;
  }

  /** Two collision circles along the body. */
  circles(): [number, number, number][] {
    const off = this.spec.len * 0.28;
    const r = this.spec.wid * 0.52;
    return [
      [this.x + this.fwdX * off, this.z + this.fwdZ * off, r],
      [this.x - this.fwdX * off, this.z - this.fwdZ * off, r],
    ];
  }

  repaint(hex: number) {
    const to = new THREE.Color(hex);
    recolor(this.body.geometry, this.color, to);
    this.color = to;
  }

  repair() {
    this.health = this.spec.health;
    this.burning = 0;
  }

  /** Arcade driving model. Returns the strength of any wall impact this frame. */
  update(dt: number, c: Controls, world: World): number {
    const s = this.spec;
    if (this.wrecked) {
      c = { throttle: 0, steer: 0, handbrake: true };
    }
    let speed = this.speed;
    if (c.throttle > 0) {
      if (speed < -0.5) speed += 28 * dt * c.throttle;
      else speed += s.accel * c.throttle * dt * (1 - Math.max(0, speed) / s.maxSpeed * 0.6);
    } else if (c.throttle < 0) {
      if (speed > 0.5) speed += 28 * dt * c.throttle;
      else speed += s.accel * 0.6 * c.throttle * dt;
    } else {
      const drag = 5 * dt;
      speed = Math.abs(speed) < drag ? 0 : speed - Math.sign(speed) * drag;
    }
    if (c.handbrake) {
      const hb = 14 * dt;
      speed = Math.abs(speed) < hb ? 0 : speed - Math.sign(speed) * hb;
    }
    speed = clamp(speed, -12, s.maxSpeed);
    // off-road (sand) slows you down
    if (Math.abs(this.x) > 330 || Math.abs(this.z) > 330) speed *= 1 - 0.6 * dt;
    this.speed = speed;

    const speedFactor = clamp(Math.abs(speed) / 6, 0, 1) * Math.sign(speed);
    const highSpeedDamp = 1 - 0.45 * clamp(Math.abs(speed) / s.maxSpeed, 0, 1);
    const yawRate = c.steer * s.handling * speedFactor * highSpeedDamp * (c.handbrake ? 1.5 : 1);
    this.yaw -= yawRate * dt;

    // velocity lags the heading for a slidey, arcade feel
    const grip = c.handbrake ? 1.6 : 7;
    const tx = this.fwdX * speed, tz = this.fwdZ * speed;
    this.velX = damp(this.velX, tx, grip, dt);
    this.velZ = damp(this.velZ, tz, grip, dt);

    const p = this.root.position;
    p.x += this.velX * dt;
    p.z += this.velZ * dt;

    // world collision with two circles
    let impact = 0;
    const off = s.len * 0.28;
    const r = s.wid * 0.52;
    for (const sgn of [1, -1]) {
      const cpt = { x: p.x + this.fwdX * off * sgn, z: p.z + this.fwdZ * off * sgn };
      const [px, pz] = world.collide(cpt, r, 0.2);
      if (px || pz) {
        p.x += px;
        p.z += pz;
        const len = Math.hypot(px, pz);
        const nx = px / len, nz = pz / len;
        const vn = this.velX * nx + this.velZ * nz;
        if (vn < 0) {
          this.velX -= nx * vn * 1.4;
          this.velZ -= nz * vn * 1.4;
          impact = Math.max(impact, -vn);
          const fwdDot = Math.abs(this.fwdX * nx + this.fwdZ * nz);
          this.speed *= 1 - 0.7 * fwdDot;
        }
      }
    }
    if (impact > 6) this.damage(impact * 1.6);

    const gy = world.groundHeight(p.x, p.z);
    p.y = damp(p.y, gy, 20, dt);
    this.root.rotation.y = this.yaw;
    // body roll/pitch for juice
    this.body.rotation.z = damp(this.body.rotation.z, -yawRate * 0.04 * Math.abs(speed) / 10, 6, dt);
    this.body.rotation.x = damp(this.body.rotation.x, -c.throttle * 0.02, 4, dt);

    this.steerVis = damp(this.steerVis, -c.steer * 0.5, 10, dt);
    for (const fp of this.frontPivots) fp.rotation.y = this.steerVis;
    const roll = (speed * dt) / 0.4;
    for (const w of this.wheels) w.rotation.x += roll;

    if (this.sirenRed && this.sirenBlue) {
      this.sirenT += dt;
      const on = this.sirenOn && Math.floor(this.sirenT * 6) % 2 === 0;
      this.sirenRed.material = this.sirenOn ? (on ? redMat : offMat) : offMat;
      this.sirenBlue.material = this.sirenOn ? (!on ? blueMat : offMat) : offMat;
    }
    this.lastImpact = impact;
    return impact;
  }

  damage(amount: number) {
    if (this.wrecked) return;
    this.health -= amount;
    if (this.health <= 0) this.health = 0;
  }

  wreck() {
    this.wrecked = true;
    this.body.material = wreckMat;
    this.lights.visible = false;
    this.sirenOn = false;
    this.speed *= 0.3;
  }

  // ------------------------------------------------------------- AI

  /** Sets the AI on a lane from node (fi,fj) toward (ti,tj). */
  setRoute(world: World, fi: number, fj: number, ti: number, tj: number, startOnLane = true) {
    this.fromI = fi; this.fromJ = fj; this.toI = ti; this.toJ = tj;
    const [ex, ez] = this.laneEnd(world);
    this.tx = ex; this.tz = ez;
    this.phase = 'lane';
    if (startOnLane) {
      const [sx, sz] = this.laneStart(world);
      this.place(sx, sz, Math.atan2(ex - sx, ez - sz));
    }
  }

  private laneDir(world: World) {
    const [ax, az] = world.nodePos(this.fromI, this.fromJ);
    const [bx, bz] = world.nodePos(this.toI, this.toJ);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    return { ax, az, bx, bz, dx, dz, rx: -dz, rz: dx };
  }

  laneStart(world: World): [number, number] {
    const { ax, az, dx, dz, rx, rz } = this.laneDir(world);
    return [ax + dx * (HALF_ROAD + 1) + rx * LANE, az + dz * (HALF_ROAD + 1) + rz * LANE];
  }

  laneEnd(world: World): [number, number] {
    const { bx, bz, dx, dz, rx, rz } = this.laneDir(world);
    return [bx - dx * (HALF_ROAD + 2) + rx * LANE, bz - dz * (HALF_ROAD + 2) + rz * LANE];
  }

  private advanceRoute(world: World, chooser?: (opts: [number, number][]) => [number, number]) {
    if (this.phase === 'lane') {
      const opts = world.neighbors(this.toI, this.toJ).filter(([i, j]) => !(i === this.fromI && j === this.fromJ));
      const next = chooser ? chooser(opts.length ? opts : [[this.fromI, this.fromJ]]) : pick(opts.length ? opts : [[this.fromI, this.fromJ]]);
      this.fromI = this.toI; this.fromJ = this.toJ;
      this.toI = next[0]; this.toJ = next[1];
      const [sx, sz] = this.laneStart(world);
      this.tx = sx; this.tz = sz;
      this.phase = 'turn';
    } else {
      const [ex, ez] = this.laneEnd(world);
      this.tx = ex; this.tz = ez;
      this.phase = 'lane';
    }
  }

  /**
   * Traffic / pursuit brain. `blocked` = something is right in front of us.
   * `chase` = optional world position to pursue (police).
   */
  aiControls(dt: number, world: World, blocked: boolean, chase?: { x: number; z: number; direct: boolean }): Controls {
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      return { throttle: -1, steer: this.stuckT > 0 ? 1 : -1, handbrake: false };
    }
    let tx = this.tx, tz = this.tz;
    const direct = chase && chase.direct;
    if (direct) { tx = chase.x; tz = chase.z; }
    const dx = tx - this.x, dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (!direct && dist < 4.5) {
      const chooser = chase
        ? (opts: [number, number][]) => {
          const [pi, pj] = world.nearestNode(chase.x, chase.z);
          let best = opts[0], bd = Infinity;
          for (const o of opts) {
            const d = Math.abs(o[0] - pi) + Math.abs(o[1] - pj) + Math.random() * 0.5;
            if (d < bd) { bd = d; best = o; }
          }
          return best;
        }
        : undefined;
      this.advanceRoute(world, chooser);
    }
    const desired = Math.atan2(dx, dz);
    const err = wrapAngle(desired - this.yaw);
    const steer = clamp(-err * 2.2, -1, 1);
    let target = chase ? 30 : this.cruise;
    if (!direct && this.phase === 'lane' && dist < 18) target = Math.min(target, chase ? 14 : 8);
    if (Math.abs(err) > 0.6) target = Math.min(target, chase ? 12 : 6);
    if (direct && dist < 10) target = Math.min(target, dist * 1.5);
    if (blocked) {
      target = 0;
      this.blockedT += dt;
    } else this.blockedT = 0;

    let throttle = 0;
    if (this.speed < target - 1) throttle = 1;
    else if (this.speed > target + 1.5) throttle = -1;

    // stuck detection: wants to move but isn't
    if (throttle > 0 && Math.abs(this.speed) < 1.2 && !blocked) {
      this.stuckT += dt;
      if (this.stuckT > 1.5) {
        this.reverseT = 1.2;
        this.stuckT = Math.random() < 0.5 ? 0 : 0.01;
      }
    } else if (Math.abs(this.speed) > 3) this.stuckT = 0;

    return { throttle, steer, handbrake: blocked && this.speed < 2 };
  }
}
