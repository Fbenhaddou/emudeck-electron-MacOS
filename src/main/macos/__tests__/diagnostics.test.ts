/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  ControllersStatus,
  LibraryOverview,
  MacStatus,
} from '../../../shared/macos';
import {
  buildDiagnostics,
  clearEvents,
  diagnosticEvent,
  recentEvents,
  scrubText,
  writeDiagnostics,
} from '../diagnostics';

const library = '/Volumes/Faris Drive/My Games — ألعاب';
const context = {
  secrets: [
    { value: '/Users/faris', placeholder: '<home>' },
    { value: 'faris', placeholder: '<user>' },
    { value: library, placeholder: '<library>' },
  ],
};
const status: MacStatus = {
  console: {
    frontend: '3.5.0',
    frontendState: 'installed',
    state: 'idle',
    lastError: `Could not open ${library}/roms/gc/Secret Game.iso`,
    games: 2,
  },
  dolphin: { version: '2609', operation: 'idle' },
  emulators: [
    {
      id: 'ppsspp',
      name: 'PPSSPP',
      systems: ['psp'],
      systemName: 'PSP',
      architecture: 'universal',
      version: '1.20.4',
      health: 'installed',
      operation: 'idle',
    },
  ],
  appVersion: '2.7.1',
  platform: 'darwin',
  architecture: 'arm64',
  osVersion: '27.0.0',
  memoryBytes: 24 * 1024 ** 3,
  displays: [
    {
      width: 1512,
      height: 982,
      scaleFactor: 2,
      refreshRate: 120,
      hdr: 'unknown',
    },
  ],
  library: { path: library, available: true },
  libraryError: null,
  capabilities: {
    controllers: 'untested',
    installation: 'planned',
    consoleMode: 'preview',
  },
};
const overview: LibraryOverview = {
  available: true,
  systems: [
    {
      id: 'gc',
      name: 'GameCube',
      emulator: 'Dolphin',
      installed: true,
      games: 2,
      folder: 'roms/gc',
    },
  ],
  firmware: [
    {
      id: 'gc-ipl',
      system: 'gc',
      title: 'GameCube IPL',
      purpose: 'Startup software.',
      required: false,
      state: 'recognized',
      detail: 'NTSC 1.0',
    },
  ],
};
const controllers: ControllersStatus = {
  controllers: [
    {
      name: 'Faris’s DualSense',
      kind: 'ps5',
      battery: 80,
      charging: false,
      haptics: true,
      motion: true,
    },
  ],
  steamInput: false,
  stickResponse: 'precise',
  dolphinControls: 'recommended',
  recommendedAvailable: true,
};

describe('diagnostics', () => {
  beforeEach(() => clearEvents());

  it('scrubs paths, account names, emails and long identifiers', () => {
    expect(
      scrubText(
        `faris (faris@example.com) id 0123456789abcdef0123456789abcdef in "${library}/roms/gc/My Game.iso" and '/Volumes/Other Drive/x y.iso'`,
        context,
      ),
    ).toBe('<user> (<email>) id <id> in "<library>/…" and \'<path>\'');
    expect(scrubText('saved to /Users/faris/Saves/Some Game', context)).toBe(
      'saved to <home>/…',
    );
  });

  it('matches account names only as whole words', () => {
    const short = { secrets: [{ value: 'ab', placeholder: '<user>' }] };
    expect(scrubText('tab ab AB lab', short)).toBe('tab <user> <user> lab');
  });

  it('builds the report from an allowlist: no library path, game or controller names', () => {
    diagnosticEvent(
      {
        event: 'console-mode',
        error: `Missing ${library}/roms/gc/Secret Game.iso`,
      },
      () => undefined,
      new Date('2026-10-08T10:00:00Z'),
    );
    const report = buildDiagnostics({
      status,
      overview,
      controllers,
      events: recentEvents(),
      context,
      now: new Date('2026-10-08T12:00:00Z'),
    });
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/faris|Faris|Secret|ألعاب|Volumes|DualSense/);
    expect(report.library).toEqual({
      selected: true,
      available: true,
      settingsError: false,
    });
    expect(report.controllers?.connected).toEqual([
      {
        kind: 'ps5',
        battery: 80,
        charging: false,
        haptics: true,
        motion: true,
      },
    ]);
    expect(report.systems).toEqual([{ id: 'gc', installed: true, games: 2 }]);
    expect(report.firmware[0]).toMatchObject({ state: 'recognized' });
    expect(report.console.lastError).toBe('Could not open <library>/…');
    expect(report.events).toEqual([
      {
        at: '2026-10-08T10:00:00.000Z',
        entry: { event: 'console-mode', error: 'Missing <library>/…' },
      },
    ]);
  });

  it('keeps only the most recent events, in memory', () => {
    const lines: string[] = [];
    for (let i = 0; i < 250; i += 1)
      diagnosticEvent({ event: 'tick', i }, (line) => lines.push(line));
    const kept = recentEvents();
    expect(kept).toHaveLength(200);
    expect(kept[0].entry).toEqual({ event: 'tick', i: 50 });
    expect(lines[0]).toBe('{"event":"tick","i":0}\n');
  });

  it('writes an owner-only file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
    const file = path.join(root, 'report.json');
    await writeDiagnostics(file, { format: 'x' });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
      format: 'x',
    });
    expect((await fs.stat(file)).mode.toString(8).slice(-3)).toBe('600');
    await fs.rm(root, { recursive: true, force: true });
  });
});
