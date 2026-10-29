// Pinhole camera standing behind the player, looking down the room.
// World units are metres (x right, y up, z away); screen units are CSS px.

export class Camera {
  constructor() {
    this.pos = { x: 0, y: 2.0, z: -1.0 };
  }

  configure(width, height) {
    this.width = width;
    this.height = height;
    this.f = Math.min(height * 1.0, width * 0.95); // focal length in px
    this.cx = width / 2;
    // Where the ball rests should sit near the bottom of the window: solve
    // the horizon so that world y = 1.285 at z = 0 lands ~232px up.
    this.horizon = height - 232 * (height / 800) - (this.pos.y - 1.285) * (this.f / (0 - this.pos.z));
  }

  /** World → screen. `s` is pixels per metre at that depth. */
  project(x, y, z) {
    const d = Math.max(0.05, z - this.pos.z);
    const s = this.f / d;
    return { x: this.cx + (x - this.pos.x) * s, y: this.horizon + (this.pos.y - y) * s, s, d };
  }

  /** Screen → world on the plane z = const. */
  unproject(sx, sy, z) {
    const s = this.f / Math.max(0.05, z - this.pos.z);
    return { x: (sx - this.cx) / s + this.pos.x, y: this.pos.y - (sy - this.horizon) / s, z };
  }
}
