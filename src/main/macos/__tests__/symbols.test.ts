import type { NativeImage } from 'electron';
import { symbolCSS } from '../symbols';

jest.mock('electron', () => ({ nativeImage: {} }), { virtual: true });

function image(url: string, empty = false) {
  return {
    isEmpty: () => empty,
    toDataURL: jest.fn(() => url),
  } as unknown as NativeImage;
}

describe('symbolCSS', () => {
  it('requests only the fixed SF Symbol names and masks their glyphs', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Typed to record the requested name.
    const render = jest.fn((_name: string) =>
      image('data:image/png;base64,AAAA'),
    );
    const css = symbolCSS(render);
    expect(render.mock.calls.map(([name]) => name)).toEqual([
      'folder',
      'square.stack.3d.up',
      'gamecontroller',
      'sofa',
      'memorychip',
      'display',
      'chevron.left.forwardslash.chevron.right',
      'arrow.clockwise',
      'sidebar.left',
      'folder.fill',
      'square.stack.3d.up.fill',
      'gamecontroller.fill',
      'sofa.fill',
      'memorychip.fill',
      'display',
      'chevron.left.forwardslash.chevron.right',
    ]);
    expect(css).toContain(
      '.symbol[data-symbol="library"] { -webkit-mask: url("data:image/png;base64,AAAA")',
    );
    expect(css).toContain(
      '.symbol[data-symbol="refresh"] > svg { visibility: hidden; }',
    );
  });

  it('keeps the vector fallback for symbols this Mac cannot render', () => {
    const css = symbolCSS((name) =>
      name === 'folder' ? image('', true) : image('data:image/png;base64,AA=='),
    );
    expect(css).not.toContain('data-symbol="library"');
    expect(css).toContain('data-symbol="emulators"');
  });

  it('never injects anything but base64 PNG data', () => {
    const css = symbolCSS(() =>
      image('data:image/png;base64,AA"); } body { display: none'),
    );
    expect(css).toBe('');
  });
});
