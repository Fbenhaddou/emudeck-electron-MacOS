import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { ConsoleSession } from '../console-session';
import type { ConsoleDependencies, GameRunner } from '../console-session';
import type { Catalog } from '../../components/es-de/catalog';

type Launch = (
  id: string,
) => Promise<{ code: number | null; signal: string | null }>;

class FakeChild extends EventEmitter {
  pid = 4242;

  exitCode: number | null = null;

  signalCode: string | null = null;

  kill = jest.fn((signal: string) => {
    this.exit(null, signal);
    return true;
  });

  exit(code: number | null, signal: string | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

const flush = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

function setup(overrides: Partial<ConsoleDependencies> = {}) {
  const child = new FakeChild();
  let launch: Launch | undefined;
  let exitHold: (() => void) | undefined;
  const watch = { stop: jest.fn() };
  const runner = {
    isBusy: false,
    handlesExitHold: true,
    forceStop: jest.fn(() => true),
    launchAndWait: jest.fn(async () => ({ code: 0, signal: null })),
  };
  const broker = { close: jest.fn(async () => undefined) };
  const deps: ConsoleDependencies = {
    frontend: jest.fn(async () => ({
      bundle: '/managed/ES-DE.app',
      executable: '/managed/ES-DE.app/Contents/MacOS/ES-DE',
    })),
    systems: jest.fn(async () => [
      { id: 'gc', fullname: 'Nintendo GameCube', label: 'Dolphin' },
      { id: 'psp', fullname: 'Sony PlayStation Portable', label: 'PPSSPP' },
    ]),
    listGames: jest.fn(async () => [
      {
        system: 'gc',
        path: '/lib/roms/gc/a; rm -rf ~.iso',
        relativePath: 'roms/gc/a; rm -rf ~.iso',
        name: 'A',
      },
      {
        system: 'gc',
        path: '/lib/roms/gc/b.iso',
        relativePath: 'roms/gc/b.iso',
        name: 'B',
      },
    ]),
    gameID: jest.fn(async (_library, game) =>
      game.name === 'A' ? 'a'.repeat(32) : 'b'.repeat(32),
    ),
    makeRuntime: jest.fn(async () => '/private/tmp/ew-console-abc123'),
    removeRuntime: jest.fn(async () => undefined),
    createCatalog: jest.fn(async () => ({}) as Catalog),
    publishProfile: jest.fn(async (home) => ({
      home,
      appData: `${home}/ES-DE`,
    })),
    startBroker: jest.fn(async (_root, _ids, callback) => {
      launch = callback;
      return broker;
    }),
    restoreFocus: jest.fn(async () => 'frontmost' as const),
    strayFrontends: jest.fn(async () => []),
    terminate: jest.fn(),
    spawn: jest.fn(() => {
      setImmediate(() => child.emit('spawn'));
      return child as unknown as ChildProcess;
    }),
    delay: jest.fn(async () => undefined),
    prepareGameInput: jest.fn(async () => undefined),
    watchExitHold: jest.fn((onHold: () => void) => {
      exitHold = onHold;
      return watch;
    }),
    hideManager: jest.fn(),
    showManager: jest.fn(),
    ...overrides,
  };
  const pspRunner = {
    isBusy: false,
    forceStop: jest.fn(() => true),
    launchAndWait: jest.fn(async () => ({ code: 0, signal: null })),
  };
  const session = new ConsoleSession(
    '/profile/esde-home',
    { gc: runner as GameRunner, psp: pspRunner as GameRunner },
    deps,
  );
  return {
    session,
    deps,
    runner,
    broker,
    child,
    watch,
    hold: () => exitHold!(),
    pspRunner,
    launch: () => launch!,
  };
}

describe('ConsoleSession', () => {
  it('hides the manager before the frontend starts, then requires focus to hold', async () => {
    const restoreFocus = jest
      .fn()
      // Just spawned: not yet registered as an application, then activated.
      .mockResolvedValueOnce('not-ready')
      .mockResolvedValueOnce('frontmost')
      // Focus lost when a late hide completed: activate again.
      .mockResolvedValueOnce('declined')
      .mockResolvedValue('frontmost');
    const { session, deps } = setup({ restoreFocus });
    await session.enter('/lib');
    expect(restoreFocus).toHaveBeenCalledTimes(5);
    expect(restoreFocus).toHaveBeenCalledWith(4242, '/managed/ES-DE.app');
    expect(
      (deps.hideManager as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan((deps.spawn as jest.Mock).mock.invocationCallOrder[0]);
    expect(session.report?.startFocus).toBe('frontmost');
  });

  it('gives up startup activation after bounded retries and stays open', async () => {
    const restoreFocus = jest.fn(async () => 'declined' as const);
    const { session } = setup({ restoreFocus });
    await session.enter('/lib');
    expect(restoreFocus).toHaveBeenCalledTimes(10);
    expect(session.state).toBe('running');
  });

  it('shows the manager again if the frontend fails to start after hiding', async () => {
    const { session, deps } = setup({
      spawn: jest.fn(() => {
        const failed = new EventEmitter();
        setImmediate(() => failed.emit('error', new Error('spawn EACCES')));
        return failed as unknown as ChildProcess;
      }),
    });
    await expect(session.enter('/lib')).rejects.toThrow('EACCES');
    expect(deps.hideManager).toHaveBeenCalled();
    expect(deps.showManager).toHaveBeenCalled();
  });

  it('starts the isolated frontend with argv only and hides the manager', async () => {
    const { session, deps } = setup();
    await session.enter('/lib');
    expect(session.state).toBe('running');
    expect(deps.spawn).toHaveBeenCalledWith(
      '/managed/ES-DE.app/Contents/MacOS/ES-DE',
      [
        '--home',
        '/profile/esde-home',
        '--no-splash',
        '--no-update-check',
        '--gamelist-only',
        '--vsync',
        '0',
      ],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({
          HOME: '/profile/esde-home',
          ESDE_APPDATA_DIR: '/profile/esde-home/ES-DE',
        }),
      }),
    );
    // ROM paths reach the catalog only as opaque IDs and display names.
    expect(deps.createCatalog).toHaveBeenCalledWith(
      '/private/tmp/ew-console-abc123',
      [
        {
          id: 'gc',
          fullname: 'Nintendo GameCube',
          label: 'Dolphin',
          entries: [
            { id: 'a'.repeat(32), name: 'A' },
            { id: 'b'.repeat(32), name: 'B' },
          ],
        },
        {
          id: 'psp',
          fullname: 'Sony PlayStation Portable',
          label: 'PPSSPP',
          entries: [],
        },
      ],
    );
    expect(deps.hideManager).toHaveBeenCalled();
  });

  it('launches by opaque ID in console presentation, then restores focus', async () => {
    const { session, deps, runner, launch } = setup();
    await session.enter('/lib');
    await expect(launch()('a'.repeat(32))).resolves.toEqual({
      code: 0,
      signal: null,
    });
    expect(runner.launchAndWait).toHaveBeenCalledWith(
      '/lib',
      '/lib/roms/gc/a; rm -rf ~.iso',
      'console',
    );
    expect(deps.restoreFocus).toHaveBeenCalledWith(4242, '/managed/ES-DE.app');
    expect(deps.prepareGameInput).toHaveBeenCalledWith('/lib', 'gc');
  });

  it('still launches the game if managed input cannot be prepared', async () => {
    const { session, runner, launch } = setup({
      prepareGameInput: jest.fn(async () => {
        throw new Error('config folder unavailable');
      }),
    });
    await session.enter('/lib');
    await expect(launch()('a'.repeat(32))).resolves.toEqual({
      code: 0,
      signal: null,
    });
    expect(runner.launchAndWait).toHaveBeenCalled();
  });

  it('force-stops only a running game on a long exit hold, then stops watching', async () => {
    let finishGame!: (value: { code: number; signal: null }) => void;
    const { session, runner, child, watch, hold, launch } = setup();
    runner.launchAndWait.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGame = resolve;
        }),
    );
    await session.enter('/lib');
    hold();
    // No game running: the hold does nothing (ES-DE has its own Quit).
    expect(runner.forceStop).not.toHaveBeenCalled();
    const game = launch()('a'.repeat(32));
    await flush();
    hold();
    await flush();
    // Dolphin's own hotkey had 3.5 s to end the game; it is still running.
    expect(runner.forceStop).toHaveBeenCalledTimes(1);
    finishGame({ code: 0, signal: null });
    await game;
    child.exit(0);
    await flush();
    expect(session.report?.forcedStops).toBe(1);
    expect(watch.stop).toHaveBeenCalled();
  });

