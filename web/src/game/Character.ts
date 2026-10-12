import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BoxBuilder } from './geom';
import { pick, rand } from './utils';

/** Three-step ramp gives the flat, illustrated "vector art" shading. */
function toonRamp() {
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** One shared material for every human in the game: colours live in vertex attributes. */
export const characterMaterial = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });

const SKIN = [0xf6d2b0, 0xeac19a, 0xd9a47a, 0xb97f55, 0x8d5a3b, 0x5e3b26];
const HAIR = [0x1b1b1b, 0x2b1d14, 0x4a2f1b, 0x7a5230, 0xc79a4a, 0x8a8a8a, 0x3d2b1f];
const SHIRT = [0x3446c2, 0xffffff, 0xe74c3c, 0x27ae60, 0xf1c40f, 0x8e44ad, 0x34495e, 0xe67e22, 0x16a085, 0xff7eb6, 0x6c8ebf, 0xf5e6c8];
const PANTS = [0x1c1c1c, 0x2c3e50, 0x34495e, 0x7f8c8d, 0x3d5a80, 0xa0826d, 0x1f2a44];
const SHOES = [0x8fd3f0, 0xffffff, 0x111111, 0x5d4037, 0xe74c3c, 0xf1c40f];

export type HairStyle = 'quiff' | 'short' | 'buzz' | 'long' | 'bun' | 'bald';

export interface Outfit {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
  hat?: number;
  hairStyle?: HairStyle;
  /** polo / undershirt collar colour */
  collar?: number;
  longSleeves?: boolean;
  female?: boolean;
  /** overall scale, ~0.92 .. 1.06 */
  size?: number;
  /** legacy flag from the old blocky outfits */
  bald?: boolean;
}

export function randomOutfit(): Outfit {
  const female = Math.random() < 0.45;
  return {
    skin: pick(SKIN),
    hair: pick(HAIR),
    shirt: pick(SHIRT),
    pants: pick(PANTS),
    shoes: pick(SHOES),
    female,
    hairStyle: female ? pick(['long', 'long', 'bun', 'short'] as const) : pick(['quiff', 'short', 'short', 'buzz', 'bald'] as const),
    collar: Math.random() < 0.5 ? 0xffffff : undefined,
    longSleeves: Math.random() < 0.2,
    hat: !female && Math.random() < 0.12 ? pick([0x111111, 0xc0392b, 0x2980b9]) : undefined,
    size: female ? rand(0.92, 0.99) : rand(0.96, 1.06),
  };
}

export const OUTFITS = {
  // matches the reference look: blue polo, white collar, black pants, light-blue sneakers
  player: { skin: 0xeac19a, hair: 0x1b1b1b, shirt: 0x3446c2, pants: 0x161616, shoes: 0x8fd3f0, collar: 0xffffff, hairStyle: 'quiff', size: 1 } as Outfit,
  cop: { skin: 0xd9a47a, hair: 0x2b2b2b, shirt: 0x1f3a93, pants: 0x101c40, shoes: 0x111111, hat: 0x101c40, hairStyle: 'short', longSleeves: true, collar: 0x101c40, size: 1.03 } as Outfit,
  gang: { skin: 0xb97f55, hair: 0x111111, shirt: 0x7d3c98, pants: 0x1c1c1c, shoes: 0xffffff, hat: 0x7d3c98, hairStyle: 'buzz', size: 1.02 } as Outfit,
};

// bone indices
const HIPS = 0, SPINE = 1, HEAD = 2, UARM_L = 3, FARM_L = 4, UARM_R = 5, FARM_R = 6, THIGH_L = 7, SHIN_L = 8, THIGH_R = 9, SHIN_R = 10;

/** Bind-pose bone layout: [parent, x, y, z] relative to the parent. */
function boneLayout(female: boolean): [number, number, number, number][] {
  const sh = female ? 0.18 : 0.2;
  return [
    [-1, 0, 0.92, 0], // hips
    [HIPS, 0, 0.06, 0], // spine
    [SPINE, 0, 0.47, 0], // head (neck base)
    [SPINE, -sh, 0.37, 0], [UARM_L, 0, -0.27, 0], // left arm
    [SPINE, sh, 0.37, 0], [UARM_R, 0, -0.27, 0], // right arm
    [HIPS, -0.095, -0.02, 0], [THIGH_L, 0, -0.42, 0], // left leg
    [HIPS, 0.095, -0.02, 0], [THIGH_R, 0, -0.42, 0], // right leg
  ];
}

/**
 * Smooth stylised human (~1.8 units tall, origin at the feet, facing +Z) built as a single
 * rigidly-skinned mesh: one draw call per character with articulated elbows and knees.
 */
