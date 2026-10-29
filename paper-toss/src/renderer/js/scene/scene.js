// Owns the canvas and camera. Computes the layout and draws one frame
// from a plain "view" description provided by the app, with the ball,
// can and lid layered by depth. No game logic here.

import { Camera } from './camera.js';
import { renderRoom } from './room.js';
import { TrashCan } from './trashCan.js';
import { Effects } from './effects.js';
import { clamp } from '../anim/easing.js';

export const BALL_RADIUS = 0.055; // metres
export const HAND = { x: 0, y: 1.285, z: 0 }; // where the ball sits before a throw

export class Scene {
  constructor(canvas, room) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new Camera();
    this.can = new TrashCan();
    this.effects = new Effects();
    this.roomDims = room;
    this.layout = null;
    this.room = null;
    this.dpr = 1;
  }

  resize() {
    // A minimised or hidden window can report 0×0; keep a sane minimum so
    // the backdrop canvas is never zero-sized.
    const W = Math.max(320, window.innerWidth || 0);
    const H = Math.max(240, window.innerHeight || 0);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.camera.configure(W, H);

    const k = H / 800;
    const hand = this.camera.project(HAND.x, HAND.y, HAND.z);
    this.layout = {
      width: W,
      height: H,
      k, // UI scale relative to an 800px-tall window
      hand, // screen position of the ball in hand
      handRadius: BALL_RADIUS * hand.s,
      maxPull: 175 * k,
    };
    this.room = renderRoom(this.camera, this.roomDims, this.can, this.dpr);
    return this.layout;
  }

  project(p) {
    return this.camera.project(p.x, p.y, p.z);
  }

  render(view) {
    const { ctx, layout, can, camera } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);
    ctx.drawImage(this.room, 0, 0, layout.width, layout.height);

    const ball = view.ballVisible ? view.ball : null;
    const lidBehind = can.lid > 0.45;
    let zone = null;
    let ballLast = false;
    if (ball) {
      zone = can.axisDistance(ball) < can.R ? 'inside' : ball.z > can.cz ? 'behind' : 'front';
      ballLast = zone === 'front' || (zone === 'inside' && !lidBehind && ball.y > can.H + ball.r * 0.5);
    }

    can.drawShadow(ctx, camera);
    if (ball && zone !== 'inside') this._drawBallShadow(ball);

    if (ball && zone === 'behind') this._drawBall(ball, view.sprite);
    if (lidBehind) can.drawLid(ctx, camera);
    can.drawInterior(ctx, camera);
    if (ball && zone === 'inside' && !ballLast) this._drawBall(ball, view.sprite);
    can.drawBody(ctx, camera);
    if (!lidBehind) can.drawLid(ctx, camera);

    this.effects.draw(ctx);
    if (view.aim) this._drawAim(view.aim);
    if (ball && ballLast) this._drawBall(ball, view.sprite);
    if (ball && view.pickupHint) this._drawPickupHint(ball, view.time);
    if (ball) {
      const p = this.project(ball);
      if (p.y + ball.r * p.s < 0) this._drawOffscreen(p);
    }

    if (view.crumple) {
      const c = view.crumple;
      c.mesh.draw(ctx, c);
      if (c.spriteFade > 0 && view.sprite) {
        this._drawSprite(view.sprite, c.x, c.y, c.rotation + c.mesh.rotation, layout.handRadius, c.spriteFade);
      }
    }
  }

  _drawBallShadow(ball) {
    const { ctx, camera } = this;
    const height = Math.max(0, ball.y - ball.r);
    const k = clamp(1 - height / 2.2, 0, 1);
    if (k <= 0) return;
    const rr = ball.r * (1.2 + height * 0.6);
    const c = camera.project(ball.x + 0.02, 0.001, ball.z + 0.02);
    const front = camera.project(ball.x, 0.001, ball.z - rr);
    const back = camera.project(ball.x, 0.001, ball.z + rr);
    const rx = rr * c.s;
    const ry = Math.max(1, (front.y - back.y) / 2);
    ctx.save();
    ctx.globalAlpha = 0.5 * k;
    ctx.translate(c.x, (front.y + back.y) / 2);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(58,42,24,1)');
    g.addColorStop(1, 'rgba(58,42,24,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawBall(ball, sprite) {
    if (!sprite) return;
    const { ctx } = this;
    const p = this.project(ball);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (ball.squash > 0.005) ctx.scale(1 + ball.squash * 0.6, 1 - ball.squash);
    this._drawSprite(sprite, 0, 0, ball.angle, ball.r * p.s, 1);
    ctx.restore();
  }

  _drawSprite(sprite, x, y, rotation, radius, alpha) {
    const { ctx } = this;
    const k = radius / sprite.pixelRadius;
    const size = sprite.canvas.width;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(k, k);
    ctx.drawImage(sprite.canvas, -size / 2, -size / 2);
    ctx.restore();
  }

  _drawAim(aim) {
    const { ctx, layout } = this;
    const { k, hand, maxPull } = layout;

    ctx.save();
    // Reach ring around the hand.
    ctx.strokeStyle = 'rgba(60,50,40,0.2)';
    ctx.setLineDash([4 * k, 8 * k]);
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, maxPull, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (aim.power > 0.02 && aim.pullAngle !== null) {
      const hue = 130 - aim.power * 120;
      ctx.strokeStyle = `hsla(${hue}, 70%, 45%, 0.9)`;
      ctx.lineWidth = 6 * k;
      ctx.lineCap = 'round';
      const span = 0.2 + aim.power * 0.8;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, maxPull, aim.pullAngle - span, aim.pullAngle + span);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(60,50,40,0.28)';
      ctx.lineWidth = 2 * k;
      ctx.setLineDash([2 * k, 6 * k]);
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(aim.ballScreen.x, aim.ballScreen.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Trajectory preview: only the start of the arc, fading out.
    if (aim.points && aim.points.length) {
      const n = aim.points.length;
      for (let i = 3; i < n; i += 3) {
        const p = this.project(aim.points[i]);
        const fade = 1 - i / n;
        const r = Math.max(1.5, 0.018 * p.s) * (0.6 + 0.4 * fade);
        ctx.fillStyle = `rgba(255,255,255,${0.95 * fade})`;
        ctx.strokeStyle = `rgba(60,50,40,${0.4 * fade})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawPickupHint(ball, time) {
    const { ctx } = this;
    const p = this.project(ball);
    const rad = Math.max(8, ball.r * p.s);
    const bob = Math.sin(time * 6) * 4;
    const y = p.y - rad - 18 + bob;
    ctx.save();
    ctx.fillStyle = 'rgba(32,36,43,0.85)';
    ctx.beginPath();
    ctx.moveTo(p.x - 8, y - 8);
    ctx.lineTo(p.x + 8, y - 8);
    ctx.lineTo(p.x, y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.55 + 0.3 * Math.sin(time * 6)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad + 6 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawOffscreen(p) {
    const { ctx, layout } = this;
    const x = clamp(p.x, 20, layout.width - 20);
    ctx.save();
    ctx.fillStyle = 'rgba(32,36,43,0.75)';
    ctx.beginPath();
    ctx.moveTo(x, 72);
    ctx.lineTo(x - 9, 86);
    ctx.lineTo(x + 9, 86);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
