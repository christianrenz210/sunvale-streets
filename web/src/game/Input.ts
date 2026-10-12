export type Action =
  | 'attack' | 'jump' | 'sprint' | 'enter' | 'weapon' | 'handbrake'
  | 'radio' | 'pause' | 'horn' | 'lookBack';

const KEY_MAP: Record<string, Action> = {
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  Space: 'jump',
  KeyF: 'enter', Enter: 'enter',
  KeyQ: 'weapon', Tab: 'weapon',
  KeyR: 'radio',
  KeyP: 'pause', Escape: 'pause',
  KeyH: 'horn',
  KeyC: 'lookBack',
};

/**
 * Unifies keyboard + mouse (desktop) and a virtual joystick + buttons (touch) into one action model.
 */
export class Input {
  moveX = 0; // -1 left .. 1 right
  moveY = 0; // -1 back .. 1 forward
  lookDX = 0;
  lookDY = 0;
  sensitivity = 1;
  touchMode = false;

  private keys = new Set<string>();
  private held = new Set<Action>();
  private pressedSet = new Set<Action>();
  private mouseDown = false;
  private joy = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private lookTouch = { id: -1, x: 0, y: 0 };
  private touchRoot: HTMLElement | null = null;
  private knob: HTMLElement | null = null;
  private base: HTMLElement | null = null;
  private disposers: (() => void)[] = [];
  /** Labels on touch buttons that change with context (on foot vs in vehicle). */
  private buttons: Partial<Record<Action, HTMLElement>> = {};

  constructor(private canvas: HTMLElement, private overlay: HTMLElement, touch: boolean) {
    this.touchMode = touch;
    this.listen(window, 'keydown', (e: Event) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e: Event) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => { this.keys.clear(); this.held.clear(); this.mouseDown = false; });
    this.listen(canvas, 'mousedown', (e: Event) => {
      if (this.touchMode) return;
      const me = e as MouseEvent;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (me.button === 0) { this.mouseDown = true; this.press('attack'); }
      if (me.button === 2) this.press('lookBack');
    });
    this.listen(window, 'mouseup', (e: Event) => { if ((e as MouseEvent).button === 0) this.mouseDown = false; });
    this.listen(window, 'mousemove', (e: Event) => {
      if (document.pointerLockElement !== canvas) return;
      const me = e as MouseEvent;
      this.lookDX += me.movementX * 0.0025 * this.sensitivity;
      this.lookDY += me.movementY * 0.0025 * this.sensitivity;
    });
    this.listen(window, 'wheel', () => this.press('weapon'));
    this.listen(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    if (touch) this.buildTouchUI();
  }

  private listen(t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    t.addEventListener(type, fn, opts);
    this.disposers.push(() => t.removeEventListener(type, fn, opts));
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    const a = KEY_MAP[e.code];
    if (a) {
      if (down && !this.held.has(a)) this.press(a);
      if (down) this.held.add(a); else this.held.delete(a);
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    }
  }

  private press(a: Action) {
    this.pressedSet.add(a);
  }

  isHeld(a: Action) {
    if (a === 'attack' && this.mouseDown) return true;
    if (a === 'handbrake' && this.held.has('jump')) return true;
    return this.held.has(a);
  }

  pressed(a: Action) {
    return this.pressedSet.has(a);
  }

  /** Called once per frame after the game consumed input. */
  endFrame() {
    this.pressedSet.clear();
    this.lookDX = 0;
    this.lookDY = 0;
  }

  /** Called once per frame before the game reads input. */
  update() {
    if (this.touchMode && this.joy.id >= 0) {
      this.moveX = this.joy.x;
      this.moveY = this.joy.y;
    } else if (this.touchMode) {
      this.moveX = 0;
      this.moveY = 0;
    }
    if (!this.touchMode || this.keys.size) {
      const k = this.keys;
      const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      if (x || y || !this.touchMode) {
        this.moveX = x;
        this.moveY = y;
      }
    }
  }

  setContext(inVehicle: boolean, armed: boolean) {
    const set = (a: Action, label: string) => {
      const b = this.buttons[a];
      if (b && b.dataset.label !== label) { b.dataset.label = label; b.textContent = label; }
    };
    set('jump', inVehicle ? 'BRAKE' : 'JUMP');
    set('sprint', inVehicle ? 'HORN' : 'RUN');
    set('enter', inVehicle ? 'EXIT' : 'CAR');
    set('attack', armed ? 'FIRE' : 'PUNCH');
    const radio = this.buttons.radio;
    if (radio) radio.style.display = inVehicle ? '' : 'none';
  }

