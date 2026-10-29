// Tiny 3D physics for one paper ball, in metres and seconds.
//   x: right, y: up, z: away from the player (into the screen)
// Gravity, air drag, a floor, the room's walls, and any extra colliders
// (the trash can) that report contacts through a shared resolver.
// No rendering and no DOM in here.

export class Ball {
  constructor(radius) {
    this.r = radius;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.angle = 0; // on-screen rotation of the sprite
    this.spin = 0; // rad/s, positive = clockwise on screen
    this.bounciness = 1; // multiplier on surface restitution
    this.contactAge = Infinity; // seconds since the last contact
    this.contactTag = null;
    this.squash = 0;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  place(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.spin = 0;
    this.contactAge = Infinity;
  }
}

export class World {
  constructor() {
    this.gravity = 9.8;
    this.airDrag = 0.16; // paper is light
    this.rollingDrag = 2.6; // paper balls don't roll well
    this.room = { xMin: -2.6, xMax: 2.6, zMin: -0.35, zMax: 6.5 };
    this.colliders = []; // objects with collide(ball, resolve)
  }

  /** Advance the ball by dt seconds. onImpact({tag, impact, x, y, z}) with impact in m/s. */
  step(ball, dt, onImpact) {
    const travel = ball.speed * dt;
    const substeps = Math.min(40, Math.max(2, Math.ceil(travel / (ball.r * 0.3))));
    const h = dt / substeps;
    ball.contactAge += dt;
    this._impacts = new Map();
    const resolve = (nx, ny, nz, pen, tag, e, mu) => this._resolve(ball, nx, ny, nz, pen, tag, e, mu, h);
    for (let i = 0; i < substeps; i++) this._substep(ball, h, resolve);
    ball.angle += ball.spin * dt;
    ball.spin *= Math.exp(-0.5 * dt);
    ball.squash *= Math.exp(-14 * dt);
    if (onImpact) for (const event of this._impacts.values()) onImpact(event);
  }

  _substep(ball, h, resolve) {
    ball.vy -= this.gravity * h;
    const drag = Math.exp(-this.airDrag * h);
    ball.vx *= drag;
    ball.vy *= drag;
    ball.vz *= drag;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    ball.z += ball.vz * h;

    const r = ball.r;
    const room = this.room;
    if (ball.y - r < 0) resolve(0, 1, 0, r - ball.y, 'floor', 0.45, 0.35);
    if (ball.x - r < room.xMin) resolve(1, 0, 0, room.xMin - (ball.x - r), 'wall', 0.45, 0.2);
    if (ball.x + r > room.xMax) resolve(-1, 0, 0, ball.x + r - room.xMax, 'wall', 0.45, 0.2);
    if (ball.z + r > room.zMax) resolve(0, 0, -1, ball.z + r - room.zMax, 'wall', 0.45, 0.2);
    if (ball.z - r < room.zMin) resolve(0, 0, 1, room.zMin - (ball.z - r), 'near', 0.3, 0.2);

    for (const c of this.colliders) c.collide(ball, resolve);
  }

  _resolve(ball, nx, ny, nz, penetration, tag, restitution, friction, h) {
    ball.x += nx * penetration;
    ball.y += ny * penetration;
    ball.z += nz * penetration;
    ball.contactAge = 0;
    ball.contactTag = tag;

    const vn = ball.vx * nx + ball.vy * ny + ball.vz * nz;
    if (vn >= 0) return;
    const impact = -vn;
    // Kill tiny bounces so the ball can come to rest.
    const e = impact < 0.6 ? 0 : restitution * ball.bounciness;
    ball.vx -= (1 + e) * vn * nx;
    ball.vy -= (1 + e) * vn * ny;
    ball.vz -= (1 + e) * vn * nz;

    // Coulomb friction in the contact plane.
    const vnAfter = ball.vx * nx + ball.vy * ny + ball.vz * nz;
    const tx = ball.vx - vnAfter * nx;
    const ty = ball.vy - vnAfter * ny;
    const tz = ball.vz - vnAfter * nz;
    const vt = Math.hypot(tx, ty, tz);
    if (vt > 1e-6) {
      const cut = Math.min(vt, friction * (1 + e) * impact) / vt;
      ball.vx -= tx * cut;
      ball.vy -= ty * cut;
      ball.vz -= tz * cut;
    }

    // Rolling resistance on mostly-flat ground.
    if (ny > 0.7) {
      const roll = Math.exp(-this.rollingDrag * h);
      ball.vx *= roll;
      ball.vz *= roll;
      ball.spin = ball.spin * 0.5 + ((ball.vx - ball.vz * 0.35) / ball.r) * 0.5;
    }

    if (impact > 0.5) {
      ball.squash = Math.max(ball.squash, Math.min(0.22, impact / 30));
      const prev = this._impacts.get(tag);
      if (!prev || prev.impact < impact) this._impacts.set(tag, { tag, impact, x: ball.x, y: ball.y - ball.r * ny, z: ball.z });
    }
  }

  /** Predict the free-flight path (no collisions) for the aiming preview. */
  predict(x, y, z, vx, vy, vz, duration, step = 1 / 60) {
    const points = [];
    const drag = Math.exp(-this.airDrag * step);
    for (let t = 0; t <= duration; t += step) {
      points.push({ x, y, z, t });
      vy -= this.gravity * step;
      vx *= drag;
      vy *= drag;
      vz *= drag;
      x += vx * step;
      y += vy * step;
      z += vz * step;
      if (y < 0) break;
    }
    return points;
  }
}
