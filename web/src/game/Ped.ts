import * as THREE from 'three';
import { Character, OUTFITS, randomOutfit } from './Character';
import { World } from './World';
import { clamp, dampAngle, rand } from './utils';

export type PedKind = 'civ' | 'cop' | 'gang';
export type PedState = 'walk' | 'flee' | 'dead' | 'chase' | 'idle';

export interface PedContext {
  world: World;
  dt: number;
  playerX: number;
  playerZ: number;
  playerAlive: boolean;
  playerInVehicle: boolean;
  wanted: number;
  /** ped wants to fire at the player; game resolves hit/miss and effects */
  fire: (p: Ped) => void;
  hasLineOfSight: (x: number, z: number) => boolean;
}

export class Ped {
  char: Character;
  root: THREE.Group;
  state: PedState = 'walk';
  health = 100;
  yaw = 0;
  speed = 0;
  loop: [number, number][] = [];
  loopIdx = 0;
  loopDir = 1;
  fleeX = 0;
  fleeZ = 0;
  stateT = 0;
  deadT = 0;
  fireCd = 0;
  hostile = false;
  armed = false;
  missionTarget = false;
  knockX = 0;
  knockZ = 0;
  money = 0;
  homeX = 0;
  homeZ = 0;

  constructor(public kind: PedKind) {
    this.char = new Character(kind === 'cop' ? OUTFITS.cop : kind === 'gang' ? { ...OUTFITS.gang, skin: randomOutfit().skin } : randomOutfit());
    this.root = this.char.root;
    this.armed = kind !== 'civ';
    this.char.gun.visible = this.armed;
  }

  get x() { return this.root.position.x; }
  get z() { return this.root.position.z; }
  get alive() { return this.state !== 'dead'; }

  spawn(x: number, z: number, world: World) {
    this.root.position.set(x, world.groundHeight(x, z), z);
    this.health = this.kind === 'cop' ? 120 : this.kind === 'gang' ? 110 : 100;
    this.state = this.kind === 'gang' ? 'idle' : 'walk';
    this.char.revive();
    this.hostile = false;
    this.missionTarget = false;
    this.deadT = 0;
    this.knockX = this.knockZ = 0;
    this.money = Math.random() < 0.6 ? Math.floor(rand(5, 60)) : 0;
    this.homeX = x;
    this.homeZ = z;
    this.setLoopFromPosition(world);
  }

  setLoopFromPosition(world: World) {
    const b = world.blockAt(this.x, this.z);
    if (!b) return;
    this.loop = world.sidewalkLoop(b.i, b.j);
    this.loopDir = Math.random() < 0.5 ? 1 : -1;
    // start at the nearest corner
    let best = 0, bd = Infinity;
    this.loop.forEach(([cx, cz], k) => {
      const d = (cx - this.x) ** 2 + (cz - this.z) ** 2;
      if (d < bd) { bd = d; best = k; }
    });
    this.loopIdx = best;
  }

