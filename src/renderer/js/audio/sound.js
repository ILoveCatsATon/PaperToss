// Synthesised sound effects (Web Audio, no asset files).
// Everything is quiet and short; all calls are no-ops while muted or
// before the first user gesture unlocks audio.

const STORAGE_KEY = 'paperToss.muted';

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable: preference just won't persist */
    }
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  get ready() {
    return this.ctx && !this.muted;
  }

  _noise({ at = 0, duration, type = 'bandpass', freq = 2000, q = 1, gain = 0.3, attack = 0.002, sweepTo = null }) {
    const c = this.ctx;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
  }

  _tone({ at = 0, freq, duration, type = 'sine', gain = 0.2, attack = 0.004, glideTo = null }) {
    const c = this.ctx;
    const t = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  /** Crinkly paper: many tiny filtered noise crackles, densest mid-way. */
  crumple(duration = 1.5) {
    if (!this.ready) return;
    const count = Math.round(duration * 46);
    for (let i = 0; i < count; i++) {
      const u = Math.random();
      const at = u * duration;
      const density = Math.sin(Math.PI * u);
      this._noise({
        at,
        duration: 0.012 + Math.random() * 0.05,
        freq: 1800 + Math.random() * 5200,
        q: 0.8 + Math.random() * 2,
        gain: 0.05 + density * 0.22 * Math.random(),
      });
    }
    this._noise({ duration, type: 'highpass', freq: 3000, gain: 0.025, attack: 0.2 });
  }

  pickup() {
    if (!this.ready) return;
    this._noise({ duration: 0.08, freq: 3200, q: 1.2, gain: 0.12 });
    this._tone({ freq: 520, glideTo: 780, duration: 0.09, gain: 0.05 });
  }

  whoosh(strength) {
    if (!this.ready) return;
    const g = 0.08 + 0.25 * Math.min(1, strength);
    this._noise({ duration: 0.38, freq: 380, sweepTo: 1500 + strength * 1200, q: 1.4, gain: g, attack: 0.05 });
  }

  /** Soft paper ball landing on wood. */
  thud(impact) {
    if (!this.ready) return;
    const g = Math.min(0.45, impact / 3000);
    if (g < 0.02) return;
    this._noise({ duration: 0.09, type: 'lowpass', freq: 900, q: 0.7, gain: g });
    this._noise({ duration: 0.05, freq: 3000, q: 1, gain: g * 0.4 });
    this._tone({ freq: 140, glideTo: 90, duration: 0.08, gain: g * 0.35 });
  }

  /** Light metallic tink when the ball clips the can. */
  tink(impact) {
    if (!this.ready) return;
    const g = Math.min(0.22, impact / 5000);
    if (g < 0.015) return;
    for (const [f, k] of [[1830, 1], [2650, 0.6], [3960, 0.35]]) {
      this._tone({ freq: f * (0.98 + Math.random() * 0.04), duration: 0.35, gain: g * k, attack: 0.002 });
    }
    this._noise({ duration: 0.03, freq: 5000, gain: g * 0.5 });
  }

  /** The bin shuffling across the wooden floor. */
  scoot(duration = 0.7) {
    if (!this.ready) return;
    this._noise({ duration, type: 'lowpass', freq: 520, q: 0.9, gain: 0.07, attack: 0.08 });
    const steps = Math.max(3, Math.round(duration / 0.13));
    for (let i = 0; i < steps; i++) {
      this._noise({ at: i * (duration / steps), duration: 0.05, type: 'lowpass', freq: 380, gain: 0.09 });
      this._tone({ at: i * (duration / steps), freq: 2200 + Math.random() * 500, duration: 0.06, gain: 0.012 });
    }
  }

  lidOpen() {
    if (!this.ready) return;
    this._noise({ duration: 0.04, type: 'highpass', freq: 2500, gain: 0.08 });
    this._tone({ freq: 880, duration: 0.07, gain: 0.03, type: 'triangle' });
  }

  clang(strength = 1) {
    if (!this.ready) return;
    const g = 0.12 + 0.18 * strength;
    for (const [f, k, d] of [[410, 1, 0.7], [655, 0.7, 0.55], [1130, 0.5, 0.45], [1590, 0.35, 0.35], [2320, 0.25, 0.25]]) {
      this._tone({ freq: f, duration: d, gain: g * k * 0.5, attack: 0.002, type: 'sine' });
    }
    this._noise({ duration: 0.12, type: 'lowpass', freq: 600, gain: g * 0.8 });
  }

  /** Ball dropping into the bin. */
  drop() {
    if (!this.ready) return;
    this._noise({ duration: 0.12, type: 'lowpass', freq: 500, gain: 0.35 });
    this._tone({ freq: 110, glideTo: 70, duration: 0.15, gain: 0.18 });
  }

  success() {
    if (!this.ready) return;
    [1046.5, 1318.5, 1568].forEach((f, i) => this._tone({ at: i * 0.09, freq: f, duration: 0.55, gain: 0.09, attack: 0.01 }));
  }

  miss() {
    if (!this.ready) return;
    this._tone({ freq: 330, glideTo: 220, duration: 0.28, gain: 0.08, type: 'triangle' });
    this._tone({ at: 0.24, freq: 247, glideTo: 150, duration: 0.42, gain: 0.08, type: 'triangle' });
  }

  survived() {
    if (!this.ready) return;
    [523.25, 659.25, 784, 1046.5].forEach((f, i) => this._tone({ at: i * 0.07, freq: f, duration: 0.6, gain: 0.06, attack: 0.01, type: 'triangle' }));
  }

  error() {
    if (!this.ready) return;
    this._tone({ freq: 196, duration: 0.25, gain: 0.09, type: 'square' });
    this._tone({ at: 0.18, freq: 165, duration: 0.35, gain: 0.08, type: 'square' });
  }
}
