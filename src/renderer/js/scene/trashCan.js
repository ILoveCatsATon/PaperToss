// The trash can: a slightly tapered metal cylinder with a hinged lid,
// standing on the floor at the far end of the room (top middle of the
// screen). Holds its own colliders, lid spring and reactions, and draws
// itself in perspective through the camera.

import { clamp, lerp, easeInOutCubic, mulberry32 } from '../anim/easing.js';
import { getSkin, resolveSkin, DEFAULT_SKIN } from './skins.js';

const LID_OPEN_ANGLE = (105 * Math.PI) / 180;
const SEGMENTS = 48;

export class TrashCan {
  constructor() {
    // Geometry (metres).
    this.cx = 0;
    this.cz = 4.3;
    this.R = 0.46; // rim radius
    this.Rb = 0.4; // base radius
    this.H = 0.9; // rim height
    this.wall = 0.012;
    this.rimT = 0.016;

    // Animated state.
    this.lid = 0; // 0 closed .. 1 open
    this.lidVel = 0;
    this.lidTarget = 0;
    this.shake = 0;
    this.shakeTime = 0;
    this.squash = 0;
    this.squashVel = 0;
    this.glow = 0;
    this.glowTarget = 0;
    this.sealed = false; // once the ball is in, it can't bounce out
    this.onLidSlam = null;
    this.move = null; // active relocation { fromX, fromZ, toX, toZ, t, dur }
    this.setSkin(DEFAULT_SKIN);

    // How full the bin is (mirrors the OS Recycle Bin), 0..1.
    this.fill = 0;
    this.fillTarget = 0;
    // Crumpled balls in the pile, in unit-disc coordinates (sunflower spread).
    const rand = mulberry32(99);
    const tones = ['#fbfaf5', '#f3efe4', '#ffffff', '#ece6d6', '#f7f2e8', '#fff4cf', '#e8f1fb', '#f9e3dc'];
    this.pile = Array.from({ length: 40 }, (_, i) => ({
      a: i * 2.39996 + rand() * 0.3,
      rr: Math.sqrt((i + 0.5) / 40),
      size: 0.8 + rand() * 0.45,
      tone: tones[Math.floor(rand() * tones.length)],
      lift: rand(),
      crease: rand() * Math.PI,
      order: rand(),
    })).sort((p, q) => p.order - q.order);
  }

  /** 0 = empty, 1 = as full as it gets. */
  setFill(level) {
    this.fillTarget = clamp(level, 0, 1);
  }

  /** Height of the paper pile balls land on inside the bin (metres). */
  pileHeight() {
    return this.fill * (this.H - 0.2);
  }

  /**
   * How far the visible heap's peak sits above the rim (metres; negative =
   * still below it). It heaps up out of the bin as the Recycle Bin fills, so
   * you can see how full it is from across the room.
   */
  crownHeight() {
    return this.fill > 0.01 ? 0.24 * Math.pow(this.fill, 1.3) - 0.025 : -Infinity;
  }

  /** The lid can't shut on a heap: it rests propped open this far (0..1). */
  restOpen() {
    return clamp(this.crownHeight() * 2.2, 0, 0.5);
  }

  // ------------------------------------------------------------------
  // Moving around the room
  // ------------------------------------------------------------------

  /** Change how the bin looks (see skins.js). */
  setSkin(id) {
    this.skin = resolveSkin(getSkin(id));
  }

  /** Waddle to a new spot on the floor. Returns the trip duration (s). */
  moveTo(x, z) {
    const dist = Math.hypot(x - this.cx, z - this.cz);
    const dur = clamp(0.35 + dist * 0.28, 0.5, 1.0);
    this.move = { fromX: this.cx, fromZ: this.cz, toX: x, toZ: z, t: 0, dur };
    return dur;
  }

  get moving() {
    return this.move !== null;
  }

  // ------------------------------------------------------------------
  // Geometry helpers
  // ------------------------------------------------------------------

