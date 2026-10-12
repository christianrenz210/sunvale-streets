import * as THREE from 'three';

const _c = new THREE.Color();

/**
 * Accumulates coloured (optionally textured) boxes into one BufferGeometry so a whole
 * character, car body or city district renders in a single draw call.
 */
export class BoxBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  private quad(
    a: number[], b: number[], c: number[], d: number[],
    n: number[], color: THREE.Color, uvs: number[],
  ) {
    const base = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) {
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
    this.uv.push(...uvs);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * Adds an axis-aligned box. (x, y, z) is the centre of the bottom face.
   * uvScale > 0 maps the wall texture in world units (one tile = uvScale units); top/bottom
   * get a constant UV so they sample the plain wall colour in the texture corner.
   */
  addBox(
    x: number, y: number, z: number, w: number, h: number, d: number,
    color: THREE.ColorRepresentation,
    opts: { uvScale?: number; skipBottom?: boolean; skipTop?: boolean; rotY?: number; topColor?: THREE.ColorRepresentation } = {},
  ) {
    const col = _c.set(color).clone();
    const topCol = opts.topColor !== undefined ? new THREE.Color(opts.topColor) : col;
    const hw = w / 2, hd = d / 2;
    const y0 = y, y1 = y + h;
    const s = opts.uvScale ?? 0;
    const rot = opts.rotY ?? 0;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const P = (px: number, py: number, pz: number) => [x + px * cs + pz * sn, py, z - px * sn + pz * cs];
    const N = (nx: number, ny: number, nz: number) => [nx * cs + nz * sn, ny, -nx * sn + nz * cs];
    const wallUV = (len: number) => (s > 0 ? [0, y0 / s, len / s, y0 / s, len / s, y1 / s, 0, y1 / s] : [0, 0, 0, 0, 0, 0, 0, 0]);
    const flat = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
    // +Z (front)
    this.quad(P(-hw, y0, hd), P(hw, y0, hd), P(hw, y1, hd), P(-hw, y1, hd), N(0, 0, 1), col, wallUV(w));
    // -Z (back)
    this.quad(P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y1, -hd), P(hw, y1, -hd), N(0, 0, -1), col, wallUV(w));
    // +X
    this.quad(P(hw, y0, hd), P(hw, y0, -hd), P(hw, y1, -hd), P(hw, y1, hd), N(1, 0, 0), col, wallUV(d));
    // -X
    this.quad(P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, y1, hd), P(-hw, y1, -hd), N(-1, 0, 0), col, wallUV(d));
    if (!opts.skipTop) this.quad(P(-hw, y1, hd), P(hw, y1, hd), P(hw, y1, -hd), P(-hw, y1, -hd), N(0, 1, 0), topCol, flat);
    if (!opts.skipBottom) this.quad(P(-hw, y0, -hd), P(hw, y0, -hd), P(hw, y0, hd), P(-hw, y0, hd), N(0, -1, 0), col, flat);
  }

  /** Four-sided pyramid roof sitting on y. */
  addPyramid(x: number, y: number, z: number, w: number, d: number, h: number, color: THREE.ColorRepresentation) {
    const col = _c.set(color).clone();
    const hw = w / 2, hd = d / 2;
    const apex = [x, y + h, z];
    const corners = [
      [x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, y, z - hd], [x - hw, y, z - hd],
    ];
    const flat = [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const e2 = new THREE.Vector3(apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]);
      const n = e1.cross(e2).normalize();
      // degenerate quad (triangle) keeps the index layout uniform
      this.quad(a, b, apex, apex, [n.x, n.y, n.z], col, flat);
    }
  }

  /** Flat horizontal quad (for markings, lots, grass) at height y. */
  addFlat(x: number, y: number, z: number, w: number, d: number, color: THREE.ColorRepresentation, uvs?: number[]) {
    const col = _c.set(color).clone();
    const hw = w / 2, hd = d / 2;
    this.quad([x - hw, y, z + hd], [x + hw, y, z + hd], [x + hw, y, z - hd], [x - hw, y, z - hd], [0, 1, 0], col,
      uvs ?? [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01]);
  }

  get empty() {
    return this.idx.length === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Rewrites every vertex colour of a geometry that matches `from` to `to` (used for repainting cars). */
export function recolor(g: THREE.BufferGeometry, from: THREE.Color, to: THREE.Color) {
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) {
    if (Math.abs(c.getX(i) - from.r) < 0.002 && Math.abs(c.getY(i) - from.g) < 0.002 && Math.abs(c.getZ(i) - from.b) < 0.002) {
      c.setXYZ(i, to.r, to.g, to.b);
    }
  }
  c.needsUpdate = true;
}
