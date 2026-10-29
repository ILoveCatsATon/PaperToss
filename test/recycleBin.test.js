'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStats, createRecycleBinStats } = require('../src/main/recycleBin');

test('parses the Recycle Bin query output', () => {
  assert.deepEqual(parseStats('0 12 345678\r\n'), { ok: true, items: 12, bytes: 345678 });
  assert.deepEqual(parseStats('0 0 0'), { ok: true, items: 0, bytes: 0 });
});

test('a failed or garbled query is reported, not guessed', () => {
  assert.equal(parseStats('-2147024809 0 0').ok, false);
  assert.equal(parseStats('').ok, false);
  assert.equal(parseStats('Add-Type : error').ok, false);
});

test('non-Windows platforms report unsupported without running anything', async () => {
  let ran = false;
  const stats = createRecycleBinStats({ platform: 'linux', run: () => { ran = true; } });
  assert.deepEqual(await stats.query(), { ok: false, code: 'unsupported' });
  assert.equal(ran, false);
});

test('overlapping queries share one PowerShell run', async () => {
  let runs = 0;
  const stats = createRecycleBinStats({
    platform: 'win32',
    run: (_cmd, _args, _opts, cb) => {
      runs += 1;
      setTimeout(() => cb(null, '0 3 900'), 10);
    },
  });
  const [a, b] = await Promise.all([stats.query(), stats.query()]);
  assert.equal(runs, 1);
  assert.deepEqual(a, { ok: true, items: 3, bytes: 900 });
  assert.deepEqual(b, a);
});
