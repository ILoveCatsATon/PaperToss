'use strict';

// Narrow bridge between the sandboxed UI and the main process.
// The UI can pick items and ask for a *token* to be trashed; it never
// gets a generic "delete this path" capability.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('paperToss', {
  info: () => ipcRenderer.invoke('app:info'),
  pick: (kind) => ipcRenderer.invoke('fs:pick', kind === 'directory' ? 'directory' : 'file'),
  selectDropped: (files) => {
    const paths = Array.from(files || [], (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    });
    return ipcRenderer.invoke('fs:select-paths', paths);
  },
  release: (token) => ipcRenderer.invoke('fs:release', String(token)),
  trash: (token) => ipcRenderer.invoke('fs:trash', String(token)),
});
