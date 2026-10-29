// Pointer (mouse / touch / pen) input for grabbing, pulling back and
// releasing the paper ball. Measures the release ("flick") velocity from
// the last few pointer samples. Knows nothing about physics or files.

const SAMPLE_WINDOW_MS = 90;

export class ThrowController {
  /**
   * @param {HTMLElement} surface
   * @param {{
   *   hitTest: (x: number, y: number) => boolean,
   *   onGrab: (x: number, y: number) => void,
   *   onMove: (x: number, y: number) => void,
   *   onRelease: (flick: {vx: number, vy: number}) => void,
   *   onCancelHold: () => void,
   *   onPickup: () => void,
   * }} handlers
   */
  constructor(surface, handlers) {
    this.surface = surface;
    this.h = handlers;
    this.mode = 'off';
    this.pointerId = null;
    this.samples = [];

    surface.addEventListener('pointerdown', (e) => this._down(e));
    surface.addEventListener('pointermove', (e) => this._move(e));
    surface.addEventListener('pointerup', (e) => this._up(e));
    surface.addEventListener('pointercancel', (e) => this._cancel(e));
    surface.addEventListener('lostpointercapture', (e) => this._cancel(e));
  }

  /** 'off' | 'throw' | 'pickup' */
  setMode(mode) {
    if (mode === this.mode) return;
    if (this.pointerId !== null && mode !== 'throw') this._endHold();
    this.mode = mode;
    this._cursor(null);
  }

  get holding() {
    return this.pointerId !== null;
  }

  _point(e) {
    const rect = this.surface.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _cursor(over) {
    let cursor = '';
    if (this.holding) cursor = 'grabbing';
    else if (over && this.mode === 'throw') cursor = 'grab';
    else if (over && this.mode === 'pickup') cursor = 'pointer';
    this.surface.style.cursor = cursor;
  }

  _down(e) {
    if (this.holding || e.button > 0) return;
    const { x, y } = this._point(e);
    if (!this.h.hitTest(x, y)) return;
    e.preventDefault();
    if (this.mode === 'pickup') {
      this.h.onPickup();
      return;
    }
    if (this.mode !== 'throw') return;
    this.pointerId = e.pointerId;
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    this.samples = [{ t: e.timeStamp, x, y }];
    this._cursor(true);
    this.h.onGrab(x, y);
  }

  _move(e) {
    const { x, y } = this._point(e);
    if (!this.holding) {
      this._cursor(this.mode !== 'off' && this.h.hitTest(x, y));
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    // Use coalesced events for smoother velocity on high-rate input.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ce of events.length ? events : [e]) {
      const p = this._point(ce);
      this.samples.push({ t: ce.timeStamp, x: p.x, y: p.y });
    }
    const cutoff = e.timeStamp - SAMPLE_WINDOW_MS * 2;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
    this.h.onMove(x, y);
  }

  _up(e) {
    if (!this.holding || e.pointerId !== this.pointerId) return;
    const { x, y } = this._point(e);
    this.samples.push({ t: e.timeStamp, x, y });
    const flick = this._velocity(e.timeStamp);
    this._endHold();
    this.h.onRelease(flick);
  }

  _cancel(e) {
    if (!this.holding || e.pointerId !== this.pointerId) return;
    this._endHold();
    this.h.onCancelHold();
  }

  _endHold() {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null) {
      try {
        if (this.surface.hasPointerCapture(id)) this.surface.releasePointerCapture(id);
      } catch {
        /* ignore */
      }
    }
    this._cursor(false);
  }

  /** Average pointer velocity (px/s) over the last ~90ms before release. */
  _velocity(now) {
    const recent = this.samples.filter((s) => now - s.t <= SAMPLE_WINDOW_MS);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.012) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }
}
