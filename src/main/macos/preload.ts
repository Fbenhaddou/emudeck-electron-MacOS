import { contextBridge, ipcRenderer } from 'electron';
import type { MacAPI } from '../../shared/macos';

const api: MacAPI = Object.freeze({
  installDolphin: () => ipcRenderer.invoke('mac:install-dolphin'),
  playGame: () => ipcRenderer.invoke('mac:play-game'),
  resetDolphin: () => ipcRenderer.invoke('mac:reset-dolphin'),
  recoverLibrarySettings: () =>
    ipcRenderer.invoke('mac:recover-library-settings'),
  getStatus: () => ipcRenderer.invoke('mac:status'),
  onRefreshStatus: (callback: () => void) => {
    if (typeof callback !== 'function')
      throw new TypeError('Refresh status callback must be a function.');
    // Do not expose Electron's event or any payload to the renderer.
    const listener = () => callback();
    ipcRenderer.on('mac:refresh-status', listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      ipcRenderer.removeListener('mac:refresh-status', listener);
    };
  },
  chooseLibrary: () => ipcRenderer.invoke('mac:choose-library'),
  revealLibrary: () => ipcRenderer.invoke('mac:reveal-library'),
});

contextBridge.exposeInMainWorld('mac', api);
