import { formatMoney } from './utils';

export interface Blip {
  x: number;
  z: number;
  color: string;
  size?: number;
  /** keep on radar edge when out of range */
  sticky?: boolean;
  shape?: 'dot' | 'square' | 'tri';
}

export class Hud {
  root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private radar: HTMLCanvasElement;
  private rctx: CanvasRenderingContext2D;
  private bigTimer = 0;
  private subTimer = 0;
  private helpTimer = 0;
  private areaTimer = 0;
  private vehTimer = 0;
  private lastArea = '';
  private lastStats = '';

  constructor(parent: HTMLElement, private map: HTMLCanvasElement) {
    const root = document.createElement('div');
    root.className = 'sv-hud';
    root.innerHTML = `
      <div class="sv-topright">
        <div class="sv-clock" data-k="clock">12:00</div>
        <div class="sv-weapon"><div class="sv-weapon-icon" data-k="wicon">✊</div><div class="sv-ammo" data-k="ammo"></div></div>
        <div class="sv-bar sv-armor" data-k="armorWrap"><i data-k="armor"></i></div>
        <div class="sv-bar sv-health"><i data-k="health"></i></div>
        <div class="sv-money" data-k="money">$00000000</div>
        <div class="sv-stars" data-k="stars"></div>
      </div>
      <div class="sv-help" data-k="help"></div>
      <div class="sv-objective" data-k="objective"></div>
      <div class="sv-timer" data-k="timer"></div>
      <div class="sv-big" data-k="big"></div>
      <div class="sv-subtitle" data-k="sub"></div>
      <div class="sv-area" data-k="area"></div>
      <div class="sv-vehname" data-k="veh"></div>
      <div class="sv-crosshair" data-k="cross"></div>
      <div class="sv-damage" data-k="damage"></div>
      <div class="sv-fps" data-k="fps"></div>
      <div class="sv-radar-wrap"><canvas class="sv-radar"></canvas></div>
    `;
    parent.appendChild(root);
    this.root = root;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => { this.el[e.dataset.k!] = e; });
    this.radar = root.querySelector('.sv-radar') as HTMLCanvasElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.radar.width = this.radar.height = Math.round(160 * dpr);
    this.rctx = this.radar.getContext('2d')!;
    const stars = this.el.stars;
    for (let i = 0; i < 6; i++) {
      const s = document.createElement('span');
      s.textContent = '★';
      stars.appendChild(s);
    }
  }

  setStats(s: {
    health: number; armor: number; money: number; wanted: number; wantedFlash: boolean;
    weaponIcon: string; ammo: string; hours: number; minutes: number;
  }) {
    const key = `${Math.ceil(s.health)}|${Math.ceil(s.armor)}|${Math.floor(s.money)}|${s.wanted}|${s.wantedFlash}|${s.weaponIcon}|${s.ammo}|${s.hours}|${s.minutes}`;
    if (key === this.lastStats) return;
    this.lastStats = key;
    this.el.health.style.width = Math.max(0, s.health) + '%';
    this.el.health.parentElement!.classList.toggle('low', s.health < 25);
    this.el.armor.style.width = Math.max(0, s.armor) + '%';
    this.el.armorWrap.style.visibility = s.armor > 0 ? 'visible' : 'hidden';
    this.el.money.textContent = formatMoney(s.money);
    this.el.wicon.textContent = s.weaponIcon;
    this.el.ammo.textContent = s.ammo;
    this.el.clock.textContent = `${String(s.hours).padStart(2, '0')}:${String(s.minutes).padStart(2, '0')}`;
    const stars = this.el.stars.children;
    for (let i = 0; i < 6; i++) {
      const on = 5 - i < s.wanted; // right-aligned fill
      (stars[i] as HTMLElement).className = on ? (s.wantedFlash ? 'on flash' : 'on') : '';
    }
  }

  showBig(text: string, color = '#ffd84d', seconds = 3, sub = '') {
    this.el.big.innerHTML = `<div style="color:${color}">${text}</div>${sub ? `<small>${sub}</small>` : ''}`;
    this.el.big.classList.add('show');
    this.bigTimer = seconds;
  }

  subtitle(text: string, seconds = 4) {
    this.el.sub.innerHTML = text;
    this.el.sub.classList.add('show');
    this.subTimer = seconds;
  }

  help(text: string, seconds = 5) {
    this.el.help.innerHTML = text;
    this.el.help.classList.add('show');
    this.helpTimer = seconds;
  }

  objective(text: string) {
    this.el.objective.innerHTML = text;
    this.el.objective.classList.toggle('show', !!text);
  }

  timer(seconds: number | null, label = '') {
    if (seconds === null) {
      this.el.timer.classList.remove('show');
      return;
    }
    const m = Math.floor(Math.max(0, seconds) / 60), s = Math.floor(Math.max(0, seconds) % 60);
    this.el.timer.textContent = `${label} ${m}:${String(s).padStart(2, '0')}`;
    this.el.timer.classList.add('show');
    this.el.timer.classList.toggle('urgent', seconds < 10);
  }

  area(name: string) {
    if (name === this.lastArea) return;
    this.lastArea = name;
    this.el.area.textContent = name;
    this.el.area.classList.add('show');
    this.areaTimer = 3.5;
  }

  vehicleName(name: string, extra = '') {
    this.el.veh.innerHTML = `${name}${extra ? `<small>${extra}</small>` : ''}`;
    this.el.veh.classList.add('show');
    this.vehTimer = 2.5;
  }

  crosshair(on: boolean, locked = false) {
    this.el.cross.classList.toggle('show', on);
    this.el.cross.classList.toggle('locked', locked);
  }

  damageFlash() {
    const d = this.el.damage;
    d.classList.remove('hit');
    void d.offsetWidth;
    d.classList.add('hit');
  }

  fps(text: string) {
    this.el.fps.textContent = text;
  }

  update(dt: number) {
    const tick = (t: number, el: HTMLElement) => {
      if (t > 0 && t - dt <= 0) el.classList.remove('show');
      return t - dt;
    };
    this.bigTimer = tick(this.bigTimer, this.el.big);
    this.subTimer = tick(this.subTimer, this.el.sub);
    this.helpTimer = tick(this.helpTimer, this.el.help);
    this.areaTimer = tick(this.areaTimer, this.el.area);
    this.vehTimer = tick(this.vehTimer, this.el.veh);
  }

  /** Rotating radar: camera forward is always "up". */
  drawRadar(px: number, pz: number, camYaw: number, playerYaw: number, zoom: number, blips: Blip[]) {
    const g = this.rctx;
    const W = this.radar.width;
    const R = W / 2;
    const scale = (W / 160) * zoom; // pixels per world unit
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;
    const a = scale * rx, b = -scale * fx, c = scale * rz, d = -scale * fz;
    const e = R - (a * px + c * pz), f = R - (b * px + d * pz);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#2f6fa8';
    g.fillRect(0, 0, W, W);
    g.setTransform(a, b, c, d, e, f);
    const ms = this.map.width;
    g.drawImage(this.map, -ms / 2, -ms / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);

    const toRadar = (x: number, z: number): [number, number] => [a * x + c * z + e, b * x + d * z + f];
    for (const bl of blips) {
      let [bx, by] = toRadar(bl.x, bl.z);
      const dx = bx - R, dy = by - R;
      const dist = Math.hypot(dx, dy);
      const max = R - 9;
      if (dist > max) {
        if (!bl.sticky) continue;
        bx = R + (dx / dist) * max;
        by = R + (dy / dist) * max;
      }
      const s = (bl.size ?? 5) * (W / 160);
      g.fillStyle = bl.color;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      if (bl.shape === 'square') g.rect(bx - s, by - s, s * 2, s * 2);
      else g.arc(bx, by, s, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();

    // player arrow
    const rel = playerYaw - camYaw;
    g.save();
    g.translate(R, R);
    g.rotate(-rel + Math.PI);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    const s = W / 160;
    g.beginPath();
    g.moveTo(0, -9 * s);
    g.lineTo(6 * s, 7 * s);
    g.lineTo(0, 3 * s);
    g.lineTo(-6 * s, 7 * s);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // north marker
    let [nx, ny] = toRadar(px, pz - 1000);
    const ndx = nx - R, ndy = ny - R, nd = Math.hypot(ndx, ndy);
    nx = R + (ndx / nd) * (R - 12);
    ny = R + (ndy / nd) * (R - 12);
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(nx, ny, 9 * s, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${11 * s}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5);
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  dispose() {
    this.root.remove();
  }
}
