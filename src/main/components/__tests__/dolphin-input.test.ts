/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyManagedInput, managedInput } from '../dolphin/input';

describe('managed Dolphin input', () => {
  let config: string;
  let ownership: string;
  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dolphin-input-'));
    config = path.join(root, 'Config');
    await fs.mkdir(config);
    ownership = path.join(root, '.emulation-workspace-input.json');
  });

  it('maps the DualSense by name and adds a deliberate exit hold', () => {
    const files = managedInput('ps5');
    expect(files['GCPadNew.ini']).toContain(
      'Device = SDL/0/DualSense Wireless Controller',
    );
    expect(files['GCPadNew.ini']).toContain('Buttons/A = `Button S`');
    expect(files['GCPadNew.ini']).toContain('Buttons/B = `Button E`');
    expect(files['GCPadNew.ini']).toContain('Main Stick/Up = `Left Y+`');
    expect(files['GCPadNew.ini']).toContain('C-Stick/Up = `Right Y+`');
    expect(files['Hotkeys.ini']).toContain(
      'General/Exit = hold(`Back` & `Start`, 1.5)',
    );
  });

  it('writes absent files and records them as managed', async () => {
    const result = await applyManagedInput(config, ownership, 'ps5');
    expect(result.files).toEqual({
      'GCPadNew.ini': 'written',
      'Hotkeys.ini': 'written',
    });
    await expect(applyManagedInput(config, ownership, 'ps5')).resolves.toEqual({
      files: { 'GCPadNew.ini': 'current', 'Hotkeys.ini': 'current' },
    });
  });

  it('never overwrites a mapping the user already had', async () => {
    await fs.writeFile(
      path.join(config, 'GCPadNew.ini'),
      '[GCPad1]\nDevice = mine\n',
    );
    const result = await applyManagedInput(config, ownership, 'ps5');
    expect(result.files['GCPadNew.ini']).toBe('user');
    expect(await fs.readFile(path.join(config, 'GCPadNew.ini'), 'utf8')).toBe(
      '[GCPad1]\nDevice = mine\n',
    );
  });

  it('keeps additions but hands the file over once a managed value changes', async () => {
    await applyManagedInput(config, ownership, 'ps5');
    const file = path.join(config, 'Hotkeys.ini');
    await fs.appendFile(file, 'General/Screenshot = `Button N`\n');
    // An added setting leaves our values intact: still managed, addition kept.
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['Hotkeys.ini'],
    ).toBe('current');
    expect(await fs.readFile(file, 'utf8')).toContain('Screenshot');
    // Changing the exit combination makes the file the user's, permanently.
    const edited = (await fs.readFile(file, 'utf8')).replace('1.5)', '3)');
    await fs.writeFile(file, edited);
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['Hotkeys.ini'],
    ).toBe('user');
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['Hotkeys.ini'],
    ).toBe('user');
    expect(await fs.readFile(file, 'utf8')).toContain(', 3)');
  });

  it('still owns a file Dolphin rewrote with extra keys and spacing', async () => {
    await applyManagedInput(config, ownership, 'ps5');
    const file = path.join(config, 'GCPadNew.ini');
    const rewritten = (await fs.readFile(file, 'utf8')).replace(
      'Rumble/Motor = `Motor`',
      'Rumble/Motor = `Motor`\nMain Stick/Calibration = 100.00 100.00\n',
    );
    await fs.writeFile(file, `${rewritten}\n`);
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['GCPadNew.ini'],
    ).toBe('current');
    expect(await fs.readFile(file, 'utf8')).toContain('Calibration');
  });

  it('updates its own older mapping even after Dolphin rewrote the file', async () => {
    // A version-1 record (hash only) of an earlier managed mapping that Dolphin left untouched.
    const old = managedInput('ps5')['GCPadNew.ini'].replace(
      '`Left Y+`',
      '`Left Y-`',
    );
    const file = path.join(config, 'GCPadNew.ini');
    await fs.writeFile(file, old);
    const { createHash } = await import('crypto');
    await fs.writeFile(
      ownership,
      JSON.stringify({
        files: {
          'GCPadNew.ini': createHash('sha256').update(old).digest('hex'),
        },
      }),
    );
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['GCPadNew.ini'],
    ).toBe('written');
    // Now Dolphin rewrites it with extra keys; the next mapping change still applies.
    await fs.appendFile(file, 'Main Stick/Dead Zone = 0.00\n');
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['GCPadNew.ini'],
    ).toBe('current');
    expect(await fs.readFile(file, 'utf8')).toContain('Dead Zone');
  });

  it('treats a corrupt ownership record as owning nothing', async () => {
    await applyManagedInput(config, ownership, 'ps5');
    await fs.writeFile(ownership, 'not json');
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['GCPadNew.ini'],
    ).toBe('user');
  });

  it('refuses to follow a symlinked configuration file', async () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}.ini`);
    await fs.writeFile(outside, 'keep');
    await fs.symlink(outside, path.join(config, 'GCPadNew.ini'));
    await expect(applyManagedInput(config, ownership, 'ps5')).rejects.toThrow();
    expect(await fs.readFile(outside, 'utf8')).toBe('keep');
  });
});
