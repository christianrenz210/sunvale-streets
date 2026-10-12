/**
 * All sound is synthesised with WebAudio, so the game ships with zero audio assets.
 */
export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private engineOsc?: OscillatorNode;
  private engineOsc2?: OscillatorNode;
  private engineGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private sirenOsc?: OscillatorNode;
  private sirenGain?: GainNode;
  private sirenLfo?: OscillatorNode;
  private radioStation = 0;
  private radioTimer = 0;
  private radioStep = 0;
  private radioNext = 0;
  private radioOn = false;
  volume = 0.8;
  musicVolume = 0.6;

  static readonly STATIONS = ['OFF', 'SUNVALE FM 88.1', 'BAYSIDE BEATS 94.7', 'NIGHT DRIVE 101.3'];

  /** Must be called from a user gesture on mobile browsers. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.5;
    this.musicBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // engine
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfx);
    this.engineOsc.start();
    this.engineOsc2.start();

    // siren
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 800;
    this.sirenLfo = ctx.createOscillator();
    this.sirenLfo.frequency.value = 0.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    this.sirenLfo.connect(lfoGain);
    lfoGain.connect(this.sirenOsc.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sfx);
    this.sirenOsc.start();
    this.sirenLfo.start();
  }

  setVolume(v: number, music: number) {
    this.volume = v;
    this.musicVolume = music;
    if (this.ctx) {
      this.master.gain.value = v;
      this.musicBus.gain.value = music * 0.5;
    }
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  setEngine(active: boolean, speedRatio: number, throttle: number) {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineOsc2 || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const rpm = 0.25 + Math.abs(speedRatio) * 0.75;
    // cheap fake gear shifts
    const gear = Math.min(4, Math.floor(Math.abs(speedRatio) * 4));
    const inGear = (Math.abs(speedRatio) * 4 - gear);
    const f = 40 + rpm * 60 + inGear * 40 + gear * 6;
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(300 + Math.abs(throttle) * 900 + rpm * 400, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.07 + Math.abs(throttle) * 0.05 : 0, t, 0.1);
  }

  setSiren(level: number) {
    if (!this.ctx || !this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(Math.min(0.06, level * 0.06), this.ctx.currentTime, 0.2);
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', q = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number, delay = 0, bus?: GainNode) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(kind: 'pistol' | 'smg' | 'shotgun', vol = 1) {
    if (kind === 'shotgun') {
      this.noise(0.45, 1800, 0.9 * vol);
      this.tone(90, 0.25, 0.5 * vol, 'sine', 40);
    } else {
      this.noise(kind === 'smg' ? 0.12 : 0.22, kind === 'smg' ? 3000 : 2400, 0.6 * vol);
      this.tone(160, 0.12, 0.35 * vol, 'square', 60);
    }
  }
  punch() { this.noise(0.12, 600, 0.6); this.tone(110, 0.1, 0.3, 'sine', 50); }
  hit() { this.noise(0.08, 1200, 0.35, 'bandpass', 2); }
  crash(strength: number) { this.noise(0.4, 500 + strength * 50, Math.min(0.9, 0.2 + strength * 0.05)); }
  explosion() {
    this.noise(1.6, 300, 1.0);
    this.noise(0.6, 2000, 0.4);
    this.tone(60, 1.0, 0.7, 'sine', 25);
  }
  horn() {
    this.tone(415, 0.35, 0.12, 'square');
    this.tone(523, 0.35, 0.1, 'square');
  }
  pickup() {
    this.tone(880, 0.1, 0.15, 'triangle');
    this.tone(1320, 0.15, 0.12, 'triangle', undefined, 0.08);
  }
  cash() {
    this.tone(1200, 0.08, 0.1, 'square');
    this.tone(1600, 0.12, 0.1, 'square', undefined, 0.07);
  }
  missionPassed() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((n, i) => this.tone(n, 0.25, 0.15, 'triangle', undefined, i * 0.13));
  }
  missionFailed() {
    [392, 330, 262].forEach((n, i) => this.tone(n, 0.4, 0.15, 'sawtooth', undefined, i * 0.25));
  }
  wasted() {
    this.tone(220, 2.0, 0.2, 'sawtooth', 55);
  }
  click() { this.tone(1000, 0.04, 0.08, 'square'); }

  cycleRadio(): string {
    this.radioStation = (this.radioStation + 1) % GameAudio.STATIONS.length;
    this.radioStep = 0;
    return GameAudio.STATIONS[this.radioStation];
  }

  setRadioActive(on: boolean) {
    this.radioOn = on;
  }

  /** Tiny step sequencer for the in-car radio. */
  update(dt: number) {
    if (!this.ctx || !this.radioOn || this.radioStation === 0) return;
    this.radioTimer += dt;
    const bpm = [0, 112, 88, 100][this.radioStation];
    const stepDur = 60 / bpm / 4;
    if (this.radioTimer < this.radioNext) return;
    this.radioNext = this.radioTimer + stepDur;
    const s = this.radioStep++ % 64;
    const bar = Math.floor(s / 16) % 4;
    const st = s % 16;
    const bus = this.musicBus;
    const prog = [
      [[0, 0], [110, 220], [87.3, 174.6], [130.8, 261.6], [98, 196]],
      [[0, 0], [73.4, 146.8], [65.4, 130.8], [55, 110], [61.7, 123.5]],
      [[0, 0], [82.4, 164.8], [98, 196], [73.4, 146.8], [110, 220]],
    ][this.radioStation - 1];
    const [bass, chordRoot] = prog[bar + 1];
    if (this.radioStation === 2) {
      // boom-bap
      if (st === 0 || st === 10) this.tone(55, 0.3, 0.5, 'sine', 35, 0, bus);
      if (st === 4 || st === 12) this.noiseOn(bus, 0.18, 1800, 0.4);
      if (st % 2 === 0) this.noiseOn(bus, 0.04, 8000, 0.08);
      if (st === 0 || st === 3 || st === 8) this.tone(bass, 0.35, 0.25, 'triangle', undefined, 0, bus);
      if (st === 0) [1, 1.19, 1.5].forEach((m) => this.tone(chordRoot * 2 * m, 1.2, 0.03, 'sine', undefined, 0, bus));
    } else {
      // synthwave / night drive
      if (st % 4 === 0) this.tone(60, 0.25, 0.5, 'sine', 40, 0, bus);
      if (st === 4 || st === 12) this.noiseOn(bus, 0.2, 2500, 0.3);
      if (st % 2 === 1) this.noiseOn(bus, 0.03, 9000, 0.06);
      this.tone(bass, stepDur * 0.9, 0.18, 'sawtooth', undefined, 0, bus);
      if (st % 4 === 2) {
        const arp = [1, 1.26, 1.5, 2][(s >> 2) % 4];
        this.tone(chordRoot * 2 * arp, 0.2, 0.05, this.radioStation === 1 ? 'square' : 'triangle', undefined, 0, bus);
      }
      if (st === 0) [1, 1.26, 1.5].forEach((m) => this.tone(chordRoot * 2 * m, 1.6, 0.025, 'sawtooth', undefined, 0, bus));
    }
  }

  private noiseOn(bus: GainNode, dur: number, freq: number, gain: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = freq > 5000 ? 'highpass' : 'bandpass';
    filt.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  dispose() {
    this.ctx?.close();
    this.ctx = null;
  }
}
