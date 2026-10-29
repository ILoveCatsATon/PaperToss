// Lightweight particle effects: dust puffs, impact rings, paper confetti.

export class Effects {
  constructor() {
    this.items = [];
  }

  clear() {
    this.items.length = 0;
  }

  dust(x, y, s, count = 8, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.PI + Math.random() * Math.PI;
      const speed = (40 + Math.random() * 120) * s * power;
      this.items.push({
        type: 'dust', x, y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.45,
        size: (6 + Math.random() * 10) * s, grow: 26 * s,
        life: 0, max: 0.5 + Math.random() * 0.4,
      });
    }
  }

  ring(x, y, s, color = 'rgba(255,255,255,0.8)') {
    this.items.push({ type: 'ring', x, y, size: 8 * s, grow: 160 * s, life: 0, max: 0.4, color });
  }

  paperBits(x, y, s, count = 18) {
    const colors = ['#ffffff', '#f6f1e4', '#ffd56b', '#9fd3b4', '#f2a38f'];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const speed = (260 + Math.random() * 420) * s;
      this.items.push({
        type: 'bit', x, y,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18,
        w: (5 + Math.random() * 6) * s, h: (3 + Math.random() * 4) * s,
        color: colors[i % colors.length], gravity: 900 * s,
        life: 0, max: 1.1 + Math.random() * 0.6,
      });
    }
  }

  /** Big floating text that pops up, rises and fades (e.g. "+1", "🔥 x3"). */
  popText(x, y, text, { color = '#ffffff', stroke = '#20242b', size = 44, delay = 0, max = 1.4 } = {}) {
    this.items.push({ type: 'text', x, y, text, color, stroke, size, life: -delay, max, vy: -70 });
  }

  update(dt) {
    for (const p of this.items) {
      p.life += dt;
      if (p.type === 'text') {
        if (p.life > 0) p.y += p.vy * dt;
        continue;
      }
      if (p.type === 'dust') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-4 * dt);
        p.vy *= Math.exp(-4 * dt);
        p.size += p.grow * dt;
      } else if (p.type === 'ring') {
        p.size += p.grow * dt;
      } else if (p.type === 'bit') {
        p.vy += p.gravity * dt;
        p.vx *= Math.exp(-1.2 * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }
    this.items = this.items.filter((p) => p.life < p.max);
  }

  draw(ctx) {
    for (const p of this.items) {
      if (p.type === 'text') {
        if (p.life > 0) this._drawText(ctx, p);
        continue;
      }
      const k = 1 - p.life / p.max;
      if (p.type === 'dust') {
        ctx.fillStyle = `rgba(235,226,210,${0.55 * k})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = 3 * k + 0.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.type === 'bit') {
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.rot * 1.7));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
  }

  _drawText(ctx, p) {
    const t = p.life / p.max;
    // Pop in with a little overshoot, hold, then fade while rising.
    const popIn = Math.min(1, p.life / 0.22);
    const scale = popIn < 1 ? 0.4 + 0.75 * Math.sin((popIn * Math.PI) / 2) * (1 + 0.25 * (1 - popIn)) : 1 + 0.04 * Math.sin(p.life * 10) * (1 - t);
    const alpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.scale(scale, scale);
    ctx.rotate(-0.06);
    ctx.font = `900 ${p.size}px "Segoe UI Variable Display", "Segoe UI", "Segoe UI Emoji", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, p.size * 0.16);
    ctx.strokeStyle = p.stroke;
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
}
