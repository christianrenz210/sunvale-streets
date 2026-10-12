import * as THREE from 'three';
import { BoxBuilder } from './geom';
import { AABB, circleVsAABB, clamp, mulberry32, pick, rayVsAABB } from './utils';

export const GRID = 8; // blocks per side
export const CELL = 80; // road centreline spacing
export const ROAD = 18;
export const HALF_ROAD = ROAD / 2;
export const OFFSET = (-GRID * CELL) / 2;
export const CITY_EDGE = -OFFSET + HALF_ROAD;
export const LIMIT = 356; // playable bound (beach edge)
export const LANE = 3.2;
export const CURB = 0.15;
const BLOCK = CELL - ROAD; // 62
const SIDEWALK = 4;
const INNER = BLOCK / 2 - SIDEWALK; // 27

export const roadCoord = (k: number) => OFFSET + k * CELL;
export const blockCenter = (i: number) => OFFSET + (i + 0.5) * CELL;

export type BlockType = 'downtown' | 'commercial' | 'residential' | 'park' | 'lot' | 'special';

export interface POI {
  name: string;
  x: number;
  z: number;
  /** direction a respawned player faces */
  yaw: number;
}

export interface ParkingSpot { x: number; z: number; yaw: number }

interface Collider extends AABB { q: number }

const SPECIAL: Record<string, string> = {
  '2,3': 'hospital',
  '5,4': 'police',
  '1,5': 'safehouse',
  '6,2': 'garage',
  '6,6': 'spray',
};
const PARKS = new Set(['4,3', '1,6', '6,0']);
const LOTS = new Set(['3,5', '5,2', '2,6']);

export class World {
  group = new THREE.Group();
  blocks: { i: number; j: number; type: BlockType; cx: number; cz: number }[] = [];
  pois: Record<string, POI> = {};
  parkingSpots: ParkingSpot[] = [];
  buildingMat: THREE.MeshLambertMaterial;
  lampMat: THREE.MeshBasicMaterial;
  water: THREE.Mesh;
  sky: THREE.Mesh;
  minimapCanvas: HTMLCanvasElement;
  private grid = new Map<number, Collider[]>();
  private queryId = 1;
  private readonly gridCell = 24;
  private rng = mulberry32(1987);

