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

  it('hands a managed file to the user once they edit it', async () => {
    await applyManagedInput(config, ownership, 'ps5');
    await fs.appendFile(
      path.join(config, 'Hotkeys.ini'),
      'General/Screenshot = `Button N`\n',
    );
    const result = await applyManagedInput(config, ownership, 'ps5');
    expect(result.files['Hotkeys.ini']).toBe('user');
    expect(
      await fs.readFile(path.join(config, 'Hotkeys.ini'), 'utf8'),
    ).toContain('Screenshot');
    // Still the user's on later runs, even though the record dropped it.
    expect(
      (await applyManagedInput(config, ownership, 'ps5')).files['Hotkeys.ini'],
    ).toBe('user');
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
