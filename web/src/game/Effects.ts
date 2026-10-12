import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  grow: number;
  gravity: number;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const sphereGeo = new THREE.IcosahedronGeometry(1, 1);

/** Pooled short-lived visuals: tracers, muzzle flashes, blood, sparks, smoke, fire, explosions. */
export class Effects {
  private particles: Particle[] = [];
  private free: THREE.Mesh[] = [];
  private tracers: { line: THREE.Line; life: number }[] = [];
  private flash: THREE.PointLight;
  private flashLife = 0;
  private mats = {
    blood: new THREE.MeshBasicMaterial({ color: 0x9b0000 }),
    spark: new THREE.MeshBasicMaterial({ color: 0xffd36e }),
    smoke: new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.55, depthWrite: false }),
    fire: new THREE.MeshBasicMaterial({ color: 0xff7b00, transparent: true, opacity: 0.9, depthWrite: false }),
    boom: new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85, depthWrite: false }),
    debris: new THREE.MeshLambertMaterial({ color: 0x222222 }),
    money: new THREE.MeshBasicMaterial({ color: 0x2ecc71 }),
  };
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.9 });

  constructor(private scene: THREE.Scene) {
    this.flash = new THREE.PointLight(0xffaa55, 0, 30, 2);
    scene.add(this.flash);
  }

  private spawn(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, size: number, life: number, vx: number, vy: number, vz: number, gravity: number, grow = 0) {
    if (this.particles.length > 260) return;
    const m = this.free.pop() ?? new THREE.Mesh(boxGeo);
    m.geometry = geo;
    m.material = mat;
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.visible = true;
    if (!m.parent) this.scene.add(m);
    this.particles.push({ mesh: m, vx, vy, vz, life, maxLife: life, grow, gravity });
  }

  blood(x: number, y: number, z: number) {
    for (let i = 0; i < 8; i++) {
      this.spawn(this.mats.blood, boxGeo, x, y, z, 0.08 + Math.random() * 0.08, 0.5 + Math.random() * 0.3,
        (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 12);
    }
  }

  sparks(x: number, y: number, z: number, n = 6) {
    for (let i = 0; i < n; i++) {
      this.spawn(this.mats.spark, boxGeo, x, y, z, 0.06, 0.25 + Math.random() * 0.2,
        (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 15);
    }
  }

  smoke(x: number, y: number, z: number, dark = false) {
    this.spawn(this.mats.smoke, sphereGeo, x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5, 0.3, 1.6,
      (Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6, 0, dark ? 1.2 : 0.8);
  }

  fire(x: number, y: number, z: number) {
    this.spawn(this.mats.fire, sphereGeo, x + (Math.random() - 0.5) * 1.5, y, z + (Math.random() - 0.5) * 1.5, 0.35, 0.5,
      0, 2.5 + Math.random() * 2, 0, 0, -0.4);
  }

  moneyBurst(x: number, y: number, z: number) {
    for (let i = 0; i < 6; i++) {
      this.spawn(this.mats.money, boxGeo, x, y, z, 0.12, 0.6, (Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3, 12);
    }
  }

  explosion(x: number, y: number, z: number) {
    this.spawn(this.mats.boom, sphereGeo, x, y + 1, z, 1, 0.6, 0, 0, 0, 0, 14);
    for (let i = 0; i < 14; i++) this.fire(x, y + 0.5, z);
    for (let i = 0; i < 10; i++) {
      this.spawn(this.mats.debris, boxGeo, x, y + 1, z, 0.2 + Math.random() * 0.3, 1.5,
        (Math.random() - 0.5) * 14, 6 + Math.random() * 8, (Math.random() - 0.5) * 14, 20);
    }
    for (let i = 0; i < 8; i++) this.smoke(x, y + 1.5, z, true);
    this.flash.position.set(x, y + 3, z);
    this.flash.intensity = 120;
    this.flashLife = 0.35;
  }

  muzzle(x: number, y: number, z: number) {
    this.spawn(this.mats.spark, sphereGeo, x, y, z, 0.15, 0.05, 0, 0, 0, 0, 2);
    this.flash.position.set(x, y, z);
    this.flash.intensity = Math.max(this.flash.intensity, 8);
    this.flashLife = Math.max(this.flashLife, 0.05);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this.tracerMat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        this.free.push(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05 && p.gravity > 0) {
        p.mesh.position.y = 0.05;
        p.vx *= 0.5; p.vz *= 0.5; p.vy = 0;
      }
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.intensity = 0;
    }
  }
}