  /** Returns true if this hit killed the ped. */
  takeDamage(amount: number, fromX: number, fromZ: number, knock = 0): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    const dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.knockX = (dx / d) * knock;
    this.knockZ = (dz / d) * knock;
    if (this.health <= 0) {
      this.state = 'dead';
      this.char.dead = true;
      this.yaw = Math.atan2(-dx, -dz); // fall away from the hit
      this.root.rotation.y = this.yaw;
      return true;
    }
    if (this.kind === 'civ') this.panic(fromX, fromZ);
    else this.hostile = true;
    return false;
  }

  panic(fromX: number, fromZ: number) {
    if (!this.alive || this.kind !== 'civ') return;
    this.state = 'flee';
    this.fleeX = fromX;
    this.fleeZ = fromZ;
    this.stateT = rand(5, 9);
  }

  update(ctx: PedContext) {
    const { dt, world } = ctx;
    const p = this.root.position;

    if (this.knockX || this.knockZ) {
      p.x += this.knockX * dt;
      p.z += this.knockZ * dt;
      this.knockX *= Math.max(0, 1 - 5 * dt);
      this.knockZ *= Math.max(0, 1 - 5 * dt);
      if (Math.abs(this.knockX) + Math.abs(this.knockZ) < 0.2) this.knockX = this.knockZ = 0;
      world.collide(p, 0.35, 0);
    }

    if (this.state === 'dead') {
      this.deadT += dt;
      this.char.animate(dt, 0);
      return;
    }

    let tx = this.x, tz = this.z, spd = 0;
    this.fireCd -= dt;
    const pdx = ctx.playerX - this.x, pdz = ctx.playerZ - this.z;
    const pdist = Math.hypot(pdx, pdz);
    let aiming = false;

    if (this.kind === 'cop' && ctx.wanted > 0 && ctx.playerAlive) this.state = 'chase';
    if (this.kind === 'cop' && ctx.wanted === 0 && this.state === 'chase') { this.state = 'walk'; this.setLoopFromPosition(world); }
    if (this.kind === 'gang' && this.hostile && ctx.playerAlive) this.state = 'chase';
    if (this.kind === 'gang' && (!this.hostile || !ctx.playerAlive) && this.state === 'chase') this.state = 'idle';

    switch (this.state) {
      case 'walk': {
        if (!this.loop.length) { this.state = 'idle'; break; }
        const [cx, cz] = this.loop[this.loopIdx];
        tx = cx; tz = cz;
        spd = 1.4;
        if ((cx - this.x) ** 2 + (cz - this.z) ** 2 < 0.6) this.loopIdx = (this.loopIdx + this.loopDir + 4) % 4;
        break;
      }
      case 'idle': {
        // gang members loiter around their spot
        const hx = this.homeX - this.x, hz = this.homeZ - this.z;
        if (hx * hx + hz * hz > 9) { tx = this.homeX; tz = this.homeZ; spd = 1.2; }
        else this.yaw = dampAngle(this.yaw, Math.atan2(pdx, pdz), 1, dt);
        break;
      }
      case 'flee': {
        const dx = this.x - this.fleeX, dz = this.z - this.fleeZ;
        const d = Math.hypot(dx, dz) || 1;
        tx = this.x + (dx / d) * 5;
        tz = this.z + (dz / d) * 5;
        spd = 5.5;
        this.stateT -= dt;
        if (this.stateT <= 0) { this.state = 'walk'; this.setLoopFromPosition(world); }
        break;
      }
      case 'chase': {
        const shootRange = this.kind === 'cop' ? 28 : 32;
        const willShoot = this.armed && (this.kind === 'gang' || ctx.wanted >= 2) && pdist < shootRange && pdist > 2.5;
        if (willShoot && ctx.hasLineOfSight(this.x, this.z)) {
          aiming = true;
          this.yaw = dampAngle(this.yaw, Math.atan2(pdx, pdz), 10, dt);
          if (pdist > 14) { tx = ctx.playerX; tz = ctx.playerZ; spd = 2.5; }
          if (this.fireCd <= 0) {
            this.fireCd = this.kind === 'cop' ? clamp(1.3 - ctx.wanted * 0.15, 0.45, 1.3) : 0.9;
            ctx.fire(this);
          }
        } else if (pdist > 1.1) {
          tx = ctx.playerX; tz = ctx.playerZ;
          spd = this.kind === 'cop' ? 6.4 : 5.5;
        }
        break;
      }
    }

    if (spd > 0) {
      const dx = tx - this.x, dz = tz - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, spd * dt);
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
        if (!aiming) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 8, dt);
      }
      world.collide(p, 0.35, 0);
    }
    this.speed = spd;
    p.y = world.groundHeight(p.x, p.z);
    this.root.rotation.y = this.yaw;
    this.char.animate(dt, spd, { aiming });
  }
}
