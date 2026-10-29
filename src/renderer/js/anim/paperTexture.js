// Draws the selected file or folder onto a sheet of paper (front + back
// textures). The crumple mesh maps these textures onto its triangles.

import { mulberry32, hashString } from './easing.js';
import { colorForExtension, formatBytes, describeContents } from '../ui/format.js';

export const PAPER_WIDTH = 220;
export const PAPER_HEIGHT = 285;
const RES = 2; // texture pixels per paper unit

const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif';

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * RES);
  canvas.height = Math.round(h * RES);
  const ctx = canvas.getContext('2d');
  ctx.scale(RES, RES);
  return { canvas, ctx };
}

function grain(ctx, w, h, rand, alpha) {
  for (let i = 0; i < 900; i++) {
    const shade = rand() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, 0.6 + rand(), 0.6 + rand());
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Word-wrap with hard breaks for long unbroken names; max lines, then ellipsis. */
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of Array.from(text)) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const consumed = lines.join('').length;
  if (consumed < Array.from(text).length) {
    let last = lines[lines.length - 1];
    while (last.length && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}

function textLines(ctx, x, y, w, bottom, rand, color) {
  ctx.fillStyle = color;
  let cy = y;
  while (cy < bottom) {
    const paragraph = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < paragraph && cy < bottom; i++) {
      const lw = i === paragraph - 1 ? w * (0.35 + rand() * 0.4) : w * (0.82 + rand() * 0.18);
      roundRect(ctx, x, cy, lw, 4.2, 2);
      ctx.fill();
      cy += 10.5;
    }
    cy += 8;
  }
}

function folderGlyph(ctx, x, y, size) {
  const w = size;
  const h = size * 0.78;
  ctx.fillStyle = '#d99a2b';
  roundRect(ctx, x, y, w * 0.45, h * 0.3, 3);
  ctx.fill();
  ctx.fillStyle = '#f2b33d';
  roundRect(ctx, x, y + h * 0.16, w, h * 0.84, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x + 3, y + h * 0.28, w - 6, 2);
}

export function createPaperTextures(info) {
  const W = PAPER_WIDTH;
  const H = PAPER_HEIGHT;
  const rand = mulberry32(hashString(info.path || info.name));
  const isFolder = info.kind === 'directory';
  const paperColor = isFolder ? '#f4e2b8' : '#fdfcf7';
  const backColor = isFolder ? '#ecd6a6' : '#f2f0e9';

  // ---------- front ----------
  const { canvas: front, ctx } = makeCanvas(W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, paperColor);
  bg.addColorStop(1, isFolder ? '#efd9a6' : '#f6f4ec');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, rand, 0.06);

  const pad = 20;
  let y = pad;
  if (isFolder) {
    folderGlyph(ctx, pad, y, 40);
  } else {
    const ext = (info.extension || (info.kind === 'symlink' ? 'link' : 'file')).slice(0, 5).toUpperCase();
    ctx.font = `700 11px ${FONT}`;
    const bw = Math.max(40, ctx.measureText(ext).width + 16);
    ctx.fillStyle = colorForExtension(info.extension || '');
    roundRect(ctx, pad, y, bw, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(ext, pad + 8, y + 11.5);
  }
  y += isFolder ? 46 : 34;

  ctx.textBaseline = 'top';
  ctx.fillStyle = '#20242b';
  ctx.font = `650 15px ${FONT}`;
  for (const line of wrapText(ctx, info.name || 'Untitled', W - pad * 2, 3)) {
    ctx.fillText(line, pad, y);
    y += 19;
  }
  ctx.font = `400 10px ${FONT}`;
  ctx.fillStyle = '#6b6f76';
  const meta = isFolder ? describeContents(info.contents) : formatBytes(info.size);
  ctx.fillText(meta, pad, y + 3);
  y += 22;
  ctx.fillStyle = isFolder ? 'rgba(120,80,20,0.25)' : 'rgba(30,40,60,0.12)';
  ctx.fillRect(pad, y, W - pad * 2, 1);
  y += 12;

  const ink = isFolder ? 'rgba(110,75,25,0.22)' : 'rgba(40,50,70,0.16)';
  if (!isFolder && /^(png|jpe?g|gif|webp|svg|bmp|heic)$/.test(info.extension || '')) {
    // A little picture placeholder for image files.
    ctx.fillStyle = 'rgba(140,79,209,0.12)';
    roundRect(ctx, pad, y, W - pad * 2, 80, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,79,209,0.35)';
    ctx.beginPath();
    ctx.moveTo(pad + 18, y + 68);
    ctx.lineTo(pad + 70, y + 22);
    ctx.lineTo(pad + 110, y + 60);
    ctx.lineTo(pad + 135, y + 40);
    ctx.lineTo(W - pad - 18, y + 68);
    ctx.fill();
    y += 96;
  }
  textLines(ctx, pad, y, W - pad * 2, H - 28, rand, ink);

  if (!isFolder) {
    // Dog-eared corner.
    const d = 24;
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.moveTo(W - d - 3, 0);
    ctx.lineTo(W, d + 3);
    ctx.lineTo(W, 0);
    ctx.fill();
    ctx.fillStyle = '#e9e6dc';
    ctx.beginPath();
    ctx.moveTo(W - d, 0);
    ctx.lineTo(W - d, d);
    ctx.lineTo(W, d);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // ---------- back ----------
  const { canvas: back, ctx: bctx } = makeCanvas(W, H);
  bctx.fillStyle = backColor;
  bctx.fillRect(0, 0, W, H);
  grain(bctx, W, H, rand, 0.05);
  // Faint show-through of the printed side.
  bctx.globalAlpha = 0.25;
  bctx.save();
  bctx.translate(W, 0);
  bctx.scale(-1, 1);
  textLines(bctx, pad, 120, W - pad * 2, H - 28, mulberry32(7), ink);
  bctx.restore();
  bctx.globalAlpha = 1;

  return { front, back, width: W, height: H };
}
