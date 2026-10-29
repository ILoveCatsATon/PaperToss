'use strict';

// End-to-end smoke test, run with Electron:  npx electron scripts/smoke.js
//  1. boots the real renderer (sandboxed, with the preload bridge) hidden
//  2. moves one throwaway temp file to the real Recycle Bin / Trash through
//     the same fileOps code the app uses, and checks its neighbour survived.
// Results are written to smoke-result.json next to this script.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { createFileOps } = require('../src/main/fileOps');

const out = path.join(__dirname, 'smoke-result.json');

app.whenReady().then(async () => {
  const results = { ok: false };
  try {
    ipcMain.handle('app:info', () => ({ platform: process.platform, trashName: 'Recycle Bin', demo: false }));
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const errors = [];
    win.webContents.on('console-message', (event, level, message) => {
      const lvl = event.level ?? level;
      const msg = event.message ?? message;
      if (lvl === 'error' || lvl === 3) errors.push(msg);
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 1500));
    results.renderer = await win.webContents.executeJavaScript(`({
      bridge: typeof window.paperToss === 'object',
      bridgeKeys: Object.keys(window.paperToss || {}),
      nodeLeaked: typeof require !== 'undefined' || typeof process !== 'undefined',
      started: !!window.__paperToss,
      state: window.__paperToss && window.__paperToss.state,
      demo: window.__paperToss && window.__paperToss.files.demo,
      dockVisible: !document.getElementById('dock').hidden,
      pickButton: document.getElementById('pick-files').innerText.trim(),
    })`);
    results.rendererErrors = errors;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-toss-smoke-'));
    const file = path.join(dir, 'paper-toss smoke test (safe to delete) #1 & ü.txt');
    const neighbour = path.join(dir, 'neighbour.txt');
    fs.writeFileSync(file, 'This file was moved to the Recycle Bin by the Paper Toss smoke test.');
    fs.writeFileSync(neighbour, 'keep');
    const ops = createFileOps({ trashItem: (p) => shell.trashItem(p), appPaths: [app.getAppPath()] });
    // Pick both (like a multi-select), throw only the first one away.
    const batch = await ops.selectMany([file, neighbour]);
    const trash = await ops.trash(batch.items[0].token);
    results.trash = { selected: batch.ok && batch.items.every((i) => i.ok), result: trash, fileGone: !fs.existsSync(file), neighbourKept: fs.existsSync(neighbour) };
    fs.rmSync(dir, { recursive: true, force: true });

    results.ok =
      results.renderer.bridge && !results.renderer.nodeLeaked && results.renderer.started &&
      results.renderer.demo === false && results.renderer.dockVisible && errors.length === 0 &&
      trash.ok && results.trash.fileGone && results.trash.neighbourKept;
  } catch (err) {
    results.error = String(err && err.stack ? err.stack : err);
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  app.exit(results.ok ? 0 : 1);
});
