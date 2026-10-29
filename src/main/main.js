'use strict';

const path = require('node:path');
const { app, BrowserWindow, shell } = require('electron');
const { createFileOps } = require('./fileOps');
const { createRecycleBinStats } = require('./recycleBin');
const { registerIpc } = require('./ipc');

const fileOps = createFileOps({
  trashItem: (target) => shell.trashItem(target),
  appPaths: [app.getAppPath(), path.dirname(process.execPath)],
});

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#e9e4da',
    title: 'Paper Toss',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // The window is a closed toy: no navigation, no popups.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpc({ fileOps, binStats: createRecycleBinStats(), getWindow: () => mainWindow });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
