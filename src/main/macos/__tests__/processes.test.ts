import { containsManagedDolphin } from '../processes';

describe('recovering managed emulator sessions without exposing game arguments', () => {
  const root =
    '/Users/example/Library/Application Support/Emulation Workspace/components/dolphin';
  it('recognizes only managed versioned Dolphin executables', () => {
    expect(
      containsManagedDolphin(
        `${root}/2609/Dolphin.app/Contents/MacOS/Dolphin\n`,
        root,
      ),
    ).toBe(true);
    expect(
      containsManagedDolphin(
        ` ${root}/2610a/Dolphin.app/Contents/MacOS/Dolphin \n`,
        root,
      ),
    ).toBe(true);
  });
  it.each([
    '/Applications/Dolphin.app/Contents/MacOS/Dolphin',
    `${root}-other/2609/Dolphin.app/Contents/MacOS/Dolphin`,
    `${root}/.dolphin-stage-abc/Dolphin.app/Contents/MacOS/Dolphin`,
    `${root}/2609/Dolphin.app/Contents/MacOS/Dolphin Updater`,
    `${root}/2609/Dolphin.app/Contents/MacOS/Dolphin --exec game.dol`,
  ])(
    'does not confuse unrelated executables with managed sessions: %s',
    (line) => {
      expect(containsManagedDolphin(line, root)).toBe(false);
    },
  );
});
