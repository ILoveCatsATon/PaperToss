// Trash-can skins. Each skin is a little bit of data: a base colour, a
// finish (metal / gloss / matte), rim, lid and interior colours, and an
// optional decoration drawn on the body. `resolveSkin` turns that into the
// concrete gradient stops the renderer uses, so adding a skin is one entry.

export const SKINS = [
  { id: 'steel', name: 'Steel', base: '#b7bfc7', finish: 'metal', rim: '#eef1f3', lid: '#cfd6db', interior: '#22272e', pedal: '#353b43', deco: 'ridges' },
  { id: 'fire', name: 'Fire Red', base: '#d8452f', finish: 'gloss', rim: '#f7f2ee', lid: '#e0533c', interior: '#2a1c1a', pedal: '#2b2b2b', deco: 'none' },
  { id: 'mint', name: 'Mint', base: '#86cfb0', finish: 'matte', rim: '#f6fffb', lid: '#a3dfc5', interior: '#1d3a2f', pedal: '#2f4b40', deco: 'band', decoColor: '#ffffff' },
  { id: 'gold', name: 'Gold', base: '#d6a933', finish: 'metal', rim: '#fff0b3', lid: '#e6c257', interior: '#3a2a10', pedal: '#5a4318', deco: 'ridges' },
  { id: 'wood', name: 'Wood', base: '#a5713f', finish: 'matte', rim: '#5e3c20', lid: '#8b5b31', interior: '#2a1a0e', pedal: '#3b2615', deco: 'slats', decoColor: '#3b2615' },
  { id: 'midnight', name: 'Midnight', base: '#2a2f3b', finish: 'gloss', rim: '#7cf3ff', lid: '#363c4a', interior: '#0b0d12', pedal: '#14171d', deco: 'band', decoColor: '#7cf3ff', neon: true },
  { id: 'polka', name: 'Polka', base: '#fbf5ea', finish: 'matte', rim: '#e2553d', lid: '#f2e9da', interior: '#2c2622', pedal: '#c9472f', deco: 'dots', decoColor: '#e2553d' },
  { id: 'recycle', name: 'Recycling', base: '#3e9b5a', finish: 'gloss', rim: '#e9f7ee', lid: '#4caf6b', interior: '#10261a', pedal: '#1f4a2d', deco: 'symbol', decoColor: '#ffffff' },
];

export const DEFAULT_SKIN = 'steel';

export function getSkin(id) {
  return SKINS.find((s) => s.id === id) || SKINS.find((s) => s.id === DEFAULT_SKIN);
}

function toRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix two hex colours; t = 0 → a, t = 1 → b. */
export function mix(a, b, t) {
  const x = toRgb(a);
  const y = toRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const dark = (c, t) => mix(c, '#000000', t);
const light = (c, t) => mix(c, '#ffffff', t);

/** Concrete colours for the renderer. */
export function resolveSkin(skin) {
  const b = skin.base;
  let body;
  if (skin.finish === 'metal') {
    body = [[0, dark(b, 0.42)], [0.12, light(b, 0.25)], [0.3, light(b, 0.8)], [0.42, light(b, 0.4)], [0.7, dark(b, 0.15)], [0.88, light(b, 0.15)], [1, dark(b, 0.45)]];
  } else if (skin.finish === 'gloss') {
    body = [[0, dark(b, 0.45)], [0.2, b], [0.29, light(b, 0.5)], [0.34, light(b, 0.65)], [0.4, b], [0.78, dark(b, 0.15)], [1, dark(b, 0.5)]];
  } else {
    body = [[0, dark(b, 0.32)], [0.3, light(b, 0.12)], [0.55, b], [0.85, dark(b, 0.12)], [1, dark(b, 0.38)]];
  }
  return {
    ...skin,
    body,
    ridgeLight: skin.finish === 'metal' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
    ridgeDark: skin.finish === 'metal' ? 'rgba(40,40,40,0.16)' : 'rgba(0,0,0,0.06)',
    rimBack: dark(skin.rim, 0.25),
    interior: [light(skin.interior, 0.2), skin.interior, dark(skin.interior, 0.6)],
    lidTop: [light(skin.lid, 0.6), skin.lid, dark(skin.lid, 0.28)],
    lidUnder: [dark(skin.lid, 0.3), dark(skin.lid, 0.5)],
    lidEdge: dark(skin.lid, 0.45),
    hinge: dark(skin.lid, 0.6),
    shine: skin.finish === 'matte' ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.45)',
  };
}
