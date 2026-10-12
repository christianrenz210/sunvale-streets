import type { Vehicle, VehicleKind } from './Vehicle';
import type { Ped } from './Ped';
import type { POI } from './World';
import { blockCenter, roadCoord } from './World';
import { pick, rand } from './utils';

/** What the mission system needs from the game. */
export interface MissionHost {
  playerX(): number;
  playerZ(): number;
  playerVehicle(): Vehicle | null;
  wanted(): number;
  setWanted(n: number): void;
  spawnMissionVehicle(kind: VehicleKind, x: number, z: number, yaw: number, color?: number): Vehicle;
  spawnMissionPed(kind: 'gang' | 'civ', x: number, z: number): Ped;
  releaseMissionEntities(): void;
  addMoney(n: number): void;
  giveWeapon(id: string, ammo: number): void;
  subtitle(text: string, seconds?: number): void;
  help(text: string, seconds?: number): void;
  objective(text: string): void;
  timer(seconds: number | null, label?: string): void;
  big(text: string, color?: string, seconds?: number, sub?: string): void;
  sound(kind: 'pass' | 'fail' | 'checkpoint'): void;
  pois: Record<string, POI>;
  onMissionPassed(): void;
}

export interface Marker {
  x: number;
  z: number;
  color: number;
  kind: 'ground' | 'arrow' | 'checkpoint';
  radius?: number;
}

type StepResult = 'done' | 'fail' | null;

interface Step {
  start?(h: MissionHost, m: ActiveMission): void;
  update(h: MissionHost, m: ActiveMission, dt: number): StepResult;
  markers?(m: ActiveMission): Marker[];
  failReason?: string;
}

interface MissionDef {
  id: string;
  title: string;
  reward: number;
  giver: string; // poi key
  steps: Step[];
}

interface ActiveMission {
  def: MissionDef;
  stepIdx: number;
  vehicles: Record<string, Vehicle>;
  peds: Ped[];
  time: number;
  stepTime: number;
  data: Record<string, number>;
  failReason?: string;
}

const near = (h: MissionHost, x: number, z: number, r: number) => (h.playerX() - x) ** 2 + (h.playerZ() - z) ** 2 < r * r;

// ------------------------------------------------------------ step factories

function talk(lines: [string, string][]): Step {
  return {
    start(h, m) { m.data.line = -1; m.data.lineT = 0; },
    update(h, m, dt) {
      m.data.lineT -= dt;
      if (m.data.lineT <= 0) {
        m.data.line++;
        if (m.data.line >= lines.length) return 'done';
        const [who, text] = lines[m.data.line];
        const dur = Math.min(6, 2.2 + text.length * 0.045);
        h.subtitle(`<b>${who}:</b> ${text}`, dur);
        m.data.lineT = dur;
      }
      return null;
    },
  };
}

function goTo(x: number, z: number, text: string, opts: { r?: number; needCar?: boolean; time?: number } = {}): Step {
  const r = opts.r ?? 4;
  return {
    start(h, m) {
      h.objective(text);
      if (opts.time) m.data.deadline = opts.time;
    },
    update(h, m) {
      if (opts.time) {
        const left = opts.time - m.stepTime;
        h.timer(left, 'TIME');
        if (left <= 0) { m.failReason = 'You ran out of time.'; return 'fail'; }
      }
      if (near(h, x, z, r) && (!opts.needCar || h.playerVehicle())) {
        h.timer(null);
        return 'done';
      }
      return null;
    },
    markers: () => [{ x, z, color: 0xffd84d, kind: 'ground', radius: r }],
  };
}

function getAnyCar(): Step {
  return {
    start(h) { h.objective('Get a <b>vehicle</b>. Walk up to a car and press <kbd>F</kbd> / tap <b>CAR</b>.'); },
    update(h) { return h.playerVehicle() ? 'done' : null; },
  };
}

function spawnVehicle(key: string, kind: VehicleKind, x: number, z: number, yaw: number, color?: number): Step {
  return {
    start(h, m) {
      const v = h.spawnMissionVehicle(kind, x, z, yaw, color);
      m.vehicles[key] = v;
    },
    update: () => 'done',
  };
}

