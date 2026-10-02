import { contextBridge, ipcRenderer } from 'electron';
import type { MacAPI } from '../../shared/macos';

const api: MacAPI = Object.freeze({
  installDolphin: () => ipcRenderer.invoke('mac:install-dolphin'),
  playGame: () => ipcRenderer.invoke('mac:play-game'),
  resetDolphin: () => ipcRenderer.invoke('mac:reset-dolphin'),
  recoverLibrarySettings: () =>
    ipcRenderer.invoke('mac:recover-library-settings'),
  getStatus: () => ipcRenderer.invoke('mac:status'),
  chooseLibrary: () => ipcRenderer.invoke('mac:choose-library'),
  revealLibrary: () => ipcRenderer.invoke('mac:reveal-library'),
});

contextBridge.exposeInMainWorld('mac', api);
