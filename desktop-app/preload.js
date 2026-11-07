// desktop-app/preload.js — Secure Bridge for Connection UI
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ragDesktop', {
  getHubUrl: () => ipcRenderer.invoke('get-hub-url'),
  setHubUrl: (url) => ipcRenderer.invoke('set-hub-url', url),
  checkConnection: (url) => ipcRenderer.invoke('check-connection', url),
  connectToHub: (url) => ipcRenderer.invoke('connect-to-hub', url)
});

