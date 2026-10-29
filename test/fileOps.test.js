'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileOps, classifySystemError } = require('../src/main/fileOps');

let dir;
let binDir;
let trashCalls;

/** A fake Recycle Bin: moves the item into binDir, like the real thing would. */
function fakeTrash(target) {
  trashCalls.push(target);
  fs.renameSync(target, path.join(binDir, `${Date.now()}-${path.basename(target)}`));
  return Promise.resolve();
}

function ops(overrides = {}) {
  return createFileOps({ trashItem: fakeTrash, ...overrides });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-toss-test-'));
  binDir = path.join(dir, '__bin');
  fs.mkdirSync(binDir);
  trashCalls = [];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('selects a file with special characters and trashes exactly that path', async () => {
  const name = 'weird name #1 & (copy) [ü] 💥 %20.txt';
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'hello');
  const neighbour = path.join(dir, 'weird name #1 & (copy) [ü] 💥 %20.txt.bak');
  fs.writeFileSync(neighbour, 'keep me');

  const o = ops();
  const sel = await o.select(file);
  assert.equal(sel.ok, true);
  assert.equal(sel.info.name, name);
  assert.equal(sel.info.kind, 'file');
  assert.equal(sel.info.size, 5);
  assert.equal(sel.info.extension, 'txt');

  const res = await o.trash(sel.token);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(trashCalls, [path.resolve(file)]);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readFileSync(neighbour, 'utf8'), 'keep me');
});

test('tokens are single use', async () => {
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');
  const o = ops();
  const sel = await o.select(file);
  assert.equal((await o.trash(sel.token)).ok, true);
  const again = await o.trash(sel.token);
  assert.equal(again.ok, false);
  assert.equal(again.code, 'stale-selection');
  assert.equal(trashCalls.length, 1);
});

test('unknown, released or superseded tokens never trash anything', async () => {
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  fs.writeFileSync(a, 'a');
  fs.writeFileSync(b, 'b');
  const o = ops();

  assert.equal((await o.trash('not-a-token')).code, 'stale-selection');
  assert.equal((await o.trash(undefined)).code, 'stale-selection');

  const selA = await o.select(a);
  o.release(selA.token);
  assert.equal((await o.trash(selA.token)).code, 'stale-selection');

  const selA2 = await o.select(a);
  await o.select(b); // picking something else invalidates the earlier pick
  assert.equal((await o.trash(selA2.token)).code, 'stale-selection');

  assert.equal(trashCalls.length, 0);
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
});

test('a file deleted after selection is reported missing, nothing is trashed', async () => {
  const file = path.join(dir, 'gone.txt');
  fs.writeFileSync(file, 'x');
  const o = ops();
  const sel = await o.select(file);
  fs.unlinkSync(file);
  const res = await o.trash(sel.token);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'missing');
  assert.equal(trashCalls.length, 0);
});

test('a different file put at the same path is left alone', async () => {
  const file = path.join(dir, 'swap.txt');
  fs.writeFileSync(file, 'original');
  const o = ops();
  const sel = await o.select(file);
  // Replace the file with a new one (new file id) at the same path.
  fs.renameSync(file, path.join(dir, 'moved-away.txt'));
  fs.writeFileSync(file, 'impostor');
  const res = await o.trash(sel.token);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'changed');
  assert.equal(trashCalls.length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'impostor');
});

test('a folder replaced by a file of the same name is left alone', async () => {
  const target = path.join(dir, 'thing');
  fs.mkdirSync(target);
  const o = ops();
  const sel = await o.select(target);
  fs.rmdirSync(target);
  fs.writeFileSync(target, 'now a file');
  const res = await o.trash(sel.token);
  assert.equal(res.code, 'changed');
  assert.equal(trashCalls.length, 0);
});

test('folders are summarised and trashed as a whole', async () => {
  const folder = path.join(dir, 'My Folder (old)');
  fs.mkdirSync(path.join(folder, 'sub', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'one.txt'), '12345');
  fs.writeFileSync(path.join(folder, 'sub', 'two.txt'), '123');
  fs.writeFileSync(path.join(folder, 'sub', 'deeper', 'three.bin'), Buffer.alloc(10));
  const o = ops();
  const sel = await o.select(folder);
  assert.equal(sel.ok, true);
  assert.equal(sel.info.kind, 'directory');
  assert.deepEqual(
    { files: sel.info.contents.files, folders: sel.info.contents.folders, bytes: sel.info.contents.bytes, truncated: sel.info.contents.truncated },
    { files: 3, folders: 2, bytes: 18, truncated: false },
  );
  const res = await o.trash(sel.token);
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'directory');
  assert.equal(fs.existsSync(folder), false);
});

test('protected locations are refused at selection time', async () => {
  const o = createFileOps({
    trashItem: fakeTrash,
    platform: 'win32',
    homedir: 'C:\\Users\\Someone',
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramData: 'C:\\ProgramData' },
    appPaths: ['C:\\Apps\\PaperToss'],
  });
  for (const p of [
    'C:\\',
    'D:\\',
    'C:\\Users',
    'C:\\Users\\Someone',
    'c:\\users\\someone\\',
    'C:\\Windows',
    'C:\\Windows\\System32\\drivers',
    'C:\\Program Files\\Thing',
    'C:\\Apps\\PaperToss\\resources',
  ]) {
    const res = await o.select(p);
    assert.equal(res.code, 'protected', `${p} should be protected`);
  }
  assert.equal(trashCalls.length, 0);
});