function getIn(key: string, text: string, onEnter?: (h: MissionHost) => void): Step {
  return {
    start(h) { h.objective(text); },
    update(h, m) {
      const v = m.vehicles[key];
      if (!v || v.wrecked) { m.failReason = 'The vehicle was destroyed.'; return 'fail'; }
      if (h.playerVehicle() === v) { onEnter?.(h); return 'done'; }
      return null;
    },
    markers: (m) => {
      const v = m.vehicles[key];
      return v ? [{ x: v.x, z: v.z, color: 0x4da6ff, kind: 'arrow' }] : [];
    },
  };
}

function deliver(key: string, x: number, z: number, text: string, time?: number): Step {
  return {
    start(h) { h.objective(text); },
    update(h, m) {
      const v = m.vehicles[key];
      if (!v || v.wrecked) { m.failReason = 'The vehicle was destroyed.'; return 'fail'; }
      if (time) {
        const left = time - m.stepTime;
        h.timer(left, 'TIME');
        if (left <= 0) { m.failReason = 'Too slow!'; return 'fail'; }
      }
      if (h.playerVehicle() !== v) {
        h.objective(`Get back in the <b>${v.spec.name}</b>!`);
        return null;
      }
      h.objective(text);
      if (near(h, x, z, 6) && Math.abs(v.speed) < 6) { h.timer(null); return 'done'; }
      return null;
    },
    markers: (m) => {
      const v = m.vehicles[key];
      const list: Marker[] = [{ x, z, color: 0xffd84d, kind: 'ground', radius: 6 }];
      if (v && !v.wrecked) list.push({ x: v.x, z: v.z, color: 0x4da6ff, kind: 'arrow' });
      return list;
    },
  };
}

function eliminate(cx: number, cz: number, count: number, text: string): Step {
  return {
    start(h, m) {
      h.objective(text);
      m.data.spawned = 0;
    },
    update(h, m) {
      if (!m.data.spawned && near(h, cx, cz, 90)) {
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const p = h.spawnMissionPed('gang', cx + Math.cos(a) * rand(4, 12), cz + Math.sin(a) * rand(4, 12));
          m.peds.push(p);
        }
        m.data.spawned = 1;
      }
      if (!m.data.spawned) return null;
      if (near(h, cx, cz, 45)) m.peds.forEach((p) => { p.hostile = true; });
      const left = m.peds.filter((p) => p.alive).length;
      h.objective(`${text} <b>${left}</b> left.`);
      return left === 0 ? 'done' : null;
    },
    markers: (m) => (m.data.spawned
      ? m.peds.filter((p) => p.alive).map((p) => ({ x: p.x, z: p.z, color: 0xff3b3b, kind: 'arrow' as const }))
      : [{ x: cx, z: cz, color: 0xff3b3b, kind: 'ground' as const, radius: 10 }]),
  };
}

function reachWanted(level: number, text: string): Step {
  return {
    start(h) { h.objective(text); },
    update(h) { return h.wanted() >= level ? 'done' : null; },
  };
}

function setWanted(level: number): Step {
  return { start(h) { h.setWanted(level); }, update: () => 'done' };
}

function evade(text: string): Step {
  return {
    start(h) { h.objective(text); h.help('Break line of sight and stay away from cops until the stars disappear. A <b>Fresh Coat</b> respray also works.', 7); },
    update(h) { return h.wanted() === 0 ? 'done' : null; },
  };
}

