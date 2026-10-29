// The game director: a small state machine that ties together the UI,
// the crumple animation, the 3D physics, pointer input and the file
// service. Several items can be picked; each gets its own paper ball and
// four throws, one after another, then a summary.
//
// Per item:  crumpling → ready ⇄ holding → flying
//            flying → scoring → trashing → (next item)   (in the bin)
//            flying → missed → returning → ready          (throws left)
//            flying → ending → (next item)                (last throw missed)
//
// The ONLY place a file operation happens is `_performTrash`, which is
// reached solely from the "scoring" state after the ball is in the can.

import { Ball, World } from '../physics/world.js';
import { Scene, BALL_RADIUS, HAND } from '../scene/scene.js';
import { PaperCrumple } from '../anim/crumple.js';
import { createPaperTextures } from '../anim/paperTexture.js';
import { Tweens, clamp, lerp, easeInOutCubic, easeOutBack, easeOutCubic } from '../anim/easing.js';
import { ThrowController } from '../input/throwController.js';
import { SKINS, DEFAULT_SKIN, resolveSkin } from '../scene/skins.js';
import { pickCheer, perfectRoundTitle } from './cheers.js';

const SKIN_KEY = 'paperToss.skin';
const BEST_STREAK_KEY = 'paperToss.bestStreak';
const BIN_FULL_ITEMS = 60; // Recycle Bin item count at which the bin looks full

const MAX_THROWS = 4;
const ELEVATION = (40 * Math.PI) / 180; // launch angle above horizontal
const V_MIN = 3.5; // m/s for the smallest real pull
const V_MAX = 8; // m/s at full pull
const YAW_GAIN = 0.5; // how strongly sideways pull steers
const MAX_YAW = 0.6; // rad left/right
// Where the bin may wander (metres). Every spot is reachable with a full pull.
// It keeps out of the dead-centre strip so throws are angled and the aiming
// dots show a visible arc (a throw straight ahead looks like a vertical line).
const CAN_AREA = { xMin: -1.3, xMax: 1.3, zMin: 3.0, zMax: 4.8, centreGap: 0.35 };
const CANCELLABLE = new Set(['crumpling', 'ready', 'holding', 'returning', 'flying', 'missed']);

export class App {
  constructor({ canvas, ui, files, sound }) {
    this.ui = ui;
    this.files = files;
    this.sound = sound;
    this.world = new World();
    this.scene = new Scene(canvas, this.world.room);
    this.world.colliders = [this.scene.can];
    this.tweens = new Tweens();

    this.state = 'idle';
    this.session = 0; // bumped on every item/reset to drop stale async work
    this.picked = null; // items from the last pick, awaiting confirmation
    this.queue = []; // [{ token, info, outcome, message }]
    this.index = -1;
    this.throwsUsed = 0;
    this.ball = null;
    this.sprite = null;
    this.mesh = null;
    this.crumpleView = null;
    this.aim = null;
    this.physicsOn = false;
    this.flight = null;
    this.time = 0;
    this.grabOffset = { x: 0, y: 0 };
    this.binStats = null;
    this.sessionTrashed = 0;
    this.sessionBytes = 0;
    this.streak = 0; // throws in a row that went in
    this.lastCheer = null;
    this.bestStreak = 0;
    try {
      this.bestStreak = Number(localStorage.getItem(BEST_STREAK_KEY)) || 0;
    } catch {
      /* storage unavailable */
    }

    this.input = new ThrowController(canvas, {
      hitTest: (x, y) => this._hitBall(x, y),
      onGrab: (x, y) => this._grab(x, y),
      onMove: (x, y) => this._drag(x, y),
      onRelease: (flick) => this._release(flick),
      onCancelHold: () => this._returnToHand(),
      onPickup: () => this._pickup(),
    });

    this.scene.can.onLidSlam = (strength) => this._lidSlammed(strength);
  }

