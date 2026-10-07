/** @jest-environment node */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { applyManagedControls, managedControls } from '../ppsspp/input';

describe('managed PPSSPP controls', () => {
  let config: string;
  let ownership: string;
  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ppsspp-input-'));
    config = path.join(root, 'SYSTEM');
    await fs.mkdir(config);
    ownership = path.join(root, '.emulation-workspace-input.json');
  });

  it('maps PSP L/R to the shoulder buttons PPSSPP actually reports', () => {
    const text = managedControls()['controls.ini'];
    // SDL left shoulder → NKCODE_BUTTON_6 (193), right shoulder → NKCODE_BUTTON_5 (192).
    expect(text).toContain('L = 1-45,10-193');
    expect(text).toContain('R = 1-51,10-192');
    // Every other binding is PPSSPP 1.20.4's own default, keyboard included.
    expect(text).toContain('Cross = 1-54,10-189');
    expect(text).toContain('An.Up = 1-37,10-4003');
  });

  it('stays managed after PPSSPP rewrites the file with a byte-order mark', async () => {
    await applyManagedControls(config, ownership);
    const file = path.join(config, 'controls.ini');
    await fs.writeFile(file, `\uFEFF${await fs.readFile(file, 'utf8')}`);
    await expect(applyManagedControls(config, ownership)).resolves.toEqual({
      files: { 'controls.ini': 'current' },
    });
  });

  it('fixes PPSSPP own untouched default, but not an edited copy of it', async () => {
    const file = path.join(config, 'controls.ini');
    const pristine = managedControls()
      ['controls.ini'].replace('10-193', '10-194')
      .replace('10-192', '10-195');
    await fs.writeFile(file, `\uFEFF${pristine}`);
    await expect(applyManagedControls(config, ownership)).resolves.toEqual({
      files: { 'controls.ini': 'written' },
    });
    expect(await fs.readFile(file, 'utf8')).toContain('L = 1-45,10-193');
    // An edited default is the user's choice and is kept.
    await fs.rm(ownership);
    await fs.writeFile(
      file,
      pristine.replace('Cross = 1-54,10-189', 'Cross = 1-54,10-190'),
    );
    await expect(applyManagedControls(config, ownership)).resolves.toEqual({
      files: { 'controls.ini': 'user' },
    });
  });

  it('never replaces a user mapping', async () => {
    const file = path.join(config, 'controls.ini');
    await fs.writeFile(file, '[ControlMapping]\nL = 10-999\n');
    await expect(applyManagedControls(config, ownership)).resolves.toEqual({
      files: { 'controls.ini': 'user' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe(
      '[ControlMapping]\nL = 10-999\n',
    );
  });
});
