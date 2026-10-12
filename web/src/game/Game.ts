import * as THREE from 'three';
import './game.css';
import { World, GRID } from './World';
import { Character, OUTFITS } from './Character';
import { Vehicle, VehicleKind, CIVILIAN_KINDS, Controls } from './Vehicle';
import { Ped, PedKind, PedContext } from './Ped';
import { Effects } from './Effects';
import { Hud, Blip } from './Hud';
import { Input } from './Input';
import { GameAudio } from './Audio';
import { Missions, MissionHost, Marker } from './Missions';
import { BoxBuilder } from './geom';
import { SaveData, Settings, saveGame, vibrate } from './Save';
import { clamp, damp, dampAngle, dist2, lerp, mulberry32, pick, rand, rayVsSphere } from './utils';

type WeaponId = 'fist' | 'pistol' | 'smg' | 'shotgun';

interface WeaponDef {
  name: string;
  dmg: number;
  range: number;
  cd: number;
  auto: boolean;
  spread: number;
  pellets: number;
}

const WEAPONS: Record<WeaponId, WeaponDef> = {
  fist: { name: 'FIST', dmg: 24, range: 1.9, cd: 0.45, auto: false, spread: 0, pellets: 1 },
  pistol: { name: 'PISTOL', dmg: 34, range: 70, cd: 0.28, auto: false, spread: 0.015, pellets: 1 },
  smg: { name: 'SMG', dmg: 15, range: 55, cd: 0.085, auto: true, spread: 0.045, pellets: 1 },
  shotgun: { name: 'SHOTGUN', dmg: 18, range: 30, cd: 0.95, auto: false, spread: 0.09, pellets: 7 },
};
const WEAPON_ORDER: WeaponId[] = ['fist', 'pistol', 'smg', 'shotgun'];
const HEAT_FOR_STARS = [0, 1, 4, 10, 20, 35, 55];

interface Pickup {
  group: THREE.Object3D;
  x: number;
  z: number;
  type: 'health' | 'armor' | 'money' | WeaponId;
  amount: number;
  respawn: number;
  active: boolean;
  temp: boolean;
  life: number;
}

export interface GameCallbacks {
  onPause: () => void;
}

export interface GameStats {
  money: number;
  story: number;
  storyTotal: number;
  sideJobs: number;
  kills: number;
  carsStolen: number;
  missions: number;
  playTime: number;
  wasted: number;
  busted: number;
  nextMission: string;
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  effects: Effects;
  hud: Hud;
  input: Input;
  audio = new GameAudio();
  missions: Missions;

  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private headlight: THREE.SpotLight;
  private overlay: HTMLDivElement;
  private raf = 0;
  private last = 0;
  private running = false;
  private paused = false;

  // player
  private pc: Character;
  private pyaw = 0;
  private pvy = 0;
  private onGround = true;
  health = 100;
  armor = 0;
  money = 250;
  private weapons: Record<WeaponId, number> = { fist: 1, pistol: 0, smg: 0, shotgun: 0 };
  private weapon: WeaponId = 'fist';
  vehicle: Vehicle | null = null;
  private fireCd = 0;
  private punchT = 0;
  private aimT = 0;
  private dead = false;
  private deathT = 0;
  private deathKind: 'wasted' | 'busted' = 'wasted';
  private bustT = 0;
  private stolen = new Set<number>();
  private stats = { kills: 0, carsStolen: 0, missions: 0, playTime: 0, wastedCount: 0, bustedCount: 0 };

  // world entities
  private vehicles: Vehicle[] = [];
  private peds: Ped[] = [];
  private pedPool: Ped[] = [];
  private pickups: Pickup[] = [];
  private markerPool: THREE.Object3D[] = [];
  private markerGeo = {
    ring: new THREE.CylinderGeometry(1, 1, 1.4, 28, 1, true),
    cone: new THREE.ConeGeometry(0.45, 0.9, 4),
    tall: new THREE.CylinderGeometry(1, 1, 7, 28, 1, true),
  };
  private missionEntities: { vehicles: Vehicle[]; peds: Ped[] } = { vehicles: [], peds: [] };

  // wanted
  private heat = 0;
  wanted = 0;
  private unseenT = 0;
  private lastCrimeT = 0;

  // camera
  private camYaw = Math.PI;
  private camPitch = 0.25;
  private camManualT = 0;
  private shake = 0;
  private camPos = new THREE.Vector3();

  // misc
  private timeOfDay = 9;
  private spawnT = 0;
  private hudT = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private hintVehicle: Vehicle | null = null;
  private saveArmed = true;
  private sprayArmed = true;
  private giverArmed = true;
  private honkT = 0;
  private settings: Settings;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(private container: HTMLElement, settings: Settings, save: SaveData | null, private cb: GameCallbacks) {
    this.settings = settings;
    const high = settings.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'sv-canvas';
    container.appendChild(this.renderer.domElement);

    this.overlay = document.createElement('div');
    this.overlay.className = 'sv-overlay';
    container.appendChild(this.overlay);

    this.camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 1200);
    this.scene.fog = new THREE.Fog(0xbfe3ff, high ? 160 : 110, high ? 520 : 380);

    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x5a5040, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
    this.sun.castShadow = high;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    this.headlight = new THREE.SpotLight(0xfff4d0, 0, 60, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight, this.headlight.target);

    this.world = new World(settings.quality);
    this.scene.add(this.world.group);
    this.scene.add(this.world.sky);
    this.effects = new Effects(this.scene);
    this.hud = new Hud(this.overlay, this.world.minimapCanvas);
    const touch = settings.touch === 'on' || (settings.touch === 'auto' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
    this.input = new Input(this.renderer.domElement, this.overlay, touch);
    this.input.sensitivity = settings.sensitivity;
    this.audio.setVolume(settings.volume, settings.music);

    this.pc = new Character(OUTFITS.player);
    this.scene.add(this.pc.root);

    this.missions = new Missions(this.missionHost());
    if (save) {
      this.money = save.money;
      this.missions.story = save.story;
      this.missions.sideJobs = save.sideJobs;
      Object.assign(this.weapons, save.weapons);
      this.health = save.health || 100;
      this.armor = save.armor || 0;
      this.timeOfDay = save.timeOfDay ?? 9;
      Object.assign(this.stats, save.stats);
    }
    const home = this.world.pois.safehouse;
    this.placePlayer(home.x, home.z, 0);

    this.buildPickups();
    this.populate(true);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.__sunvale = {
      onBackPressed: () => {
        if (this.running && !this.paused) { this.cb.onPause(); return true; }
        return false;
      },
      onAppPause: () => { if (this.running && !this.paused) this.cb.onPause(); },
      onAppResume: () => {},
    };

    // test hook: open the game with ?debug to poke at it from the console
    if (location.search.includes('debug')) (window as unknown as { __svGame: Game }).__svGame = this;

    if (!save) {
      setTimeout(() => this.hud.help(touch
        ? 'Left side: move. Right side: look. Walk into the <b style="color:#ffd84d">yellow marker</b> to start the story.'
        : '<kbd>WASD</kbd> move, <kbd>Mouse</kbd> look (click to lock), <kbd>Shift</kbd> run, <kbd>Space</kbd> jump, <kbd>F</kbd> enter car, <kbd>Q</kbd> weapon, <kbd>Esc</kbd> pause. Walk into the <b style="color:#ffd84d">yellow marker</b> to start the story.', 12), 800);
    } else {
      setTimeout(() => this.hud.help('Welcome back to <b>Sunvale</b>.', 4), 800);
    }
  }

  // ================================================================ lifecycle

  start() {
    this.running = true;
    this.paused = false;
    this.last = performance.now();
    this.audio.unlock();
    this.loop();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    cancelAnimationFrame(this.raf);
    this.audio.setEngine(false, 0, 0);
    this.audio.setSiren(0);
    this.audio.suspend();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.audio.unlock();
    this.audio.resume();
    this.last = performance.now();
    this.loop();
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.input.sensitivity = s.sensitivity;
    this.audio.setVolume(s.volume, s.music);
    const high = s.quality === 'high';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    if (this.renderer.shadowMap.enabled !== high) {
      this.renderer.shadowMap.enabled = high;
      this.sun.castShadow = high;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    }
    this.hud.fps('');
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.hud.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
    delete window.__sunvale;
  }

  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onVisibility = () => {
    if (document.hidden && this.running && !this.paused) this.cb.onPause();
  };

  getSaveData(): SaveData {
    return {
      version: 1,
      money: this.money,
      story: this.missions.story,
      sideJobs: this.missions.sideJobs,
      weapons: { ...this.weapons },
      health: this.health,
      armor: this.armor,
      timeOfDay: this.timeOfDay,
      stats: { ...this.stats },
      savedAt: Date.now(),
    };
  }

