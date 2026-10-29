// Easing and small math helpers shared by the animation code.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const progress = (t, start, duration) => clamp((t - start) / duration, 0, 1);

export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** Deterministic PRNG so a given file always crumples the same way. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Simple time-based tween runner: tweens are advanced by the main loop. */
export class Tweens {
  constructor() {
    this.items = new Set();
  }
  add({ duration, update, done, ease = (t) => t, delay = 0 }) {
    const item = { elapsed: -delay, duration, update, done, ease };
    this.items.add(item);
    return () => this.items.delete(item);
  }
  wait(duration) {
    return new Promise((resolve) => this.add({ duration, update: () => {}, done: resolve }));
  }
  run(options) {
    return new Promise((resolve) => this.add({ ...options, done: () => { options.done?.(); resolve(); } }));
  }
  clear() {
    this.items.clear();
  }
  step(dt) {
    for (const item of [...this.items]) {
      item.elapsed += dt;
      if (item.elapsed < 0) continue;
      const t = clamp(item.elapsed / item.duration, 0, 1);
      item.update(item.ease(t), t);
      if (t >= 1) {
        this.items.delete(item);
        item.done?.();
      }
    }
  }
}