  it('routes a PSP game to the PSP runner and stops that runner on a long hold', async () => {
    let finishGame!: (value: { code: number; signal: null }) => void;
    const psp = 'c'.repeat(32);
    const { session, deps, runner, pspRunner, hold, launch, child } = setup({
      listGames: jest.fn(async () => [
        {
          system: 'psp',
          path: '/lib/roms/psp/p.pbp',
          relativePath: 'roms/psp/p.pbp',
          name: 'P',
        },
      ]),
      gameID: jest.fn(async () => psp),
    });
    pspRunner.launchAndWait.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGame = resolve;
        }),
    );
    await session.enter('/lib');
    const game = launch()(psp);
    await flush();
    expect(pspRunner.launchAndWait).toHaveBeenCalledWith(
      '/lib',
      '/lib/roms/psp/p.pbp',
      'console',
    );
    expect(runner.launchAndWait).not.toHaveBeenCalled();
    expect(deps.prepareGameInput).toHaveBeenCalledWith('/lib', 'psp');
    hold();
    expect(pspRunner.forceStop).toHaveBeenCalled();
    expect(runner.forceStop).not.toHaveBeenCalled();
    finishGame({ code: 0, signal: null });
    await game;
    child.exit(0);
    await flush();
    // A polite quit is a normal exit, not an emergency stop.
    expect(session.report).toMatchObject({ exitRequests: 1, forcedStops: 0 });
  });

  it('does not stop a Dolphin game that exited by itself during the grace period', async () => {
    let finishGame!: (value: { code: number; signal: null }) => void;
    let resumeGrace!: () => void;
    const { session, runner, hold, launch } = setup({
      // Only the 3.5 s exit grace period is held open; focus retries pass through.
      delay: jest.fn((milliseconds: number) =>
        milliseconds === 3500
          ? new Promise<void>((resolve) => {
              resumeGrace = resolve;
            })
          : Promise.resolve(),
      ),
    });
    runner.launchAndWait.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGame = resolve;
        }),
    );
    await session.enter('/lib');
    const game = launch()('a'.repeat(32));
    await flush();
    hold();
    finishGame({ code: 0, signal: null });
    await game;
    resumeGrace();
    await flush();
    expect(runner.forceStop).not.toHaveBeenCalled();
  });

  it('leaves out systems without an installed emulator', async () => {
    const { session, deps } = setup({
      systems: jest.fn(async () => [
        { id: 'gc', fullname: 'Nintendo GameCube', label: 'Dolphin' },
      ]),
      listGames: jest.fn(async () => [
        {
          system: 'gc',
          path: '/lib/roms/gc/a.iso',
          relativePath: 'roms/gc/a.iso',
          name: 'A',
        },
        {
          system: 'psp',
          path: '/lib/roms/psp/p.pbp',
          relativePath: 'roms/psp/p.pbp',
          name: 'P',
        },
      ]),
    });
    await session.enter('/lib');
    const systems = (deps.createCatalog as jest.Mock).mock.calls[0][1];
    expect(systems.map((system: { id: string }) => system.id)).toEqual(['gc']);
    expect(session.report?.games ?? 1).toBe(1);
  });

  it('refuses to open with no installed emulator', async () => {
    const { session, deps } = setup({ systems: jest.fn(async () => []) });
    await expect(session.enter('/lib')).rejects.toThrow('Install an emulator');
    expect(deps.makeRuntime).not.toHaveBeenCalled();
  });

  it('refuses unknown IDs', async () => {
    const { session, launch } = setup();
    await session.enter('/lib');
    await expect(launch()('c'.repeat(32))).rejects.toThrow('not ready');
  });

  it('cleans up and shows the manager when the frontend quits', async () => {
    const { session, deps, broker, child } = setup();
    await session.enter('/lib');
    child.exit(0);
    await flush();
    expect(session.state).toBe('idle');
    expect(broker.close).toHaveBeenCalled();
    expect(deps.removeRuntime).toHaveBeenCalledWith(
      '/private/tmp/ew-console-abc123',
    );
    expect(deps.showManager).toHaveBeenCalled();
    expect(session.report?.error).toBeNull();
  });

  it('waits for a running game before releasing when the frontend crashes', async () => {
    let finishGame!: (value: { code: number; signal: null }) => void;
    const { session, deps, runner, broker, child, launch } = setup();
    runner.launchAndWait.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGame = resolve;
        }),
    );
    await session.enter('/lib');
    const game = launch()('b'.repeat(32));
    await flush();
    child.exit(null, 'SIGABRT');
    await flush();
    expect(session.state).toBe('stopping');
    expect(broker.close).not.toHaveBeenCalled();
    expect(deps.showManager).not.toHaveBeenCalled();
    finishGame({ code: 0, signal: null });
    await game;
    await flush();
    expect(session.state).toBe('idle');
    expect(broker.close).toHaveBeenCalled();
    // Only the two startup checks ran; a dead frontend is never focused after the game.
    expect(deps.restoreFocus).toHaveBeenCalledTimes(2);
    expect(session.report?.error).toContain('closed unexpectedly');
  });

  it('terminates stray unisolated frontends before starting', async () => {
    const { session, deps } = setup({
      strayFrontends: jest.fn(async () => [7001, 7002]),
    });
    await session.enter('/lib');
    expect(deps.terminate).toHaveBeenNthCalledWith(1, 7001);
    expect(deps.terminate).toHaveBeenNthCalledWith(2, 7002);
  });

  it('refuses to start without ES-DE and leaves nothing behind', async () => {
    const { session, deps } = setup({ frontend: jest.fn(async () => null) });
    await expect(session.enter('/lib')).rejects.toThrow('Install ES-DE');
    expect(session.state).toBe('idle');
    expect(deps.makeRuntime).not.toHaveBeenCalled();
    expect(deps.hideManager).not.toHaveBeenCalled();
  });

  it('refuses while another emulator task is active', async () => {
    const { session, runner, deps } = setup();
    runner.isBusy = true;
    await expect(session.enter('/lib')).rejects.toThrow('Finish the current');
    expect(deps.frontend).not.toHaveBeenCalled();
  });

  it('rolls back the runtime and broker if the frontend cannot spawn', async () => {
    const { session, deps, broker } = setup({
      spawn: jest.fn(() => {
        const child = new FakeChild();
        setImmediate(() => child.emit('error', new Error('spawn EACCES')));
        return child as unknown as ChildProcess;
      }),
    });
    await expect(session.enter('/lib')).rejects.toThrow('EACCES');
    expect(broker.close).toHaveBeenCalled();
    expect(deps.removeRuntime).toHaveBeenCalled();
    // Hidden before spawning, so a failed start must show it again.
    expect(deps.showManager).toHaveBeenCalled();
    expect(session.state).toBe('idle');
  });

  it('refuses a second session and a stop request during a game', async () => {
    let finishGame!: (value: { code: number; signal: null }) => void;
    const { session, runner, child, launch } = setup();
    runner.launchAndWait.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishGame = resolve;
        }),
    );
    await session.enter('/lib');
    await expect(session.enter('/lib')).rejects.toThrow('already open');
    const game = launch()('a'.repeat(32));
    await flush();
    expect(session.stop()).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    finishGame({ code: 0, signal: null });
    await game;
    expect(session.stop()).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