test('invalid paths are refused', async () => {
  const o = ops();
  for (const p of ['', 'relative\\file.txt', './file.txt', 'C:\\bad\0name.txt', null, 42, { path: 'x' }, '\\\\?\\C:\\file.txt']) {
    const res = await o.select(p);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'invalid-path', `${String(p)} should be invalid`);
  }
});

test('selecting a missing path reports missing', async () => {
  const res = await ops().select(path.join(dir, 'nope.txt'));
  assert.equal(res.code, 'missing');
});

test('OS trash errors are mapped to friendly codes and nothing else happens', async () => {
  const cases = [
    [new Error('The process cannot access the file because it is being used by another process.'), 'locked'],
    [Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }), 'permission'],
    [new Error('Access is denied.'), 'permission'],
    [new Error('Failed to move item to trash; it would be permanently deleted'), 'too-large'],
    [new Error('Something odd'), 'trash-failed'],
  ];
  for (const [err, code] of cases) {
    const file = path.join(dir, `f-${code}.txt`);
    fs.writeFileSync(file, 'x');
    const o = ops({ trashItem: () => Promise.reject(err) });
    const sel = await o.select(file);
    const res = await o.trash(sel.token);
    assert.equal(res.ok, false);
    assert.equal(res.code, code, err.message);
    assert.ok(res.message.includes('Nothing'), res.message);
    assert.ok(fs.existsSync(file));
  }
});

test('a trash call that "succeeds" but leaves the item in place is a failure', async () => {
  const file = path.join(dir, 'stubborn.txt');
  fs.writeFileSync(file, 'x');
  const o = ops({ trashItem: () => Promise.resolve() });
  const sel = await o.select(file);
  const res = await o.trash(sel.token);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'trash-failed');
});

test('symlinks are flagged and only the link is trashed', { skip: process.platform === 'win32' && 'symlinks need admin rights on Windows' }, async () => {
  const real = path.join(dir, 'real.txt');
  const link = path.join(dir, 'link.txt');
  fs.writeFileSync(real, 'x');
  fs.symlinkSync(real, link);
  const o = ops();
  const sel = await o.select(link);
  assert.equal(sel.info.kind, 'symlink');
  assert.ok(sel.info.warnings.some((w) => /link/i.test(w)));
  assert.equal((await o.trash(sel.token)).ok, true);
  assert.ok(fs.existsSync(real));
});

test('classifySystemError covers errno codes', () => {
  assert.equal(classifySystemError({ code: 'ENOENT' }), 'missing');
  assert.equal(classifySystemError({ code: 'EBUSY' }), 'locked');
  assert.equal(classifySystemError({ code: 'EACCES' }), 'permission');
  assert.equal(classifySystemError(null), 'unknown');
});

test('selectMany issues one token per item and trashes each independently', async () => {
  const files = ['one.txt', 'two (copy).txt', 'three #3.md'].map((n) => path.join(dir, n));
  files.forEach((f) => fs.writeFileSync(f, 'x'));
  const o = ops();
  const res = await o.selectMany(files);
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 3);
  assert.ok(res.items.every((i) => i.ok && typeof i.token === 'string'));
  assert.equal(new Set(res.items.map((i) => i.token)).size, 3);

  assert.equal((await o.trash(res.items[1].token)).ok, true);
  assert.deepEqual(trashCalls, [path.resolve(files[1])]);
  assert.ok(fs.existsSync(files[0]) && fs.existsSync(files[2]));
  // The other tokens are still usable.
  assert.equal((await o.trash(res.items[0].token)).ok, true);
});

test('selectMany reports bad items without blocking good ones, and dedupes', async () => {
  const good = path.join(dir, 'good.txt');
  fs.writeFileSync(good, 'x');
  const res = await ops().selectMany([good, good, path.join(dir, 'missing.txt'), 'relative.txt']);
  assert.equal(res.ok, true);
  assert.equal(res.items.length, 3);
  assert.equal(res.items[0].ok, true);
  assert.equal(res.items[1].code, 'missing');
  assert.equal(res.items[2].code, 'invalid-path');
});

test('items inside a picked folder are skipped (they go with the folder)', async () => {
  const folder = path.join(dir, 'outer');
  const inner = path.join(folder, 'inner.txt');
  fs.mkdirSync(folder);
  fs.writeFileSync(inner, 'x');
  const res = await ops().selectMany([inner, folder]);
  assert.equal(res.items[0].ok, false);
  assert.equal(res.items[0].code, 'nested');
  assert.equal(res.items[1].ok, true);
});

test('a new batch invalidates every token from the previous batch', async () => {
  const a = path.join(dir, 'a.txt');
  const b = path.join(dir, 'b.txt');
  fs.writeFileSync(a, 'a');
  fs.writeFileSync(b, 'b');
  const o = ops();
  const first = await o.selectMany([a, b]);
  await o.selectMany([b]);
  for (const item of first.items) assert.equal((await o.trash(item.token)).code, 'stale-selection');
  assert.equal(trashCalls.length, 0);
});

test('selectMany refuses empty and oversized batches', async () => {
  const o = ops();
  assert.equal((await o.selectMany([])).ok, false);
  assert.equal((await o.selectMany('not-an-array')).ok, false);
  const many = Array.from({ length: 26 }, (_, i) => path.join(dir, `f${i}.txt`));
  const res = await o.selectMany(many);
  assert.equal(res.code, 'too-many');
});
