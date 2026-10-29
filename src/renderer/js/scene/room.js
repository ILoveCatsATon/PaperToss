// Static backdrop seen from the player's spot: back wall, side walls,
// a wooden floor running away from you, a window, a poster, a plant and
// a round rug under the can. Rendered once per resize.

import { mulberry32 } from '../anim/easing.js';

function poly(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function renderRoom(cam, room, dpr) {
  const W = cam.width;
  const H = cam.height;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const rand = mulberry32(7);
  const P = (x, y, z) => cam.project(x, y, z);
  const { xMin, xMax, zMax } = room;
  const zNear = 0.05;
  const top = 3.2;

  // ---- Walls ----
  ctx.fillStyle = '#e7e0d3';
  ctx.fillRect(0, 0, W, H);
  const backWall = [P(xMin, 0, zMax), P(xMax, 0, zMax), P(xMax, top, zMax), P(xMin, top, zMax)];
  const bw = ctx.createLinearGradient(0, backWall[2].y, 0, backWall[0].y);
  bw.addColorStop(0, '#f3eee5');
  bw.addColorStop(1, '#e8e1d4');
  ctx.fillStyle = bw;
  poly(ctx, backWall);
  ctx.fill();
  const leftWall = [P(xMin, 0, zNear), P(xMin, 0, zMax), P(xMin, top, zMax), P(xMin, top, zNear)];
  const rightWall = [P(xMax, 0, zNear), P(xMax, 0, zMax), P(xMax, top, zMax), P(xMax, top, zNear)];
  for (const [wall, shade] of [[leftWall, '#ddd5c6'], [rightWall, '#e2dacc']]) {
    const g = ctx.createLinearGradient(wall[0].x, 0, wall[1].x, 0);
    g.addColorStop(0, shade);
    g.addColorStop(1, '#ebe4d8');
    ctx.fillStyle = g;
    poly(ctx, wall);
    ctx.fill();
  }

  // Window on the left wall, with light on the floor.
  const win = [P(xMin, 1.0, 1.6), P(xMin, 1.0, 3.6), P(xMin, 2.3, 3.6), P(xMin, 2.3, 1.6)];
  ctx.fillStyle = '#f7f4ee';
  poly(ctx, [P(xMin, 0.92, 1.5), P(xMin, 0.92, 3.7), P(xMin, 2.38, 3.7), P(xMin, 2.38, 1.5)]);
  ctx.fill();
  const sky = ctx.createLinearGradient(0, win[3].y, 0, win[0].y);
  sky.addColorStop(0, '#9fc8ea');
  sky.addColorStop(1, '#d9ecf7');
  ctx.fillStyle = sky;
  poly(ctx, win);
  ctx.fill();
  ctx.strokeStyle = '#f7f4ee';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const m1 = P(xMin, 1.0, 2.6);
  const m2 = P(xMin, 2.3, 2.6);
  ctx.moveTo(m1.x, m1.y);
  ctx.lineTo(m2.x, m2.y);
  ctx.stroke();

  // Poster on the back wall.
  const poster = [P(-1.5, 1.25, zMax), P(-0.55, 1.25, zMax), P(-0.55, 1.95, zMax), P(-1.5, 1.95, zMax)];
  ctx.fillStyle = 'rgba(60,45,30,0.12)';
  ctx.save();
  ctx.translate(4, 5);
  poly(ctx, poster);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#3b3631';
  poly(ctx, poster);
  ctx.fill();
  const inner = [P(-1.44, 1.31, zMax), P(-0.61, 1.31, zMax), P(-0.61, 1.89, zMax), P(-1.44, 1.89, zMax)];
  ctx.fillStyle = '#faf7f0';
  poly(ctx, inner);
  ctx.fill();
  const sun = P(-0.82, 1.73, zMax);
  ctx.fillStyle = '#f2c46d';
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, 0.07 * sun.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b8f7b';
  poly(ctx, [P(-1.38, 1.36, zMax), P(-1.12, 1.68, zMax), P(-0.96, 1.5, zMax), P(-0.86, 1.58, zMax), P(-0.67, 1.36, zMax)]);
  ctx.fill();

  // ---- Floor ----
  const floor = [P(xMin, 0, zNear), P(xMax, 0, zNear), P(xMax, 0, zMax), P(xMin, 0, zMax)];
  ctx.save();
  poly(ctx, floor);
  ctx.clip();
  const fg = ctx.createLinearGradient(0, floor[2].y, 0, H);
  fg.addColorStop(0, '#b8946b');
  fg.addColorStop(1, '#c9a77f');
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, W, H);
  // Planks run away from the player; joints at random depths.
  const plank = 0.17;
  for (let x = xMin; x < xMax; x += plank) {
    let z = zNear - rand() * 1.5;
    while (z < zMax) {
      const len = 0.9 + rand() * 1.6;
      const z2 = Math.min(zMax, z + len);
      const tone = rand();
      ctx.fillStyle = tone < 0.5 ? `rgba(255,238,210,${0.05 + tone * 0.1})` : `rgba(90,55,25,${0.03 + (tone - 0.5) * 0.12})`;
      poly(ctx, [P(x, 0, Math.max(zNear, z)), P(x + plank, 0, Math.max(zNear, z)), P(x + plank, 0, z2), P(x, 0, z2)]);
      ctx.fill();
      if (z2 < zMax && z2 > zNear) {
        const a = P(x, 0, z2);
        const b = P(x + plank, 0, z2);
        ctx.strokeStyle = 'rgba(80,50,20,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      z = z2;
    }
    const a = P(x, 0, zNear);
    const b = P(x, 0, zMax);
    ctx.strokeStyle = 'rgba(80,50,20,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // Window light on the floor.
  ctx.fillStyle = 'rgba(255,248,225,0.1)';
  poly(ctx, [P(xMin, 0, 1.6), P(xMin + 1.6, 0, 1.2), P(xMin + 1.6, 0, 3.2), P(xMin, 0, 3.6)]);
  ctx.fill();
  ctx.restore();

  // Baseboards.
  ctx.fillStyle = '#f8f5ef';
  poly(ctx, [P(xMin, 0, zMax), P(xMax, 0, zMax), P(xMax, 0.1, zMax), P(xMin, 0.1, zMax)]);
  ctx.fill();
  poly(ctx, [P(xMin, 0, zNear), P(xMin, 0, zMax), P(xMin, 0.1, zMax), P(xMin, 0.1, zNear)]);
  ctx.fill();
  poly(ctx, [P(xMax, 0, zNear), P(xMax, 0, zMax), P(xMax, 0.1, zMax), P(xMax, 0.1, zNear)]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,40,20,0.25)';
  ctx.lineWidth = 1;
  for (const [a, b] of [[P(xMin, 0, zMax), P(xMax, 0, zMax)], [P(xMin, 0, zNear), P(xMin, 0, zMax)], [P(xMax, 0, zNear), P(xMax, 0, zMax)]]) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // ---- Big round rug in the middle of the room (the bin wanders around it) ----
  const rug = { x: 0, z: 4.1 };
  const ring = (radius) => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      pts.push(P(rug.x + Math.cos(t) * radius * 1.25, 0.002, rug.z + Math.sin(t) * radius));
    }
    return pts;
  };
  ctx.fillStyle = 'rgba(60,40,20,0.12)';
  poly(ctx, ring(1.3));
  ctx.fill();
  ctx.fillStyle = '#d9cbb3';
  poly(ctx, ring(1.25));
  ctx.fill();
  ctx.fillStyle = '#c9b391';
  poly(ctx, ring(1.0));
  ctx.fill();
  ctx.fillStyle = '#e4d8c3';
  poly(ctx, ring(0.85));
  ctx.fill();

  // ---- Throw line taped on the floor near the player ----
  ctx.fillStyle = 'rgba(226,85,61,0.75)';
  poly(ctx, [P(-0.5, 0.002, 1.4), P(0.5, 0.002, 1.4), P(0.5, 0.002, 1.47), P(-0.5, 0.002, 1.47)]);
  ctx.fill();

  // ---- Plant in the back-right corner ----
  const base = P(xMax - 0.45, 0, zMax - 0.45);
  const k = base.s;
  ctx.fillStyle = 'rgba(50,30,10,0.2)';
  ctx.beginPath();
  ctx.ellipse(base.x + 0.04 * k, base.y, 0.3 * k, 0.06 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  const potTop = base.y - 0.38 * k;
  for (const [angle, len] of [[-0.9, 0.75], [-0.5, 0.95], [-0.15, 1.05], [0.2, 1.0], [0.55, 0.88], [0.95, 0.7], [-0.3, 0.7], [0.4, 0.66]]) {
    ctx.save();
    ctx.translate(base.x, potTop + 0.02 * k);
    ctx.rotate(angle);
    const lg = ctx.createLinearGradient(0, 0, 0, -len * k);
    lg.addColorStop(0, '#3f7a52');
    lg.addColorStop(1, '#6bb07a');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(0.1 * k, -len * k * 0.55, 0, -len * k);
    ctx.quadraticCurveTo(-0.1 * k, -len * k * 0.55, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#d9d2c5';
  ctx.beginPath();
  ctx.moveTo(base.x - 0.22 * k, potTop);
  ctx.lineTo(base.x + 0.22 * k, potTop);
  ctx.lineTo(base.x + 0.17 * k, base.y);
  ctx.lineTo(base.x - 0.17 * k, base.y);
  ctx.closePath();
  ctx.fill();

  // Soft vignette.
  const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  v.addColorStop(0, 'rgba(40,25,10,0)');
  v.addColorStop(1, 'rgba(40,25,10,0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  return canvas;
}
