import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { activateUntilHeld, restoreFocus } from '../focus';

const helper =
  '/Applications/Emulation Workspace.app/Contents/Helpers/activate-app';
const bundle = '/Users/test/Library/Application Support/x/ES-DE.app';

describe('restoreFocus', () => {
  it('passes only the exact pid and bundle as argv', async () => {
    const run = jest.fn(async () => 0);
    await expect(restoreFocus(helper, 4242, bundle, run)).resolves.toBe(
      'frontmost',
    );
    expect(run).toHaveBeenCalledWith(helper, [
      '--pid',
      '4242',
      '--bundle',
      bundle,
    ]);
  });

  it.each([
    [2, 'declined'],
    [3, 'not-ready'],
    [1, 'refused'],
    [-1, 'failed'],
    [137, 'failed'],
  ])('maps helper status %i to %s', async (code, outcome) => {
    await expect(
      restoreFocus(helper, 4242, bundle, async () => code),
    ).resolves.toBe(outcome);
  });

  it('reports a failure without throwing when the helper cannot run', async () => {
    await expect(
      restoreFocus(helper, 4242, bundle, async () => {
        throw new Error('spawn failed');
      }),
    ).resolves.toBe('failed');
  });

  it.each([
    [0, bundle],
    [1, bundle],
    [-5, bundle],
    [1.5, bundle],
    [Number.NaN, bundle],
    [4242, 'relative/ES-DE.app'],
    [4242, '/x/../ES-DE.app'],
    [4242, '/x/ES-DE'],
  ])(
    'refuses pid %p with bundle %p before running anything',
    async (pid, bundlePath) => {
      const run = jest.fn(async () => 0);
      await expect(restoreFocus(helper, pid, bundlePath, run)).resolves.toBe(
        'refused',
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('refuses a relative helper path', async () => {
    const run = jest.fn(async () => 0);
    await expect(restoreFocus('activate-app', 4242, bundle, run)).resolves.toBe(
      'refused',
    );
    expect(run).not.toHaveBeenCalled();
  });
});

const native = path.resolve(
  __dirname,
  '../../../../release/native/activate-app',
);
const hasNative = process.platform === 'darwin' && fs.existsSync(native);

(hasNative ? describe : describe.skip)('native activate-app refusals', () => {
  // launchd's per-system daemons run as root; the helper must check ownership itself.
  const rootPID = () =>
    Number(
      execFileSync('/usr/bin/pgrep', ['-x', '-u', 'root', 'syslogd'])
        .toString()
        .split('\n')[0],
    );
  it.each([
    ['root-owned process', rootPID],
    ['this test runner, not inside the bundle', () => process.pid],
  ])('refuses a %s', async (_label, pid) => {
    await expect(
      restoreFocus(native, pid(), '/System/Applications/Calculator.app'),
    ).resolves.toBe('refused');
  });
});

describe('activateUntilHeld', () => {
  const delay = jest.fn(async () => undefined);
  beforeEach(() => delay.mockClear());

  it('needs two consecutive frontmost results', async () => {
    const activate = jest
      .fn()
      .mockResolvedValueOnce('not-ready')
      .mockResolvedValueOnce('frontmost')
      .mockResolvedValueOnce('declined')
      .mockResolvedValue('frontmost');
    await expect(activateUntilHeld(activate, delay)).resolves.toBe('frontmost');
    expect(activate).toHaveBeenCalledTimes(5);
  });

  it('stops immediately on refusal', async () => {
    const activate = jest.fn(async () => 'refused' as const);
    await expect(activateUntilHeld(activate, delay)).resolves.toBe('refused');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('is bounded and stops when the target is gone', async () => {
    const activate = jest.fn(async () => 'declined' as const);
    await expect(
      activateUntilHeld(activate, delay, () => true, 4),
    ).resolves.toBe('declined');
    expect(activate).toHaveBeenCalledTimes(4);
    activate.mockClear();
    await activateUntilHeld(activate, delay, () => false);
    expect(activate).not.toHaveBeenCalled();
  });
});
