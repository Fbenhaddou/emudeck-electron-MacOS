import { stableGameID } from '../es-de/ids';

const secret = new Uint8Array(32).fill(7);
const game = {
  volume: 'A1B2C3D4-0000-0000-0000-000000000001',
  file: 123456n,
  relativePath: 'roms/gc/Homebrew; rm -rf ~ `x`.iso',
};

describe('stable opaque game IDs', () => {
  it('is stable across sessions and matches the catalog marker grammar', () => {
    const id = stableGameID(secret, game);
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(stableGameID(secret, { ...game })).toBe(id);
  });

  it('reveals nothing of the original filename', () => {
    expect(stableGameID(secret, game)).not.toMatch(/rm|Homebrew|iso/);
  });

  it.each([
    ['another volume', { volume: 'other' }],
    ['another file identity', { file: 123457n }],
    ['another path', { relativePath: 'roms/gc/other.iso' }],
  ])('changes for %s', (_label, change) => {
    expect(stableGameID(secret, { ...game, ...change })).not.toBe(
      stableGameID(secret, game),
    );
  });

  it('differs per installation secret', () => {
    expect(stableGameID(new Uint8Array(32).fill(8), game)).not.toBe(
      stableGameID(secret, game),
    );
  });

  it('cannot be made to collide by moving separators between fields', () => {
    const left = stableGameID(secret, {
      volume: 'a',
      file: 1,
      relativePath: 'b/c',
    });
    const right = stableGameID(secret, {
      volume: 'a1',
      file: 1,
      relativePath: 'b/c',
    });
    expect(left).not.toBe(right);
  });

  it('treats NFC and NFD forms of a Unicode name as the same game', () => {
    const composed = stableGameID(secret, {
      ...game,
      relativePath: 'roms/gc/Pokémon.iso',
    });
    const decomposed = stableGameID(secret, {
      ...game,
      relativePath: 'roms/gc/Pokémon.iso',
    });
    expect(decomposed).toBe(composed);
  });

  it.each([
    [new Uint8Array(16), game],
    [secret, { ...game, volume: '' }],
    [secret, { ...game, relativePath: '/abs/path.iso' }],
    [secret, { ...game, relativePath: 'roms/../x.iso' }],
    [secret, { ...game, relativePath: 'roms//x.iso' }],
    [secret, { ...game, file: -1 }],
  ])('rejects invalid input %#', (key, identity) => {
    expect(() => stableGameID(key, identity)).toThrow();
  });
});