  constructor(private quality: 'low' | 'high') {
    this.buildingMat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: makeWindowTexture(false, this.rng),
      emissiveMap: makeWindowTexture(true, this.rng),
      emissive: new THREE.Color(0xffe2a8),
      emissiveIntensity: 0,
    });
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x777766 });

    this.classifyBlocks();
    this.buildGround();
    this.buildBlocks();
    this.buildRoads();
    this.buildBeach();
    this.water = this.buildWater();
    this.sky = this.buildSky();
    this.minimapCanvas = this.buildMinimap();
  }

  // ---------------------------------------------------------------- layout

  private classifyBlocks() {
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const key = `${i},${j}`;
        const d = Math.max(Math.abs(i - 3.5), Math.abs(j - 3.5));
        let type: BlockType;
        if (SPECIAL[key]) type = 'special';
        else if (PARKS.has(key)) type = 'park';
        else if (LOTS.has(key)) type = 'lot';
        else if (d <= 1.5) type = 'downtown';
        else if (d <= 2.5) type = 'commercial';
        else type = 'residential';
        this.blocks.push({ i, j, type, cx: blockCenter(i), cz: blockCenter(j) });
      }
    }
  }

  private buildGround() {
    // sand underlay for everything (visible as the beach ring)
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(LIMIT * 2 + 40, LIMIT * 2 + 40),
      new THREE.MeshLambertMaterial({ color: 0xe8d39a }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -0.03;
    sand.receiveShadow = true;
    this.group.add(sand);
    // asphalt under the city
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_EDGE * 2, CITY_EDGE * 2),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3f }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = -0.01;
    asphalt.receiveShadow = true;
    this.group.add(asphalt);
  }

  private buildBlocks() {
    const bb = new BoxBuilder(); // textured buildings
    const ground = new BoxBuilder(); // sidewalks, lawns, lots (untextured)
    const r = this.rng;
    const trees: { x: number; z: number; s: number; palm: boolean }[] = [];
    const lamps: { x: number; z: number; rot: number }[] = [];

    const DT = [0x8fa3b8, 0x6d7f94, 0xb8c4d0, 0xd9cbb3, 0x5d6d7e, 0xa3b5a6, 0x9c8f80, 0x7f8fa6];
    const CM = [0xe8d5b7, 0xd4a373, 0xc9ada7, 0xa8dadc, 0xf1faee, 0xe9c46a, 0xf4a261, 0xb5838d, 0xcdb4db];
    const HS = [0xffd6a5, 0xfdffb6, 0xcaffbf, 0x9bf6ff, 0xa0c4ff, 0xffc6ff, 0xfffffc, 0xe6ccb2];
    const ROOF = [0x8d3b2b, 0x5d4037, 0x37474f, 0x6d4c41, 0x455a64];

    const building = (x: number, z: number, w: number, d: number, h: number, color: number, tiered: boolean) => {
      bb.addBox(x, CURB, z, w, h, d, color, { uvScale: 32, skipBottom: true, topColor: 0x777777 });
      this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h + CURB);
      let top = h + CURB;
      if (tiered && h > 30) {
        const w2 = w * 0.65, d2 = d * 0.65, h2 = 10 + r() * 30;
        bb.addBox(x, top, z, w2, h2, d2, color, { uvScale: 32, skipBottom: true, topColor: 0x777777 });
        top += h2;
        if (r() < 0.5) bb.addBox(x, top, z, 0.4, 12, 0.4, 0x555555, { skipBottom: true }); // antenna
      }
      // rooftop clutter
      const n = Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        bb.addBox(x + (r() - 0.5) * w * 0.5, top, z + (r() - 0.5) * d * 0.5, 2 + r() * 3, 1.5 + r() * 2, 2 + r() * 3, 0x9e9e9e, { skipBottom: true });
      }
    };

    for (const b of this.blocks) {
      const { cx, cz, type, i, j } = b;
      const grassTop = type === 'park' || type === 'residential';
      ground.addBox(cx, 0, cz, BLOCK, CURB, BLOCK, 0xa7a49c, { skipBottom: true });
      if (grassTop) ground.addFlat(cx, CURB + 0.01, cz, INNER * 2, INNER * 2, type === 'park' ? 0x5fa04e : 0x6bb05a);
      if (type === 'lot' || type === 'special') ground.addFlat(cx, CURB + 0.01, cz, INNER * 2, INNER * 2, 0x4a4a50);

      // lamps along the curb
      for (const side of [0, 1, 2, 3]) {
        for (const t of [-15, 15]) {
          const e = BLOCK / 2 - 0.8;
          const [lx, lz] = side === 0 ? [cx + t, cz - e] : side === 1 ? [cx + e, cz + t] : side === 2 ? [cx + t, cz + e] : [cx - e, cz + t];
          lamps.push({ x: lx, z: lz, rot: (side * Math.PI) / 2 });
          this.addCollider(lx - 0.2, lx + 0.2, lz - 0.2, lz + 0.2, 6);
        }
      }

      if (type === 'downtown' || type === 'commercial') {
        const dt = type === 'downtown';
        const centre = 1 - Math.max(Math.abs(i - 3.5), Math.abs(j - 3.5)) / 4;
        const split = dt ? pick([1, 2, 4, 4], r) : pick([2, 4, 4], r);
        const lots: [number, number, number, number][] = [];
        if (split === 1) lots.push([cx, cz, INNER * 2 - 4, INNER * 2 - 4]);
        else if (split === 2) {
          if (r() < 0.5) { lots.push([cx - 13.5, cz, 23, INNER * 2 - 4], [cx + 13.5, cz, 23, INNER * 2 - 4]); }
          else { lots.push([cx, cz - 13.5, INNER * 2 - 4, 23], [cx, cz + 13.5, INNER * 2 - 4, 23]); }
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) lots.push([cx + sx * 13.5, cz + sz * 13.5, 23, 23]);
        }
        for (const [lx, lz, lw, ld] of lots) {
          const h = dt ? 25 + r() * 60 * centre + r() * 30 : 8 + r() * 22;
          const shrink = 0.8 + r() * 0.2;
          building(lx, lz, lw * shrink, ld * shrink, h, dt ? pick(DT, r) : pick(CM, r), dt);
        }
        if (dt) for (const t of [-22, 22]) trees.push({ x: cx + t, z: cz - BLOCK / 2 + 1.6, s: 0.8, palm: true });
      } else if (type === 'residential') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const hx = cx + sx * 13.5, hz = cz + sz * 13.5;
          const w = 11 + r() * 4, d = 10 + r() * 3, h = 4.5 + r() * 3;
          bb.addBox(hx, CURB, hz, w, h, d, pick(HS, r), { uvScale: 32, skipBottom: true, skipTop: true });
          bb.addPyramid(hx, CURB + h, hz, w + 1, d + 1, 2.5 + r() * 1.5, pick(ROOF, r));
          this.addCollider(hx - w / 2, hx + w / 2, hz - d / 2, hz + d / 2, h + 3);
          // yard tree towards the street
          const tx = hx + sx * (w / 2 + 3.2), tz = hz + sz * (d / 2 + 3.5);
          if (Math.abs(tx - cx) < INNER - 1 && Math.abs(tz - cz) < INNER - 1) trees.push({ x: tx, z: tz, s: 0.8 + r() * 0.5, palm: r() < 0.3 });
        }
      } else if (type === 'park') {
        ground.addFlat(cx, CURB + 0.02, cz, 4, INNER * 2, 0xd8c9a3); // paths
        ground.addFlat(cx, CURB + 0.02, cz, INNER * 2, 4, 0xd8c9a3);
        ground.addFlat(cx + 12, CURB + 0.03, cz - 12, 12, 9, 0x4fa3d1); // pond
        bb.addBox(cx, CURB, cz, 3, 1, 3, 0xcfcfcf, { skipBottom: true }); // fountain
        bb.addBox(cx, CURB + 1, cz, 0.6, 1.6, 0.6, 0xbfbfbf, { skipBottom: true });
        this.addCollider(cx - 1.5, cx + 1.5, cz - 1.5, cz + 1.5, 1);
        for (let k = 0; k < 16; k++) {
          const x = cx + (r() - 0.5) * INNER * 1.8, z = cz + (r() - 0.5) * INNER * 1.8;
          if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
          if (x > cx + 4 && z < cz - 4 && x < cx + 20 && z > cz - 20) continue;
          trees.push({ x, z, s: 0.9 + r() * 0.7, palm: r() < 0.25 });
        }
      } else if (type === 'lot') {
        const marks = new BoxBuilder();
        for (let k = -4; k <= 4; k++) {
          ground.addFlat(cx + k * 5.5 + 2.75, CURB + 0.02, cz - 12, 0.2, 9, 0xeeeeee);
          ground.addFlat(cx + k * 5.5 + 2.75, CURB + 0.02, cz + 12, 0.2, 9, 0xeeeeee);
          if (k < 4) {
            this.parkingSpots.push({ x: cx + k * 5.5 + 5.5, z: cz - 12, yaw: 0 });
            this.parkingSpots.push({ x: cx + k * 5.5 + 5.5, z: cz + 12, yaw: Math.PI });
          }
        }
        void marks;
        bb.addBox(cx - 22, CURB, cz, 4, 3, 4, 0xe0e0e0, { uvScale: 32, skipBottom: true }); // booth
        this.addCollider(cx - 24, cx - 20, cz - 2, cz + 2, 3);
      } else if (type === 'special') {
        this.buildSpecial(SPECIAL[`${i},${j}`], cx, cz, bb, ground, trees);
      }
    }

    // roadside parking along segments
    for (let k = 0; k <= GRID; k++) {
      for (let s = 0; s < GRID; s++) {
        const rc = roadCoord(k);
        const mid = blockCenter(s);
        for (const off of [-12, 12]) {
          if (r() < 0.5) this.parkingSpots.push({ x: rc + 7.0, z: mid + off, yaw: Math.PI });
          if (r() < 0.5) this.parkingSpots.push({ x: rc - 7.0, z: mid + off, yaw: 0 });
          if (r() < 0.5) this.parkingSpots.push({ x: mid + off, z: rc + 7.0, yaw: Math.PI / 2 });
          if (r() < 0.5) this.parkingSpots.push({ x: mid + off, z: rc - 7.0, yaw: -Math.PI / 2 });
        }
      }
    }

    const bm = new THREE.Mesh(bb.build(), this.buildingMat);
    bm.castShadow = this.quality === 'high';
    bm.receiveShadow = true;
    this.group.add(bm);
    const gm = new THREE.Mesh(ground.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    gm.receiveShadow = true;
    this.group.add(gm);

    this.buildTrees(trees);
    this.buildLamps(lamps);
  }

  private buildSpecial(kind: string, cx: number, cz: number, bb: BoxBuilder, ground: BoxBuilder, trees: { x: number; z: number; s: number; palm: boolean }[]) {
    const entranceZ = cz + BLOCK / 2 - 2;
    const sign = (x: number, y: number, z: number, w: number, h: number, color: number) => bb.addBox(x, y, z, w, h, 0.3, color, { skipBottom: true });
    switch (kind) {
      case 'hospital': {
        bb.addBox(cx, CURB, cz - 6, 44, 22, 34, 0xf4f6f7, { uvScale: 32, skipBottom: true, topColor: 0x888888 });
        this.addCollider(cx - 22, cx + 22, cz - 23, cz + 11, 22);
        sign(cx, 16, cz + 11.2, 6, 2, 0xd62828);
        sign(cx, 14, cz + 11.2, 2, 6, 0xd62828);
        this.pois.hospital = { name: 'Sunvale General Hospital', x: cx, z: entranceZ, yaw: Math.PI };
        break;
      }
      case 'police': {
        bb.addBox(cx, CURB, cz - 6, 42, 15, 32, 0x8aa1b1, { uvScale: 32, skipBottom: true, topColor: 0x777777 });
        this.addCollider(cx - 21, cx + 21, cz - 22, cz + 10, 15);
        sign(cx, 11, cz + 10.2, 16, 2.2, 0x1d3557);
        sign(cx, 11.5, cz + 10.4, 14, 1.2, 0xf1faee);
        this.pois.police = { name: 'SVPD Headquarters', x: cx, z: entranceZ, yaw: Math.PI };
        break;
      }
      case 'safehouse': {
        ground.addFlat(cx, CURB + 0.02, cz, INNER * 2, INNER * 2, 0x6bb05a);
        bb.addBox(cx - 6, CURB, cz - 6, 18, 6, 14, 0xf2cc8f, { uvScale: 32, skipBottom: true, skipTop: true });
        bb.addPyramid(cx - 6, CURB + 6, cz - 6, 19, 15, 4, 0x6d4c41);
        this.addCollider(cx - 15, cx + 3, cz - 13, cz + 1, 10);
        bb.addBox(cx + 10, CURB, cz - 6, 9, 4, 12, 0xe0e0e0, { skipBottom: true });
        this.addCollider(cx + 5.5, cx + 14.5, cz - 12, cz, 4);
        trees.push({ x: cx - 18, z: cz + 14, s: 1.2, palm: true }, { x: cx + 18, z: cz + 14, s: 1.1, palm: true });
        this.pois.safehouse = { name: 'Safehouse', x: cx - 6, z: cz + 4, yaw: Math.PI };
        break;
      }
      case 'garage': {
        bb.addBox(cx, CURB, cz - 10, 40, 9, 24, 0x9c6644, { uvScale: 32, skipBottom: true, topColor: 0x555555 });
        this.addCollider(cx - 20, cx + 20, cz - 22, cz + 2, 9);
        bb.addBox(cx, CURB, cz + 2.05, 12, 6, 0.2, 0x3d3d3d, { skipBottom: true });
        sign(cx, 7, cz + 2.3, 18, 1.6, 0xffb703);
        this.pois.garage = { name: "Rico's Garage", x: cx, z: cz + 12, yaw: Math.PI };
        break;
      }
      case 'spray': {
        bb.addBox(cx - 14, CURB, cz - 8, 12, 8, 26, 0x2a9d8f, { uvScale: 32, skipBottom: true });
        bb.addBox(cx + 14, CURB, cz - 8, 12, 8, 26, 0x2a9d8f, { uvScale: 32, skipBottom: true });
        bb.addBox(cx, CURB + 8, cz - 8, 40, 1.5, 26, 0x264653, { skipBottom: true });
        bb.addBox(cx, CURB, cz - 20.5, 16, 8, 1, 0x264653, { skipBottom: true });
        this.addCollider(cx - 20, cx - 8, cz - 21, cz + 5, 8);
        this.addCollider(cx + 8, cx + 20, cz - 21, cz + 5, 8);
        this.addCollider(cx - 8, cx + 8, cz - 21, cz - 20, 8);
        sign(cx, 9.6, cz + 5.2, 14, 1.4, 0xe9c46a);
        this.pois.spray = { name: 'Fresh Coat Paint & Repair', x: cx, z: cz - 8, yaw: Math.PI };
        break;
      }
    }
  }

  private buildTrees(trees: { x: number; z: number; s: number; palm: boolean }[]) {
    const round = trees.filter((t) => !t.palm);
    const palms = trees.filter((t) => t.palm);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4f3a });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8f3a, flatShading: true });
    const palmLeafMat = new THREE.MeshLambertMaterial({ color: 0x4caf50, flatShading: true, side: THREE.DoubleSide });

    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const leafGeo = new THREE.IcosahedronGeometry(2, 0);
    leafGeo.translate(0, 4.2, 0);
    const palmTrunk = new THREE.CylinderGeometry(0.18, 0.3, 8, 6);
    palmTrunk.translate(0, 4, 0);
    const palmLeaf = new BoxBuilder();
    for (let k = 0; k < 7; k++) {
      palmLeaf.addBox(Math.sin((k / 7) * Math.PI * 2) * 1.6, 7.6, Math.cos((k / 7) * Math.PI * 2) * 1.6, 0.9, 0.08, 3.4, 0x4caf50, { rotY: (k / 7) * Math.PI * 2 });
    }
    const palmLeafGeo = palmLeaf.build();
    palmLeafGeo.deleteAttribute('color');

    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: typeof trees, scaleY = 1) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((t, k) => {
        q.setFromAxisAngle(up, (t.x * 13.1 + t.z * 7.7) % (Math.PI * 2));
        m.compose(new THREE.Vector3(t.x, CURB, t.z), q, new THREE.Vector3(t.s, t.s * scaleY, t.s));
        im.setMatrixAt(k, m);
      });
      im.count = list.length;
      im.castShadow = this.quality === 'high';
      im.computeBoundingSphere();
      this.group.add(im);
    };
    inst(trunkGeo, trunkMat, round);
    inst(leafGeo, leafMat, round);
    inst(palmTrunk, trunkMat, palms);
    inst(palmLeafGeo, palmLeafMat, palms);
    for (const t of trees) this.addCollider(t.x - 0.4, t.x + 0.4, t.z - 0.4, t.z + 0.4, 6);
  }

  private buildLamps(lamps: { x: number; z: number; rot: number }[]) {
    const pole = new BoxBuilder();
    pole.addBox(0, 0, 0, 0.18, 6, 0.18, 0x555555);
    pole.addBox(0, 5.9, 0.8, 0.12, 0.12, 1.7, 0x555555);
    const poleGeo = pole.build();
    poleGeo.deleteAttribute('color');
    const bulbGeo = new THREE.BoxGeometry(0.5, 0.2, 0.7);
    bulbGeo.translate(0, 5.8, 1.5);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x555555 }), lamps.length);
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.lampMat, lamps.length);
    lamps.forEach((l, k) => {
      // lamp arm points toward the road
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot + Math.PI);
      m.compose(new THREE.Vector3(l.x, CURB, l.z), q, new THREE.Vector3(1, 1, 1));
      poles.setMatrixAt(k, m);
      bulbs.setMatrixAt(k, m);
    });
    poles.computeBoundingSphere();
    bulbs.computeBoundingSphere();
    this.group.add(poles, bulbs);
  }

  private buildRoads() {
    const tex = makeRoadTexture();
    const rb = new BoxBuilder();
    const marks = new BoxBuilder();
    const len = BLOCK;
    const plain = [0.25, 0.25, 0.26, 0.25, 0.26, 0.26, 0.25, 0.26];
    for (let k = 0; k <= GRID; k++) {
      const rc = roadCoord(k);
      for (let s = 0; s < GRID; s++) {
        const mid = blockCenter(s);
        const v = len / 18;
        // north-south segment: u across x, v along z
        rb.addFlat(rc, 0.0, mid, ROAD, len, 0xffffff, [0, v, 1, v, 1, 0, 0, 0]);
        // east-west segment: rotate uv so lines run along x
        rb.addFlat(mid, 0.0, rc, len, ROAD, 0xffffff, [0, 0, 0, v, 1, v, 1, 0]);
        // crosswalks at both ends of each segment
        for (const end of [-1, 1]) {
          const along = mid + end * (len / 2 - 2.2);
          for (let st = -7.2; st <= 7.2; st += 2.4) {
            marks.addFlat(rc + st, 0.02, along, 1.2, 3.2, 0xf0f0f0);
            marks.addFlat(along, 0.02, rc + st, 3.2, 1.2, 0xf0f0f0);
          }
        }
      }
      for (let s = 0; s <= GRID; s++) rb.addFlat(rc, 0.0, roadCoord(s), ROAD, ROAD, 0xffffff, plain);
    }
    const rm = new THREE.Mesh(rb.build(), new THREE.MeshLambertMaterial({ map: tex, vertexColors: true }));
    rm.position.y = 0.005;
    rm.receiveShadow = true;
    this.group.add(rm);
    const mm = new THREE.Mesh(marks.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mm.receiveShadow = true;
    this.group.add(mm);
  }

  private buildBeach() {
    const b = new BoxBuilder();
    // pier / docks on the east shore
    const dx = CITY_EDGE + 20, dz = 200;
    b.addBox(dx + 20, 0.2, dz, 50, 0.4, 12, 0x8d6e63, { skipBottom: true });
    for (let k = 0; k < 6; k++) b.addBox(dx + 4 + k * 8, -1, dz + 5.5, 0.5, 1.2, 0.5, 0x5d4037);
    b.addBox(dx + 10, 0.6, dz - 3, 6, 2.6, 2.4, 0xc0392b, { skipBottom: true }); // containers
    b.addBox(dx + 17, 0.6, dz - 3, 6, 2.6, 2.4, 0x2980b9, { skipBottom: true });
    this.addCollider(dx + 7, dx + 20, dz - 4.2, dz - 1.8, 3);
    this.pois.docks = { name: 'Sunvale Docks', x: dx + 30, z: dz, yaw: -Math.PI / 2 };
    // lifeguard towers & umbrellas
    const um = [0xe63946, 0xf1faee, 0x457b9d, 0xffb703];
    for (let k = 0; k < 14; k++) {
      const side = k % 4;
      const t = -280 + (k * 41) % 560;
      const off = CITY_EDGE + 14;
      const [x, z] = side === 0 ? [t, -off] : side === 1 ? [-off, t] : side === 2 ? [t, off] : [-off, t + 20];
      if (Math.abs(z - dz) < 20 && x > 0) continue;
      b.addBox(x, 0, z, 0.15, 2.4, 0.15, 0xdddddd);
      b.addPyramid(x, 2.3, z, 3.2, 3.2, 0.8, um[k % 4]);
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.castShadow = this.quality === 'high';
    this.group.add(mesh);
    const palms: { x: number; z: number; s: number; palm: boolean }[] = [];
    for (let k = 0; k < 48; k++) {
      const t = -330 + k * 28 % 660;
      const off = CITY_EDGE + 6 + (k % 3) * 4;
      const side = k % 4;
      palms.push(side === 0 ? { x: t, z: -off, s: 1, palm: true } : side === 1 ? { x: -off, z: t, s: 1.1, palm: true } : side === 2 ? { x: t, z: off, s: 0.9, palm: true } : { x: off, z: t, s: 1, palm: true });
    }
    this.buildTrees(palms.filter((p) => !(p.x > CITY_EDGE && Math.abs(p.z - dz) < 12)));
  }

  private buildWater() {
    const geo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0x1e88e5, transparent: true, opacity: 0.92 });
    const w = new THREE.Mesh(geo, mat);
    w.rotation.x = -Math.PI / 2;
    w.position.y = -0.4;
    // carve the island: draw water only outside the beach by placing it under the sand but
    // the sand plane ends at LIMIT+20, so water shows beyond.
    this.group.add(w);
    return w;
  }

  private buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x3a7bd5) },
        bottom: { value: new THREE.Color(0xbfe3ff) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.1,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h),1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    return sky;
  }

  /** Pre-rendered top-down city map used by the radar. 1px = 1 world unit. */
  private buildMinimap() {
    const size = Math.ceil((LIMIT + 40) * 2);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const W = (x: number) => x + size / 2;
    g.fillStyle = '#2f6fa8';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#d9c38a';
    g.fillRect(W(-LIMIT - 20), W(-LIMIT - 20), (LIMIT + 20) * 2, (LIMIT + 20) * 2);
    g.fillStyle = '#4a4a50';
    g.fillRect(W(-CITY_EDGE), W(-CITY_EDGE), CITY_EDGE * 2, CITY_EDGE * 2);
    for (const b of this.blocks) {
      g.fillStyle = b.type === 'park' ? '#4f8f45' : b.type === 'residential' ? '#6d8f63' : b.type === 'downtown' ? '#77808a' : b.type === 'lot' ? '#60606a' : '#8a8a80';
      g.fillRect(W(b.cx - BLOCK / 2), W(b.cz - BLOCK / 2), BLOCK, BLOCK);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    this.grid.forEach((list) => list.forEach((b) => {
      if (b.height > 3.5 && b.maxX - b.minX > 2) g.fillRect(W(b.minX), W(b.minZ), b.maxX - b.minX, b.maxZ - b.minZ);
    }));
    g.fillStyle = '#8d6e63';
    g.fillRect(W(CITY_EDGE + 20), W(194), 50, 12);
    return c;
  }

  // ---------------------------------------------------------------- collision

  private key(ix: number, iz: number) {
    return (ix + 1000) * 4096 + (iz + 1000);
  }

  addCollider(minX: number, maxX: number, minZ: number, maxZ: number, height: number) {
    const c: Collider = { minX, maxX, minZ, maxZ, height, q: 0 };
    const s = this.gridCell;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++) {
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(c);
      }
    }
  }

  private query(minX: number, maxX: number, minZ: number, maxZ: number, out: Collider[]) {
    const q = ++this.queryId;
    const s = this.gridCell;
    out.length = 0;
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++) {
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const list = this.grid.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c.q !== q) { c.q = q; out.push(c); }
        }
      }
    }
    return out;
  }

  private tmp: Collider[] = [];

  /**
   * Pushes a circle (at height y with given body height) out of world geometry.
   * Returns the accumulated push vector (0,0 if nothing was hit).
   */
  collide(p: { x: number; z: number }, r: number, y = 0): [number, number] {
    let px = 0, pz = 0;
    const list = this.query(p.x - r, p.x + r, p.z - r, p.z + r, this.tmp);
    for (const c of list) {
      if (y > c.height - 0.3) continue; // standing on top / above
      const push = circleVsAABB(p.x, p.z, r, c);
      if (push) {
        p.x += push[0];
        p.z += push[1];
        px += push[0];
        pz += push[1];
      }
    }
    // island bounds
    const nx = clamp(p.x, -LIMIT, LIMIT), nz = clamp(p.z, -LIMIT, LIMIT);
    if (nx !== p.x || nz !== p.z) { px += nx - p.x; pz += nz - p.z; p.x = nx; p.z = nz; }
    return [px, pz];
  }

  /** Distance along the ray to the first building, or maxDist. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number) {
    const ex = o.x + d.x * maxDist, ez = o.z + d.z * maxDist;
    const list = this.query(Math.min(o.x, ex), Math.max(o.x, ex), Math.min(o.z, ez), Math.max(o.z, ez), this.tmp);
    let best = maxDist;
    for (const c of list) {
      const t = rayVsAABB(o.x, o.y, o.z, d.x, d.y, d.z, c, best);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  }

  groundHeight(x: number, z: number) {
    if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) return 0;
    const lx = ((x - OFFSET) % CELL + CELL) % CELL;
    const lz = ((z - OFFSET) % CELL + CELL) % CELL;
    const onRoadX = lx < HALF_ROAD || lx > CELL - HALF_ROAD;
    const onRoadZ = lz < HALF_ROAD || lz > CELL - HALF_ROAD;
    return onRoadX || onRoadZ ? 0 : CURB;
  }

  // ---------------------------------------------------------------- navigation

  nodePos(i: number, j: number): [number, number] {
    return [roadCoord(i), roadCoord(j)];
  }

  nearestNode(x: number, z: number): [number, number] {
    return [clamp(Math.round((x - OFFSET) / CELL), 0, GRID), clamp(Math.round((z - OFFSET) / CELL), 0, GRID)];
  }

  neighbors(i: number, j: number): [number, number][] {
    const out: [number, number][] = [];
    if (i > 0) out.push([i - 1, j]);
    if (i < GRID) out.push([i + 1, j]);
    if (j > 0) out.push([i, j - 1]);
    if (j < GRID) out.push([i, j + 1]);
    return out;
  }

  blockAt(x: number, z: number) {
    const i = Math.floor((x - OFFSET) / CELL), j = Math.floor((z - OFFSET) / CELL);
    if (i < 0 || j < 0 || i >= GRID || j >= GRID) return null;
    return this.blocks[i * GRID + j];
  }

  /** Corners of the sidewalk loop around a block, walked clockwise. */
  sidewalkLoop(i: number, j: number): [number, number][] {
    const cx = blockCenter(i), cz = blockCenter(j), h = BLOCK / 2 - 2.2;
    return [[cx - h, cz - h], [cx + h, cz - h], [cx + h, cz + h], [cx - h, cz + h]];
  }

  districtAt(x: number, z: number) {
    if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) return x > CITY_EDGE && Math.abs(z - 200) < 30 ? 'Sunvale Docks' : 'Sunvale Beach';
    const i = Math.floor((x - OFFSET) / CELL), j = Math.floor((z - OFFSET) / CELL);
    if (Math.max(Math.abs(i - 3.5), Math.abs(j - 3.5)) <= 1.5) return 'Downtown';
    if (x < 0 && z < 0) return 'Vista Heights';
    if (x >= 0 && z < 0) return 'Eastside';
    if (x < 0) return 'Old Town';
    return 'Marina';
  }

  /** Updates time-of-day dependent visuals. night: 0 (day) .. 1 (full night). */
  setNight(night: number, skyTop: THREE.Color, skyBottom: THREE.Color) {
    this.buildingMat.emissiveIntensity = night * 1.1;
    this.lampMat.color.setRGB(0.45 + night * 0.55, 0.45 + night * 0.5, 0.4 + night * 0.25);
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    u.top.value.copy(skyTop);
    u.bottom.value.copy(skyBottom);
    (this.water.material as THREE.MeshLambertMaterial).color.setRGB(0.12 - night * 0.08, 0.53 - night * 0.38, 0.9 - night * 0.55);
  }
}

