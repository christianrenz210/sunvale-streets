export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

export function dampAngle(a: number, b: number, lambda: number, dt: number) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

export function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Small deterministic PRNG so the city is identical on every device. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
export function pick<T>(arr: readonly T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)];
}

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

/**
 * Pushes a circle out of an AABB. Returns the push normal (x,z) scaled by depth, or null if no overlap.
 */
export function circleVsAABB(x: number, z: number, r: number, b: AABB): [number, number] | null {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = r - d;
    return [(dx / d) * push, (dz / d) * push];
  }
  // centre inside the box: push out along the shallowest axis
  const left = x - b.minX + r;
  const right = b.maxX - x + r;
  const top = z - b.minZ + r;
  const bottom = b.maxZ - z + r;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return [-left, 0];
  if (m === right) return [right, 0];
  if (m === top) return [0, -top];
  return [0, bottom];
}

/** Ray (origin o, unit dir d) vs AABB extruded from y=0 to height. Returns distance or -1. */
export function rayVsAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: AABB, maxDist: number,
): number {
  let tmin = 0;
  let tmax = maxDist;
  const axes: [number, number, number, number][] = [
    [ox, dx, b.minX, b.maxX],
    [oy, dy, 0, b.height],
    [oz, dz, b.minZ, b.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** Ray vs sphere; returns distance or -1. */
export function rayVsSphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number,
): number {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}

export function formatMoney(n: number) {
  return '$' + Math.floor(n).toString().padStart(8, '0');
}