  private buildTouchUI() {
    const root = document.createElement('div');
    root.className = 'sv-touch';
    root.innerHTML = `
      <div class="sv-joy-zone"></div>
      <div class="sv-joy-base"><div class="sv-joy-knob"></div></div>
      <div class="sv-look-zone"></div>
      <div class="sv-btns">
        <button data-a="attack" class="sv-btn sv-btn-big sv-btn-red">PUNCH</button>
        <button data-a="jump" class="sv-btn">JUMP</button>
        <button data-a="sprint" class="sv-btn">RUN</button>
        <button data-a="enter" class="sv-btn sv-btn-yellow">CAR</button>
        <button data-a="weapon" class="sv-btn sv-btn-small">WPN</button>
        <button data-a="radio" class="sv-btn sv-btn-small" style="display:none">RADIO</button>
      </div>
      <button data-a="pause" class="sv-btn sv-btn-pause">II</button>
    `;
    this.overlay.appendChild(root);
    this.overlay.classList.add('sv-is-touch');
    this.touchRoot = root;
    this.base = root.querySelector('.sv-joy-base');
    this.knob = root.querySelector('.sv-joy-knob');

    root.querySelectorAll<HTMLElement>('button[data-a]').forEach((btn) => {
      const a = btn.dataset.a as Action;
      this.buttons[a] = btn;
      const down = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('on');
        this.press(a);
        this.held.add(a);
        if (a === 'sprint') this.held.add('horn');
      };
      const up = (e: Event) => {
        e.preventDefault();
        btn.classList.remove('on');
        this.held.delete(a);
        if (a === 'sprint') this.held.delete('horn');
      };
      this.listen(btn, 'pointerdown', down);
      this.listen(btn, 'pointerup', up);
      this.listen(btn, 'pointercancel', up);
      this.listen(btn, 'pointerleave', up);
    });

    const joyZone = root.querySelector('.sv-joy-zone') as HTMLElement;
    const lookZone = root.querySelector('.sv-look-zone') as HTMLElement;
    const R = 55;
    this.listen(joyZone, 'pointerdown', (ev: Event) => {
      const e = ev as PointerEvent;
      e.preventDefault();
      if (this.joy.id >= 0) return;
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      joyZone.setPointerCapture(e.pointerId);
      if (this.base) {
        this.base.style.display = 'block';
        this.base.style.left = e.clientX - 65 + 'px';
        this.base.style.top = e.clientY - 65 + 'px';
      }
      if (this.knob) this.knob.style.transform = 'translate(0px,0px)';
    });
    this.listen(joyZone, 'pointermove', (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.pointerId !== this.joy.id) return;
      let dx = e.clientX - this.joy.ox;
      let dy = e.clientY - this.joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
      this.joy.x = dx / R;
      this.joy.y = -dy / R;
      if (this.knob) this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const joyEnd = (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.pointerId !== this.joy.id) return;
      this.joy.id = -1;
      this.joy.x = this.joy.y = 0;
      if (this.base) this.base.style.display = 'none';
    };
    this.listen(joyZone, 'pointerup', joyEnd);
    this.listen(joyZone, 'pointercancel', joyEnd);

    this.listen(lookZone, 'pointerdown', (ev: Event) => {
      const e = ev as PointerEvent;
      if (this.lookTouch.id >= 0) return;
      this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      lookZone.setPointerCapture(e.pointerId);
    });
    this.listen(lookZone, 'pointermove', (ev: Event) => {
      const e = ev as PointerEvent;
      if (e.pointerId !== this.lookTouch.id) return;
      this.lookDX += (e.clientX - this.lookTouch.x) * 0.006 * this.sensitivity;
      this.lookDY += (e.clientY - this.lookTouch.y) * 0.006 * this.sensitivity;
      this.lookTouch.x = e.clientX;
      this.lookTouch.y = e.clientY;
    });
    const lookEnd = (ev: Event) => {
      if ((ev as PointerEvent).pointerId === this.lookTouch.id) this.lookTouch.id = -1;
    };
    this.listen(lookZone, 'pointerup', lookEnd);
    this.listen(lookZone, 'pointercancel', lookEnd);
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.touchRoot?.remove();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }
}