  getStats(): GameStats {
    return {
      money: this.money,
      story: this.missions.story,
      storyTotal: this.missions.storyCount,
      sideJobs: this.missions.sideJobs,
      kills: this.stats.kills,
      carsStolen: this.stats.carsStolen,
      missions: this.stats.missions,
      playTime: this.stats.playTime,
      wasted: this.stats.wastedCount,
      busted: this.stats.bustedCount,
      nextMission: this.missions.active ? this.missions.active.def.title + ' (in progress)' : this.missions.nextTitle(),
    };
  }

  save() {
    saveGame(this.getSaveData());
  }

  private loop = () => {
    if (!this.running || this.paused) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.settings.showFps) {
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.hud.fps(`${Math.round(this.fpsFrames / this.fpsAcc)} FPS`);
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
  };

  // ================================================================ main update

  private update(dt: number) {
    this.input.update();
    this.stats.playTime += dt;
    if (this.input.pressed('pause')) {
      this.input.endFrame();
      this.cb.onPause();
      return;
    }

    this.updateTime(dt);
    if (this.dead) this.updateDeath(dt);
    else if (this.vehicle) this.updateDriving(dt);
    else this.updateOnFoot(dt);

    this.updateVehicles(dt);
    this.updatePeds(dt);
    this.updateWanted(dt);
    this.updatePickups(dt);
    this.missions.update(dt);
    this.updateMarkers(dt);
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      this.populate(false);
    }
    this.effects.update(dt);
    this.updateCamera(dt);
    this.updateHud(dt);
    this.audio.update(dt);
    this.input.setContext(!!this.vehicle, this.weapon !== 'fist');
    this.input.endFrame();
  }

  private updateTime(dt: number) {
    this.timeOfDay = (this.timeOfDay + dt / 60) % 24; // 1 real second = 1 game minute
    const elev = Math.sin(((this.timeOfDay - 6) / 24) * Math.PI * 2);
    const day = THREE.MathUtils.smoothstep(elev, -0.15, 0.3);
    const night = 1 - day;
    const sunset = Math.max(0, 1 - Math.abs(elev) * 4) * (elev > -0.2 ? 1 : 0);
    const az = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
    const dir = this.tmpV.set(Math.cos(az), Math.max(0.15, Math.abs(elev)), 0.35).normalize();
    const focus = this.vehicle ? this.vehicle.root.position : this.pc.root.position;
    this.sun.position.copy(focus).addScaledVector(dir, 150);
    this.sun.target.position.copy(focus);
    this.sun.intensity = 0.15 + 2.2 * day;
    this.sun.color.setRGB(1, lerp(0.95, 0.65, sunset), lerp(0.85, 0.45, sunset));
    this.hemi.intensity = 0.35 + 0.75 * day;
    this.hemi.color.setRGB(lerp(0.35, 0.87, day), lerp(0.4, 0.94, day), lerp(0.65, 1, day));

    const top = new THREE.Color(0x060b24).lerp(new THREE.Color(0x3a7bd5), day).lerp(new THREE.Color(0x4a3a7a), sunset * 0.5);
    const bottom = new THREE.Color(0x141a3a).lerp(new THREE.Color(0xbfe3ff), day).lerp(new THREE.Color(0xff9a55), sunset * 0.7);
    (this.scene.fog as THREE.Fog).color.copy(bottom);
    this.world.setNight(night, top, bottom);

    if (this.vehicle && night > 0.4) {
      const v = this.vehicle;
      this.headlight.intensity = 60 * night;
      this.headlight.position.set(v.x + v.fwdX * 2, 1.2, v.z + v.fwdZ * 2);
      this.headlight.target.position.set(v.x + v.fwdX * 20, 0, v.z + v.fwdZ * 20);
    } else this.headlight.intensity = 0;
  }

  // ================================================================ player

  private placePlayer(x: number, z: number, yaw: number) {
    const p = this.pc.root.position;
    p.set(x, this.world.groundHeight(x, z), z);
    this.pyaw = yaw;
    this.camYaw = yaw + Math.PI;
    this.pc.root.rotation.y = yaw;
    this.pc.root.visible = true;
  }

  get px() { return this.vehicle ? this.vehicle.x : this.pc.root.position.x; }
  get pz() { return this.vehicle ? this.vehicle.z : this.pc.root.position.z; }

  private updateOnFoot(dt: number) {
    const inp = this.input;
    const p = this.pc.root.position;
    this.camYaw -= inp.lookDX;
    this.camPitch = clamp(this.camPitch + inp.lookDY * (this.settings.invertY ? -1 : 1), -0.4, 1.1);

    const fwdX = -Math.sin(this.camYaw), fwdZ = -Math.cos(this.camYaw);
    const rgtX = Math.cos(this.camYaw), rgtZ = -Math.sin(this.camYaw);
    let mx = inp.moveX, my = inp.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    if (mag > 1e-3) { mx /= Math.hypot(inp.moveX, inp.moveY); my /= Math.hypot(inp.moveX, inp.moveY); }
    const sprint = inp.isHeld('sprint') || (inp.touchMode && mag > 0.95);
    const speed = (sprint ? 8.2 : 4.6) * mag;
    const dx = (fwdX * my + rgtX * mx) * speed, dz = (fwdZ * my + rgtZ * mx) * speed;
    p.x += dx * dt;
    p.z += dz * dt;

    // weapons
    if (inp.pressed('weapon')) this.cycleWeapon();
    this.fireCd -= dt;
    this.punchT = Math.max(0, this.punchT - dt * 2.5);
    const w = WEAPONS[this.weapon];
    const wantFire = w.auto ? inp.isHeld('attack') : inp.pressed('attack') || (inp.isHeld('attack') && inp.touchMode && this.weapon !== 'fist');
    if (wantFire && this.fireCd <= 0) {
      this.fireCd = w.cd;
      if (this.weapon === 'fist') this.punch();
      else this.shoot();
    }
    this.aimT = Math.max(0, this.aimT - dt);
    const aiming = this.weapon !== 'fist' && (this.aimT > 0 || inp.isHeld('attack'));

    if (aiming) this.pyaw = dampAngle(this.pyaw, this.camYaw + Math.PI, 18, dt);
    else if (speed > 0.1) this.pyaw = dampAngle(this.pyaw, Math.atan2(dx, dz), 12, dt);
    this.pc.root.rotation.y = this.pyaw;

    // jump & gravity
    const ground = this.world.groundHeight(p.x, p.z);
    if (inp.pressed('jump') && this.onGround) {
      this.pvy = 6.5;
      this.onGround = false;
    }
    this.pvy -= 20 * dt;
    p.y += this.pvy * dt;
    if (p.y <= ground) {
      p.y = ground;
      this.pvy = 0;
      this.onGround = true;
    }
    this.world.collide(p, 0.4, p.y);
    this.pushOutOfVehicles(p, 0.4);

    this.pc.gun.visible = this.weapon !== 'fist';
    this.pc.animate(dt, speed, { aiming, airborne: !this.onGround, punch: this.punchT });

    // enter vehicle
    const nearV = this.nearestVehicle(4.5);
    if (nearV && nearV !== this.hintVehicle && !inp.touchMode) {
      this.hud.help(`Press <kbd>F</kbd> to enter the <b>${nearV.spec.name}</b>`, 2.5);
    }
    this.hintVehicle = nearV;
    if (inp.pressed('enter') && nearV) this.enterVehicle(nearV);

    this.hud.crosshair(this.weapon !== 'fist' && !inp.touchMode);
  }

  private pushOutOfVehicles(p: { x: number; z: number }, r: number) {
    for (const v of this.vehicles) {
      if (dist2(p.x, p.z, v.x, v.z) > 36) continue;
      for (const [cx, cz, cr] of v.circles()) {
        const dx = p.x - cx, dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        const min = cr + r;
        if (d < min && d > 1e-4) {
          p.x += (dx / d) * (min - d);
          p.z += (dz / d) * (min - d);
        }
      }
    }
  }

  private nearestVehicle(maxD: number) {
    let best: Vehicle | null = null, bd = maxD * maxD;
    const p = this.pc.root.position;
    for (const v of this.vehicles) {
      if (v.wrecked) continue;
      const d = dist2(p.x, p.z, v.x, v.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  private enterVehicle(v: Vehicle) {
    if (v.driver === 'ai' || v.driver === 'police') {
      // car-jack: the driver gets thrown out
      const side = this.tmpV.set(-v.fwdZ, 0, v.fwdX).multiplyScalar(-(v.spec.wid / 2 + 1));
      const ex = v.x + side.x, ez = v.z + side.z;
      if (v.driver === 'police') {
        for (let i = 0; i < Math.max(1, v.copsInside); i++) this.spawnPed('cop', ex + i, ez);
        v.copsInside = 0;
        this.crime(6, true);
      } else {
        const ped = this.spawnPed('civ', ex, ez);
        ped.panic(v.x, v.z);
        this.crime(1, false);
      }
    }
    v.driver = 'player';
    v.persistent = true;
    this.vehicle = v;
    this.pc.root.visible = false;
    if (!this.stolen.has(v.id)) {
      this.stolen.add(v.id);
      this.stats.carsStolen++;
    }
    this.camManualT = 0;
    this.hud.vehicleName(v.spec.name, v.kind === 'police' ? 'Stolen police car!' : '');
    this.audio.setRadioActive(true);
    this.hud.crosshair(false);
  }

  private exitVehicle() {
    const v = this.vehicle!;
    for (const sgn of [-1, 1]) {
      const ox = -v.fwdZ * sgn * (v.spec.wid / 2 + 0.9), oz = v.fwdX * sgn * (v.spec.wid / 2 + 0.9);
      const pt = { x: v.x + ox, z: v.z + oz };
      const [px, pz] = this.world.collide(pt, 0.4, 0);
      if (Math.abs(px) + Math.abs(pz) < 0.3 || sgn === 1) {
        this.placePlayer(pt.x, pt.z, v.yaw);
        break;
      }
    }
    v.driver = 'none';
    this.vehicle = null;
    this.audio.setEngine(false, 0, 0);
    this.audio.setRadioActive(false);
    this.camYaw = v.yaw + Math.PI;
  }

  private updateDriving(dt: number) {
    const v = this.vehicle!;
    const inp = this.input;
    const c: Controls = { throttle: inp.moveY, steer: inp.moveX, handbrake: inp.isHeld('handbrake') };
    const impact = v.update(dt, c, this.world);
    if (impact > 5) {
      this.audio.crash(impact);
      this.shake = Math.min(1, this.shake + impact * 0.04);
      if (impact > 10) vibrate(Math.min(200, impact * 8));
    }
    if (inp.pressed('horn') || (inp.isHeld('horn') && this.honkT <= 0)) {
      this.audio.horn();
      this.honkT = 0.4;
      this.panicNear(v.x, v.z, 12);
    }
    this.honkT -= dt;
    if (inp.pressed('radio')) this.hud.vehicleName(this.audio.cycleRadio());
    this.audio.setEngine(!v.wrecked, v.speed / v.spec.maxSpeed, c.throttle);
    if (inp.pressed('enter') && Math.abs(v.speed) < 10) this.exitVehicle();
    if (v.wrecked && !this.dead) {
      this.exitVehicle();
    }
    // keep the hidden character with the car (for respawn/ejection)
    this.pc.root.position.set(v.x, v.root.position.y, v.z);
    this.camYaw -= inp.lookDX;
    this.camPitch = clamp(this.camPitch + inp.lookDY * (this.settings.invertY ? -1 : 1), -0.2, 1.0);
    if (inp.lookDX || inp.lookDY) this.camManualT = 1.5;
  }

  private cycleWeapon() {
    let i = WEAPON_ORDER.indexOf(this.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + 1) % WEAPON_ORDER.length;
      if (WEAPON_ORDER[i] === 'fist' || this.weapons[WEAPON_ORDER[i]] > 0) break;
    }
    this.weapon = WEAPON_ORDER[i];
    this.audio.click();
  }

  private punch() {
    this.punchT = 1;
    const p = this.pc.root.position;
    const fx = Math.sin(this.pyaw), fz = Math.cos(this.pyaw);
    let hit: Ped | null = null, bd = 4;
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const dx = ped.x - p.x, dz = ped.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd && (dx * fx + dz * fz) / Math.sqrt(d2 + 1e-6) > 0.4) { bd = d2; hit = ped; }
    }
    if (hit) {
      this.audio.punch();
      this.damagePed(hit, WEAPONS.fist.dmg, p.x, p.z, 7);
    } else this.audio.hit();
  }

  /** Fires the current gun along the camera's aim, with auto-aim on touch screens. */
  private shoot() {
    const w = WEAPONS[this.weapon];
    this.weapons[this.weapon]--;
    this.aimT = 1.2;
    const p = this.pc.root.position;
    const origin = this.tmpV.set(p.x, p.y + 1.45, p.z);
    // camera forward
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);

    // auto-aim (strong on touch, subtle with a mouse)
    const assist = this.input.touchMode ? 0.5 : 0.07;
    let target: Ped | null = null, bestA = assist;
    const hx = camDir.x, hz = camDir.z, hl = Math.hypot(hx, hz) || 1;
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const dx = ped.x - p.x, dz = ped.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range || d < 0.5) continue;
      const ang = Math.acos(clamp((dx * hx + dz * hz) / (d * hl), -1, 1));
      const score = ang - (ped.hostile || ped.kind === 'cop' ? 0.15 : 0);
      if (score < bestA && this.losFrom(p.x, p.z, ped.x, ped.z)) { bestA = score; target = ped; }
    }
    let dir: THREE.Vector3;
    if (target) {
      dir = new THREE.Vector3(target.x - origin.x, 1.1 - origin.y + target.root.position.y, target.z - origin.z).normalize();
      if (this.input.touchMode) this.pyaw = Math.atan2(dir.x, dir.z);
    } else {
      // aim at whatever the screen centre points at
      const camHit = this.camera.position.clone().addScaledVector(camDir, 60);
      dir = camHit.sub(origin).normalize();
    }
    const muzzle = origin.clone().addScaledVector(dir, 0.7);
    this.effects.muzzle(muzzle.x, muzzle.y, muzzle.z);
    this.audio.shot(this.weapon === 'fist' ? 'pistol' : this.weapon as 'pistol' | 'smg' | 'shotgun');
    vibrate(this.weapon === 'shotgun' ? 60 : 20);
    this.shake = Math.min(1, this.shake + (this.weapon === 'shotgun' ? 0.25 : 0.06));

    for (let i = 0; i < w.pellets; i++) {
      const d = dir.clone();
      d.x += (Math.random() - 0.5) * w.spread * 2;
      d.y += (Math.random() - 0.5) * w.spread * 2;
      d.z += (Math.random() - 0.5) * w.spread * 2;
      d.normalize();
      this.resolveShot(origin, d, w.range, w.dmg);
    }
    this.panicNear(p.x, p.z, 30);
    this.crime(0.35, false, 35);
    if (this.weapons[this.weapon] <= 0) {
      this.weapons[this.weapon] = 0;
      this.weapon = 'fist';
    }
  }

  private resolveShot(o: THREE.Vector3, d: THREE.Vector3, range: number, dmg: number) {
    let best = this.world.raycast(o, d, range);
    let hitPed: Ped | null = null;
    let hitCar: Vehicle | null = null;
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const py = ped.root.position.y;
      const t = rayVsSphere(o.x, o.y, o.z, d.x, d.y, d.z, ped.x, py + 1.0, ped.z, 0.55);
      const th = rayVsSphere(o.x, o.y, o.z, d.x, d.y, d.z, ped.x, py + 1.75, ped.z, 0.25);
      const tt = th >= 0 && (t < 0 || th < t) ? th : t;
      if (tt >= 0 && tt < best) { best = tt; hitPed = ped; hitCar = null; }
    }
    for (const v of this.vehicles) {
      if (v === this.vehicle) continue;
      for (const [cx, cz, r] of v.circles()) {
        const t = rayVsSphere(o.x, o.y, o.z, d.x, d.y, d.z, cx, 0.9, cz, r);
        if (t >= 0 && t < best) { best = t; hitCar = v; hitPed = null; }
      }
    }
    const end = this.tmpV2.copy(o).addScaledVector(d, best);
    this.effects.tracer(o.clone().addScaledVector(d, 0.8), end.clone());
    if (hitPed) {
      const head = end.y - hitPed.root.position.y > 1.5;
      this.damagePed(hitPed, head ? dmg * 2.5 : dmg, o.x, o.z, 2);
      this.effects.blood(end.x, end.y, end.z);
    } else if (hitCar) {
      this.damageVehicle(hitCar, dmg * 0.6, true);
      this.effects.sparks(end.x, end.y, end.z);
    } else if (best < range) {
      this.effects.sparks(end.x, end.y, end.z, 3);
    }
  }

  private damagePed(ped: Ped, dmg: number, fromX: number, fromZ: number, knock: number) {
    const killed = ped.takeDamage(dmg, fromX, fromZ, knock);
    if (ped.kind === 'gang') {
      for (const o of this.peds) if (o.kind === 'gang' && dist2(o.x, o.z, ped.x, ped.z) < 900) o.hostile = true;
    }
    if (ped.kind === 'cop') this.crime(killed ? 8 : 2, true);
    else if (ped.kind === 'civ') this.crime(killed ? 3 : 0.5, !killed ? false : false, killed ? 0 : 35);
    if (killed) {
      this.stats.kills++;
      if (ped.money > 0 || ped.kind !== 'civ') {
        this.addPickup(ped.kind === 'civ' ? 'money' : ped.kind === 'cop' ? 'pistol' : pick(['money', 'pistol', 'smg'] as const), ped.x + 0.6, ped.z, ped.kind === 'civ' ? ped.money : ped.kind === 'cop' ? 12 : 30, true);
      }
      this.panicNear(ped.x, ped.z, 25);
    }
  }

  private damageVehicle(v: Vehicle, amount: number, byPlayer: boolean) {
    v.damage(amount);
    if (byPlayer && v.kind === 'police' && v.driver === 'police') this.crime(1, true);
    if (byPlayer && v.driver === 'ai') {
      // drivers being shot at bail out sometimes
      if (Math.random() < 0.25) this.ejectDriver(v);
    }
  }

  private ejectDriver(v: Vehicle) {
    if (v.driver !== 'ai') return;
    v.driver = 'none';
    const ped = this.spawnPed('civ', v.x - v.fwdZ * (v.spec.wid / 2 + 0.9), v.z + v.fwdX * (v.spec.wid / 2 + 0.9));
    ped.panic(this.px, this.pz);
  }

  private hurtPlayer(amount: number) {
    if (this.dead) return;
    if (this.armor > 0) {
      const a = Math.min(this.armor, amount * 0.7);
      this.armor -= a;
      amount -= a;
    }
    this.health -= amount;
    this.hud.damageFlash();
    vibrate(40);
    if (this.health <= 0) this.die('wasted');
  }

  private die(kind: 'wasted' | 'busted') {
    if (this.dead) return;
    this.dead = true;
    this.deathKind = kind;
    this.deathT = 0;
    this.health = Math.max(0, this.health);
    if (this.vehicle) {
      const v = this.vehicle;
      this.vehicle = null;
      v.driver = 'none';
      this.placePlayer(v.x - v.fwdZ * 2, v.z + v.fwdX * 2, v.yaw);
    }
    this.audio.setEngine(false, 0, 0);
    this.audio.setRadioActive(false);
    if (kind === 'wasted') {
      this.pc.dead = true;
      this.hud.showBig('WASTED', '#c0392b', 4);
      this.audio.wasted();
      this.stats.wastedCount++;
    } else {
      this.hud.showBig('BUSTED', '#5dade2', 4);
      this.audio.missionFailed();
      this.stats.bustedCount++;
    }
    this.missions.fail(kind === 'wasted' ? 'You were wasted.' : 'You got busted.');
    vibrate(300);
  }

  private updateDeath(dt: number) {
    this.deathT += dt;
    this.pc.animate(dt, 0);
    if (this.deathT < 4) return;
    const poi = this.deathKind === 'wasted' ? this.world.pois.hospital : this.world.pois.police;
    this.dead = false;
    this.pc.revive();
    this.health = 100;
    this.armor = 0;
    if (this.deathKind === 'wasted') {
      const fee = Math.min(this.money, 100);
      this.money -= fee;
      this.hud.help(`Hospital bill: <b>$${fee}</b>`, 4);
    } else {
      const fine = Math.min(this.money, 200);
      this.money -= fine;
      this.weapons = { fist: 1, pistol: 0, smg: 0, shotgun: 0 };
      this.weapon = 'fist';
      this.hud.help(`Fine: <b>$${fine}</b>. Your weapons were confiscated.`, 4);
    }
    this.setWantedLevel(0);
    this.clearPolice();
    this.placePlayer(poi.x, poi.z, 0);
  }

  // ================================================================ wanted / police

  private crime(points: number, seenByCop: boolean, witnessRange = 0) {
    if (this.dead) return;
    if (!seenByCop && witnessRange > 0) {
      // only counts if someone saw it
      const wr = witnessRange * witnessRange;
      const witnessed = this.peds.some((p) => p.alive && dist2(p.x, p.z, this.px, this.pz) < wr);
      if (!witnessed) return;
    }
    this.heat = Math.min(HEAT_FOR_STARS[6], this.heat + points);
    this.lastCrimeT = 0;
    this.unseenT = 0;
    let stars = 0;
    for (let s = 1; s <= 6; s++) if (this.heat >= HEAT_FOR_STARS[s]) stars = s;
    stars = Math.min(5, stars);
    if (stars > this.wanted) {
      this.wanted = stars;
      this.audio.click();
    }
  }

  setWantedLevel(n: number) {
    this.wanted = n;
    this.heat = HEAT_FOR_STARS[n];
    this.unseenT = 0;
    if (n === 0) {
      for (const v of this.vehicles) if (v.driver === 'police') { v.sirenOn = false; v.driver = 'ai'; this.reroute(v); }
    }
  }

  private reroute(v: Vehicle) {
    const [i, j] = this.world.nearestNode(v.x, v.z);
    const n = pick(this.world.neighbors(i, j));
    v.fromI = i; v.fromJ = j; v.toI = n[0]; v.toJ = n[1];
    const [ex, ez] = v.laneStart(this.world);
    v.tx = ex; v.tz = ez;
    v.phase = 'turn';
  }

  private clearPolice() {
    for (const v of [...this.vehicles]) if (v.kind === 'police' && v !== this.vehicle && !v.persistent) this.removeVehicle(v);
    for (const p of [...this.peds]) if (p.kind === 'cop') this.removePed(p);
  }

  private losFrom(ax: number, az: number, bx: number, bz: number) {
    const o = this.tmpV2.set(ax, 1.5, az);
    const d = new THREE.Vector3(bx - ax, 0, bz - az);
    const len = d.length();
    if (len < 0.1) return true;
    d.divideScalar(len);
    return this.world.raycast(o, d, len) >= len - 0.5;
  }

  private updateWanted(dt: number) {
    this.lastCrimeT += dt;
    if (this.wanted === 0) { this.audio.setSiren(0); return; }
    const px = this.px, pz = this.pz;
    let seen = false, nearestCop = Infinity;
    for (const v of this.vehicles) {
      if (v.driver !== 'police') continue;
      const d = Math.sqrt(dist2(v.x, v.z, px, pz));
      nearestCop = Math.min(nearestCop, d);
      if (d < 18 || (d < 55 && this.losFrom(v.x, v.z, px, pz))) seen = true;
    }
    for (const p of this.peds) {
      if (p.kind !== 'cop' || !p.alive) continue;
      const d = Math.sqrt(dist2(p.x, p.z, px, pz));
      nearestCop = Math.min(nearestCop, d);
      if (d < 12 || (d < 45 && this.losFrom(p.x, p.z, px, pz))) seen = true;
    }
    this.audio.setSiren(clamp(1 - nearestCop / 120, 0, 1));
    if (seen) this.unseenT = 0;
    else {
      this.unseenT += dt;
      if (this.unseenT > 6 + this.wanted * 2.5) {
        this.setWantedLevel(this.wanted - 1);
        if (this.wanted === 0) this.hud.help('You lost the cops.', 3);
      }
    }

    // busted check
    if (!this.dead) {
      let close = false;
      for (const p of this.peds) {
        if (p.kind !== 'cop' || !p.alive) continue;
        const d2 = dist2(p.x, p.z, px, pz);
        if (!this.vehicle && d2 < 1.6 * 1.6) close = true;
        if (this.vehicle && Math.abs(this.vehicle.speed) < 1.5 && d2 < 3.2 * 3.2) close = true;
      }
      this.bustT = close ? this.bustT + dt : Math.max(0, this.bustT - dt * 2);
      if (this.bustT > (this.vehicle ? 2.2 : 1.4)) {
        this.bustT = 0;
        this.die('busted');
      }
    }
  }

  // ================================================================ vehicles

  private aiBlocked(v: Vehicle) {
    const fx = v.fwdX, fz = v.fwdZ, rx = -fz, rz = fx;
    const look = 4.5 + Math.max(0, v.speed) * 0.75;
    const check = (x: number, z: number, w: number) => {
      const dx = x - v.x, dz = z - v.z;
      const f = dx * fx + dz * fz;
      if (f < 1 || f > look) return false;
      return Math.abs(dx * rx + dz * rz) < w;
    };
    if (!this.vehicle && !this.dead && check(this.pc.root.position.x, this.pc.root.position.z, 1.8)) return 'player';
    for (const p of this.peds) if (p.alive && check(p.x, p.z, 1.6)) return 'ped';
    if (v.blockedT < 5) {
      for (const o of this.vehicles) if (o !== v && check(o.x, o.z, 2.3)) return o === this.vehicle ? 'player' : 'car';
    }
    return null;
  }

  private updateVehicles(dt: number) {
    const px = this.px, pz = this.pz;
    for (const v of this.vehicles) {
      if (v === this.vehicle) continue;
      let c: Controls = { throttle: 0, steer: 0, handbrake: true };
      if (v.driver === 'ai' && !v.wrecked) {
        const blocked = this.aiBlocked(v);
        c = v.aiControls(dt, this.world, !!blocked);
        if (blocked === 'player' && v.blockedT > 1.2 && v.honkT <= 0 && dist2(v.x, v.z, px, pz) < 900) {
          this.audio.horn();
          v.honkT = 2.5;
        }
        v.honkT -= dt;
      } else if (v.driver === 'police' && !v.wrecked) {
        const d = Math.sqrt(dist2(v.x, v.z, px, pz));
        const direct = d < 40 && this.losFrom(v.x, v.z, px, pz);
        const lead = this.vehicle ? 0.6 : 0;
        const tx = px + (this.vehicle ? this.vehicle.velX * lead : 0);
        const tz = pz + (this.vehicle ? this.vehicle.velZ * lead : 0);
        c = v.aiControls(dt, this.world, false, { x: tx, z: tz, direct });
        // cops bail out to arrest/shoot when close
        if (v.copsInside > 0 && d < 16 && (!this.vehicle || Math.abs(this.vehicle.speed) < 5) && Math.abs(v.speed) < 6) {
          const cops = this.peds.filter((p) => p.kind === 'cop').length;
          for (let i = 0; i < v.copsInside && cops + i < 10; i++) {
            const s = i === 0 ? -1 : 1;
            this.spawnPed('cop', v.x - v.fwdZ * s * (v.spec.wid / 2 + 0.9), v.z + v.fwdX * s * (v.spec.wid / 2 + 0.9));
          }
          v.copsInside = 0;
          v.driver = 'none';
        }
      }
      v.update(dt, c, this.world);
    }

    this.vehicleCollisions();

    for (const v of [...this.vehicles]) {
      // damage effects & explosions
      if (!v.wrecked) {
        const hp = v.health / v.spec.health;
        if (hp < 0.35 && Math.random() < dt * (hp < 0.15 ? 14 : 5)) this.effects.smoke(v.x + v.fwdX * v.spec.len * 0.35, v.root.position.y + 1.1, v.z + v.fwdZ * v.spec.len * 0.35, hp < 0.15);
        if (v.health <= 0) {
          v.burning += dt;
          if (Math.random() < dt * 20) this.effects.fire(v.x + v.fwdX * v.spec.len * 0.35, v.root.position.y + 1, v.z + v.fwdZ * v.spec.len * 0.35);
          if (v.burning > 3.5) this.explode(v);
        }
      } else {
        v.wreckT += dt;
        if (v.wreckT < 20 && Math.random() < dt * 6) this.effects.smoke(v.x, 1.2, v.z, true);
        if (v.wreckT > 45 && !v.missionTarget) this.removeVehicle(v);
      }
    }
  }

  private vehicleCollisions() {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (dist2(a.x, a.z, b.x, b.z) > 49) continue;
        const ca = a.circles(), cb = b.circles();
        for (const [ax, az, ar] of ca) {
          for (const [bx, bz, br] of cb) {
            const dx = bx - ax, dz = bz - az;
            const d = Math.hypot(dx, dz);
            const min = ar + br;
            if (d >= min || d < 1e-4) continue;
            const nx = dx / d, nz = dz / d;
            const pen = min - d;
            const ma = a.spec.mass * (a.driver === 'none' && !a.wrecked ? 1.5 : 1), mb = b.spec.mass * (b.driver === 'none' && !b.wrecked ? 1.5 : 1);
            const ta = mb / (ma + mb), tb = ma / (ma + mb);
            a.root.position.x -= nx * pen * ta;
            a.root.position.z -= nz * pen * ta;
            b.root.position.x += nx * pen * tb;
            b.root.position.z += nz * pen * tb;
            const rv = (b.velX - a.velX) * nx + (b.velZ - a.velZ) * nz;
            if (rv < 0) {
              const imp = -rv * 1.3;
              a.velX -= nx * imp * ta; a.velZ -= nz * imp * ta;
              b.velX += nx * imp * tb; b.velZ += nz * imp * tb;
              a.speed *= 0.85; b.speed *= 0.85;
              if (-rv > 7) {
                const playerInvolved = a === this.vehicle || b === this.vehicle;
                this.damageVehicle(a, -rv * 1.2 * ta * 2, playerInvolved);
                this.damageVehicle(b, -rv * 1.2 * tb * 2, playerInvolved);
                if (playerInvolved) {
                  this.audio.crash(-rv);
                  this.shake = Math.min(1, this.shake + -rv * 0.03);
                  vibrate(80);
                }
              }
            }
          }
        }
      }
    }

    // vehicles vs peds and the player on foot
    for (const v of vs) {
      const spd = Math.hypot(v.velX, v.velZ);
      for (const p of this.peds) {
        if (!p.alive || dist2(p.x, p.z, v.x, v.z) > 16) continue;
        for (const [cx, cz, r] of v.circles()) {
          const dx = p.x - cx, dz = p.z - cz;
          const d = Math.hypot(dx, dz);
          if (d > r + 0.35) continue;
          if (spd > 5) {
            const byPlayer = v === this.vehicle;
            const killed = p.takeDamage(spd * 9, v.x - v.velX, v.z - v.velZ, spd * 0.8);
            this.effects.blood(p.x, 1, p.z);
            this.audio.hit();
            if (byPlayer) {
              if (p.kind === 'cop') this.crime(killed ? 8 : 2, true);
              else this.crime(killed ? 3 : 1, false, killed ? 0 : 30);
              if (killed) this.stats.kills++;
              this.panicNear(p.x, p.z, 20);
            }
          } else if (d > 1e-4) {
            p.root.position.x += (dx / d) * (r + 0.35 - d);
            p.root.position.z += (dz / d) * (r + 0.35 - d);
            if (spd > 1.5) p.panic(v.x, v.z);
          }
          break;
        }
      }
      if (!this.vehicle && !this.dead && spd > 6) {
        const pp = this.pc.root.position;
        if (dist2(pp.x, pp.z, v.x, v.z) < 9) {
          for (const [cx, cz, r] of v.circles()) {
            if (Math.hypot(pp.x - cx, pp.z - cz) < r + 0.4) {
              this.hurtPlayer(spd * 2.2);
              this.pvy = 4;
              this.onGround = false;
              pp.x += v.velX * 0.12;
              pp.z += v.velZ * 0.12;
              this.audio.hit();
              break;
            }
          }
        }
      }
    }
  }

  private explode(v: Vehicle) {
    v.wreck();
    this.effects.explosion(v.x, v.root.position.y, v.z);
    this.audio.explosion();
    const pd = Math.sqrt(dist2(v.x, v.z, this.px, this.pz));
    this.shake = Math.min(1.5, this.shake + Math.max(0, 1.2 - pd / 40));
    vibrate(250);
    if (v === this.vehicle) {
      this.hurtPlayer(500);
    } else if (pd < 8) this.hurtPlayer(70 * (1 - pd / 8));
    for (const p of this.peds) {
      const d = Math.sqrt(dist2(p.x, p.z, v.x, v.z));
      if (d < 8) {
        if (p.takeDamage(150 * (1 - d / 8) + 20, v.x, v.z, 12)) this.stats.kills++;
      } else if (d < 30) p.panic(v.x, v.z);
    }
    for (const o of this.vehicles) {
      if (o === v || o.wrecked) continue;
      const d = Math.sqrt(dist2(o.x, o.z, v.x, v.z));
      if (d < 8) {
        o.damage(90 * (1 - d / 8));
        const dx = (o.x - v.x) / (d || 1), dz = (o.z - v.z) / (d || 1);
        o.velX += dx * 10; o.velZ += dz * 10;
      }
    }
    if (pd < 60 && this.vehicle !== v) this.crime(v.kind === 'police' ? 4 : 2, false, 40);
  }

  // ================================================================ peds

  private pedCtx(dt: number): PedContext {
    return {
      world: this.world,
      dt,
      playerX: this.px,
      playerZ: this.pz,
      playerAlive: !this.dead,
      playerInVehicle: !!this.vehicle,
      wanted: this.wanted,
      fire: (p) => this.pedFire(p),
      hasLineOfSight: (x, z) => this.losFrom(x, z, this.px, this.pz),
    };
  }

  private updatePeds(dt: number) {
    const ctx = this.pedCtx(dt);
    for (const p of this.peds) p.update(ctx);
    // cheap separation between the player and nearby peds
    if (!this.vehicle) {
      const pp = this.pc.root.position;
      for (const p of this.peds) {
        if (!p.alive) continue;
        const dx = pp.x - p.x, dz = pp.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 1e-4) {
          pp.x += (dx / d) * (0.75 - d) * 0.5;
          pp.z += (dz / d) * (0.75 - d) * 0.5;
          p.root.position.x -= (dx / d) * (0.75 - d) * 0.5;
          p.root.position.z -= (dz / d) * (0.75 - d) * 0.5;
        }
      }
    }
  }

  private pedFire(p: Ped) {
    const px = this.px, pz = this.pz;
    const py = this.vehicle ? 1.0 : this.pc.root.position.y + 1.2;
    const d = Math.sqrt(dist2(p.x, p.z, px, pz));
    const moving = this.vehicle ? Math.abs(this.vehicle.speed) : 3;
    let chance = (p.kind === 'cop' ? 0.45 + this.wanted * 0.05 : 0.38) - d / 80 - moving / 60;
    chance = clamp(chance, 0.08, 0.75);
    const hit = Math.random() < chance;
    const from = new THREE.Vector3(p.x + Math.sin(p.yaw) * 0.6, p.root.position.y + 1.45, p.z + Math.cos(p.yaw) * 0.6);
    const to = new THREE.Vector3(px, py, pz);
    if (!hit) to.add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.5, 1), rand(-1.5, 1.5)));
    this.effects.tracer(from, to);
    this.effects.muzzle(from.x, from.y, from.z);
    this.audio.shot('pistol', clamp(1 - d / 60, 0.1, 0.7));
    if (hit) {
      if (this.vehicle) {
        this.vehicle.damage(6);
        this.effects.sparks(to.x, to.y, to.z, 3);
        if (Math.random() < 0.25) this.hurtPlayer(4);
      } else {
        this.hurtPlayer(p.kind === 'cop' ? 8 : 9);
        this.effects.blood(to.x, to.y, to.z);
      }
    }
  }

  private panicNear(x: number, z: number, r: number) {
    const r2 = r * r;
    for (const p of this.peds) if (p.kind === 'civ' && dist2(p.x, p.z, x, z) < r2) p.panic(x, z);
  }

  private spawnPed(kind: PedKind, x: number, z: number): Ped {
    const idx = this.pedPool.findIndex((p) => p.kind === kind);
    const ped = idx >= 0 ? this.pedPool.splice(idx, 1)[0] : new Ped(kind);
    ped.spawn(x, z, this.world);
    this.scene.add(ped.root);
    this.peds.push(ped);
    return ped;
  }

  private removePed(p: Ped) {
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
    this.scene.remove(p.root);
    if (this.pedPool.length < 40) this.pedPool.push(p);
    else p.char.dispose();
  }

  private spawnVehicle(kind: VehicleKind, x: number, z: number, yaw: number, color?: number) {
    const v = new Vehicle(kind, color);
    v.place(x, z, yaw);
    v.root.position.y = this.world.groundHeight(x, z);
    this.scene.add(v.root);
    this.vehicles.push(v);
    return v;
  }

  private removeVehicle(v: Vehicle) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    this.scene.remove(v.root);
    v.body.geometry.dispose();
    v.lights.geometry.dispose();
    if (this.hintVehicle === v) this.hintVehicle = null;
  }

  // ================================================================ population

  private populate(initial: boolean) {
    const px = this.px, pz = this.pz;
    const high = this.settings.quality === 'high';
    const camFx = -Math.sin(this.camYaw), camFz = -Math.cos(this.camYaw);
    const hidden = (x: number, z: number, minD: number) => {
      const dx = x - px, dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d < minD) return false;
      if (initial) return true;
      return d > 120 || (dx * camFx + dz * camFz) / d < 0.2;
    };

    // despawn
    for (const v of [...this.vehicles]) {
      if (v === this.vehicle || v.persistent || v.missionTarget) continue;
      const d2 = dist2(v.x, v.z, px, pz);
      if (d2 > 190 * 190) this.removeVehicle(v);
    }
    for (const v of this.vehicles) {
      if (v.persistent && v !== this.vehicle && !v.missionTarget && dist2(v.x, v.z, px, pz) > 260 * 260) v.persistent = false;
    }
    for (const p of [...this.peds]) {
      if (p.missionTarget) continue;
      const d2 = dist2(p.x, p.z, px, pz);
      if (d2 > 140 * 140 || (p.state === 'dead' && p.deadT > 25)) this.removePed(p);
    }

    // traffic
    const traffic = this.vehicles.filter((v) => v.driver === 'ai').length;
    const wantTraffic = high ? 22 : 14;
    for (let n = 0; n < (initial ? wantTraffic : 2) && traffic + n < wantTraffic; n++) {
      const [ni, nj] = this.world.nearestNode(px + rand(-140, 140), pz + rand(-140, 140));
      const nb = pick(this.world.neighbors(ni, nj));
      const kind = pick(CIVILIAN_KINDS);
      const v = new Vehicle(kind);
      v.setRoute(this.world, ni, nj, nb[0], nb[1]);
      // advance a random amount along the lane
      const t = rand(0.1, 0.7);
      v.root.position.x = lerp(v.root.position.x, v.tx, t);
      v.root.position.z = lerp(v.root.position.z, v.tz, t);
      if (!hidden(v.x, v.z, 45) || this.vehicles.some((o) => dist2(o.x, o.z, v.x, v.z) < 100)) {
        v.body.geometry.dispose();
        v.lights.geometry.dispose();
        continue;
      }
      v.driver = 'ai';
      v.cruise = rand(11, 16);
      this.scene.add(v.root);
      this.vehicles.push(v);
    }

    // parked cars
    const parked = this.vehicles.filter((v) => v.driver === 'none' && !v.wrecked && !v.persistent).length;
    const wantParked = high ? 14 : 9;
    for (let n = 0; n < (initial ? 30 : 3) && parked + n < wantParked; n++) {
      const s = this.world.parkingSpots[Math.floor(Math.random() * this.world.parkingSpots.length)];
      const d2 = dist2(s.x, s.z, px, pz);
      if (d2 > 150 * 150 || !hidden(s.x, s.z, 30)) continue;
      if (this.vehicles.some((o) => dist2(o.x, o.z, s.x, s.z) < 30)) continue;
      this.spawnVehicle(pick(CIVILIAN_KINDS), s.x, s.z, s.yaw);
    }

    // pedestrians
    const civs = this.peds.filter((p) => p.kind !== 'cop' && !p.missionTarget).length;
    const wantPeds = high ? 32 : 20;
    for (let n = 0; n < (initial ? wantPeds : 3) && civs + n < wantPeds; n++) {
      const b = this.world.blockAt(px + rand(-110, 110), pz + rand(-110, 110));
      if (!b) continue;
      const loop = this.world.sidewalkLoop(b.i, b.j);
      const k = Math.floor(Math.random() * 4);
      const [ax, az] = loop[k], [bx, bz] = loop[(k + 1) % 4];
      const t = Math.random();
      const x = lerp(ax, bx, t), z = lerp(az, bz, t);
      if (!hidden(x, z, 35)) continue;
      const gangTurf = this.world.districtAt(x, z) === 'Old Town' && Math.random() < 0.2;
      this.spawnPed(gangTurf ? 'gang' : 'civ', x, z);
    }

    // police
    if (this.wanted > 0 && !this.dead) {
      const cars = this.vehicles.filter((v) => v.driver === 'police').length;
      const want = Math.min(high ? 5 : 3, this.wanted + (this.wanted >= 3 ? 1 : 0));
      if (cars < want) {
        for (let tries = 0; tries < 6; tries++) {
          const a = Math.random() * Math.PI * 2;
          const r = rand(80, 130);
          const [ni, nj] = this.world.nearestNode(px + Math.cos(a) * r, pz + Math.sin(a) * r);
          const nb = this.world.neighbors(ni, nj);
          const [pi, pj] = this.world.nearestNode(px, pz);
          // head roughly toward the player
          nb.sort((m, n) => Math.abs(m[0] - pi) + Math.abs(m[1] - pj) - (Math.abs(n[0] - pi) + Math.abs(n[1] - pj)));
          const v = new Vehicle('police');
          v.setRoute(this.world, ni, nj, nb[0][0], nb[0][1]);
          if (Math.sqrt(dist2(v.x, v.z, px, pz)) < 60 || this.vehicles.some((o) => dist2(o.x, o.z, v.x, v.z) < 64)) {
            v.body.geometry.dispose();
            v.lights.geometry.dispose();
            continue;
          }
          v.driver = 'police';
          v.sirenOn = true;
          v.copsInside = 2;
          this.scene.add(v.root);
          this.vehicles.push(v);
          break;
        }
      }
    }
    // stray cops wander off when not wanted
    if (this.wanted === 0) {
      for (const p of [...this.peds]) if (p.kind === 'cop' && dist2(p.x, p.z, px, pz) > 90 * 90) this.removePed(p);
    }
  }

  // ================================================================ pickups & markers

  private makePickupMesh(type: Pickup['type']) {
    const b = new BoxBuilder();
    switch (type) {
      case 'health':
        b.addBox(0, -0.35, 0, 0.7, 0.7, 0.25, 0xffffff);
        b.addBox(0, -0.25, 0.13, 0.5, 0.15, 0.02, 0xd62828);
        b.addBox(0, -0.25 - 0.17 + 0.075, 0.13, 0.15, 0.5, 0.02, 0xd62828);
        break;
      case 'armor':
        b.addBox(0, -0.4, 0, 0.6, 0.75, 0.3, 0x1d4ed8);
        b.addBox(0, -0.15, 0.16, 0.3, 0.25, 0.02, 0xffffff);
        break;
      case 'money':
        b.addBox(0, -0.2, 0, 0.6, 0.3, 0.35, 0x2ecc71);
        b.addBox(0, -0.07, 0, 0.62, 0.06, 0.1, 0xffffff);
        break;
      default:
        b.addBox(0, -0.1, 0, 0.12, 0.18, type === 'shotgun' ? 1.1 : type === 'smg' ? 0.6 : 0.45, 0x2b2b2b);
        b.addBox(0, -0.35, -0.05, 0.1, 0.3, 0.12, 0x5d4037);
        if (type === 'smg') b.addBox(0, -0.4, 0.15, 0.08, 0.3, 0.08, 0x2b2b2b);
    }
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x222222 }));
    const g = new THREE.Group();
    mesh.position.y = 1.2;
    g.add(mesh);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 20), new THREE.MeshBasicMaterial({
      color: type === 'health' ? 0xff5555 : type === 'armor' ? 0x55aaff : type === 'money' ? 0x55ff88 : 0xffdd55,
      transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
    }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    g.add(glow);
    return g;
  }

  private addPickup(type: Pickup['type'], x: number, z: number, amount: number, temp: boolean) {
    const group = this.makePickupMesh(type);
    group.position.set(x, this.world.groundHeight(x, z), z);
    this.scene.add(group);
    this.pickups.push({ group, x, z, type, amount, respawn: 0, active: true, temp, life: 30 });
  }

  private buildPickups() {
    const r = mulberry32(42);
    const hosp = this.world.pois.hospital, pol = this.world.pois.police, home = this.world.pois.safehouse;
    this.addPickup('health', hosp.x + 4, hosp.z, 100, false);
    this.addPickup('armor', pol.x - 4, pol.z, 100, false);
    this.addPickup('health', home.x - 14, home.z + 6, 100, false);
    const types: Pickup['type'][] = ['health', 'health', 'health', 'armor', 'armor', 'pistol', 'pistol', 'smg', 'smg', 'shotgun', 'shotgun',
      'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'health', 'armor', 'pistol', 'money', 'money'];
    for (const t of types) {
      const i = Math.floor(r() * GRID), j = Math.floor(r() * GRID);
      const loop = this.world.sidewalkLoop(i, j);
      const [x, z] = loop[Math.floor(r() * 4)];
      const amount = t === 'money' ? 100 + Math.floor(r() * 400) : t === 'pistol' ? 40 : t === 'smg' ? 120 : t === 'shotgun' ? 20 : 100;
      this.addPickup(t, x, z, amount, false);
    }
  }

  private updatePickups(dt: number) {
    const px = this.px, pz = this.pz;
    const t = performance.now() / 1000;
    for (const p of [...this.pickups]) {
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) { p.active = true; p.group.visible = true; }
        continue;
      }
      p.group.children[0].rotation.y = t * 2;
      p.group.children[0].position.y = 1.2 + Math.sin(t * 3 + p.x) * 0.12;
      if (p.temp) {
        p.life -= dt;
        if (p.life <= 0) { this.scene.remove(p.group); this.pickups.splice(this.pickups.indexOf(p), 1); continue; }
      }
      if (this.dead || dist2(px, pz, p.x, p.z) > (this.vehicle ? 6 : 2.2)) continue;
      let took = true;
      switch (p.type) {
        case 'health':
          if (this.health >= 100) took = false;
          else { this.health = 100; this.hud.help('Health restored', 2); }
          break;
        case 'armor':
          if (this.armor >= 100) took = false;
          else { this.armor = 100; this.hud.help('Body armor', 2); }
          break;
        case 'money':
          this.money += p.amount;
          this.audio.cash();
          this.effects.moneyBurst(p.x, 1, p.z);
          break;
        default: {
          const id = p.type as WeaponId;
          this.weapons[id] += p.amount;
          if (this.weapon === 'fist') this.weapon = id;
          this.hud.help(`${WEAPONS[id].name} +${p.amount}`, 2);
        }
      }
      if (!took) continue;
      if (p.type !== 'money') this.audio.pickup();
      if (p.temp) { this.scene.remove(p.group); this.pickups.splice(this.pickups.indexOf(p), 1); }
      else { p.active = false; p.group.visible = false; p.respawn = 60; }
    }
  }

  private markerMesh(i: number) {
    while (this.markerPool.length <= i) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd84d, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(this.markerGeo.ring, mat);
      ring.position.y = 0.7;
      ring.name = 'ring';
      const tall = new THREE.Mesh(this.markerGeo.tall, mat);
      tall.position.y = 3.5;
      tall.name = 'tall';
      const cone = new THREE.Mesh(this.markerGeo.cone, new THREE.MeshBasicMaterial({ color: 0xffd84d }));
      cone.rotation.x = Math.PI;
      cone.name = 'cone';
      g.add(ring, tall, cone);
      this.scene.add(g);
      this.markerPool.push(g);
    }
    return this.markerPool[i];
  }

  private updateMarkers(dt: number) {
    void dt;
    const list: Marker[] = [...this.missions.markers()];
    const pois = this.world.pois;
    const px = this.px, pz = this.pz;
    const giver = this.missions.nextGiver();
    const gx = giver ? giver.x + (giver === pois.safehouse ? 5 : 0) : 0;
    const gz = giver ? giver.z + (giver === pois.safehouse ? 3 : 0) : 0;
    if (giver) list.push({ x: gx, z: gz, color: 0xffd84d, kind: 'ground', radius: 1.6 });
    if (!this.missions.active) {
      list.push({ x: pois.safehouse.x - 3, z: pois.safehouse.z + 2, color: 0xff6ec7, kind: 'ground', radius: 1.2 });
      list.push({ x: pois.spray.x, z: pois.spray.z, color: 0x3ee6d0, kind: 'ground', radius: 4 });
    }

    const t = performance.now() / 1000;
    let i = 0;
    for (const m of list) {
      const g = this.markerMesh(i++);
      g.visible = true;
      const ring = g.getObjectByName('ring') as THREE.Mesh, tall = g.getObjectByName('tall') as THREE.Mesh, cone = g.getObjectByName('cone') as THREE.Mesh;
      (ring.material as THREE.MeshBasicMaterial).color.setHex(m.color);
      (cone.material as THREE.MeshBasicMaterial).color.setHex(m.color);
      const r = m.radius ?? 1.5;
      ring.visible = m.kind === 'ground';
      tall.visible = m.kind === 'checkpoint';
      ring.scale.set(r, 1, r);
      tall.scale.set(r, 1, r);
      const gy = this.world.groundHeight(m.x, m.z);
      g.position.set(m.x, gy, m.z);
      cone.position.y = (m.kind === 'arrow' ? 3.6 : m.kind === 'checkpoint' ? 8 : 2.6) + Math.sin(t * 3) * 0.2;
      cone.rotation.y = t * 2;
      cone.scale.setScalar(m.kind === 'checkpoint' ? 2 : 1);
    }
    for (; i < this.markerPool.length; i++) this.markerPool[i].visible = false;

    if (this.dead) return;
    // mission giver
    if (giver) {
      const d2 = dist2(px, pz, gx, gz);
      if (d2 > 64) this.giverArmed = true;
      if (d2 < 2.2 * 2.2 && this.giverArmed && (!this.vehicle || Math.abs(this.vehicle.speed) < 3)) {
        this.giverArmed = false;
        if (this.wanted > 0) this.hud.help('Lose your wanted level before starting a mission.', 3);
        else this.missions.start();
      }
    }
    if (!this.missions.active) {
      // save point
      const sd = dist2(px, pz, pois.safehouse.x - 3, pois.safehouse.z + 2);
      if (sd > 25) this.saveArmed = true;
      if (sd < 2 && this.saveArmed && !this.vehicle) {
        this.saveArmed = false;
        this.save();
        this.hud.showBig('GAME SAVED', '#ff6ec7', 2);
        this.audio.pickup();
      }
      // respray
      const rd = dist2(px, pz, pois.spray.x, pois.spray.z);
      if (rd > 100) this.sprayArmed = true;
      if (rd < 16 && this.sprayArmed && this.vehicle) {
        this.sprayArmed = false;
        if (this.money < 100) this.hud.help('A respray costs <b>$100</b>. Come back with cash.', 3);
        else {
          this.money -= 100;
          this.vehicle.repaint(pick(this.vehicle.spec.colors.concat([0xffffff, 0x111111, 0x8e44ad, 0x16a085, 0xe67e22])));
          this.vehicle.repair();
          this.setWantedLevel(0);
          this.clearPolice();
          this.hud.showBig('NEW PAINT, NEW YOU', '#3ee6d0', 2.5, '-$100');
          this.audio.cash();
        }
      }
    }
  }

  // ================================================================ camera & hud

  private updateCamera(dt: number) {
    const cam = this.camera;
    const target = this.tmpV.set(0, 0, 0);
    let dist: number;
    let fovTarget = 65;
    if (this.vehicle) {
      const v = this.vehicle;
      target.set(v.x, v.root.position.y + 1.6, v.z);
      this.camManualT -= dt;
      if (this.camManualT <= 0) {
        const behind = v.yaw + Math.PI;
        const look = this.input.isHeld('lookBack') ? v.yaw : behind;
        this.camYaw = dampAngle(this.camYaw, look, this.input.isHeld('lookBack') ? 30 : 3.5, dt);
        this.camPitch = damp(this.camPitch, 0.22, 2, dt);
      }
      dist = 6.5 + v.spec.len * 0.6 + Math.abs(v.speed) * 0.06;
      fovTarget = 65 + clamp(Math.abs(v.speed) - 10, 0, 40) * 0.35;
    } else {
      const p = this.pc.root.position;
      target.set(p.x, p.y + 1.6, p.z);
      const aiming = this.weapon !== 'fist' && (this.aimT > 0 || this.input.isHeld('attack'));
      dist = aiming ? 3.4 : 5.2;
      if (aiming) {
        target.x += Math.cos(this.camYaw) * 0.7;
        target.z += -Math.sin(this.camYaw) * 0.7;
      }
    }
    const cp = Math.cos(this.camPitch);
    const dir = this.tmpV2.set(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    const hit = this.world.raycast(target, dir, dist + 0.3);
    const d = Math.max(0.8, Math.min(dist, hit - 0.4));
    const desired = new THREE.Vector3().copy(target).addScaledVector(dir, d);
    if (desired.y < 0.4) desired.y = 0.4;
    this.camPos.lerp(desired, 1 - Math.exp(-dt * (this.vehicle ? 12 : 25)));
    if (this.camPos.distanceToSquared(desired) > 400) this.camPos.copy(desired);
    cam.position.copy(this.camPos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake = damp(this.shake, 0, 6, dt);
    }
    cam.lookAt(target);
    if (Math.abs(cam.fov - fovTarget) > 0.1) {
      cam.fov = damp(cam.fov, fovTarget, 3, dt);
      cam.updateProjectionMatrix();
    }
    this.world.sky.position.copy(cam.position);
  }

  private updateHud(dt: number) {
    this.hud.update(dt);
    this.hudT -= dt;
    const w = WEAPONS[this.weapon];
    const h = Math.floor(this.timeOfDay), m = Math.floor((this.timeOfDay % 1) * 60);
    this.hud.setStats({
      health: this.health, armor: this.armor, money: this.money, wanted: this.wanted,
      wantedFlash: this.wanted > 0 && this.unseenT > 1,
      weaponIcon: w.name, ammo: this.weapon === 'fist' ? '' : String(this.weapons[this.weapon]), hours: h, minutes: m,
    });
    if (this.hudT > 0) return;
    this.hudT = 1 / 20;
    this.hud.area(this.world.districtAt(this.px, this.pz));

    const blips: Blip[] = [];
    const pois = this.world.pois;
    const giver = this.missions.nextGiver();
    if (giver) blips.push({ x: giver.x, z: giver.z, color: '#ffd84d', size: 6, sticky: true, shape: 'square' });
    blips.push({ x: pois.safehouse.x, z: pois.safehouse.z, color: '#ff6ec7', size: 5, sticky: true, shape: 'square' });
    blips.push({ x: pois.spray.x, z: pois.spray.z, color: '#3ee6d0', size: 4, shape: 'square' });
    blips.push({ x: pois.hospital.x, z: pois.hospital.z, color: '#ff4d4d', size: 4, shape: 'square' });
    for (const mk of this.missions.markers()) {
      blips.push({ x: mk.x, z: mk.z, color: mk.color === 0xff3b3b ? '#ff3b3b' : mk.color === 0x4da6ff ? '#4da6ff' : mk.color === 0xff4fd8 ? '#ff4fd8' : '#ffd84d', size: 5, sticky: mk.color !== 0x7a2b6a });
    }
    const flash = Math.floor(performance.now() / 250) % 2 === 0;
    for (const v of this.vehicles) if (v.driver === 'police') blips.push({ x: v.x, z: v.z, color: flash ? '#ff2a2a' : '#2a6bff', size: 4 });
    for (const p of this.peds) {
      if (!p.alive) continue;
      if (p.kind === 'cop' && this.wanted > 0) blips.push({ x: p.x, z: p.z, color: flash ? '#ff2a2a' : '#2a6bff', size: 3 });
      else if (p.hostile && !p.missionTarget) blips.push({ x: p.x, z: p.z, color: '#ff3b3b', size: 3 });
    }
    const speed = this.vehicle ? Math.abs(this.vehicle.speed) : 0;
    const zoom = this.vehicle ? clamp(1.2 - speed / 60, 0.5, 1.2) : 1.4;
    const yaw = this.vehicle ? this.vehicle.yaw : this.pyaw;
    this.hud.drawRadar(this.px, this.pz, this.camYaw, yaw, zoom, blips);
  }

  // ================================================================ mission host

  private missionHost(): MissionHost {
    return {
      playerX: () => this.px,
      playerZ: () => this.pz,
      playerVehicle: () => this.vehicle,
      wanted: () => this.wanted,
      setWanted: (n) => {
        this.setWantedLevel(n);
        this.lastCrimeT = 0;
      },
      spawnMissionVehicle: (kind, x, z, yaw, color) => {
        // clear anything parked on the spot
        for (const o of [...this.vehicles]) if (o !== this.vehicle && dist2(o.x, o.z, x, z) < 36) this.removeVehicle(o);
        const v = this.spawnVehicle(kind, x, z, yaw, color);
        v.missionTarget = true;
        v.persistent = true;
        this.missionEntities.vehicles.push(v);
        return v;
      },
      spawnMissionPed: (kind, x, z) => {
        const p = this.spawnPed(kind, x, z);
        p.missionTarget = true;
        this.missionEntities.peds.push(p);
        return p;
      },
      releaseMissionEntities: () => {
        for (const v of this.missionEntities.vehicles) { v.missionTarget = false; }
        for (const p of this.missionEntities.peds) { p.missionTarget = false; }
        this.missionEntities = { vehicles: [], peds: [] };
      },
      addMoney: (n) => { this.money += n; this.audio.cash(); },
      giveWeapon: (id, ammo) => {
        const wid = id as WeaponId;
        this.weapons[wid] = (this.weapons[wid] ?? 0) + ammo;
        this.weapon = wid;
      },
      subtitle: (t, s) => this.hud.subtitle(t, s),
      help: (t, s) => this.hud.help(t, s),
      objective: (t) => this.hud.objective(t),
      timer: (s, l) => this.hud.timer(s, l),
      big: (t, c, s, sub) => this.hud.showBig(t, c, s, sub),
      sound: (k) => {
        if (k === 'pass') this.audio.missionPassed();
        else if (k === 'fail') this.audio.missionFailed();
        else this.audio.pickup();
      },
      pois: this.world.pois,
      onMissionPassed: () => {
        this.stats.missions++;
        this.save();
        setTimeout(() => this.hud.help('Progress <b>auto-saved</b>.', 2.5), 4200);
      },
    };
  }
}

