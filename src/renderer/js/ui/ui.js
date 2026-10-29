// DOM user interface: bottom pick dock, bottom sheet (confirm / summary),
// HUD, hints and toasts. File names and paths are always inserted with
// textContent, never as HTML.

import { formatBytes, formatDate, describeKind, describeContents, colorForExtension } from './format.js';

const ICONS = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  folder: '<svg viewBox="0 0 52 46" aria-hidden="true"><path d="M2 6a4 4 0 0 1 4-4h14l5 6h21a4 4 0 0 1 4 4v4H2z" fill="#d99a2b"/><rect x="2" y="12" width="48" height="32" rx="4" fill="#f2b33d"/><rect x="5" y="16" width="42" height="2" rx="1" fill="#fff" opacity=".35"/></svg>',
  trashed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  survived: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  kept: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  failed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 7v6M12 16.5h.01"/><circle cx="12" cy="12" r="9"/></svg>',
};

/** Tiny element builder. Strings become text nodes; null/false are skipped. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value; // static trusted markup only
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fileBadge(info) {
  if (info.kind === 'directory') return el('span', { class: 'item-icon folder', html: ICONS.folder });
  const badge = el('span', { class: 'ext' }, (info.extension || (info.kind === 'symlink' ? 'link' : 'file')).toUpperCase());
  badge.style.background = colorForExtension(info.extension || '');
  return el('span', { class: 'item-icon' }, badge);
}

export class UI {
  constructor() {
    this.sheet = document.getElementById('sheet');
    this.dock = document.getElementById('dock');
    this.hud = document.getElementById('hud');
    this.hudName = document.getElementById('hud-name');
    this.hudCount = document.getElementById('hud-count');
    this.throws = document.getElementById('throws');
    this.keepBtn = document.getElementById('keep-btn');
    this.stopBtn = document.getElementById('stop-btn');
    this.toastEl = document.getElementById('toast');
    this.hintEl = document.getElementById('hint');
    this.statusEl = document.getElementById('status');
    this.statusText = document.getElementById('status-text');
    this.dropOverlay = document.getElementById('drop-overlay');
    this.soundBtn = document.getElementById('sound-btn');
    this.demoBadge = document.getElementById('demo-badge');
    this.dockNote = document.getElementById('dock-note');
    this.handlers = {};
    this.trashName = 'Recycle Bin';

    document.getElementById('pick-files').addEventListener('click', () => this.emit('pick', 'file'));
    document.getElementById('pick-folder').addEventListener('click', () => this.emit('pick', 'directory'));
    this.keepBtn.addEventListener('click', () => this.emit('keep'));
    this.stopBtn.addEventListener('click', () => this.emit('stop'));
    this.soundBtn.addEventListener('click', () => this.emit('toggleSound'));

    this.skinBtn = document.getElementById('skin-btn');
    this.skinMenu = document.getElementById('skin-menu');
    this.skinList = document.getElementById('skin-list');
    this.skinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSkinMenu(this.skinMenu.hidden);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.skinMenu.hidden && !e.target.closest('.skin-picker')) this._toggleSkinMenu(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.skinMenu.hidden) {
        e.stopImmediatePropagation();
        this._toggleSkinMenu(false);
        this.skinBtn.focus();
      }
    }, true);
  }

  // ---------- Recycle Bin badge ----------

  /** @param {{items: number, bytes: number} | null} stats  @param {number} level 0..1 */
  setBinStats(stats, level) {
    const badge = document.getElementById('bin-badge');
    if (!stats) {
      badge.hidden = true;
      return;
    }
    badge.hidden = false;
    const items = `${stats.items.toLocaleString()} item${stats.items === 1 ? '' : 's'}`;
    document.getElementById('bin-badge-text').textContent = stats.items ? `${items} · ${formatBytes(stats.bytes)}` : 'Empty';
    document.getElementById('bin-meter-fill').style.width = `${Math.round(level * 100)}%`;
    badge.title = `Your ${this.trashName}: ${items}, ${formatBytes(stats.bytes)}`;
  }

  // ---------- skins ----------

  /** @param {{id: string, name: string, body: [number, string][], lid: string}[]} skins */
  setSkins(skins, currentId) {
    this.skinList.replaceChildren(...skins.map((skin) => {
      const swatch = el('span', { class: 'skin-swatch', 'aria-hidden': 'true' });
      swatch.style.background = `linear-gradient(90deg, ${skin.body.map(([at, c]) => `${c} ${Math.round(at * 100)}%`).join(', ')})`;
      swatch.style.setProperty('--lid', skin.lid);
      return el('button', {
        class: 'skin-option',
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': String(skin.id === currentId),
        'data-skin': skin.id,
        onclick: () => {
          this._markSkin(skin.id);
          this.emit('skin', skin.id);
        },
      }, swatch, skin.name);
    }));
  }

  _markSkin(id) {
    for (const b of this.skinList.children) b.setAttribute('aria-checked', String(b.dataset.skin === id));
  }

  _toggleSkinMenu(open) {
    this.skinMenu.hidden = !open;
    this.skinBtn.setAttribute('aria-expanded', String(open));
    if (open) this.skinList.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, ...args) {
    this.handlers[name]?.(...args);
  }

  setEnvironment({ demo, trashName }) {
    this.trashName = trashName;
    this.demoBadge.hidden = !demo;
    this.dockNote.textContent = `or drop files anywhere · they go to the ${trashName} only if your throw lands`;
  }

  setMuted(muted) {
    this.soundBtn.setAttribute('aria-pressed', String(muted));
    this.soundBtn.title = muted ? 'Sound off' : 'Sound on';
  }

  showDock(visible) {
    this.dock.hidden = !visible;
    if (visible) document.getElementById('pick-files').focus({ preventScroll: true });
  }

  // ---------- bottom sheet ----------

  _setSheet(...children) {
    this.sheet.className = 'sheet';
    this.sheet.replaceChildren(...children.flat().filter(Boolean));
    this.sheet.hidden = false;
    void this.sheet.offsetWidth; // restart the entrance animation
    this.sheet.classList.add('enter');
    const focusable = this.sheet.querySelector('[data-autofocus]') || this.sheet.querySelector('button');
    focusable?.focus({ preventScroll: true });
  }

  hideSheet() {
    if (this.sheet.hidden) return Promise.resolve();
    this.sheet.classList.remove('enter');
    this.sheet.classList.add('leave');
    return new Promise((resolve) => {
      setTimeout(() => {
        this.sheet.hidden = true;
        this.sheet.replaceChildren();
        resolve();
      }, 180);
    });
  }

  /**
   * @param {Array} items  results from the file service (ok items have token + info)
   */
  showConfirm(items) {
    const valid = items.filter((i) => i.ok);
    const refused = items.filter((i) => !i.ok);
    const hasFolder = valid.some((i) => i.info.kind === 'directory');
    const single = valid.length === 1 && refused.length === 0 ? valid[0].info : null;

    let body;
    if (single) {
      const facts = el('dl', { class: 'facts' });
      const fact = (k, v) => facts.append(el('dt', {}, k), el('dd', {}, v));
      fact('Type', describeKind(single));
      if (single.kind === 'directory') {
        fact('Contains', describeContents(single.contents));
        fact('Total size', (single.contents?.truncated ? 'At least ' : '') + formatBytes(single.size));
      } else {
        fact('Size', formatBytes(single.size));
      }
      fact('Modified', formatDate(single.modified));
      body = [
        el('div', { class: 'item-head' }, fileBadge(single),
          el('div', { class: 'item-title' },
            el('div', { class: 'kicker' }, 'Throw this away?'),
            el('p', { class: 'item-name', title: single.name }, single.name))),
        el('div', { class: 'item-path', title: single.path }, single.path),
        facts,
      ];
    } else {
      const list = el('ul', { class: 'item-list' },
        items.map((item) => {
          if (!item.ok) {
            return el('li', { class: 'row refused' },
              el('span', { class: 'row-icon', html: ICONS.failed }),
              el('div', { class: 'row-text' },
                el('div', { class: 'row-name', title: item.path || item.name }, item.name || item.path || 'Unknown item'),
                el('div', { class: 'row-meta warn' }, `Skipped: ${item.message}`)));
          }
          const info = item.info;
          const meta = info.kind === 'directory' ? `Folder · ${describeContents(info.contents)} · ${formatBytes(info.size)}` : `${describeKind(info)} · ${formatBytes(info.size)}`;
          return el('li', { class: 'row' }, fileBadge(info),
            el('div', { class: 'row-text' },
              el('div', { class: 'row-name', title: info.path }, info.name),
              el('div', { class: 'row-meta' }, meta, el('span', { class: 'row-path' }, info.parent || ''))));
        }));
      body = [
        el('div', { class: 'kicker' }, valid.length ? `Throw ${valid.length === 1 ? 'this' : `these ${valid.length}`} away?` : 'Nothing to throw'),
        list,
      ];
    }

    const notices = [];
    if (hasFolder) {
      notices.push(el('div', { class: 'notice' }, el('span', { html: ICONS.warn, 'aria-hidden': 'true' }),
        el('span', {}, `Folders go to the ${this.trashName} together with everything inside them.`)));
    }
    for (const item of valid) {
      for (const w of item.info.warnings || []) {
        notices.push(el('div', { class: 'notice' }, el('span', { html: ICONS.warn, 'aria-hidden': 'true' }),
          el('span', {}, valid.length > 1 ? `${item.info.name}: ${w}` : w)));
      }
    }

    const confirmBtn = valid.length
      ? el('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.emit('confirm') },
        valid.length === 1 ? 'Crumple it up' : `Crumple all ${valid.length}`)
      : null;
    let check = null;
    if (hasFolder && confirmBtn) {
      confirmBtn.disabled = true;
      const box = el('input', { type: 'checkbox', onchange: (e) => { confirmBtn.disabled = !e.target.checked; } });
      check = el('label', { class: 'check' }, box, el('span', {}, 'I understand folders are thrown away with all their contents.'));
    }

    this._setSheet(
      body,
      notices,
      check,
      valid.length
        ? el('p', { class: 'footnote' }, el('span', { html: ICONS.shield, 'aria-hidden': 'true' }),
          el('span', {}, `Nothing happens until a paper ball lands in the bin. Four throws each. Then it goes to the ${this.trashName}.`))
        : null,
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => this.emit('cancel'), 'data-autofocus': true }, valid.length ? 'Cancel' : 'Pick again'),
        confirmBtn),
    );
  }

  /**
   * @param {{tone: string, title: string, lede: string, rows: {name: string, outcome: string, message?: string}[],
   *          note?: string, actions: {label: string, primary?: boolean, onClick: () => void}[]}} s
   */
  showSummary(s) {
    const labels = { trashed: `In the ${this.trashName}`, survived: 'Survived', kept: 'Kept', failed: 'Not moved' };
    this._setSheet(
      el('h2', { class: `summary-title tone-${s.tone}` }, s.title),
      s.lede ? el('p', { class: 'lede' }, s.lede) : null,
      el('ul', { class: 'item-list' },
        s.rows.map((row) => el('li', { class: `row outcome-${row.outcome}` },
          el('span', { class: 'row-icon', html: ICONS[row.outcome] }),
          el('div', { class: 'row-text' },
            el('div', { class: 'row-name', title: row.name }, row.name),
            el('div', { class: 'row-meta' }, row.message || labels[row.outcome]))))),
      s.note ? el('p', { class: 'detail' }, s.note) : null,
      el('div', { class: 'actions' },
        s.actions.map((a) => el('button', {
          class: `btn ${a.primary ? 'btn-dark' : 'btn-secondary'}`,
          type: 'button',
          onclick: a.onClick,
          'data-autofocus': a.primary || undefined,
        }, a.label))),
    );
  }

  // ---------- HUD / hints / toasts ----------

  setHud(state) {
    if (!state) {
      this.hud.hidden = true;
      return;
    }
    this.hud.hidden = false;
    this.hudName.textContent = state.name;
    this.hudName.title = state.name;
    this.hudCount.hidden = state.total < 2;
    this.hudCount.textContent = `${state.index + 1} of ${state.total}`;
    while (this.throws.children.length < state.maxThrows) this.throws.append(document.createElement('i'));
    while (this.throws.children.length > state.maxThrows) this.throws.lastChild.remove();
    [...this.throws.children].forEach((dot, i) => dot.classList.toggle('used', i >= state.throwsLeft));
    this.throws.setAttribute('aria-label', `${state.throwsLeft} throw${state.throwsLeft === 1 ? '' : 's'} left`);
    this.keepBtn.hidden = !state.canKeep;
    this.stopBtn.hidden = !state.canKeep || state.total - state.index < 2;
  }

  hint(text) {
    if (!text) {
      this.hintEl.hidden = true;
      return;
    }
    if (this.hintEl.textContent === text && !this.hintEl.hidden) return;
    this.hintEl.textContent = text;
    this.hintEl.hidden = false;
  }

  toast(text, { tone = 'info', sub = '' } = {}) {
    const t = this.toastEl;
    t.className = `toast tone-${tone}`;
    t.replaceChildren(text, ...(sub ? [el('small', {}, sub)] : []));
    void t.offsetWidth;
    t.classList.add('show');
  }

  status(text) {
    this.statusEl.hidden = !text;
    if (text) this.statusText.textContent = text;
  }

  setDropActive(active) {
    this.dropOverlay.hidden = !active;
  }
}
