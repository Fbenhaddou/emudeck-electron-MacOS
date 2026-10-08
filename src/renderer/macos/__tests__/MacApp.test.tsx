/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import MacApp from '../MacApp';
import type {
  ControllersStatus,
  LibraryOverview,
  MacStatus,
  SavesOverview,
} from '../../../shared/macos';

const status: MacStatus = {
  console: {
    frontend: null,
    frontendState: 'missing',
    state: 'idle',
    lastError: null,
    games: null,
  },
  dolphin: { version: null, operation: 'idle' },
  emulators: [
    {
      id: 'ppsspp',
      name: 'PPSSPP',
      systems: ['psp'],
      systemName: 'PSP',
      architecture: 'universal',
      version: null,
      health: 'missing',
      operation: 'idle',
    },
  ],
  appVersion: 'test',
  platform: 'darwin',
  architecture: 'arm64',
  osVersion: '14.0',
  memoryBytes: 16 * 1024 ** 3,
  displays: [],
  library: null,
  libraryError: null,
  capabilities: {
    controllers: 'untested',
    installation: 'planned',
    consoleMode: 'preview',
  },
};
const controllersStatus: ControllersStatus = {
  controllers: [
    {
      name: 'DualSense Wireless Controller',
      kind: 'ps5',
      battery: 100,
      charging: true,
      haptics: true,
      motion: true,
    },
  ],
  steamInput: false,
  stickResponse: 'standard',
  dolphinControls: 'user',
  recommendedAvailable: true,
};
const overview: LibraryOverview = {
  available: true,
  systems: [
    {
      id: 'gc',
      name: 'GameCube',
      emulator: 'Dolphin',
      installed: true,
      games: 1,
      folder: 'roms/gc',
    },
    {
      id: 'psp',
      name: 'PSP',
      emulator: 'PPSSPP',
      installed: false,
      games: 3,
      folder: 'roms/psp',
    },
  ],
  firmware: [
    {
      id: 'gc-ipl',
      system: 'gc',
      title: 'GameCube IPL',
      purpose: 'The GameCube’s startup software.',
      required: false,
      state: 'missing',
      detail: null,
    },
  ],
};
const savesOverview: SavesOverview = {
  available: true,
  systems: [
    {
      emulator: 'dolphin',
      name: 'Dolphin',
      system: 'GameCube',
      installed: true,
      snapshots: [
        {
          id: '2026-10-01T10-00-00-000Z-before-reset',
          reason: 'before-reset',
          created: '2026-10-01T10:00:00.000Z',
          files: 3,
          bytes: 12292,
        },
      ],
    },
    {
      emulator: 'ppsspp',
      name: 'PPSSPP',
      system: 'PSP',
      installed: false,
      snapshots: [],
    },
  ],
};
let refreshFromMenu: () => void;
let unsubscribeRefresh: jest.Mock;
beforeEach(() => {
  unsubscribeRefresh = jest.fn();
  window.mac = {
    installDolphin: jest.fn().mockResolvedValue({ ok: true }),
    playGame: jest.fn().mockResolvedValue({ ok: true }),
    resetDolphin: jest.fn().mockResolvedValue({ ok: true }),
    installConsole: jest.fn(async () => ({ ok: true as const })),
    enterConsole: jest.fn(async () => ({ ok: true as const })),
    getControllers: jest.fn(async () => controllersStatus),
    setStickResponse: jest.fn(async () => ({ ok: true as const })),
    useRecommendedControls: jest.fn(async () => ({ ok: true as const })),
    installEmulator: jest.fn(async () => ({ ok: true as const })),
    playEmulator: jest.fn(async () => ({ ok: true as const })),
    recoverLibrarySettings: jest.fn().mockResolvedValue({ ok: true }),
    getStatus: jest.fn().mockResolvedValue(status),
    onRefreshStatus: jest.fn((callback: () => void) => {
      refreshFromMenu = callback;
      return unsubscribeRefresh;
    }),
    chooseLibrary: jest
      .fn()
      .mockResolvedValue({ ok: false, cancelled: true, error: 'Cancelled' }),
    revealLibrary: jest.fn().mockResolvedValue({ ok: true }),
    getLibraryOverview: jest.fn(async () => overview),
    addFirmware: jest.fn(async () => ({ ok: true as const })),
    revealSystem: jest.fn(async () => ({ ok: true as const })),
    exportDiagnostics: jest.fn(async () => ({ ok: true as const })),
    getSaves: jest.fn(async () => savesOverview),
    backUpSaves: jest.fn(async () => ({ ok: true as const })),
    restoreSaves: jest.fn(async () => ({ ok: true as const })),
    revealSaves: jest.fn(async () => ({ ok: true as const })),
  };
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
it('loads status from the narrow API and leaves cancelled selection unchanged', async () => {
  render(<MacApp />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Choose Folder…' }),
  );
  await waitFor(() =>
    expect(window.mac.chooseLibrary).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Choose Folder…' }),
    ).toBeEnabled(),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('No folder selected')).toBeInTheDocument();
});
it('presents disconnected storage without offering Finder access', async () => {
  window.mac.getStatus = jest.fn().mockResolvedValue({
    ...status,
    library: { path: '/Volumes/Game Library', available: false },
  });
  render(<MacApp />);
  expect(await screen.findByText('Folder unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeDisabled();
});
it('reports IPC failure and does not mark an error screen ready', async () => {
  window.mac.getStatus = jest.fn().mockRejectedValue(new Error('unavailable'));
  const { container } = render(<MacApp />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not read application status',
  );
  expect(container.querySelector('[data-ready="true"]')).toBeNull();
  expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
  expect(screen.queryByText('Reading your Mac…')).toBeNull();
});
it('starts a newly selected page at the top without moving content on status refresh', async () => {
  render(<MacApp />);
  await screen.findByRole('button', { name: 'Choose Folder…' });
  const main = screen.getByRole('main');
  main.scrollTop = 240;
  fireEvent.click(screen.getByRole('button', { name: 'Emulators' }));
  expect(main.scrollTop).toBe(0);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Emulators',
  );
  main.scrollTop = 120;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await waitFor(() => expect(window.mac.getStatus).toHaveBeenCalledTimes(2));
  expect(main.scrollTop).toBe(120);
});
it('refreshes from the native menu while preserving page, scroll and keyboard focus, then unsubscribes', async () => {
  const { unmount } = render(<MacApp />);
  await screen.findByRole('button', { name: 'Choose Folder…' });
  const pageButton = screen.getByRole('button', { name: 'Emulators' });
  fireEvent.click(pageButton);
  pageButton.focus();
  const main = screen.getByRole('main');
  main.scrollTop = 120;
  await act(async () => {
    refreshFromMenu();
  });
  expect(window.mac.getStatus).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Emulators',
  );
  expect(document.activeElement).toBe(pageButton);
  expect(main.scrollTop).toBe(120);
  unmount();
  expect(unsubscribeRefresh).toHaveBeenCalledTimes(1);
});
it('reveals a newly appearing action error without stealing focus or moving content on later refresh', async () => {
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function bounds(this: HTMLElement) {
      const main = document.querySelector('main');
      const top = this === main ? 50 : 90 - (main?.scrollTop || 0);
      return {
        top,
        bottom: top + (this === main ? 200 : 80),
        left: 0,
        right: 400,
        width: 400,
        height: this === main ? 200 : 80,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });
  window.mac.chooseLibrary = jest.fn().mockResolvedValue({
    ok: false,
    error: 'The selected drive is unavailable.',
  });
  render(<MacApp />);
  const choose = await screen.findByRole('button', { name: 'Choose Folder…' });
  const main = screen.getByRole('main');
  choose.focus();
  main.scrollTop = 240;
  fireEvent.click(choose);
  const alert = await screen.findByRole('alert');
  await waitFor(() => expect(choose).toBeEnabled());
  expect(alert.getBoundingClientRect().top).toBe(50);
  expect(main.scrollTop).toBe(40);
  expect(document.activeElement).toBe(choose);
  main.scrollTop = 160;
  await act(async () => {
    refreshFromMenu();
  });
  expect(main.scrollTop).toBe(160);
  expect(document.activeElement).toBe(choose);
});
it('clears a status-read error when Refresh succeeds', async () => {
  window.mac.getStatus = jest
    .fn()
    .mockRejectedValueOnce(new Error('temporarily unavailable'))
    .mockResolvedValue(status);
  render(<MacApp />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not read application status',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  await screen.findByRole('button', { name: 'Choose Folder…' });
  expect(screen.queryByRole('alert')).toBeNull();
});
it('recovers malformed settings and returns to folder selection', async () => {
  window.mac.getStatus = jest
    .fn()
    .mockResolvedValueOnce({
      ...status,
      libraryError:
        'Library settings could not be read. Existing files have been preserved.',
    })
    .mockResolvedValue(status);
  render(<MacApp />);
  const recover = await screen.findByRole('button', {
    name: 'Recover Library Settings…',
  });
  expect(screen.getByRole('button', { name: 'Choose Folder…' })).toBeDisabled();
  fireEvent.click(recover);
  await waitFor(() =>
    expect(window.mac.recoverLibrarySettings).toHaveBeenCalledTimes(1),
  );
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('button', { name: 'Choose Folder…' })).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: 'Recover Library Settings…' }),
  ).toBeNull();
  expect(screen.getByText('No folder selected')).toBeInTheDocument();
});
it('recovers controls when a running game exits and stops polling when idle', async () => {
  jest.useFakeTimers();
  const installed: MacStatus = {
    ...status,
    dolphin: { version: '2509', operation: 'idle' },
    library: { path: '/Volumes/Game Library', available: true },
  };
  const getStatus = jest
    .fn()
    .mockResolvedValueOnce(installed)
    .mockResolvedValueOnce({
      ...installed,
      dolphin: { version: '2509', operation: 'running' },
    })
    .mockResolvedValue(installed);
  window.mac.getStatus = getStatus;
  render(<MacApp />);
  await screen.findByRole('button', { name: 'Change…' });
  fireEvent.click(screen.getByRole('button', { name: 'Emulators' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose Game…' }));
  await screen.findByText('Dolphin is running. Quit the game to return here.');
  expect(screen.getByRole('button', { name: 'Choose Game…' })).toBeDisabled();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByRole('button', { name: 'Choose Game…' })).toBeEnabled();
  expect(screen.queryByText(/Dolphin is running/)).toBeNull();
  const callsAfterExit = getStatus.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(getStatus).toHaveBeenCalledTimes(callsAfterExit);
});
it('cleans up active-game polling when the window is unmounted', async () => {
  jest.useFakeTimers();
  const getStatus = jest.fn().mockResolvedValue({
    ...status,
    dolphin: { version: '2509', operation: 'running' },
    library: { path: '/Volumes/Game Library', available: true },
  });
  window.mac.getStatus = getStatus;
  const { unmount } = render(<MacApp />);
  await screen.findByRole('button', { name: 'Change…' });
  unmount();
  const callsBeforeUnmount = getStatus.mock.calls.length;
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(getStatus).toHaveBeenCalledTimes(callsBeforeUnmount);
});
it('keeps future capabilities honestly labeled', async () => {
  render(<MacApp />);
  await screen.findByRole('button', { name: 'Choose Folder…' });
  fireEvent.click(screen.getByRole('button', { name: 'Development' }));
  expect(screen.getByText('Not tested')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /install/i })).toBeNull();
});
describe('Console Mode page', () => {
  const ready: MacStatus = {
    ...status,
    library: { path: '/Volumes/Games', available: true },
    dolphin: { version: '2609', operation: 'idle' },
    console: {
      frontend: '3.5.0',
      frontendState: 'installed',
      state: 'idle',
      lastError: null,
      games: null,
    },
  };
  async function open(current: MacStatus) {
    (window.mac.getStatus as jest.Mock).mockResolvedValue(current);
    render(<MacApp />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Console Mode' }),
    );
    return screen.findByRole('button', { name: 'Open Console Mode' });
  }

  it.each([
    [status, 'Choose an available library in Library first.'],
    [
      { ...ready, dolphin: { version: null, operation: 'idle' as const } },
      'Install Dolphin in Emulators first.',
    ],
    [
      {
        ...ready,
        console: { ...ready.console, frontend: null, frontendState: 'missing' },
      },
      'Install ES-DE above first.',
    ],
    [
      { ...ready, console: { ...ready.console, frontendState: 'damaged' } },
      'Repair ES-DE above first.',
    ],
  ])(
    'explains what is missing and keeps Open disabled %#',
    async (current, reason) => {
      const button = await open(current as MacStatus);
      expect(button).toBeDisabled();
      expect(screen.getByText(reason)).toBeInTheDocument();
    },
  );

  it('offers repair for a damaged installation through the same bridge', async () => {
    await open({
      ...ready,
      console: { ...ready.console, frontendState: 'damaged' },
    });
    expect(screen.getByText(/Needs repair/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Repair ES-DE…' }));
    await waitFor(() =>
      expect(window.mac.installConsole).toHaveBeenCalledWith(),
    );
  });

  it('installs ES-DE through the zero-argument bridge', async () => {
    await open({
      ...ready,
      console: { ...ready.console, frontend: null, frontendState: 'missing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Install ES-DE…' }));
    await waitFor(() =>
      expect(window.mac.installConsole).toHaveBeenCalledWith(),
    );
  });

  it('opens Console Mode when everything is ready', async () => {
    const button = await open(ready);
    expect(button).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Install ES-DE…' })).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(window.mac.enterConsole).toHaveBeenCalledWith());
  });

  it('shows the last session problem as an alert', async () => {
    await open({
      ...ready,
      console: {
        ...ready.console,
        lastError:
          'Console Mode closed unexpectedly. Your games and saves are unchanged.',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('closed unexpectedly');
  });

  it('disables actions while Console Mode is open', async () => {
    const button = await open({
      ...ready,
      console: { ...ready.console, state: 'running' },
    });
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Choose Quit ES-DE');
  });
});

describe('Controllers page', () => {
  async function open() {
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Controllers' }));
    return screen.findByText('DualSense Wireless Controller');
  }

  it('lists connected controllers with battery and capabilities', async () => {
    await open();
    expect(
      screen.getByText(
        'PlayStation · Battery 100%, charging · Supports haptics and motion',
      ),
    ).toBeInTheDocument();
  });

  it('switches stick response with the keyboard, sending only the literal value', async () => {
    await open();
    const standard = screen.getByRole('radio', { name: 'Standard' });
    expect(standard).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(standard, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(window.mac.setStickResponse).toHaveBeenCalledWith('precise'),
    );
    expect(screen.getByRole('radio', { name: 'Precise' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('offers recommended controls only when the library has its own', async () => {
    await open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Use Recommended Controls…' }),
    );
    await waitFor(() =>
      expect(window.mac.useRecommendedControls).toHaveBeenCalledWith(),
    );
  });

  it('warns when Steam Input is taking over the controller', async () => {
    (window.mac.getControllers as jest.Mock).mockResolvedValue({
      ...controllersStatus,
      steamInput: true,
    });
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Controllers' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Steam is taking over your controller',
    );
  });

  it('explains how to connect a controller when none is found', async () => {
    (window.mac.getControllers as jest.Mock).mockResolvedValue({
      ...controllersStatus,
      controllers: [],
      dolphinControls: 'recommended',
    });
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Controllers' }));
    expect(
      await screen.findByText('No controllers connected'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Use Recommended Controls…' }),
    ).toBeNull();
  });
});

describe('PPSSPP on the Emulators page', () => {
  const library = { path: '/Volumes/Games', available: true };
  async function open(current: MacStatus) {
    (window.mac.getStatus as jest.Mock).mockResolvedValue(current);
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Emulators' }));
    await screen.findByText('PPSSPP');
  }

  it('installs PPSSPP by its fixed id', async () => {
    await open({ ...status, library });
    fireEvent.click(screen.getByRole('button', { name: 'Install PPSSPP' }));
    await waitFor(() =>
      expect(window.mac.installEmulator).toHaveBeenCalledWith('ppsspp'),
    );
  });

  it('plays a PSP game once installed and offers repair when damaged', async () => {
    await open({
      ...status,
      library,
      emulators: [
        { ...status.emulators[0], version: '1.20.4', health: 'installed' },
      ],
    });
    expect(screen.getByText('PSP · Version 1.20.4')).toBeInTheDocument();
    const play = screen.getAllByRole('button', { name: 'Choose Game…' });
    fireEvent.click(play[play.length - 1]);
    await waitFor(() =>
      expect(window.mac.playEmulator).toHaveBeenCalledWith('ppsspp'),
    );
  });

  it('shows repair for a damaged installation', async () => {
    await open({
      ...status,
      library,
      emulators: [
        { ...status.emulators[0], version: '1.20.4', health: 'damaged' },
      ],
    });
    expect(screen.getByRole('button', { name: 'Repair PPSSPP' })).toBeEnabled();
  });
});

describe('library systems and firmware', () => {
  const library = { path: '/Volumes/Games', available: true };

  it('lists each system with its game count and opens its folder by id', async () => {
    (window.mac.getStatus as jest.Mock).mockResolvedValue({
      ...status,
      library,
    });
    render(<MacApp />);
    expect(
      await screen.findByText('1 game · Plays with Dolphin'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('3 games · Install PPSSPP in Emulators to play'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Show PSP games folder in Finder',
      }),
    );
    await waitFor(() =>
      expect(window.mac.revealSystem).toHaveBeenCalledWith('psp'),
    );
  });

  it('adds firmware by its declared id and shows the recognized dump', async () => {
    (window.mac.getStatus as jest.Mock).mockResolvedValue({
      ...status,
      library,
    });
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Firmware' }));
    expect(await screen.findByText('Optional')).toBeInTheDocument();
    expect(
      screen.getByText('PPSSPP needs no system files.'),
    ).toBeInTheDocument();
    (window.mac.getLibraryOverview as jest.Mock).mockResolvedValue({
      ...overview,
      firmware: [
        { ...overview.firmware[0], state: 'recognized', detail: 'NTSC 1.0' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add GameCube IPL' }));
    await waitFor(() =>
      expect(window.mac.addFirmware).toHaveBeenCalledWith('gc-ipl'),
    );
    expect(
      await screen.findByText('Added and recognized: NTSC 1.0.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Replace GameCube IPL' }),
    ).toBeInTheDocument();
  });

  it('shows a refused dump as an alert without changing the row', async () => {
    (window.mac.getStatus as jest.Mock).mockResolvedValue({
      ...status,
      library,
    });
    (window.mac.addFirmware as jest.Mock).mockResolvedValue({
      ok: false,
      error:
        'This file is not a known good GameCube IPL dump. Nothing was copied.',
    });
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Firmware' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Add GameCube IPL' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'not a known good GameCube IPL dump',
    );
  });

  it('asks for a library before managing firmware', async () => {
    (window.mac.getLibraryOverview as jest.Mock).mockResolvedValue({
      available: false,
      systems: [],
      firmware: [],
    });
    render(<MacApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Firmware' }));
    expect(await screen.findByText('No library available')).toBeInTheDocument();
  });
});

it('exports diagnostics from This Mac through its fixed method', async () => {
  render(<MacApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'This Mac' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Export…' }));
  await waitFor(() =>
    expect(window.mac.exportDiagnostics).toHaveBeenCalledWith(),
  );
  expect(
    screen.getByText(/never includes game names, file paths/),
  ).toBeInTheDocument();
});

describe('Saves page', () => {
  async function openSaves() {
    render(<MacApp />);
    await screen.findByRole('button', { name: 'Choose Folder…' });
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    return screen.findByRole('region', { name: 'GameCube saves' });
  }

  it('lists each system with its backups and why they were made', async () => {
    const gamecube = await openSaves();
    expect(gamecube).toHaveTextContent('Dolphin');
    expect(gamecube).toHaveTextContent('Before resetting settings');
    expect(gamecube).toHaveTextContent('3 files · 12 KB');
    expect(screen.getByRole('region', { name: 'PSP saves' })).toHaveTextContent(
      'No backups yet',
    );
  });

  it('backs up and restores through the narrow API only', async () => {
    await openSaves();
    fireEvent.click(
      screen.getByRole('button', { name: 'Back up GameCube saves now' }),
    );
    await waitFor(() =>
      expect(window.mac.backUpSaves).toHaveBeenCalledWith('dolphin'),
    );
    await waitFor(() => expect(window.mac.getSaves).toHaveBeenCalledTimes(2));
    fireEvent.click(
      screen.getByRole('button', { name: /^Restore GameCube saves from / }),
    );
    await waitFor(() =>
      expect(window.mac.restoreSaves).toHaveBeenCalledWith(
        'dolphin/2026-10-01T10-00-00-000Z-before-reset',
      ),
    );
  });

  it('asks for a library when none is available', async () => {
    window.mac.getSaves = jest.fn(async () => ({
      available: false,
      systems: [],
    }));
    render(<MacApp />);
    await screen.findByRole('button', { name: 'Choose Folder…' });
    fireEvent.click(screen.getByRole('button', { name: 'Saves' }));
    expect(await screen.findByText('No library available')).toBeInTheDocument();
  });
});