  start() {
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.keep();
    });
    this._wireDragAndDrop();
    this._wireUi();
    this.ui.setEnvironment({ demo: this.files.demo, trashName: this.files.trashName });
    this.ui.setMuted(this.sound.muted);
    let skinId = DEFAULT_SKIN;
    try {
      skinId = localStorage.getItem(SKIN_KEY) || DEFAULT_SKIN;
    } catch {
      /* storage unavailable: default skin */
    }
    this.scene.can.setSkin(skinId);
    this.ui.setSkins(SKINS.map(resolveSkin), this.scene.can.skin.id);
    this.ui.showDock(true);

    // Fill the bin to match the real Recycle Bin, and keep it in sync when
    // you come back to the window (e.g. after emptying it in Explorer).
    this.refreshBin();
    let lastFocusRefresh = 0;
    window.addEventListener('focus', () => {
      if (performance.now() - lastFocusRefresh < 2000) return;
      lastFocusRefresh = performance.now();
      this.refreshBin();
    });

    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        this._update(dt);
        this._render();
      } catch (err) {
        // Never let one bad frame stop the loop (and strand the toss).
        console.error(err);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  get layout() {
    return this.scene.layout;
  }

  get trashName() {
    return this.files.trashName;
  }

  get current() {
    return this.queue[this.index] || null;
  }

  // ------------------------------------------------------------------
  // UI wiring
  // ------------------------------------------------------------------

  _wireUi() {
    const { ui } = this;
    ui.on('pick', (kind) => this.pick(kind));
    ui.on('confirm', () => this.confirm());
    ui.on('cancel', () => this.cancelSelection());
    ui.on('keep', () => this.keep());
    ui.on('stop', () => this.stopAll());
    ui.on('skin', (id) => this.changeSkin(id));
    ui.on('toggleSound', () => {
      this.sound.unlock();
      this.sound.setMuted(!this.sound.muted);
      ui.setMuted(this.sound.muted);
    });
    // Audio can only start after a user gesture.
    window.addEventListener('pointerdown', () => this.sound.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.sound.unlock(), { capture: true });
  }

  /** Swap the bin's look, with a little bounce and sparkle. */
  changeSkin(id) {
    const can = this.scene.can;
    can.setSkin(id);
    try {
      localStorage.setItem(SKIN_KEY, can.skin.id);
    } catch {
      /* storage unavailable: choice lasts this session only */
    }
    can.thump(1.3);
    can.hit(0.5);
    const p = can.rimCenter(this.scene.camera);
    this.scene.effects.paperBits(p.x, p.y, p.s / 160, 10);
    this.sound.pickup();
  }

  _wireDragAndDrop() {
    let depth = 0;
    const accepts = (e) => (this.state === 'idle' || this.state === 'confirm') && e.dataTransfer?.types?.includes('Files');
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      depth += 1;
      if (accepts(e)) this.ui.setDropActive(true);
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.ui.setDropActive(false);
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = accepts(e) ? 'copy' : 'none';
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0;
      this.ui.setDropActive(false);
      if (!accepts(e)) return;
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      await this._releasePicked();
      this.state = 'picking';
      let result;
      try {
        result = await this.files.selectDropped(files);
      } catch (err) {
        result = { ok: false, code: 'unknown', message: 'Could not read what you dropped.', detail: String(err?.message || err) };
      }
      this._handleSelection(result);
    });
  }

  // ------------------------------------------------------------------
  // Selection & confirmation (no file changes here)
  // ------------------------------------------------------------------

  async pick(kind) {
    if (this.state !== 'idle') return;
    this.state = 'picking';
    let result;
    try {
      result = await this.files.pick(kind);
    } catch (err) {
      result = { ok: false, code: 'unknown', message: 'Could not open the picker.', detail: String(err?.message || err) };
    }
    this._handleSelection(result);
  }

  _handleSelection(result) {
    if (this.state !== 'picking') return;
    if (!result || !result.ok) {
      this.state = 'idle';
      this.ui.showDock(true);
      if (result?.code !== 'cancelled') {
        this.sound.error();
        this.ui.toast('Can’t pick that up', { tone: 'miss', sub: result?.message || 'Something went wrong.' });
      }
      return;
    }
    this.picked = result.items;
    this.state = 'confirm';
    this.ui.showDock(false);
    this.ui.showConfirm(result.items);
  }

  async cancelSelection() {
    if (this.state !== 'confirm') return;
    this.state = 'idle';
    await this._releasePicked();
    await this.ui.hideSheet();
    if (this.state === 'idle') this.ui.showDock(true);
  }

  async _releasePicked() {
    const items = this.picked || [];
    this.picked = null;
    await Promise.all(items.filter((i) => i.ok).map((i) => this._release_(i.token)));
  }

  async _release_(token) {
    try {
      await this.files.release(token);
    } catch {
      /* nothing to undo: releasing only forgets the token */
    }
  }

  async confirm() {
    if (this.state !== 'confirm' || !this.picked) return;
    this.queue = this.picked.filter((i) => i.ok).map((i) => ({ token: i.token, info: i.info, outcome: null, message: '' }));
    this.picked = null;
    if (!this.queue.length) return;
    this.state = 'crumpling';
    this.index = -1;
    await this.ui.hideSheet();
    this._nextItem();
  }

  // ------------------------------------------------------------------
  // Queue
  // ------------------------------------------------------------------

  _nextItem() {
    this.session += 1;
    this.tweens.clear();
    this.index += 1;
    this.aim = null;
    this.flight = null;
    this.physicsOn = false;
    this.input.setMode('off');
    const can = this.scene.can;
    can.sealed = false;
    can.lidTarget = 0;
    can.glowTarget = 0;
    if (this.index >= this.queue.length) {
      this._showSummary();
      return;
    }
    this.throwsUsed = 0;
    this.state = 'crumpling';
    if (this.thrownSinceMove) this._relocateCan(null);
    this._prepareBall();
    this._updateHud();
    this._crumple(this.session);
  }

  _finishItem(outcome, message = '', delay = 0.9) {
    const item = this.current;
    if (item) {
      item.outcome = outcome;
      item.message = message;
    }
    this.state = 'between';
    this._updateHud();
    const session = this.session;
    this.tweens.add({
      duration: delay,
      update: () => {},
      done: () => {
        if (session === this.session) this._nextItem();
      },
    });
  }

  _showSummary() {
    this.state = 'summary';
    this.ball = null;
    this.crumpleView = null;
    this.ui.setHud(null);
    this.ui.hint(null);
    this.ui.status(null);

    const n = this.queue.length;
    const count = (o) => this.queue.filter((i) => i.outcome === o).length;
    const trashed = count('trashed');
    const failed = count('failed');
    const survivors = this.queue.filter((i) => i.outcome === 'survived' || i.outcome === 'kept');
    let title;
    let tone;
    if (trashed === n) {
      title = perfectRoundTitle(n, this.queue.every((i) => i.throws === 1));
      tone = 'success';
    } else if (trashed === 0 && failed === 0) {
      title = n === 1 ? (count('survived') ? 'The file survived' : 'Kept it') : 'Nothing was thrown away';
      tone = 'info';
    } else if (trashed === 0) {
      title = n === 1 ? 'Couldn’t move it' : 'Nothing could be moved';
      tone = 'error';
    } else {
      title = `${trashed} of ${n} in the bin`;
      tone = 'success';
    }
    let lede = '';
    if (trashed) lede = `Changed your mind? You can restore ${trashed === 1 ? 'it' : 'them'} from the ${this.trashName}.`;
    else if (!failed) lede = n === 1 ? 'Nothing was changed. It is safe and sound.' : 'Nothing was changed.';
    else lede = 'Nothing was deleted.';

    const actions = [];
    if (survivors.length) {
      actions.push({ label: survivors.length === 1 ? 'Give it another go' : `Try those ${survivors.length} again`, onClick: () => this._retrySurvivors() });
    }
    actions.push({ label: 'Done', primary: true, onClick: () => this._finishRound() });

    this.ui.showSummary({
      tone,
      title,
      lede,
      rows: this.queue.map((i) => ({
        name: i.info.name,
        outcome: i.outcome || 'kept',
        message: i.outcome === 'trashed'
          ? `In the ${this.trashName} · ${i.throws === 1 ? 'first try!' : `on throw ${i.throws}`}`
          : i.message,
      })),
      note: this.files.demo ? 'Demo mode: nothing was really deleted.' : '',
      actions,
    });
  }

  async _retrySurvivors() {
    if (this.state !== 'summary') return;
    this.queue = this.queue
      .filter((i) => i.outcome === 'survived' || i.outcome === 'kept')
      .map((i) => ({ token: i.token, info: i.info, outcome: null, message: '' }));
    this.index = -1;
    this.state = 'crumpling';
    await this.ui.hideSheet();
    this._nextItem();
  }

  async _finishRound() {
    if (this.state !== 'summary') return;
    const leftovers = this.queue.filter((i) => i.outcome !== 'trashed' && i.outcome !== 'failed');
    this.queue = [];
    this.index = -1;
    this.state = 'idle';
    this.mesh = null;
    this.sprite = null;
    await Promise.all(leftovers.map((i) => this._release_(i.token)));
    await this.ui.hideSheet();
    if (this.state === 'idle') this.ui.showDock(true);
  }

  // ------------------------------------------------------------------
  // Crumple → ball in hand
  // ------------------------------------------------------------------

  _prepareBall() {
    const info = this.current.info;
    const paper = createPaperTextures(info);
    this.mesh = new PaperCrumple(paper, { seed: info.path || info.name });
    this.sprite = this.mesh.renderSprite(this.layout.handRadius * this.scene.dpr * 1.3);
    this.ball = new Ball(BALL_RADIUS);
    this.ball.place(HAND.x, HAND.y, HAND.z);
  }

  _crumple(session) {
    const { hand, handRadius, k } = this.layout;
    const mesh = this.mesh;
    const start = { x: hand.x, y: hand.y - 150 * k };
    const startScale = 0.85 * k;
    const endScale = handRadius / mesh.R;
    const view = { mesh, x: start.x, y: start.y, rotation: 0, scale: startScale * 0.8, alpha: 0, spriteFade: 0 };
    this.crumpleView = view;
    mesh.setProgress(0);
    this.ui.hint(this.queue.length > 1 ? `Crumpling ${this.current.info.name}…` : 'Crumpling…');

    // 1) the sheet pops up from below
    this.tweens.add({
      duration: 0.32,
      ease: easeOutBack,
      update: (e) => {
        view.scale = lerp(startScale * 0.8, startScale, e);
        view.y = start.y + (1 - e) * 60 * k;
        view.alpha = clamp(e * 2, 0, 1);
      },
      done: () => {
        if (session !== this.session) return;
        this.sound.crumple(1.55);
        // 2) fold, crumple and settle into your hand
        this.tweens.add({
          duration: 1.75,
          update: (_, t) => {
            mesh.setProgress(t);
            const travel = easeInOutCubic(clamp((t - 0.3) / 0.7, 0, 1));
            view.x = lerp(start.x, hand.x, travel);
            view.y = lerp(start.y, hand.y, travel);
            view.rotation = 0.6 * easeInOutCubic(t);
            const squeeze = t > 0.85 ? 1 - Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.08 : 1;
            view.scale = lerp(startScale, endScale, easeInOutCubic(clamp((t - 0.3) / 0.7, 0, 1))) * squeeze;
            view.spriteFade = clamp((t - 0.88) / 0.12, 0, 1);
          },
          done: () => {
            if (session !== this.session) return;
            this.crumpleView = null;
            this.ball.angle = view.rotation + mesh.rotation;
            this._enterReady();
          },
        });
      },
    });
  }

  // ------------------------------------------------------------------
  // Grab → pull back → release
  // ------------------------------------------------------------------

  _ballScreen() {
    return this.scene.project(this.ball);
  }

  _hitBall(x, y) {
    const b = this.ball;
    if (!b || this.crumpleView) return false;
    const p = this._ballScreen();
    return Math.hypot(x - p.x, y - p.y) < Math.max(26, b.r * p.s + 22 * this.layout.k);
  }

  _enterReady() {
    this.state = 'ready';
    this.physicsOn = false;
    this.ball.place(HAND.x, HAND.y, HAND.z);
    this.input.setMode('throw');
    this.scene.can.lidTarget = 0;
    const left = MAX_THROWS - this.throwsUsed;
    this.ui.hint(
      this.throwsUsed === 0
        ? 'Grab the ball, pull it back toward you, and let go'
        : left === 1
          ? 'Last throw. Make it count!'
          : `${left} throws left. The bin moved!`,
    );
    this._updateHud();
  }

  _grab(x, y) {
    if (this.state !== 'ready') return;
    this.state = 'holding';
    const p = this._ballScreen();
    this.grabOffset = { x: p.x - x, y: p.y - y };
    this.sound.pickup();
    this.scene.can.lidTarget = 0.12; // the bin perks up
    this.ui.hint('Pull back to aim · let go to throw');
    this._drag(x, y);
  }

  _drag(x, y) {
    if (this.state !== 'holding') return;
    const { hand, maxPull, height } = this.layout;
    let dx = x + this.grabOffset.x - hand.x;
    let dy = y + this.grabOffset.y - hand.y;
    const len = Math.hypot(dx, dy);
    // Soft limit: linear up to 80% reach, then it resists like an arm at full stretch.
    const knee = maxPull * 0.8;
    if (len > knee) {
      const soft = knee + (maxPull - knee) * Math.tanh((len - knee) / (maxPull - knee));
      dx *= soft / len;
      dy *= soft / len;
    }
    const sx = hand.x + dx;
    const sy = Math.min(hand.y + dy, height - 12);
    const b = this.ball;
    const w = this.scene.camera.unproject(sx, sy, HAND.z);
    b.angle += (w.x - b.x) / b.r * 0.25;
    b.x = w.x;
    b.y = Math.max(b.r, w.y);
    b.z = HAND.z;

    const launch = this._launch({ x: sx - hand.x, y: sy - hand.y }, null);
    this.aim = {
      ballScreen: { x: sx, y: sy },
      power: launch.power,
      pullAngle: launch.power > 0.02 ? Math.atan2(sy - hand.y, sx - hand.x) : null,
      points: launch.valid ? this._previewPath(b, launch.v) : null,
    };
  }

  /** The predicted arc, stopping where it would meet the bin (in or off the side). */
  _previewPath(b, v) {
    const can = this.scene.can;
    const points = this.world.predict(b.x, b.y, b.z, v.x, v.y, v.z, 1.8);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.y < can.H && Math.hypot(p.x - can.cx, p.z - can.cz) < can.R + b.r) return points.slice(0, i + 1);
    }
    return points;
  }

  /**
   * Turn a pull (screen offset of the ball from the hand; +y = pulled back)
   * and an optional release flick (px/s) into a 3D launch velocity.
   */
  _launch(pull, flick) {
    const { maxPull, k } = this.layout;
    const len = Math.hypot(pull.x, pull.y);
    const power = Math.min(1, len / maxPull);
    let valid = pull.y > len * 0.25 && len > 12 * k;
    let speed = V_MIN + (V_MAX - V_MIN) * power;
    let yaw = Math.atan2(-pull.x, Math.max(1e-6, pull.y)) * YAW_GAIN;

    // Release speed adds to the throw when the hand is moving forward (up).
    if (flick) {
      const up = -flick.vy;
      if (up > 350 * k) {
        const flickSpeed = up / (230 * k);
        const flickYaw = Math.atan2(flick.vx, up) * YAW_GAIN;
        if (valid) {
          speed += flickSpeed * 0.35;
          yaw += flickYaw * 0.3;
        } else {
          valid = true;
          speed = flickSpeed;
          yaw = flickYaw;
        }
      }
    }
    speed = Math.min(speed, V_MAX * 1.12);
    yaw = clamp(yaw, -MAX_YAW, MAX_YAW);
    const v = {
      x: speed * Math.cos(ELEVATION) * Math.sin(yaw),
      y: speed * Math.sin(ELEVATION),
      z: speed * Math.cos(ELEVATION) * Math.cos(yaw),
    };
    return { valid: valid && speed > 1.5, v, speed, power };
  }

  _release(flick) {
    if (this.state !== 'holding') return;
    const { hand } = this.layout;
    const p = this._ballScreen();
    const launch = this._launch({ x: p.x - hand.x, y: p.y - hand.y }, flick);
    this.aim = null;
    if (!launch.valid) {
      this._returnToHand('Pull back (toward you) to throw');
      return;
    }

    this.throwsUsed += 1;
    this.thrownSinceMove = true;
    this._updateHud();
    this.state = 'flying';
    this.input.setMode('off');
    this.ui.hint(null);
    const b = this.ball;
    b.vx = launch.v.x;
    b.vy = launch.v.y;
    b.vz = launch.v.z;
    b.spin = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6);
    b.bounciness = 1;
    this.physicsOn = true;
    this.flight = { elapsed: 0, rest: 0, captured: 0, closing: false, touchedCan: false, touchedLid: false, touchedRim: false, bounces: 0, lidSignalled: false };
    this.sound.whoosh(launch.speed / V_MAX);
  }

  _returnToHand(message) {
    if (!this.ball) return;
    const session = this.session;
    this.state = 'returning';
    this.aim = null;
    this.input.setMode('off');
    const b = this.ball;
    const from = { x: b.x, y: b.y, z: b.z };
    this.tweens.add({
      duration: 0.28,
      ease: easeOutBack,
      update: (e) => {
        b.x = lerp(from.x, HAND.x, e);
        b.y = lerp(from.y, HAND.y, e);
        b.z = lerp(from.z, HAND.z, e);
      },
      done: () => {
        if (session !== this.session) return;
        this._enterReady();
        if (message) this.ui.hint(message);
      },
    });
  }

  // ------------------------------------------------------------------
  // Flight, misses and the bin
  // ------------------------------------------------------------------

  _update(dt) {
    this.time += dt;
    this.tweens.step(dt);
    const can = this.scene.can;

    if (this.physicsOn && this.ball) {
      this.world.step(this.ball, dt, (e) => this._impact(e));
      if (this.state === 'flying') this._updateFlight(dt);
      else if (this.state === 'scoring') this._updateScoring(dt);
    }

    can.update(dt);
    this.scene.effects.update(dt);
  }

  _updateFlight(dt) {
    const can = this.scene.can;
    const b = this.ball;
    const f = this.flight;
    f.elapsed += dt;

    // The bin notices the ball coming and opens up.
    const dist = Math.hypot(b.x - can.cx, b.z - can.cz);
    const near = dist < 2.1;
    can.lidTarget = near ? 1 : 0.15;
    can.glowTarget = near ? clamp(1.35 - dist / 1.5, 0, 1) : 0;
    if (near && !f.lidSignalled) {
      f.lidSignalled = true;
      this.sound.lidOpen();
    }

    if (can.contains(b)) {
      this._captured();
      return;
    }

    if (b.speed < 0.12 && b.contactAge < 0.1) f.rest += dt;
    else f.rest = 0;
    if (f.rest > 0.3 || f.elapsed > 8) this._missed();
  }

  _impact(e) {
    const can = this.scene.can;
    const f = this.flight;
    const loud = e.impact * 260; // sound effects were tuned in px/s
    switch (e.tag) {
      case 'floor':
      case 'wall':
      case 'near': {
        this.sound.thud(loud);
        if (e.tag === 'floor' && e.impact > 1.6) {
          const p = this.scene.camera.project(e.x, 0, e.z);
          this.scene.effects.dust(p.x, p.y, p.s / 160, Math.round(e.impact * 2), 0.6);
        }
        if (f && this.state === 'flying' && e.tag === 'floor') f.bounces += 1;
        break;
      }
      case 'can-wall':
      case 'can-rim':
      case 'lid':
        this.sound.tink(loud);
        can.hit(Math.min(0.8, e.impact / 8));
        if (f) {
          f.touchedCan = true;
          if (e.tag === 'lid') f.touchedLid = true;
          if (e.tag === 'can-rim') f.touchedRim = true;
        }
        break;
      case 'can-bottom':
        this.sound.drop();
        can.thump(Math.min(1.2, e.impact / 5));
        can.hit(0.3);
        break;
      default:
        break;
    }
  }

  _missed() {
    const can = this.scene.can;
    this.streak = 0;
    can.lidTarget = 0;
    can.glowTarget = 0;
    this.sound.miss();
    if (this.throwsUsed < MAX_THROWS) {
      this.state = 'missed';
      const left = MAX_THROWS - this.throwsUsed;
      this.ui.toast('Miss!', { tone: 'miss', sub: `${left === 1 ? 'One throw' : `${left} throws`} remaining.` });
      this.ui.hint('Click the paper ball to pick it back up');
      this.input.setMode('pickup');
      this._updateHud();
      const session = this.session;
      this.tweens.add({
        duration: 0.45,
        update: () => {},
        done: () => {
          if (session === this.session && this.thrownSinceMove) this._relocateCan(this.ball);
        },
      });
      return;
    }
    this._fileSurvived();
  }

  /**
   * Send the bin to a new random spot after a throw: far enough from where it
   * was to be a fresh challenge, and clear of the ball lying on the floor.
   */
  _relocateCan(avoid) {
    const can = this.scene.can;
    this.thrownSinceMove = false;
    let best = null;
    for (let i = 0; i < 40; i++) {
      const x = CAN_AREA.xMin + Math.random() * (CAN_AREA.xMax - CAN_AREA.xMin);
      if (Math.abs(x) < CAN_AREA.centreGap) continue;
      const z = CAN_AREA.zMin + Math.random() * (CAN_AREA.zMax - CAN_AREA.zMin);
      const fromOld = Math.hypot(x - can.cx, z - can.cz);
      const fromBall = avoid ? Math.hypot(x - avoid.x, z - avoid.z) : Infinity;
      if (fromBall < can.R + 0.4) continue;
      if (fromOld >= 0.9) {
        best = { x, z };
        break;
      }
      if (!best || fromOld > Math.hypot(best.x - can.cx, best.z - can.cz)) best = { x, z };
    }
    if (!best) return;
    const dur = can.moveTo(best.x, best.z);
    this.sound.scoot(dur);
  }

  _pickup() {
    if (this.state !== 'missed' || !this.ball) return;
    const session = this.session;
    this.state = 'returning';
    this.physicsOn = false;
    this.input.setMode('off');
    this.sound.pickup();
    this.ui.hint(null);
    const b = this.ball;
    const from = { x: b.x, y: b.y, z: b.z, angle: b.angle };
    this.tweens.add({
      duration: 0.7,
      ease: easeInOutCubic,
      update: (e) => {
        b.x = lerp(from.x, HAND.x, e);
        b.y = lerp(from.y, HAND.y, e) + Math.sin(Math.PI * e) * 0.9;
        b.z = lerp(from.z, HAND.z, e);
        b.angle = from.angle - e * Math.PI * 2;
      },
      done: () => {
        if (session === this.session) this._enterReady();
      },
    });
  }

  _captured() {
    const can = this.scene.can;
    this.state = 'scoring';
    this.input.setMode('off');
    this.ball.bounciness = 0.45;
    can.sealed = true; // no escaping now
    can.glowTarget = 0;
    this.flight.captured = 0;
    this._updateHud();
  }

  _updateScoring(dt) {
    const f = this.flight;
    const b = this.ball;
    const can = this.scene.can;
    f.captured += dt;
    const settled = b.speed < 0.2 && b.contactAge < 0.1;
    if (!f.closing && (f.captured > 0.55 || (settled && f.captured > 0.25))) {
      f.closing = true;
      can.lidTarget = 0;
      f.closingAt = f.captured;
    }
    // Fallback in case the slam callback didn't fire (e.g. lid already shut).
    if (f.closing && !f.slammed && f.captured - f.closingAt > 0.8) this._lidSlammed(0.6);
  }

  _lidSlammed(strength) {
    const can = this.scene.can;
    this.sound.clang(strength);
    can.hit(0.9);
    can.thump(1.6 * strength + 0.4);
    if (this.state === 'scoring' && this.flight && !this.flight.slammed) {
      this.flight.slammed = true;
      const p = can.rimCenter(this.scene.camera);
      this.scene.effects.dust(p.x, p.y, p.s / 160, 12, 1.2);
      this.scene.effects.ring(p.x, p.y, p.s / 160);
      this._performTrash(this.session);
    }
  }

  /** The one and only place the real file is touched. */
  async _performTrash(session) {
    const item = this.current;
    if (this.state !== 'scoring' || !item || item.outcome) return;
    this.state = 'trashing';
    this._celebrate(item);

    const statusTimer = setTimeout(() => this.ui.status(`Moving to the ${this.trashName}…`), 300);
    let result;
    try {
      result = await this.files.trash(item.token);
    } catch (err) {
      result = { ok: false, code: 'unknown', message: 'Something unexpected went wrong. Nothing was deleted.', detail: String(err?.message || err) };
    }
    clearTimeout(statusTimer);
    this.ui.status(null);
    if (session !== this.session) return;

    if (result.ok) this._trashSucceeded();
    else this._trashFailed(result);
  }

  /** A ball landed: count the streak and cheer. */
  _celebrate(item) {
    const can = this.scene.can;
    const f = this.flight;
    this.streak += 1;
    const newBest = this.streak > this.bestStreak;
    if (newBest) {
      this.bestStreak = this.streak;
      try {
        localStorage.setItem(BEST_STREAK_KEY, String(this.bestStreak));
      } catch {
        /* storage unavailable: best streak lasts this session only */
      }
    }
    item.throws = this.throwsUsed;
    this.lastCheer = pickCheer({
      ...f,
      throwNumber: this.throwsUsed,
      maxThrows: MAX_THROWS,
      distance: Math.hypot(can.cx - HAND.x, can.cz - HAND.z),
      lateral: can.cx,
      streak: this.streak,
      newBest: newBest && this.streak >= 2,
      fill: can.fill,
      isFolder: item.info.kind === 'directory',
      name: item.info.name,
      trashName: this.trashName,
    });
    this.ui.toast(this.lastCheer.title, { tone: this.lastCheer.big ? 'big' : 'success', sub: this.lastCheer.sub });
  }

  _trashSucceeded() {
    const can = this.scene.can;
    const p = can.rimCenter(this.scene.camera);
    const k = p.s / 160;
    this.physicsOn = false;
    this.ball = null;
    this.sound.success();
    const big = this.lastCheer?.big;
    this.scene.effects.paperBits(p.x, p.y - 6, k, big ? 48 : 22);
    if (big) setTimeout(() => this.scene.effects.paperBits(p.x, p.y - 6, k, 30), 220);
    // Floating "+1" over the bin, plus the streak count when it's going.
    const lift = this.layout.k;
    this.scene.effects.popText(p.x, p.y - 70 * lift, '+1', { color: '#ffd84d', size: Math.round(54 * lift) });
    if (this.streak >= 2) {
      this.scene.effects.popText(p.x + 105 * lift, p.y - 140 * lift, `🔥 x${this.streak}`, { color: '#ff8a3d', size: Math.round(40 * lift), delay: 0.25 });
    }
    can.thump(0.8);
    // The ball joins the pile: bump the count now, then re-read the real numbers.
    const size = this.current?.info.size || 0;
    this.sessionTrashed += 1;
    this.sessionBytes += size;
    const prev = this.binStats || { items: 0, bytes: 0 };
    this._applyBinStats({ items: prev.items + 1, bytes: prev.bytes + size });
    setTimeout(() => this.refreshBin(), 500);
    this._finishItem('trashed', '', 1.1);
  }

  /** Read how full the OS Recycle Bin is and fill the on-screen bin to match. */
  async refreshBin() {
    let stats = null;
    try {
      stats = this.files.binStats ? await this.files.binStats() : null;
    } catch {
      stats = null;
    }
    // Where the OS can't tell us, show what was binned this session.
    if (!stats || !stats.ok) stats = { items: this.sessionTrashed, bytes: this.sessionBytes };
    this._applyBinStats(stats);
  }

  _applyBinStats(stats) {
    this.binStats = { items: stats.items, bytes: stats.bytes };
    // Log scale: the first few items show clearly, ~60 items fills it up.
    const level = stats.items > 0 ? Math.min(1, Math.log(1 + stats.items) / Math.log(1 + BIN_FULL_ITEMS)) : 0;
    this.scene.can.setFill(level);
    this.ui.setBinStats(this.binStats, level);
  }

  _trashFailed(result) {
    const can = this.scene.can;
    this.sound.error();
    this.ui.toast('The bin spat it back out', { tone: 'miss', sub: result.message || 'Nothing was deleted.' });
    // The bin spits the ball back out: the file is still there.
    can.sealed = false;
    can.lidTarget = 1;
    const session = this.session;
    this.tweens.add({
      duration: 0.18,
      update: () => {},
      done: () => {
        if (session !== this.session || !this.ball) return;
        const b = this.ball;
        b.bounciness = 1;
        b.y = Math.max(b.y, can.H + b.r + 0.02);
        b.vx = (Math.random() - 0.5) * 1.2;
        b.vy = 3.4;
        b.vz = -2.4;
        b.spin = -8;
      },
    });
    this.tweens.add({
      duration: 0.8,
      update: () => {},
      done: () => {
        if (session === this.session) can.lidTarget = 0;
      },
    });
    this._finishItem('failed', result.message || 'Could not be moved.', 2.6);
  }

  // ------------------------------------------------------------------
  // Survived / kept: un-crumple back to a safe sheet of paper
  // ------------------------------------------------------------------

  _fileSurvived() {
    this.state = 'ending';
    this._updateHud();
    this.input.setMode('off');
    this.ui.hint(null);
    this.ui.toast(`All ${MAX_THROWS} throws missed.`, { tone: 'info', sub: `${this.queue.length > 1 ? 'This one' : 'The file'} survived.` });
    this.sound.survived();
    const session = this.session;
    this._uncrumple(() => {
      if (session === this.session) this._finishItem('survived', '', 0.2);
    });
  }

  /** "Keep it" / Esc: skip this item before the ball is in the bin. */
  keep() {
    if (this.state === 'confirm') {
      this.cancelSelection();
      return;
    }
    if (!CANCELLABLE.has(this.state)) return;
    this._abortCurrent(() => {
      this.ui.toast('Kept it', { tone: 'info', sub: 'Nothing was touched.' });
      this._finishItem('kept', '', 0.2);
    });
  }

  /** "Stop all": keep this item and everything still waiting. */
  stopAll() {
    if (!CANCELLABLE.has(this.state)) return;
    this._abortCurrent(() => {
      for (const item of this.queue) if (!item.outcome) item.outcome = 'kept';
      this.index = this.queue.length;
      this._showSummary();
    });
  }

  _abortCurrent(done) {
    this.session += 1;
    const session = this.session;
    this.tweens.clear();
    this.state = 'ending';
    this._updateHud();
    this.input.setMode('off');
    this.aim = null;
    this.ui.hint(null);
    const can = this.scene.can;
    can.lidTarget = 0;
    can.glowTarget = 0;
    this._uncrumple(() => {
      if (session === this.session) done();
    });
  }

  _uncrumple(done) {
    const { hand, k } = this.layout;
    const mesh = this.mesh;
    const b = this.ball;
    let from = null;
    if (this.crumpleView) {
      from = { ...this.crumpleView, t: mesh.t };
    } else if (b && mesh) {
      const p = this._ballScreen();
      from = { x: p.x, y: p.y, rotation: b.angle - mesh.rotation, scale: (b.r * p.s) / mesh.R, t: 1 };
    }
    this.physicsOn = false;
    this.ball = null;
    if (!from) {
      done();
      return;
    }
    const view = { mesh, x: from.x, y: from.y, rotation: from.rotation, scale: from.scale, alpha: 1, spriteFade: from.t === 1 ? 1 : 0 };
    this.crumpleView = view;
    const to = { x: hand.x, y: hand.y - 150 * k, scale: 0.8 * k };
    this.tweens.add({
      duration: 1.0,
      update: (_, t) => {
        const e = easeInOutCubic(t);
        mesh.setProgress(from.t * (1 - easeOutCubic(t)));
        view.x = lerp(from.x, to.x, e);
        view.y = lerp(from.y, to.y, e) - Math.sin(Math.PI * e) * 40 * k;
        view.rotation = lerp(from.rotation, 0, e);
        view.scale = lerp(from.scale, to.scale, e);
        view.spriteFade = from.t === 1 ? clamp(1 - t * 8, 0, 1) : 0;
      },
      done: () => {
        this.tweens.add({
          duration: 0.3,
          update: (e) => {
            view.alpha = 1 - e;
            view.y = to.y + e * 40 * k;
          },
          done: () => {
            if (this.crumpleView === view) this.crumpleView = null;
            done();
          },
        });
      },
    });
  }

  // ------------------------------------------------------------------
  // Layout & rendering
  // ------------------------------------------------------------------

  _updateHud() {
    const item = this.current;
    if (!item || this.state === 'summary') {
      this.ui.setHud(null);
      return;
    }
    this.ui.setHud({
      name: item.info.name,
      index: this.index,
      total: this.queue.length,
      throwsLeft: MAX_THROWS - this.throwsUsed,
      maxThrows: MAX_THROWS,
      canKeep: CANCELLABLE.has(this.state),
    });
  }

  _resize() {
    this.scene.resize();
    if (this.mesh && this.sprite) this.sprite = this.mesh.renderSprite(this.layout.handRadius * this.scene.dpr * 1.3);
  }

  _render() {
    this.scene.render({
      ball: this.ball,
      ballVisible: !!this.ball && !this.crumpleView,
      sprite: this.sprite,
      crumple: this.crumpleView,
      aim: this.state === 'holding' ? this.aim : null,
      pickupHint: this.state === 'missed',
      time: this.time,
    });
  }
}