function race(points: [number, number][], time: number, key?: string): Step {
  return {
    start(h, m) { m.data.cp = 0; h.objective(`Hit all <b>${points.length}</b> checkpoints!`); },
    update(h, m) {
      const left = time - m.stepTime;
      h.timer(left, 'RACE');
      if (left <= 0) { m.failReason = 'You ran out of time.'; return 'fail'; }
      if (key) {
        const v = m.vehicles[key];
        if (!v || v.wrecked) { m.failReason = 'The car was wrecked.'; return 'fail'; }
      }
      if (!h.playerVehicle()) h.objective('Get back in a car!');
      const [x, z] = points[m.data.cp];
      if (near(h, x, z, 9) && h.playerVehicle()) {
        m.data.cp++;
        h.sound('checkpoint');
        if (m.data.cp >= points.length) { h.timer(null); return 'done'; }
        h.objective(`Checkpoint <b>${m.data.cp}/${points.length}</b>`);
      }
      return null;
    },
    markers: (m) => {
      const out: Marker[] = [];
      const i = m.data.cp ?? 0;
      if (points[i]) out.push({ x: points[i][0], z: points[i][1], color: 0xff4fd8, kind: 'checkpoint', radius: 9 });
      if (points[i + 1]) out.push({ x: points[i + 1][0], z: points[i + 1][1], color: 0x7a2b6a, kind: 'checkpoint', radius: 6 });
      return out;
    },
  };
}

function giveWeapon(id: string, ammo: number, note: string): Step {
  return { start(h) { h.giveWeapon(id, ammo); h.help(note, 6); }, update: () => 'done' };
}

// ------------------------------------------------------------ story

const R = (k: number) => roadCoord(k);
const B = (k: number) => blockCenter(k);

function story(pois: Record<string, POI>): MissionDef[] {
  const g = pois.garage, docks = pois.docks;
  return [
    {
      id: 'homecoming', title: 'Homecoming', reward: 500, giver: 'safehouse',
      steps: [
        talk([
          ['Ray', 'Five years away and Sunvale still smells like salt and gasoline.'],
          ['Rico (phone)', 'Ray! Word travels fast, hermano. Come by the garage on the Eastside. We got business.'],
        ]),
        getAnyCar(),
        goTo(g.x, g.z, "Drive to <b>Rico's Garage</b> on the Eastside.", { r: 6 }),
        talk([
          ['Rico', 'Look at you! Still got that Old Town swagger.'],
          ['Rico', "Things changed while you were gone. The Vipers run half the city now. I need someone I can trust."],
        ]),
      ],
    },
    {
      id: 'hotwheels', title: 'Hot Wheels', reward: 1500, giver: 'garage',
      steps: [
        talk([['Rico', 'A client wants a Vortex GT. Some suit parked one downtown. Bring it back without a scratch... well, without too many.']]),
        spawnVehicle('target', 'sports', B(3) + 5.5, B(5) - 12, 0, 0xe74c3c),
        getIn('target', 'Steal the red <b>Vortex GT</b> from the downtown parking lot.'),
        deliver('target', g.x, g.z, "Bring the Vortex GT to <b>Rico's Garage</b>."),
        talk([['Rico', "Beautiful. That's going to pay some bills."]]),
      ],
    },
    {
      id: 'delivery', title: 'Special Delivery', reward: 1200, giver: 'garage',
      steps: [
        talk([['Rico', "A package is waiting at the docks. Don't ask what's in it. My buyer in Vista Heights won't wait long."]]),
        goTo(docks.x, docks.z, 'Pick up the package at the <b>Docks</b>.', { r: 5 }),
        goTo(B(1), R(1) - 0, 'Deliver the package to <b>Vista Heights</b> before time runs out!', { r: 6, time: 100 }),
        talk([['Buyer', "You're Rico's guy? Fast. I like fast."]]),
      ],
    },
    {
      id: 'turf', title: 'Turf War', reward: 2500, giver: 'garage',
      steps: [
        talk([
          ['Rico', "The Vipers have been tagging our side of town. They hang out in the Old Town park, purple shirts, can't miss 'em."],
          ['Rico', "Take this piece. Make them leave."],
        ]),
        giveWeapon('pistol', 80, 'You got a <b>Pistol</b>. Switch weapons with <kbd>Q</kbd> / <b>WPN</b>. Aim with the mouse and click (or tap <b>FIRE</b> for auto-aim).'),
        eliminate(B(1), B(6), 5, 'Take out the <b>Vipers</b> in the Old Town park.'),
        talk([['Ray', "That's for the old neighborhood."]]),
      ],
    },
    {
      id: 'heat', title: 'Feel the Heat', reward: 2000, giver: 'garage',
      steps: [
        talk([['Rico', "A cop's been sniffing around the garage. Lead them away and lose them, then come back."]]),
        setWanted(2),
        evade('Lose your <b>wanted level</b>.'),
        goTo(g.x, g.z, "Return to <b>Rico's Garage</b>.", { r: 6 }),
      ],
    },
    {
      id: 'midnight', title: 'Midnight Run', reward: 3000, giver: 'garage',
      steps: [
        talk([['Rico', "Street race tonight. I put money on you. Take the Stallion and don't make me look stupid."]]),
        spawnVehicle('racer', 'muscle', g.x + 6, g.z + 4, Math.PI / 2, 0x111111),
        getIn('racer', 'Get in the <b>Stallion</b>.'),
        race([
          [R(7), B(1)], [R(7), B(4)], [B(5), R(6)], [B(2), R(6)], [R(1), B(4)], [R(1), B(1)], [B(4), R(1)], [g.x, g.z],
        ], 110, 'racer'),
        talk([['Rico', "HA! Told them. Here's your cut."]]),
      ],
    },
    {
      id: 'bigscore', title: 'The Big Score', reward: 10000, giver: 'garage',
      steps: [
        talk([
          ['Rico', 'This is it. The Vipers move their money in an armored van. It is parked near the police HQ right now.'],
          ['Rico', 'Grab it, bring it to the docks. Every cop in Sunvale will be on you.'],
        ]),
        spawnVehicle('van', 'armored', R(6) - 3.2, B(3), Math.PI, 0x37474f),
        getIn('van', 'Steal the <b>Armored Van</b> near the SVPD HQ.', (h) => h.setWanted(3)),
        deliver('van', docks.x - 6, docks.z, 'Deliver the van to the <b>Docks</b>!'),
        talk([
          ['Rico', "We did it, Ray. Sunvale's ours now."],
          ['Ray', 'Sunvale was always ours.'],
        ]),
      ],
    },
  ];
}

