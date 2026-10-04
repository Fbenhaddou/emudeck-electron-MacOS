/* eslint import/prefer-default-export: "off" -- Single focused capability. */
import { nativeImage } from 'electron';

/**
 * Renderer glyph keys mapped to SF Symbol names. AppKit renders the system's own
 * symbols at runtime; no Apple artwork is exported, bundled or redistributed.
 */
const symbols: Readonly<Record<string, string>> = Object.freeze({
  library: 'folder',
  emulators: 'gamecontroller',
  'this-mac': 'desktopcomputer',
  development: 'chevron.left.forwardslash.chevron.right',
  refresh: 'arrow.clockwise',
  sidebar: 'sidebar.left',
});

/**
 * Builds mask rules for every symbol this Mac can render. Missing symbols keep
 * the renderer's original vector glyph. Only fixed names and AppKit-produced PNG
 * data reach insertCSS.
 */
export function symbolCSS(
  render: typeof nativeImage.createFromNamedImage = (name) =>
    nativeImage.createFromNamedImage(name),
): string {
  return Object.entries(symbols)
    .map(([key, name]) => {
      const image = render(name);
      if (image.isEmpty()) return '';
      const url = image.toDataURL({ scaleFactor: 3 });
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url)) return '';
      return `.symbol[data-symbol="${key}"] { -webkit-mask: url("${url}") center / contain no-repeat; background: currentColor; }
.symbol[data-symbol="${key}"] > svg { visibility: hidden; }`;
    })
    .filter(Boolean)
    .join('\n');
}
