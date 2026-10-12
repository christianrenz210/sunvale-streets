import * as THREE from 'three';
import { BoxBuilder } from './geom';
import { pick } from './utils';

/** One shared material for every human in the game: colours live in vertex attributes. */
export const characterMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a1e, 0xffdbac];
const HAIR = [0x1b1b1b, 0x3b2314, 0x6a4e23, 0xb8860b, 0x2b2b2b, 0x888888];
const SHIRT = [0xffffff, 0x2e86de, 0xe74c3c, 0x27ae60, 0xf1c40f, 0x8e44ad, 0x34495e, 0xe67e22, 0x16a085, 0xff7eb6];
const PANTS = [0x2c3e50, 0x1c1c1c, 0x34495e, 0x7f8c8d, 0x3d5a80, 0xa0826d];

export interface Outfit {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
  hat?: number;
  bald?: boolean;
}

export function randomOutfit(): Outfit {
  return {
    skin: pick(SKIN), hair: pick(HAIR), shirt: pick(SHIRT), pants: pick(PANTS),
    shoes: pick([0x111111, 0xffffff, 0x5d4037]), bald: Math.random() < 0.15,
    hat: Math.random() < 0.15 ? pick([0x111111, 0xc0392b, 0x2980b9]) : undefined,
  };
}

export const OUTFITS = {
  player: { skin: 0x8d5524, hair: 0x111111, shirt: 0xffffff, pants: 0x3d5a80, shoes: 0x111111, hat: undefined, bald: false } as Outfit,
  cop: { skin: 0xe0ac69, hair: 0x2b2b2b, shirt: 0x1f3a93, pants: 0x101c40, shoes: 0x111111, hat: 0x101c40 } as Outfit,
  gang: { skin: 0xc68642, hair: 0x111111, shirt: 0x7d3c98, pants: 0x1c1c1c, shoes: 0xffffff, hat: 0x7d3c98 } as Outfit,
};

/**
 * Blocky low-poly human, ~1.8 units tall, origin at the feet, facing +Z.
 * Five meshes: body (torso+head) and four limbs pivoting at shoulders/hips.
 */
export class Character {
  /** Positioned and yawed by the owner. */
  root = new THREE.Group();
  /** Inner pivot used for falling over. */
  pose = new THREE.Group();
  body: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  gun: THREE.Mesh;
  phase = 0;
  dead = false;
  private deathT = 0;

  constructor(public outfit: Outfit) {
    const b = new BoxBuilder();
    b.addBox(0, 0.95, 0, 0.56, 0.62, 0.3, outfit.shirt); // torso
    b.addBox(0, 0.9, 0, 0.58, 0.1, 0.32, outfit.pants); // belt
    b.addBox(0, 1.57, 0, 0.14, 0.08, 0.14, outfit.skin); // neck
    b.addBox(0, 1.62, 0, 0.32, 0.34, 0.32, outfit.skin); // head
    b.addBox(-0.08, 1.8, 0.161, 0.06, 0.05, 0.01, 0x111111); // eyes
    b.addBox(0.08, 1.8, 0.161, 0.06, 0.05, 0.01, 0x111111);
    if (!outfit.bald) b.addBox(0, 1.9, -0.02, 0.34, 0.1, 0.34, outfit.hair);
    if (outfit.hat !== undefined) {
      b.addBox(0, 1.94, 0, 0.36, 0.12, 0.36, outfit.hat);
      b.addBox(0, 1.94, 0.2, 0.34, 0.03, 0.18, outfit.hat);
    }
    this.body = new THREE.Mesh(b.build(), characterMaterial);
    this.root.add(this.pose);
    this.pose.add(this.body);

    const limb = (w: number, len: number, top: number, bottom: number, tip: number) => {
      const lb = new BoxBuilder();
      lb.addBox(0, -len * 0.55, 0, w, len * 0.55, w, top);
      lb.addBox(0, -len, 0, w * 0.95, len * 0.45, w * 0.95, bottom);
      lb.addBox(0, -len - 0.04, 0.03, w * 1.05, 0.08, w * 1.4, tip);
      return lb.build();
    };
    const armGeo = limb(0.16, 0.62, outfit.shirt, outfit.skin, outfit.skin);
    const legGeo = limb(0.21, 0.82, outfit.pants, outfit.pants, outfit.shoes);
    this.armL = new THREE.Mesh(armGeo, characterMaterial);
    this.armR = new THREE.Mesh(armGeo, characterMaterial);
    this.armL.position.set(-0.37, 1.5, 0);
    this.armR.position.set(0.37, 1.5, 0);
    this.legL = new THREE.Mesh(legGeo, characterMaterial);
    this.legR = new THREE.Mesh(legGeo, characterMaterial);
    this.legL.position.set(-0.14, 0.86, 0);
    this.legR.position.set(0.14, 0.86, 0);
    this.pose.add(this.armL, this.armR, this.legL, this.legR);

    const gb = new BoxBuilder();
    // barrel points along the arm (local -Y) so it aims forward when the arm is raised
    gb.addBox(0, -0.34, 0.02, 0.07, 0.34, 0.09, 0x222222);
    gb.addBox(0, -0.1, -0.08, 0.06, 0.08, 0.16, 0x3a2a1a);
    this.gun = new THREE.Mesh(gb.build(), characterMaterial);
    this.gun.position.set(0, -0.56, 0);
    this.gun.visible = false;
    this.armR.add(this.gun);

    this.root.traverse((o) => { o.castShadow = true; });
  }

  /**
   * speed: horizontal speed in m/s; aiming raises the right arm; airborne spreads limbs.
   */
  animate(dt: number, speed: number, opts: { aiming?: boolean; airborne?: boolean; punch?: number } = {}) {
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 3);
      this.pose.rotation.x = -Math.PI / 2 * this.deathT;
      this.body.position.y = -0.15 * this.deathT;
      return;
    }
    const moving = speed > 0.3;
    this.phase += dt * (moving ? 3 + speed * 1.15 : 0);
    const amp = moving ? Math.min(0.9, 0.25 + speed * 0.08) : 0;
    const s = Math.sin(this.phase);
    const target = (m: THREE.Object3D, v: number) => { m.rotation.x += (v - m.rotation.x) * Math.min(1, dt * 14); };
    if (opts.airborne) {
      target(this.legL, -0.5); target(this.legR, 0.3);
      target(this.armL, -2.4); target(this.armR, opts.aiming ? -Math.PI / 2 : -2.4);
    } else {
      target(this.legL, s * amp);
      target(this.legR, -s * amp);
      target(this.armL, -s * amp * 0.8);
      if (opts.aiming) target(this.armR, -Math.PI / 2);
      else if (opts.punch && opts.punch > 0) target(this.armR, -Math.PI / 2 * Math.sin(opts.punch * Math.PI));
      else target(this.armR, s * amp * 0.8);
    }
    this.body.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.05 : 0;
  }

  revive() {
    this.dead = false;
    this.deathT = 0;
    this.pose.rotation.set(0, 0, 0);
    this.body.position.y = 0;
  }

  dispose() {
    this.body.geometry.dispose();
    this.armL.geometry.dispose();
    this.legL.geometry.dispose();
    this.gun.geometry.dispose();
  }
}