export class Character {
  /** Positioned and yawed by the owner. */
  root = new THREE.Group();
  /** Inner pivot used for falling over. */
  pose = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[] = [];
  gun: THREE.Mesh;
  phase = 0;
  dead = false;
  private deathT = 0;
  private idleT = Math.random() * 10;
  private hipY = 0.92;

  constructor(public outfit: Outfit) {
    const female = !!outfit.female;
    const layout = boneLayout(female);
    // world (bind) positions of each bone
    const bind: THREE.Vector3[] = [];
    layout.forEach(([parent, x, y, z], i) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      this.bones.push(b);
      if (parent >= 0) this.bones[parent].add(b);
      bind.push(new THREE.Vector3(x, y, z).add(parent >= 0 ? bind[parent] : new THREE.Vector3()));
    });

    const geo = buildBody(outfit, bind);
    this.mesh = new THREE.SkinnedMesh(geo, characterMaterial);
    this.mesh.add(this.bones[HIPS]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // skinned bounds don't follow the animation
    this.root.add(this.pose);
    this.pose.add(this.mesh);
    this.pose.scale.setScalar(outfit.size ?? 1);

    // pistol held in the right hand; barrel along the forearm (local -Y) so it aims forward when raised
    const gb = new BoxBuilder();
    gb.addBox(0, -0.3, 0.03, 0.05, 0.26, 0.07, 0x222222);
    gb.addBox(0, -0.08, -0.05, 0.045, 0.06, 0.13, 0x2b2b2b);
    this.gun = new THREE.Mesh(gb.build(), characterMaterial);
    this.gun.position.set(0, -0.24, 0.02);
    this.gun.visible = false;
    this.gun.castShadow = true;
    this.bones[FARM_R].add(this.gun);
  }

  /**
   * speed: horizontal speed in m/s; aiming raises the right arm; airborne tucks the legs.
   */
  animate(dt: number, speed: number, opts: { aiming?: boolean; airborne?: boolean; punch?: number } = {}) {
    const b = this.bones;
    const k = Math.min(1, dt * 14);
    const rx = (i: number, v: number) => { b[i].rotation.x += (v - b[i].rotation.x) * k; };
    const rz = (i: number, v: number) => { b[i].rotation.z += (v - b[i].rotation.z) * k; };

    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 3);
      this.pose.rotation.x = (-Math.PI / 2) * this.deathT;
      this.pose.position.y = 0.12 * this.deathT;
      rz(UARM_L, -1.3); rz(UARM_R, 1.3); rx(UARM_L, -0.3); rx(UARM_R, -0.3);
      rx(FARM_L, -0.4); rx(FARM_R, -0.4);
      rx(THIGH_L, -0.15); rx(THIGH_R, 0.1); rx(SHIN_L, 0.3); rx(SHIN_R, 0.1);
      rx(SPINE, 0); rx(HEAD, 0.2);
      b[HIPS].position.y = this.hipY;
      return;
    }

    const moving = speed > 0.3;
    const run = Math.min(1, Math.max(0, (speed - 4) / 4));
    this.phase += dt * (moving ? 2.6 + speed * 1.05 : 0);
    this.idleT += dt;
    const amp = moving ? Math.min(0.95, 0.3 + speed * 0.09) : 0;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);

    if (opts.airborne) {
      rx(THIGH_L, -0.9); rx(SHIN_L, 1.1); rx(THIGH_R, -0.2); rx(SHIN_R, 0.6);
      rz(UARM_L, -0.7); rx(UARM_L, -0.5); rx(FARM_L, -0.6);
      if (opts.aiming) { rz(UARM_R, 0); rx(UARM_R, -Math.PI / 2); rx(FARM_R, 0); }
      else { rz(UARM_R, 0.7); rx(UARM_R, -0.5); rx(FARM_R, -0.6); }
      rx(SPINE, 0.1);
      b[HIPS].position.y = this.hipY;
      return;
    }

    // legs: knees bend while the leg swings forward
    rx(THIGH_L, s * amp);
    rx(THIGH_R, -s * amp);
    rx(SHIN_L, Math.max(0, -c) * amp * (1.3 + run * 0.6) + 0.04);
    rx(SHIN_R, Math.max(0, c) * amp * (1.3 + run * 0.6) + 0.04);

    // arms swing opposite to the legs with relaxed elbows
    const breathe = moving ? 0 : Math.sin(this.idleT * 1.8) * 0.03;
    rz(UARM_L, -0.06 - breathe);
    rx(UARM_L, -s * amp * 0.75);
    rx(FARM_L, -0.25 - amp * 0.35 - run * 0.7);
    if (opts.aiming) {
      rz(UARM_R, 0);
      rx(UARM_R, -Math.PI / 2 + 0.05);
      rx(FARM_R, 0);
    } else if (opts.punch && opts.punch > 0) {
      const p = Math.sin(opts.punch * Math.PI);
      rz(UARM_R, 0.1);
      rx(UARM_R, (-Math.PI / 2) * p);
      rx(FARM_R, -1.4 * (1 - p));
    } else {
      rz(UARM_R, 0.06 + breathe);
      rx(UARM_R, s * amp * 0.75);
      rx(FARM_R, -0.25 - amp * 0.35 - run * 0.7);
    }

    // torso: lean into a run, counter-twist, gentle bob and idle breathing
    rx(SPINE, run * 0.18 + breathe * 0.5);
    b[SPINE].rotation.y += (s * amp * 0.18 - b[SPINE].rotation.y) * k;
    rx(HEAD, -run * 0.12);
    b[HIPS].position.y = this.hipY + (moving ? Math.abs(c) * 0.045 * (0.6 + run) - 0.02 : 0);
  }

  revive() {
    this.dead = false;
    this.deathT = 0;
    this.pose.rotation.set(0, 0, 0);
    this.pose.position.y = 0;
    for (const bone of this.bones) bone.rotation.set(0, 0, 0);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.skeleton.dispose();
    this.gun.geometry.dispose();
  }
}

