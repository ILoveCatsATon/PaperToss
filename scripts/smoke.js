'use strict';

// End-to-end smoke test, run with Electron:  npm run smoke
//
// Boots the real renderer (sandboxed, with the real preload and the real IPC
// handlers), then pushes one throwaway temp file all the way through the
// app's own trash path:
//   renderer App._performTrash → preload → IPC → fileOps → shell.trashItem
// and checks that the file is gone, its neighbour survived, and that the
// on-screen bin's Recycle Bin count went up.
// Results are written to smoke-result.json next to this script.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');
const { createFileOps } = require('../src/main/fileOps');
const { createRecycleBinStats } = require('../src/main/recycleBin');
const { registerIpc } = require('../src/main/ipc');

const out = path.join(__dirname, 'smoke-result.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const results = { ok: false };
  let win = null;
  try {
    const fileOps = createFileOps({ trashItem: (p) => shell.trashItem(p), appPaths: [app.getAppPath()] });
    const binStats = createRecycleBinStats();
    registerIpc({ fileOps, binStats, getWindow: () => win });

    win = new BrowserWindow({
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
    await wait(2500); // let the first Recycle Bin query finish

    const js = (code) => win.webContents.executeJavaScript(code);
    results.renderer = await js(`({
      bridgeKeys: Object.keys(window.paperToss || {}),
      nodeLeaked: typeof require !== 'undefined' || typeof process !== 'undefined',
      started: !!window.__paperToss,
      demo: window.__paperToss && window.__paperToss.files.demo,
      dockVisible: !document.getElementById('dock').hidden,
      binBefore: window.__paperToss && window.__paperToss.binStats,
    })`);

    // A throwaway file, picked like the dialog would, next to one that must survive.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-toss-smoke-'));
    const file = path.join(dir, 'paper-toss smoke test (safe to delete) #1 & ü.txt');
    const neighbour = path.join(dir, 'neighbour.txt');
    fs.writeFileSync(file, 'This file was moved to the Recycle Bin by the Paper Toss smoke test.');
    fs.writeFileSync(neighbour, 'keep');
    const batch = await fileOps.selectMany([file, neighbour]);
    const item = batch.items[0];

    // Pretend the ball just landed: run the app's real trash step.
    results.appTrash = await js(`(async () => {
      const app = window.__paperToss;
      app.queue = [{ token: ${JSON.stringify(item.token)}, info: ${JSON.stringify(item.info)}, outcome: null, message: '' }];
      app.index = 0;
      app.flight = { touchedLid: false, touchedRim: false, touchedCan: false, bounces: 0 };
      app.state = 'scoring';
      await app._performTrash(app.session);
      return { outcome: app.queue[0].outcome, message: app.queue[0].message, state: app.state };
    })()`);
    results.fileGone = !fs.existsSync(file);
    results.neighbourKept = fs.existsSync(neighbour);
    fs.rmSync(dir, { recursive: true, force: true });

    await wait(2500); // the app re-reads the Recycle Bin after a success
    results.binAfter = await js('window.__paperToss.binStats');
    results.binQuery = await binStats.query();
    results.rendererErrors = errors;

    const before = results.renderer.binBefore ? results.renderer.binBefore.items : 0;
    results.ok =
      results.renderer.started && !results.renderer.nodeLeaked && results.renderer.demo === false &&
      results.renderer.dockVisible && errors.length === 0 &&
      results.appTrash.outcome === 'trashed' && results.fileGone && results.neighbourKept &&
      results.binQuery.ok && results.binAfter.items >= before + 1;
  } catch (err) {
    results.error = String(err && err.stack ? err.stack : err);
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  app.exit(results.ok ? 0 : 1);
});
