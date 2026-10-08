import { contextBridge, ipcRenderer } from 'electron';
import type { MacAPI, PinnedEmulatorID } from '../../shared/macos';

const api: MacAPI = Object.freeze({
  installDolphin: () => ipcRenderer.invoke('mac:install-dolphin'),
  playGame: () => ipcRenderer.invoke('mac:play-game'),
  resetDolphin: () => ipcRenderer.invoke('mac:reset-dolphin'),
  recoverLibrarySettings: () =>
    ipcRenderer.invoke('mac:recover-library-settings'),
  installConsole: () => ipcRenderer.invoke('mac:install-console'),
  enterConsole: () => ipcRenderer.invoke('mac:enter-console'),
  getControllers: () => ipcRenderer.invoke('mac:controllers'),
  // The single forwarded value is re-validated against fixed literals in main.
  setStickResponse: (value: 'standard' | 'precise') =>
    ipcRenderer.invoke('mac:set-stick-response', value),
  useRecommendedControls: () =>
    ipcRenderer.invoke('mac:use-recommended-controls'),
  // Single forwarded emulator id; main accepts only fixed literals.
  installEmulator: (id: PinnedEmulatorID) =>
    ipcRenderer.invoke('mac:install-emulator', id),
  playEmulator: (id: PinnedEmulatorID) =>
    ipcRenderer.invoke('mac:play-emulator', id),
  getLibraryOverview: () => ipcRenderer.invoke('mac:library-overview'),
  exportDiagnostics: () => ipcRenderer.invoke('mac:export-diagnostics'),
  // Single forwarded ids; main accepts only ids its components declare.
  addFirmware: (id: string) => ipcRenderer.invoke('mac:add-firmware', id),
  revealSystem: (id: string) => ipcRenderer.invoke('mac:reveal-system', id),
  getSaves: () => ipcRenderer.invoke('mac:saves'),
  // Single forwarded ids; main accepts only its emulators and existing backups.
  backUpSaves: (emulator: string) =>
    ipcRenderer.invoke('mac:back-up-saves', emulator),
  restoreSaves: (target: string) =>
    ipcRenderer.invoke('mac:restore-saves', target),
  revealSaves: (emulator: string) =>
    ipcRenderer.invoke('mac:reveal-saves', emulator),
  checkLibrary: () => ipcRenderer.invoke('mac:check-library'),
  // Single forwarded issue id; main accepts only ids from its own last check.
  fixLibraryIssue: (id: string) =>
    ipcRenderer.invoke('mac:fix-library-issue', id),
  revealLibraryIssue: (id: string) =>
    ipcRenderer.invoke('mac:reveal-library-issue', id),
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