  radiusAt(y) {
    const t = clamp(y / this.H, 0, 1);
    return this.Rb + (this.R - this.Rb) * t;
  }

  lidAngle() {
    return this.lid * LID_OPEN_ANGLE;
  }

  /** Lid frame: hinge at the back rim; f points from hinge to lid centre. */
  lidFrame() {
    const a = this.lidAngle();
    const hinge = { x: this.cx, y: this.H + 0.012, z: this.cz + this.R + 0.01 };
    const f = { x: 0, y: Math.sin(a), z: -Math.cos(a) };
    const n = { x: 0, y: Math.cos(a), z: Math.sin(a) };
    const c = { x: hinge.x, y: hinge.y + f.y * this.R, z: hinge.z + f.z * this.R };
    return { hinge, f, n, c };
  }

  /** Ball has dropped through the opening and is inside. */
  contains(ball) {
    const dist = Math.hypot(ball.x - this.cx, ball.z - this.cz);
    return dist < this.radiusAt(ball.y) - this.wall - ball.r * 0.2 && ball.y < this.H - ball.r * 0.6;
  }

  /** Horizontal distance from the can's axis. */
  axisDistance(ball) {
    return Math.hypot(ball.x - this.cx, ball.z - this.cz);
  }

  // ------------------------------------------------------------------
  // Collisions (called by the physics world every substep)
  // ------------------------------------------------------------------

  collide(ball, resolve) {
    const r = ball.r;
    let dx = ball.x - this.cx;
    let dz = ball.z - this.cz;
    let dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      dx = 0;
      dz = -1;
      dist = 1e-6;
    }
    const ux = dx / dist;
    const uz = dz / dist;
    const Rw = this.radiusAt(ball.y);

    // Walls (only below the rim; the rim itself is a torus below).
    if (ball.y <= this.H && ball.y > -r) {
      if (dist >= Rw - this.wall / 2) {
        if (dist < Rw + r) resolve(ux, 0, uz, Rw + r - dist, 'can-wall', 0.35, 0.25);
      } else if (dist > Rw - this.wall - r) {
        resolve(-ux, 0, -uz, dist - (Rw - this.wall - r), 'can-wall', 0.3, 0.25);
      }
    }

    // Rim: a torus of radius R at height H.
    const qx = this.cx + ux * (this.R - this.wall / 2);
    const qz = this.cz + uz * (this.R - this.wall / 2);
    const rx = ball.x - qx;
    const ry = ball.y - this.H;
    const rz = ball.z - qz;
    const rd = Math.hypot(rx, ry, rz);
    if (rd < r + this.rimT && rd > 1e-6) resolve(rx / rd, ry / rd, rz / rd, r + this.rimT - rd, 'can-rim', 0.4, 0.2);

    // Bottom, or the top of the paper pile when the bin is part full.
    const floor = 0.02 + this.pileHeight();
    if (dist < Rw && ball.y - r < floor && ball.y > floor - r * 2) {
      resolve(0, 1, 0, floor - (ball.y - r), 'can-bottom', this.fill > 0.05 ? 0.08 : 0.15, 0.6);
    }

    if (this.sealed) {
      if (dist < this.R && ball.y + r > this.H - 0.01) resolve(0, -1, 0, ball.y + r - (this.H - 0.01), 'seal', 0.1, 0.5);
      return;
    }