// ------------------------------------------------------------------ body geometry

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

/**
 * Builds the whole body from smooth primitives. Each part is weighted 100% to one bone
 * (rigid skinning), positioned in bind pose, and coloured through vertex colours.
 */
function buildBody(o: Outfit, bind: THREE.Vector3[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const female = !!o.female;
  const add = (
    g: THREE.BufferGeometry, color: number, bone: number,
    pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0],
  ) => {
    _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]).add(bind[bone]), _q, new THREE.Vector3(...scale));
    g.applyMatrix4(_m);
    const n = g.getAttribute('position').count;
    _c.set(color);
    const col = new Float32Array(n * 3);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!g.index) g.setIndex([...Array(n).keys()]);
    parts.push(g);
  };
  const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10);
  const sphere = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
  const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);

  const sleeveColor = o.longSleeves ? o.shirt : o.skin;
  const shoulder = female ? 0.165 : 0.19;

  // ---- torso (spine bone): tapered shirt, waist, belt, collar
  const prof = [
    [0.001, -0.1], [0.14, -0.1], [female ? 0.14 : 0.15, -0.02], [female ? 0.135 : 0.155, 0.1],
    [female ? 0.15 : 0.17, 0.22], [shoulder, 0.32], [shoulder, 0.37], [shoulder - 0.03, 0.42], [0.09, 0.46], [0.001, 0.47],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(prof, 16), o.shirt, SPINE, [0, 0, 0], [1, 1, 0.62]);
  add(cyl(0.152, 0.152, 0.045, 16), 0x2a2a2a, SPINE, [0, -0.075, 0], [1, 1, 0.66]); // belt
  add(cyl(0.062, 0.07, 0.06), o.collar ?? o.shirt, SPINE, [0, 0.455, 0]); // collar
  if (o.collar !== undefined) {
    // polo collar flaps and placket
    add(new THREE.BoxGeometry(0.07, 0.035, 0.02), o.collar, SPINE, [-0.04, 0.43, 0.085], [1, 1, 1], [0.5, 0, -0.35]);
    add(new THREE.BoxGeometry(0.07, 0.035, 0.02), o.collar, SPINE, [0.04, 0.43, 0.085], [1, 1, 1], [0.5, 0, 0.35]);
    add(new THREE.BoxGeometry(0.025, 0.09, 0.01), o.collar, SPINE, [0, 0.37, 0.103]);
  }
  // pelvis (pants)
  add(capsule(0.1, 0.13), o.pants, HIPS, [0, -0.06, 0], [1, 1, 0.78], [0, 0, Math.PI / 2]);

  // ---- head (drawn ~10% larger and sitting low on a short neck, like the reference art)
  add(cyl(0.05, 0.054, 0.09), o.skin, HEAD, [0, 0.035, 0]); // neck
  const HS = 1.1, HY = -0.035;
  const addH = (g: THREE.BufferGeometry, color: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]) =>
    add(g, color, HEAD, [pos[0] * HS, pos[1] * HS + HY, pos[2] * HS], [scale[0] * HS, scale[1] * HS, scale[2] * HS], rot);
  addH(sphere(0.125, 18, 14), o.skin, [0, 0.2, 0.005], [0.95, 1.1, 1]);
  addH(sphere(0.022, 8, 6), o.skin, [0, 0.185, 0.128], [1, 1, 1.1]); // nose
  for (const sx of [-1, 1]) {
    addH(sphere(0.03, 8, 6), o.skin, [sx * 0.118, 0.195, 0], [0.55, 1, 0.8]); // ears
    addH(sphere(0.017, 8, 6), 0x1a1a1a, [sx * 0.044, 0.22, 0.112], [1, 1.25, 0.5]); // eyes
    addH(new THREE.BoxGeometry(0.05, 0.011, 0.012), o.hair, [sx * 0.045, 0.252, 0.114], [1, 1, 1], [0, 0, sx * -0.12]); // brows
  }
  addH(new THREE.BoxGeometry(0.045, 0.009, 0.01), 0x8a3b3b, [0, 0.142, 0.116]); // mouth

  const style: HairStyle = o.hairStyle ?? (o.bald ? 'bald' : 'short');
  // hair cap: upper hemisphere tilted so the hairline sits above the brows and drops at the nape
  const cap = (r: number, color: number, sc: [number, number, number] = [0.98, 1.05, 1.05]) => {
    const g = new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.55);
    addH(g, color, [0, 0.214, -0.004], sc, [-0.32, 0, 0]);
  };
  if (o.hat !== undefined) {
    cap(0.137, o.hat, [1, 0.95, 1.05]);
    addH(cyl(0.11, 0.11, 0.015, 14), o.hat, [0, 0.268, 0.11], [0.9, 1, 0.75], [0.12, 0, 0]); // brim
  } else if (style !== 'bald') {
    cap(style === 'buzz' ? 0.129 : 0.134, o.hair);
    if (style === 'quiff') {
      addH(sphere(0.07, 12, 8), o.hair, [0.005, 0.322, 0.065], [1.45, 0.72, 1.15], [0.35, 0, 0.08]);
      addH(sphere(0.05, 10, 7), o.hair, [-0.03, 0.3, 0.1], [1.4, 0.6, 0.9], [0.5, 0, 0]);
    } else if (style === 'short') {
      addH(sphere(0.06, 10, 7), o.hair, [0.02, 0.305, 0.07], [1.6, 0.55, 1.1], [0.3, 0, 0]);
    } else if (style === 'long') {
      addH(capsule(0.1, 0.14), o.hair, [0, 0.13, -0.055], [1.12, 1, 0.62]);
      for (const sx of [-1, 1]) addH(capsule(0.035, 0.12), o.hair, [sx * 0.105, 0.15, 0.02]);
    } else if (style === 'bun') {
      addH(sphere(0.06, 10, 8), o.hair, [0, 0.31, -0.09]);
    }
  }

  // ---- arms
  for (const [ua, fa, sx] of [[UARM_L, FARM_L, -1], [UARM_R, FARM_R, 1]] as const) {
    add(sphere(0.066, 12, 9), o.shirt, ua, [sx * -0.012, -0.02, 0], [1, 0.9, 0.95]); // shoulder
    add(capsule(0.061, 0.09), o.shirt, ua, [0, -0.08, 0]); // sleeve
    add(capsule(0.049, 0.17), sleeveColor, ua, [0, -0.16, 0]); // upper arm
    add(capsule(0.044, 0.16), sleeveColor, fa, [0, -0.11, 0]); // forearm
    add(sphere(0.052, 10, 8), o.skin, fa, [0, -0.255, 0.008], [0.72, 1.15, 0.95]); // hand
    add(sphere(0.02, 6, 5), o.skin, fa, [sx * -0.03, -0.235, 0.03], [1, 1.4, 1]); // thumb
  }

  // ---- legs
  for (const [th, sh] of [[THIGH_L, SHIN_L], [THIGH_R, SHIN_R]] as const) {
    add(capsule(female ? 0.082 : 0.088, 0.3), o.pants, th, [0, -0.2, 0]);
    add(capsule(0.07, 0.3), o.pants, sh, [0, -0.2, 0]);
    add(capsule(0.068, 0.15), o.shoes, sh, [0, -0.425, 0.055], [1, 0.75, 1], [Math.PI / 2, 0, 0]); // sneaker
    add(capsule(0.07, 0.14), 0xf4f4f4, sh, [0, -0.46, 0.055], [1.0, 0.28, 1.0], [Math.PI / 2, 0, 0]); // sole
    add(capsule(0.03, 0.05), 0xffffff, sh, [0, -0.392, 0.105], [1.4, 0.5, 1], [Math.PI / 2 - 0.5, 0, 0]); // laces
  }

  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  merged.deleteAttribute('uv');
  merged.computeBoundingSphere();
  return merged;
}