function randomSideJob(pois: Record<string, POI>, n: number): MissionDef {
  const kind = pick(['courier', 'race', 'cleanup', 'repo'] as const);
  const bx = () => B(Math.floor(Math.random() * 8));
  const rr = () => R(Math.floor(Math.random() * 9));
  const scale = 1 + n * 0.15;
  switch (kind) {
    case 'courier': {
      const a: [number, number] = [rr(), bx()], b: [number, number] = [bx(), rr()];
      return {
        id: 'side', title: 'Side Job: Courier', reward: Math.round(800 * scale), giver: 'garage',
        steps: [
          talk([['Rico', 'Quick courier job. Pick up, drop off, get paid.']]),
          goTo(a[0], a[1], 'Pick up the <b>parcel</b>.', { r: 6 }),
          goTo(b[0], b[1], 'Deliver the <b>parcel</b>!', { r: 6, time: 80 }),
        ],
      };
    }
    case 'race': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) pts.push(i % 2 ? [rr(), bx()] : [bx(), rr()]);
      pts.push([pois.garage.x, pois.garage.z]);
      return {
        id: 'side', title: 'Side Job: Street Race', reward: Math.round(1500 * scale), giver: 'garage',
        steps: [talk([['Rico', 'Another race. Any car will do.']]), getAnyCar(), race(pts, 120)],
      };
    }
    case 'cleanup': {
      // sidewalk corner next to an intersection, never inside a building
      const cx = bx() + 29, cz = bx() + 29;
      return {
        id: 'side', title: 'Side Job: Cleanup', reward: Math.round(1800 * scale), giver: 'garage',
        steps: [
          talk([['Rico', 'More Vipers moved in. You know what to do.']]),
          giveWeapon('smg', 120, 'Rico slipped you an <b>SMG</b>.'),
          eliminate(cx, cz, 4 + Math.min(4, n), 'Take out the <b>Vipers</b>.'),
        ],
      };
    }
    default: {
      const x = rr() + 3.2, z = bx();
      return {
        id: 'side', title: 'Side Job: Repo', reward: Math.round(1200 * scale), giver: 'garage',
        steps: [
          talk([['Rico', "Someone skipped payments on their ride. Bring it in."]]),
          spawnVehicle('repo', pick(['muscle', 'sports', 'pickup'] as const), x, z, 0),
          getIn('repo', 'Repossess the marked <b>vehicle</b>.', (h) => { if (Math.random() < 0.5) h.setWanted(1); }),
          deliver('repo', pois.garage.x, pois.garage.z, "Bring it to <b>Rico's Garage</b>."),
        ],
      };
    }
  }
}

