import { contextBridge, ipcRenderer } from 'electron';
import type { MacAPI } from '../../shared/macos';

const api: MacAPI = Object.freeze({
  getStatus: () => ipcRenderer.invoke('mac:status'),
  chooseLibrary: () => ipcRenderer.invoke('mac:choose-library'),
  revealLibrary: () => ipcRenderer.invoke('mac:reveal-library'),
});

contextBridge.exposeInMainWorld('mac', api);
