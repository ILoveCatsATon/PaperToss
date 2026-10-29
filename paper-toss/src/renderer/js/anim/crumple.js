// Paper crumple animation.
//
// The sheet is a grid mesh with 3D vertices. As progress goes 0 → 1:
//   1. the right half folds over the left half,
//   2. a corner folds down,
//   3. every vertex collapses onto a lumpy sphere (the paper ball),
// with wrinkle noise peaking mid-way. Triangles are drawn with affine
// texture mapping (front or back texture depending on facing), sorted by
// depth, and shaded by their normal for a faceted, crumpled look.

import { clamp, lerp, progress, easeInOutCubic, mulberry32, hashString } from './easing.js';

const LIGHT = (() => {
  const v = [-0.45, -0.65, 0.62];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

export class PaperCrumple {
  /**
   * @param {{front: HTMLCanvasElement, back: HTMLCanvasElement, width: number, height: number}} paper
   * @param {{seed?: string, cols?: number, rows?: number, ballRadius?: number}} options
   */
  constructor(paper, { seed = 'paper', cols = 11, rows = 14, ballRadius = 34 } = {}) {
    this.paper = paper;
    this.cols = cols;
    this.rows = rows;
    this.R = ballRadius;
    this.t = 0;
    this.rotation = 0;
    const W = paper.width;
    const H = paper.height;
    const texScale = paper.front.width / W;
    const rand = mulberry32(hashString(seed));
    const count = (cols + 1) * (rows + 1);

    this.rest = new Float32Array(count * 2);
    this.uv = new Float32Array(count * 2);
    this.target = new Float32Array(count * 3);
    this.jitter = new Float32Array(count * 3);
    this.pos = new Float32Array(count * 3);
    this.proj = new Float32Array(count * 2); // perspective-projected x, y

    // The sphere's front pole sits near the top of the page so the file
    // name stays visible on the finished ball.
    const pole = { x: 0, y: -H * 0.2 };
    const maxR = Math.hypot(W / 2, H / 2 + Math.abs(pole.y));
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        // Small rest-position noise makes the crumple less grid-like.
        const edgeI = i === 0 || i === cols;
        const edgeJ = j === 0 || j === rows;
        const x = (i / cols - 0.5) * W + (edgeI ? 0 : (rand() - 0.5) * (W / cols) * 0.35);
        const y = (j / rows - 0.5) * H + (edgeJ ? 0 : (rand() - 0.5) * (H / rows) * 0.35);
        this.rest[k * 2] = x;
        this.rest[k * 2 + 1] = y;
        this.uv[k * 2] = (x + W / 2) * texScale;
        this.uv[k * 2 + 1] = (y + H / 2) * texScale;

        const dx = x - pole.x;
        const dy = y - pole.y;
        const rn = Math.hypot(dx, dy) / maxR;
        const theta = rn * Math.PI * 0.97;
        const phi = Math.atan2(dy, dx) + rn * 1.4 + (rand() - 0.5) * 0.5;
        const radius = this.R * (0.8 + rand() * 0.32);
        this.target[k * 3] = radius * Math.sin(theta) * Math.cos(phi) + (rand() - 0.5) * this.R * 0.14;
        this.target[k * 3 + 1] = radius * Math.sin(theta) * Math.sin(phi) + (rand() - 0.5) * this.R * 0.14;
        this.target[k * 3 + 2] = radius * Math.cos(theta);

        this.jitter[k * 3] = rand() - 0.5;
        this.jitter[k * 3 + 1] = rand() - 0.5;
        this.jitter[k * 3 + 2] = rand() - 0.5;
      }
    }

    // Two triangles per cell, alternating the diagonal.
    const tris = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        if ((i + j) % 2) tris.push([a, b, c], [b, d, c]);
        else tris.push([a, b, d], [a, d, c]);
      }
    }
    this.tris = tris;
    this.order = tris.map((_, i) => ({ i, z: 0, front: true, light: 1 }));

    this.folds = [
      { cx: 0, cy: 0, nx: 1, ny: 0, max: Math.PI * 0.94, start: 0.0, dur: 0.3 },
      { cx: -W * 0.22, cy: -H * 0.16, nx: -0.5, ny: -0.866, max: Math.PI * 0.86, start: 0.2, dur: 0.24 },
    ];
    this.setProgress(0);
  }

  setProgress(t) {
    this.t = clamp(t, 0, 1);
    const tt = this.t;
    const crumple = easeInOutCubic(progress(tt, 0.36, 0.56));
    const wrinkle = Math.sin(Math.PI * progress(tt, 0.34, 0.62));
    const angles = this.folds.map((f) => easeInOutCubic(progress(tt, f.start, f.dur)) * f.max);
    const count = this.rest.length / 2;
    const { rest, target, jitter, pos } = this;
    let sx = 0;
    let sy = 0;

    for (let k = 0; k < count; k++) {
      let x = rest[k * 2];
      let y = rest[k * 2 + 1];
      let z = 0;
      for (let f = 0; f < this.folds.length; f++) {
        const a = angles[f];
        if (a <= 0) continue;
        const fold = this.folds[f];
        const qx = x - fold.cx;
        const qy = y - fold.cy;
        const sn = qx * fold.nx + qy * fold.ny;
        if (sn <= 0) continue;
        const along = -qx * fold.ny + qy * fold.nx; // component along the crease
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const sn2 = sn * cos - z * sin;
        z = sn * sin + z * cos;
        x = fold.cx + along * -fold.ny + sn2 * fold.nx;
        y = fold.cy + along * fold.nx + sn2 * fold.ny;
      }
      x += jitter[k * 3] * wrinkle * 16;
      y += jitter[k * 3 + 1] * wrinkle * 16;
      z += jitter[k * 3 + 2] * wrinkle * 34;

      x = lerp(x, target[k * 3], crumple);
      y = lerp(y, target[k * 3 + 1], crumple);
      z = lerp(z, target[k * 3 + 2], crumple);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      sx += x;
      sy += y;
    }

    // Keep the paper visually centred while it folds, then project with a
    // little perspective so flaps lifting toward the viewer read as folds.
    sx /= count;
    sy /= count;
    const focal = 620;
    for (let k = 0; k < count; k++) {
      pos[k * 3] -= sx;
      pos[k * 3 + 1] -= sy;
      const p = focal / (focal - Math.min(pos[k * 3 + 2], focal * 0.6));
      this.proj[k * 2] = pos[k * 3] * p;
      this.proj[k * 2 + 1] = pos[k * 3 + 1] * p;
    }

    for (const entry of this.order) {
      const [a, b, c] = this.tris[entry.i];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
      const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      entry.front = nz >= 0;
      if (!entry.front) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const d = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      entry.light = clamp(1 + (d - LIGHT[2]) * 0.95, 0.5, 1.28);
      entry.z = (az + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    }
    this.order.sort((p, q) => p.z - q.z);

    this.rotation = -1.9 * easeInOutCubic(tt) + 0.09 * Math.sin(tt * 15) * Math.sin(Math.PI * tt);
  }

  /** Draw at (x, y) with an extra rotation/scale. Uses the current transform. */
  draw(ctx, { x, y, rotation = 0, scale = 1, alpha = 1, shadow = true }) {
    const { proj: pos, uv, paper } = this;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(rotation + this.rotation);
    ctx.scale(scale, scale);

    if (shadow) this._drawShadow(ctx);

    // Expand each triangle slightly in screen space to hide seams.
    const grow = 0.75 / Math.max(0.2, scale);
    for (const entry of this.order) {
      const [a, b, c] = this.tris[entry.i];
      let x0 = pos[a * 2], y0 = pos[a * 2 + 1];
      let x1 = pos[b * 2], y1 = pos[b * 2 + 1];
      let x2 = pos[c * 2], y2 = pos[c * 2 + 1];
      const mx = (x0 + x1 + x2) / 3;
      const my = (y0 + y1 + y2) / 3;
      const g0 = grow / (Math.hypot(x0 - mx, y0 - my) || 1);
      const g1 = grow / (Math.hypot(x1 - mx, y1 - my) || 1);
      const g2 = grow / (Math.hypot(x2 - mx, y2 - my) || 1);
      x0 += (x0 - mx) * g0; y0 += (y0 - my) * g0;
      x1 += (x1 - mx) * g1; y1 += (y1 - my) * g1;
      x2 += (x2 - mx) * g2; y2 += (y2 - my) * g2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.clip();
      texturedTriangle(
        ctx,
        entry.front ? paper.front : paper.back,
        pos[a * 2], pos[a * 2 + 1], pos[b * 2], pos[b * 2 + 1], pos[c * 2], pos[c * 2 + 1],
        uv[a * 2], uv[a * 2 + 1], uv[b * 2], uv[b * 2 + 1], uv[c * 2], uv[c * 2 + 1],
      );
      const light = entry.light;
      if (light < 0.995) {
        ctx.fillStyle = `rgba(40,32,20,${((1 - light) * 0.62).toFixed(3)})`;
        ctx.fill();
      } else if (light > 1.005) {
        ctx.fillStyle = `rgba(255,255,255,${((light - 1) * 0.9).toFixed(3)})`;
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  _drawShadow(ctx) {
    // Soft drop shadow shaped like the sheet, tightening as it balls up.
    const k = easeInOutCubic(progress(this.t, 0.25, 0.6));
    const w = lerp(this.paper.width * 0.6, this.R * 1.15, k);
    const h = lerp(this.paper.height * 0.6, this.R * 1.15, k);
    ctx.save();
    ctx.translate(8, 16);
    ctx.scale(w, h);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(40,30,15,0.2)');
    g.addColorStop(0.75, 'rgba(40,30,15,0.12)');
    g.addColorStop(1, 'rgba(40,30,15,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Snapshot the fully crumpled ball as a sprite.
   * The sprite's ball radius (this.R) is drawn at `pixelRadius` pixels.
   */
  renderSprite(pixelRadius) {
    const saved = this.t;
    this.setProgress(1);
    const scale = pixelRadius / this.R;
    const size = Math.ceil(pixelRadius * 2 * 1.45);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    this.draw(ctx, { x: size / 2, y: size / 2, rotation: -this.rotation, scale, shadow: false });

    // Spherical shading on top of the facets, only where paper was drawn.
    ctx.globalCompositeOperation = 'source-atop';
    const c = size / 2;
    const g = ctx.createRadialGradient(c - pixelRadius * 0.4, c - pixelRadius * 0.45, pixelRadius * 0.1, c, c, pixelRadius * 1.25);
    g.addColorStop(0, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(50,38,20,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';

    this.setProgress(saved);
    return { canvas, pixelRadius };
  }
}

/** Map texture triangle (u,v) onto screen triangle (x,y) and draw the image. */
function texturedTriangle(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
  const det = u0 * v1 + v0 * u2 + u1 * v2 - v1 * u2 - v0 * u1 - u0 * v2;
  if (Math.abs(det) < 1e-6) return;
  const a = (x0 * v1 + v0 * x2 + x1 * v2 - v1 * x2 - v0 * x1 - x0 * v2) / det;
  const b = (y0 * v1 + v0 * y2 + y1 * v2 - v1 * y2 - v0 * y1 - y0 * v2) / det;
  const c = (u0 * x1 + x0 * u2 + u1 * x2 - x1 * u2 - x0 * u1 - u0 * x2) / det;
  const d = (u0 * y1 + y0 * u2 + u1 * y2 - y1 * u2 - y0 * u1 - u0 * y2) / det;
  const e = (u0 * v1 * x2 + v0 * x1 * u2 + x0 * u1 * v2 - x0 * v1 * u2 - v0 * u1 * x2 - u0 * x1 * v2) / det;
  const f = (u0 * v1 * y2 + v0 * y1 * u2 + y0 * u1 * v2 - y0 * v1 * u2 - v0 * u1 * y2 - u0 * y1 * v2) / det;
  ctx.save();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