// ------------------------------------------------------------ manager

export class Missions {
  active: ActiveMission | null = null;
  story = 0;
  sideJobs = 0;
  private defs: MissionDef[];
  private sideDef: MissionDef | null = null;
  private cooldown = 0;

  constructor(private host: MissionHost) {
    this.defs = story(host.pois);
  }

  get storyComplete() { return this.story >= this.defs.length; }

  get storyCount() { return this.defs.length; }

  /** The marker where the next mission can be started. */
  nextGiver(): POI | null {
    if (this.active || this.cooldown > 0) return null;
    const key = this.storyComplete ? 'garage' : this.defs[this.story].giver;
    return this.host.pois[key];
  }

  nextTitle() {
    return this.storyComplete ? 'Side Job' : this.defs[this.story].title;
  }

  start() {
    const def = this.storyComplete ? (this.sideDef = randomSideJob(this.host.pois, this.sideJobs)) : this.defs[this.story];
    this.active = { def, stepIdx: -1, vehicles: {}, peds: [], time: 0, stepTime: 0, data: {} };
    this.host.big(def.title, '#ffffff', 3);
    this.nextStep();
  }

  private nextStep() {
    const m = this.active!;
    m.stepIdx++;
    m.stepTime = 0;
    if (m.stepIdx >= m.def.steps.length) {
      this.pass();
      return;
    }
    m.def.steps[m.stepIdx].start?.(this.host, m);
  }

  update(dt: number) {
    if (this.cooldown > 0) this.cooldown -= dt;
    const m = this.active;
    if (!m) return;
    m.time += dt;
    m.stepTime += dt;
    // a step may finish instantly; allow chaining a few per frame
    for (let guard = 0; guard < 4 && this.active; guard++) {
      const r = m.def.steps[m.stepIdx].update(this.host, m, dt);
      if (r === 'done') this.nextStep();
      else if (r === 'fail') { this.fail(m.failReason); break; }
      else break;
    }
  }

  markers(): Marker[] {
    const m = this.active;
    if (!m) return [];
    const s = m.def.steps[m.stepIdx];
    return s?.markers ? s.markers(m) : [];
  }

  private pass() {
    const m = this.active!;
    this.host.objective('');
    this.host.timer(null);
    this.host.addMoney(m.def.reward);
    this.host.big('MISSION PASSED!', '#ffd84d', 4, `$${m.def.reward} RESPECT +`);
    this.host.sound('pass');
    if (this.storyComplete) this.sideJobs++;
    else this.story++;
    this.cleanup();
    this.cooldown = 4;
    if (this.storyComplete && m.def.id === 'bigscore') {
      setTimeout(() => this.host.help('<b>Story complete!</b> Rico still has side jobs at the garage. The city is yours to explore.', 8), 4500);
    }
    this.host.onMissionPassed();
  }

  fail(reason?: string) {
    if (!this.active) return;
    this.host.objective('');
    this.host.timer(null);
    this.host.big('MISSION FAILED!', '#ff4040', 4, reason ?? '');
    this.host.sound('fail');
    this.cleanup();
    this.cooldown = 5;
  }

  private cleanup() {
    this.active = null;
    this.host.releaseMissionEntities();
  }
}