function makeWindowTexture(emissive: boolean, r: () => number) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = emissive ? '#000' : '#e6e6e6';
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const px = x * 64 + 12, py = y * 64 + 10;
      if (emissive) {
        if (r() < 0.42) {
          g.fillStyle = pick(['#ffe8a3', '#fff4d6', '#ffd27a', '#cfe8ff'], r);
          g.fillRect(px, py, 40, 44);
        }
      } else {
        const grad = g.createLinearGradient(px, py, px + 40, py + 44);
        grad.addColorStop(0, '#5d7286');
        grad.addColorStop(0.5, '#2b3a4a');
        grad.addColorStop(1, '#3f5366');
        g.fillStyle = grad;
        g.fillRect(px, py, 40, 44);
        g.fillStyle = '#c8c8c8';
        g.fillRect(px - 2, py + 44, 44, 4); // sill
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3c3c42';
  g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 900; k++) {
    const v = 50 + Math.random() * 20;
    g.fillStyle = `rgb(${v},${v},${v + 4})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1);
  }
  g.fillStyle = '#e8e8e8';
  g.fillRect(5, 0, 2, 128);
  g.fillRect(121, 0, 2, 128);
  g.fillStyle = '#f2c230';
  g.fillRect(61, 0, 2, 128);
  g.fillRect(65, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}