'use strict';

// IPC handlers between the sandboxed UI and the main process. Kept in one
// place so the app and the end-to-end smoke test use exactly the same code.

const { dialog, ipcMain } = require('electron');

function trashLabel() {
  return process.platform === 'win32' ? 'Recycle Bin' : 'Trash';
}

/**
 * @param {{ fileOps: object, binStats: { query: () => Promise<object> }, getWindow: () => Electron.BrowserWindow | null }} deps
 */
function registerIpc({ fileOps, binStats, getWindow }) {
  ipcMain.handle('app:info', () => ({ platform: process.platform, trashName: trashLabel(), demo: false }));

  ipcMain.handle('fs:pick', async (_event, kind) => {
    const isFolder = kind === 'directory';
    const result = await dialog.showOpenDialog(getWindow(), {
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

  // Read-only: how full the OS Recycle Bin is (for the on-screen bin's pile).
  ipcMain.handle('bin:stats', () => binStats.query());
}

module.exports = { registerIpc };
