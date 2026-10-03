/** @jest-environment node */
import { EventEmitter } from 'events';
import type { MacAPI } from '../../../shared/macos';

describe('actual frozen macOS preload bridge', () => {
  let api: MacAPI;
  let ipc: EventEmitter & { invoke: jest.Mock };
  let exposeInMainWorld: jest.Mock;
  beforeEach(() => {
    jest.resetModules();
    ipc = Object.assign(new EventEmitter(), {
      invoke: jest.fn().mockResolvedValue({ ok: true }),
    });
    exposeInMainWorld = jest.fn((_name: string, exposed: MacAPI) => {
      api = exposed;
    });
    jest.doMock('electron', () => ({
      ipcRenderer: ipc,
      contextBridge: { exposeInMainWorld },
    }));
    jest.isolateModules(() => {
      jest.requireActual('../preload');
    });
  });

  it('exposes only eight fixed methods and no generic IPC primitive', () => {
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld).toHaveBeenCalledWith('mac', api);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api).sort()).toEqual([
      'chooseLibrary',
      'getStatus',
      'installDolphin',
      'onRefreshStatus',
      'playGame',
      'recoverLibrarySettings',
      'resetDolphin',
      'revealLibrary',
    ]);
  });

  it.each([
    ['getStatus', 'mac:status'],
    ['chooseLibrary', 'mac:choose-library'],
    ['revealLibrary', 'mac:reveal-library'],
    ['installDolphin', 'mac:install-dolphin'],
    ['playGame', 'mac:play-game'],
    ['resetDolphin', 'mac:reset-dolphin'],
    ['recoverLibrarySettings', 'mac:recover-library-settings'],
  ])('does not forward renderer arguments from %s', async (method, channel) => {
    const call = api[method as Exclude<keyof MacAPI, 'onRefreshStatus'>] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await call({ command: 'untrusted', path: '/other' }, 'other-channel');
    expect(ipc.invoke).toHaveBeenCalledTimes(1);
    expect(ipc.invoke).toHaveBeenCalledWith(channel);
  });

  it.each([null, undefined, 'callback', 1, {}, []])(
    'rejects a nonfunction refresh subscriber: %p',
    (callback) => {
      expect(() => api.onRefreshStatus(callback as never)).toThrow(TypeError);
      expect(ipc.listenerCount('mac:refresh-status')).toBe(0);
    },
  );

  it('strips the Electron event and data, and cleanup removes only its own listener', () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribe = api.onRefreshStatus(first);
    const unsubscribeSecond = api.onRefreshStatus(second);
    expect(ipc.listenerCount('mac:refresh-status')).toBe(2);
    ipc.emit('unrelated-channel', { sender: ipc });
    expect(first).not.toHaveBeenCalled();
    ipc.emit('mac:refresh-status', { sender: ipc }, { path: '/other' });
    expect(first).toHaveBeenCalledWith();
    expect(second).toHaveBeenCalledWith();
    unsubscribe();
    unsubscribe();
    expect(ipc.listenerCount('mac:refresh-status')).toBe(1);
    ipc.emit('mac:refresh-status');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
    expect(ipc.listenerCount('mac:refresh-status')).toBe(0);
    expect(ipc.invoke).not.toHaveBeenCalled();
  });
});