    // Lid: a disc hinged at the back rim.
    const { c, n } = this.lidFrame();
    const vx = ball.x - c.x;
    const vy = ball.y - c.y;
    const vz = ball.z - c.z;
    const hgt = vx * n.x + vy * n.y + vz * n.z;
    let px = vx - hgt * n.x;
    let py = vy - hgt * n.y;
    let pz = vz - hgt * n.z;
    const pl = Math.hypot(px, py, pz);
    if (pl > this.R) {
      px *= this.R / pl;
      py *= this.R / pl;
      pz *= this.R / pl;
    }
    const lx = vx - px;
    const ly = vy - py;
    const lz = vz - pz;
    const ld = Math.hypot(lx, ly, lz);
    const lidT = 0.015;
    if (ld < r + lidT && ld > 1e-6) resolve(lx / ld, ly / ld, lz / ld, r + lidT - ld, 'lid', 0.45, 0.2);
  }

  // ------------------------------------------------------------------
  // Reactions
  // ------------------------------------------------------------------

  hit(strength) {
    this.shake = Math.min(1, this.shake + strength);
  }

  thump(strength) {
    this.squashVel -= strength;
  }

  update(dt) {
    if (this.move) {
      const m = this.move;
      m.t = Math.min(m.dur, m.t + dt);
      const e = easeInOutCubic(m.t / m.dur);
      this.cx = lerp(m.fromX, m.toX, e);
      this.cz = lerp(m.fromZ, m.toZ, e);
      this.shake = Math.max(this.shake, 0.45 * Math.sin(Math.PI * (m.t / m.dur))); // waddle
      if (m.t >= m.dur) {
        this.move = null;
        this.thump(0.7); // settle with a little bounce
      }
    }
    // Lid: under-damped spring so it pops open and bounces shut.
    // A full bin's lid comes down onto the heap instead of the rim.
    const rest = this.restOpen();
    const target = Math.max(this.lidTarget, rest);
    const opening = target > this.lid;
    const stiffness = opening ? 240 : 320;
    const damping = opening ? 19 : 14;
    this.lidVel += (stiffness * (target - this.lid) - damping * this.lidVel) * dt;
    this.lid += this.lidVel * dt;
    if (this.lid < rest) {
      if (this.lidVel < -2.5 && this.onLidSlam) this.onLidSlam(Math.min(1, -this.lidVel / 9));
      this.lid = rest;
      this.lidVel = Math.abs(this.lidVel) * 0.3;
      if (this.lidVel < 0.5) this.lidVel = 0;
    }
    if (this.lid > 1.06) {
      this.lid = 1.06;
      this.lidVel = 0;
    }
    this.shake *= Math.exp(-5 * dt);
    this.shakeTime += dt;
    this.squashVel += (-180 * this.squash - 12 * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    this.glow += (this.glowTarget - this.glow) * Math.min(1, dt * 10);
    this.fill += (this.fillTarget - this.fill) * Math.min(1, dt * 2.5);
  }

  // ------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------

  /** Screen points around a horizontal circle; theta = 90° is the front. */
  _ring(cam, y, radius, from, to, steps = SEGMENTS) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      pts.push(cam.project(this.cx + radius * Math.cos(t), y, this.cz - radius * Math.sin(t)));
    }
    return pts;
  }

  _path(ctx, pts, close = true) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (close) ctx.closePath();
  }

  _withBodyTransform(ctx, cam, fn) {
    const base = cam.project(this.cx, 0, this.cz - this.Rb);
    const wobble = Math.sin(this.shakeTime * 38) * this.shake * 0.05;
    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.rotate(wobble);
    ctx.scale(1 - this.squash * 0.5, 1 + this.squash);
    ctx.translate(-base.x, -base.y);
    fn();
    ctx.restore();
  }

  /** Screen anchor for effects (centre of the opening). */
  rimCenter(cam) {
    return cam.project(this.cx, this.H, this.cz);
  }

  drawShadow(ctx, cam) {
    const c = cam.project(this.cx + 0.06, 0, this.cz + 0.04);
    const front = cam.project(this.cx, 0, this.cz - this.R * 1.4);
    const back = cam.project(this.cx, 0, this.cz + this.R * 1.4);
    const rx = this.R * 1.5 * c.s;
    const ry = Math.max(4, (front.y - back.y) / 2);
    ctx.save();
    ctx.translate(c.x, (front.y + back.y) / 2);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(40,30,20,0.38)');
    g.addColorStop(0.6, 'rgba(40,30,20,0.18)');
    g.addColorStop(1, 'rgba(40,30,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Dark opening: drawn before a ball that is inside or over the can. */
  drawInterior(ctx, cam) {
    this._withBodyTransform(ctx, cam, () => {
      const rim = this._ring(cam, this.H, this.R, 0, Math.PI * 2);
      const back = cam.project(this.cx, this.H, this.cz + this.R);
      const front = cam.project(this.cx, this.H, this.cz - this.R);
      const g = ctx.createLinearGradient(0, back.y, 0, front.y);
      const [i0, i1, i2] = this.skin.interior;
      g.addColorStop(0, i0);
      g.addColorStop(0.35, i1);
      g.addColorStop(1, i2);
      ctx.fillStyle = g;
      this._path(ctx, rim);
      ctx.fill();
      // Far rim edge.
      ctx.strokeStyle = this.skin.rimBack;
      ctx.lineWidth = Math.max(1.5, 0.012 * back.s);
      this._path(ctx, this._ring(cam, this.H, this.R, 0, -Math.PI), false);
      ctx.stroke();
      // The heap goes over the far rim; the body (drawn next) hides whatever
      // sits below the front rim.
      if (this.fill > 0.01) this._drawPile(ctx, cam);
    });
  }

  /** Body, front rim lip, pedal and glow: drawn over an inside ball. */
  drawBody(ctx, cam) {
    this._withBodyTransform(ctx, cam, () => {
      const rimFront = this._ring(cam, this.H, this.R, Math.PI, 0);
      const baseFront = this._ring(cam, 0.004, this.Rb, 0, Math.PI);
      const body = [...rimFront, ...baseFront];
      const left = rimFront[0].x;
      const right = rimFront[rimFront.length - 1].x;

      this._path(ctx, body);
      const g = ctx.createLinearGradient(left, 0, right, 0);
      const skin = this.skin;
      for (const [at, color] of skin.body) g.addColorStop(at, color);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();
      ctx.clip();
      // Vertical ridges that follow the curvature.
      for (let i = 1; i < 24 && skin.deco === 'ridges'; i++) {
        const t = Math.PI - (Math.PI * i) / 24;
        const top = cam.project(this.cx + this.R * Math.cos(t), this.H, this.cz - this.R * Math.sin(t));
        const bot = cam.project(this.cx + this.Rb * Math.cos(t), 0, this.cz - this.Rb * Math.sin(t));
        ctx.strokeStyle = i % 2 ? skin.ridgeLight : skin.ridgeDark;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bot.x, bot.y);
        ctx.stroke();
      }
      this._drawDecoration(ctx, cam, rimFront);
      // Dark base band and soft shade under the rim.
      const baseY = baseFront[Math.floor(baseFront.length / 2)].y;
      const rimY = rimFront[Math.floor(rimFront.length / 2)].y;
      const h = baseY - rimY;
      const band = ctx.createLinearGradient(0, baseY - h * 0.16, 0, baseY);
      band.addColorStop(0, 'rgba(40,45,52,0)');
      band.addColorStop(0.3, 'rgba(40,45,52,0.55)');
      band.addColorStop(1, 'rgba(25,28,32,0.8)');
      ctx.fillStyle = band;
      ctx.fillRect(left - 20, baseY - h * 0.16, right - left + 40, h * 0.2);
      const ao = ctx.createLinearGradient(0, rimY, 0, rimY + h * 0.18);
      ao.addColorStop(0, 'rgba(30,35,40,0.38)');
      ao.addColorStop(1, 'rgba(30,35,40,0)');
      ctx.fillStyle = ao;
      ctx.fillRect(left - 20, rimY - 10, right - left + 40, h * 0.18 + 10);
      ctx.restore();

      // Front rim lip.
      const s = rimFront[Math.floor(rimFront.length / 2)].s;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.save();
      if (skin.neon) {
        ctx.shadowColor = skin.rim;
        ctx.shadowBlur = 14;
      }
      ctx.strokeStyle = skin.rim;
      ctx.lineWidth = Math.max(2, 0.026 * s);
      this._path(ctx, rimFront, false);
      ctx.stroke();
      ctx.restore();

      if (this.glow > 0.01) {
        ctx.save();
        ctx.globalAlpha = this.glow;
        ctx.shadowColor = 'rgba(255,214,102,0.95)';
        ctx.shadowBlur = 22;
        ctx.strokeStyle = 'rgba(255,222,125,0.95)';
        ctx.lineWidth = Math.max(2, 0.02 * s);
        this._path(ctx, this._ring(cam, this.H + 0.01, this.R + 0.01, 0, Math.PI * 2));
        ctx.stroke();
        ctx.restore();
      }

      // Foot pedal sticking out at the front.
      const push = this.lid * 0.025;
      const pedal = [
        cam.project(this.cx - 0.09, 0.07, this.cz - this.Rb + 0.01),
        cam.project(this.cx + 0.09, 0.07, this.cz - this.Rb + 0.01),
        cam.project(this.cx + 0.09, 0.05 - push, this.cz - this.Rb - 0.13),
        cam.project(this.cx - 0.09, 0.05 - push, this.cz - this.Rb - 0.13),
      ];
      ctx.fillStyle = skin.pedal;
      this._path(ctx, pedal);
      ctx.fill();
    });
  }

  /**
   * Heap of crumpled paper balls: a dome whose peak rises out of the opening
   * as the bin fills (see crownHeight). Visual only; balls land on pileHeight.
   */
  _drawPile(ctx, cam) {
    const peak = this.H + this.crownHeight();
    const dome = 0.06 + 0.1 * this.fill; // peak-to-edge drop
    const rad = this.R - this.wall;
    // Fewer balls when nearly empty, a full heap of them when full.
    const count = Math.min(this.pile.length, 6 + Math.round(this.fill * 40));
    const balls = this.pile.slice(0, count).map((b) => {
      const x = this.cx + Math.cos(b.a) * b.rr * rad * 0.88;
      const z = this.cz + Math.sin(b.a) * b.rr * rad * 0.88;
      const y = peak - dome * b.rr * b.rr + (b.lift - 0.5) * 0.025;
      return { b, y, p: cam.project(x, y, z) };
    });
    // Far balls first.
    balls.sort((u, v) => v.p.d - u.p.d);
    for (const { b, y, p } of balls) {
      const r = 0.06 * b.size * p.s;
      const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, b.tone);
      g.addColorStop(1, 'rgba(120,110,95,1)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,80,65,0.35)';
      ctx.lineWidth = Math.max(0.6, r * 0.08);
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(b.crease) * r * 0.6, p.y - Math.sin(b.crease) * r * 0.6);
      ctx.lineTo(p.x + Math.cos(b.crease + 0.5) * r * 0.2, p.y + Math.sin(b.crease + 0.5) * r * 0.2);
      ctx.lineTo(p.x + Math.cos(b.crease) * r * 0.55, p.y + Math.sin(b.crease) * r * 0.55);
      ctx.stroke();
      // Balls sitting down inside the bin are in its shadow.
      const depth = clamp((this.H - y) / 0.12, 0, 1);
      if (depth > 0) {
        ctx.fillStyle = `rgba(15,15,18,${(0.55 * depth).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** A point on the can's outer surface; theta = 90° faces the player. */
  _surface(cam, theta, y, out = 0) {
    const r = this.radiusAt(y) + out;
    return cam.project(this.cx + r * Math.cos(theta), y, this.cz - r * Math.sin(theta));
  }

  /** Skin decoration painted on the body (already clipped to it). */
  _drawDecoration(ctx, cam, rimFront) {
    const skin = this.skin;
    const s = rimFront[Math.floor(rimFront.length / 2)].s;
    const H = this.H;
    const front = (y) => {
      const pts = [];
      for (let i = 0; i <= SEGMENTS; i++) pts.push(this._surface(cam, Math.PI - (Math.PI * i) / SEGMENTS, y));
      return pts;
    };
    if (skin.deco === 'band') {
      const top = front(H * 0.58);
      const bottom = front(H * 0.44).reverse();
      ctx.save();
      if (skin.neon) {
        ctx.shadowColor = skin.decoColor;
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = skin.decoColor;
      ctx.globalAlpha = skin.neon ? 0.9 : 0.85;
      this._path(ctx, [...top, ...bottom]);
      ctx.fill();
      ctx.restore();
    } else if (skin.deco === 'slats') {
      ctx.strokeStyle = skin.decoColor;
      for (let i = 1; i < 12; i++) {
        const t = Math.PI - (Math.PI * i) / 12;
        const a = this._surface(cam, t, H);
        const b = this._surface(cam, t, 0);
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(1, 0.01 * s);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      // Metal hoops.
      ctx.globalAlpha = 1;
      for (const y of [H * 0.82, H * 0.22]) {
        ctx.strokeStyle = '#3a3f46';
        ctx.lineWidth = Math.max(2, 0.03 * s);
        this._path(ctx, front(y), false);
        ctx.stroke();
      }
    } else if (skin.deco === 'dots') {
      ctx.fillStyle = skin.decoColor;
      const rows = 5;
      for (let row = 0; row < rows; row++) {
        const y = H * (0.16 + (row * 0.7) / (rows - 1));
        for (let col = 0; col < 9; col++) {
          const t = Math.PI * ((col + (row % 2 ? 0.5 : 0) + 0.25) / 9);
          const facing = Math.sin(t);
          if (facing < 0.12) continue;
          const p = this._surface(cam, t, y);
          const r = 0.032 * p.s;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, Math.max(0.5, r * facing), r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (skin.deco === 'symbol') {
      const p = this._surface(cam, Math.PI / 2, H * 0.5);
      ctx.fillStyle = skin.decoColor;
      ctx.globalAlpha = 0.9;
      ctx.font = `${Math.round(0.36 * p.s)}px "Segoe UI Symbol", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('♻', p.x, p.y);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }

  /** The lid. Drawn behind the opening when open, on top when closed. */
  drawLid(ctx, cam) {
    this._withBodyTransform(ctx, cam, () => {
      const { c, f, n } = this.lidFrame();
      const disc = (radius, offset) => {
        const pts = [];
        for (let i = 0; i <= SEGMENTS; i++) {
          const t = (i / SEGMENTS) * Math.PI * 2;
          const a = Math.cos(t) * radius;
          const b = Math.sin(t) * radius;
          pts.push(cam.project(c.x + a + n.x * offset, c.y + f.y * b + n.y * offset, c.z + f.z * b + n.z * offset));
        }
        return pts;
      };
      const eye = cam.pos;
      const topVisible = (eye.x - c.x) * n.x + (eye.y - c.y) * n.y + (eye.z - c.z) * n.z > 0;
      const side = topVisible ? 1 : -1;
      const edge = disc(this.R + 0.012, -0.02 * side);
      const face = disc(this.R + 0.012, 0);
      const s = cam.project(c.x, c.y, c.z).s;

      const skin = this.skin;
      ctx.fillStyle = skin.lidEdge;
      this._path(ctx, edge);
      ctx.fill();
      const top = face.reduce((m, p) => Math.min(m, p.y), Infinity);
      const bottom = face.reduce((m, p) => Math.max(m, p.y), -Infinity);
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      if (topVisible) {
        g.addColorStop(0, skin.lidTop[0]);
        g.addColorStop(0.5, skin.lidTop[1]);
        g.addColorStop(1, skin.lidTop[2]);
      } else {
        g.addColorStop(0, skin.lidUnder[0]);
        g.addColorStop(1, skin.lidUnder[1]);
      }
      ctx.fillStyle = g;
      this._path(ctx, face);
      ctx.fill();
      if (topVisible) {
        ctx.fillStyle = skin.shine;
        this._path(ctx, disc(this.R * 0.55, 0.035));
        ctx.fill();
      }
      // Hinge.
      const hinge = cam.project(this.cx, this.H + 0.012, this.cz + this.R + 0.01);
      ctx.fillStyle = skin.hinge;
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, Math.max(2, 0.02 * s), 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
