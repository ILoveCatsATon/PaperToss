// The trash can: a slightly tapered metal cylinder with a hinged lid,
// standing on the floor at the far end of the room (top middle of the
// screen). Holds its own colliders, lid spring and reactions, and draws
// itself in perspective through the camera.

import { clamp } from '../anim/easing.js';

const LID_OPEN_ANGLE = (105 * Math.PI) / 180;
const SEGMENTS = 48;

export class TrashCan {
  constructor() {
    // Geometry (metres).
    this.cx = 0;
    this.cz = 4.3;
    this.R = 0.4; // rim radius
    this.Rb = 0.35; // base radius
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

    // Bottom.
    if (dist < Rw && ball.y - r < 0.02 && ball.y > 0) resolve(0, 1, 0, 0.02 - (ball.y - r), 'can-bottom', 0.15, 0.5);

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
    // Lid: under-damped spring so it pops open and bounces shut.
    const opening = this.lidTarget > this.lid;
    const stiffness = opening ? 240 : 320;
    const damping = opening ? 19 : 14;
    this.lidVel += (stiffness * (this.lidTarget - this.lid) - damping * this.lidVel) * dt;
    this.lid += this.lidVel * dt;
    if (this.lid < 0) {
      if (this.lidVel < -2.5 && this.onLidSlam) this.onLidSlam(Math.min(1, -this.lidVel / 9));
      this.lid = 0;
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
      g.addColorStop(0, '#4a525c');
      g.addColorStop(0.35, '#22272e');
      g.addColorStop(1, '#0d1013');
      ctx.fillStyle = g;
      this._path(ctx, rim);
      ctx.fill();
      // Far rim edge.
      ctx.strokeStyle = '#a7b0b9';
      ctx.lineWidth = Math.max(1.5, 0.012 * back.s);
      this._path(ctx, this._ring(cam, this.H, this.R, 0, -Math.PI), false);
      ctx.stroke();
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
      g.addColorStop(0, '#6f7882');
      g.addColorStop(0.12, '#c4cbd2');
      g.addColorStop(0.3, '#f6f8f9');
      g.addColorStop(0.42, '#d6dce1');
      g.addColorStop(0.7, '#98a1aa');
      g.addColorStop(0.88, '#bec5cc');
      g.addColorStop(1, '#6c757f');
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();
      ctx.clip();
      // Vertical ridges that follow the curvature.
      for (let i = 1; i < 24; i++) {
        const t = Math.PI - (Math.PI * i) / 24;
        const top = cam.project(this.cx + this.R * Math.cos(t), this.H, this.cz - this.R * Math.sin(t));
        const bot = cam.project(this.cx + this.Rb * Math.cos(t), 0, this.cz - this.Rb * Math.sin(t));
        ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.22)' : 'rgba(60,68,76,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bot.x, bot.y);
        ctx.stroke();
      }
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
      ctx.strokeStyle = '#eef1f3';
      ctx.lineWidth = Math.max(2, 0.026 * s);
      this._path(ctx, rimFront, false);
      ctx.stroke();

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
      ctx.fillStyle = '#353b43';
      this._path(ctx, pedal);
      ctx.fill();
    });
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

      ctx.fillStyle = '#5d666f';
      this._path(ctx, edge);
      ctx.fill();
      const top = face.reduce((m, p) => Math.min(m, p.y), Infinity);
      const bottom = face.reduce((m, p) => Math.max(m, p.y), -Infinity);
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      if (topVisible) {
        g.addColorStop(0, '#fbfcfd');
        g.addColorStop(0.5, '#d3d9de');
        g.addColorStop(1, '#9aa3ac');
      } else {
        g.addColorStop(0, '#8d969f');
        g.addColorStop(1, '#5f6870');
      }
      ctx.fillStyle = g;
      this._path(ctx, face);
      ctx.fill();
      if (topVisible) {
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        this._path(ctx, disc(this.R * 0.55, 0.035));
        ctx.fill();
      }
      // Hinge.
      const hinge = cam.project(this.cx, this.H + 0.012, this.cz + this.R + 0.01);
      ctx.fillStyle = '#4b525a';
      ctx.beginPath();
      ctx.arc(hinge.x, hinge.y, Math.max(2, 0.02 * s), 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
