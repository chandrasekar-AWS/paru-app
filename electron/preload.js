const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('paru', {
  platform: process.platform,
  win: a => ipcRenderer.send('win', a),
  setAutostart: v => ipcRenderer.send('autostart', !!v),
});
