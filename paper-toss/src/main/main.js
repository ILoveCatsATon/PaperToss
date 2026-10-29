'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { createFileOps } = require('./fileOps');

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

function trashLabel() {
  return process.platform === 'win32' ? 'Recycle Bin' : 'Trash';
}

function registerIpc() {
  ipcMain.handle('app:info', () => ({ platform: process.platform, trashName: trashLabel(), demo: false }));

  ipcMain.handle('fs:pick', async (_event, kind) => {
    const isFolder = kind === 'directory';
    const result = await dialog.showOpenDialog(mainWindow, {
      title: isFolder ? 'Choose folders to throw away' : 'Choose files to throw away',
      buttonLabel: 'Pick',
      properties: [isFolder ? 'openDirectory' : 'openFile', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, code: 'cancelled' };
    return fileOps.selectMany(result.filePaths);
  });

  // Used for drag-and-drop onto the window. Paths are validated and
  // inspected here; the user still has to confirm before anything happens.
  ipcMain.handle('fs:select-paths', (_event, targets) => fileOps.selectMany(Array.isArray(targets) ? targets : []));

  ipcMain.handle('fs:release', (_event, token) => fileOps.release(token));

  ipcMain.handle('fs:trash', (_event, token) => fileOps.trash(token));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
