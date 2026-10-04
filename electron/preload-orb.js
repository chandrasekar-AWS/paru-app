const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('paruOrb', {
  visible: v => ipcRenderer.send('orb-visible', !!v),
  size: (px, enabled) => ipcRenderer.send('orb-size', px, enabled !== false),
});
