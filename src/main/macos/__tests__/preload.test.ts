/** @jest-environment node */
import { EventEmitter } from 'events';
import type { MacAPI } from '../../../shared/macos';
import {
  bridgeComplete,
  bridgeMethodNames,
  bridgeMethods,
} from '../../../shared/macos-bridge';

const zeroArgument = bridgeMethodNames
  .filter((name) => bridgeMethods[name].argument === 'none')
  .map((name) => [name, bridgeMethods[name].channel]);
const oneArgument = bridgeMethodNames
  .filter((name) => bridgeMethods[name].argument === 'one')
  .map((name) => [
    name,
    bridgeMethods[name].channel,
    bridgeMethods[name].sample as string,
  ]);

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

  it('exposes exactly the manifest methods and no generic IPC primitive', () => {
    expect(bridgeComplete).toBe(true);
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld).toHaveBeenCalledWith('mac', api);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.keys(api).sort()).toEqual(bridgeMethodNames);
  });

  it('covers every manifest method with an argument rule test', () => {
    expect(
      zeroArgument.length +
        oneArgument.length +
        bridgeMethodNames.filter(
          (name) => bridgeMethods[name].argument === 'callback',
        ).length,
    ).toBe(bridgeMethodNames.length);
    expect(
      bridgeMethodNames.filter(
        (name) => bridgeMethods[name].argument === 'callback',
      ),
    ).toEqual(['onRefreshStatus']);
  });

  it.each(zeroArgument)(
    'does not forward renderer arguments from %s',
    async (method, channel) => {
      const call = api[method as Exclude<keyof MacAPI, 'onRefreshStatus'>] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await call({ command: 'untrusted', path: '/other' }, 'other-channel');
      expect(ipc.invoke).toHaveBeenCalledTimes(1);
      expect(ipc.invoke).toHaveBeenCalledWith(channel);
    },
  );

  it.each(oneArgument)(
    'forwards exactly one value from %s on %s',
    async (method, channel, sample) => {
      const call = api[method as 'addFirmware'] as unknown as (
        ...args: unknown[]
      ) => Promise<unknown>;
      await call(sample, '/Users/someone/IPL.bin', { command: 'untrusted' });
      expect(ipc.invoke).toHaveBeenCalledTimes(1);
      expect(ipc.invoke).toHaveBeenCalledWith(channel, sample);
    },
  );

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
