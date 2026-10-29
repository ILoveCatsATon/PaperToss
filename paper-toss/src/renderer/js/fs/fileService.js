// The renderer's only door to the filesystem.
//
// In the desktop app this wraps the preload bridge (window.paperToss),
// which works with opaque single-use tokens. Opened in a plain browser
// it falls back to a demo service that never touches real files.
//
// pick()/selectDropped() resolve to
//   { ok: true, items: [{ ok: true, token, info } | { ok: false, code, message, name, path }] }
//   or { ok: false, code, message }   (code 'cancelled' when the dialog was closed)

export async function createFileService() {
  const bridge = window.paperToss;
  if (bridge) {
    const info = await bridge.info();
    return {
      demo: false,
      trashName: info.trashName,
      pick: (kind) => bridge.pick(kind),
      selectDropped: (files) => bridge.selectDropped(files),
      release: (token) => bridge.release(token),
      trash: (token) => bridge.trash(token),
    };
  }
  return createDemoService();
}

const DEMO_FILES = [
  { name: 'Quarterly report FINAL (2) — really final.docx', kind: 'file', extension: 'docx', size: 482_113 },
  { name: 'meeting-notes_2019 #draft & ideas.txt', kind: 'file', extension: 'txt', size: 3_204 },
  { name: 'IMG_4031 (copy).jpeg', kind: 'file', extension: 'jpeg', size: 5_870_221 },
];
const DEMO_FOLDERS = [
  { name: 'Old screenshots', kind: 'directory', contents: { files: 214, folders: 6, bytes: 389_220_118, truncated: false, unreadable: 0 } },
];

function createDemoService() {
  const live = new Map();

  const register = (bases) => {
    live.clear();
    const items = bases.map((base) => {
      const token = `demo-${Math.random().toString(36).slice(2)}`;
      const info = {
        path: `C:\\Users\\you\\Documents\\${base.name}`,
        parent: 'C:\\Users\\you\\Documents',
        modified: Date.now() - 1000 * 60 * 60 * 24 * 90,
        created: Date.now() - 1000 * 60 * 60 * 24 * 400,
        extension: '',
        contents: null,
        warnings: [],
        size: 0,
        ...base,
      };
      if (info.kind === 'directory') info.size = info.contents.bytes;
      live.set(token, info);
      return { ok: true, token, info };
    });
    return { ok: true, items };
  };

  return {
    demo: true,
    trashName: 'Recycle Bin',
    async pick(kind) {
      return register(kind === 'directory' ? DEMO_FOLDERS : DEMO_FILES);
    },
    async selectDropped(files) {
      return register(Array.from(files, (file) => {
        const hasExt = file.name.includes('.');
        return { name: file.name, kind: 'file', extension: hasExt ? file.name.split('.').pop().toLowerCase() : '', size: file.size, modified: file.lastModified };
      }));
    },
    async release(token) {
      live.delete(token);
      return { ok: true };
    },
    async trash(token) {
      await new Promise((r) => setTimeout(r, 400));
      const info = live.get(token);
      live.delete(token);
      if (!info) return { ok: false, code: 'stale-selection', message: 'This selection has expired. Please pick the item again.' };
      return { ok: true, name: info.name, kind: info.kind };
    },
  };
}
