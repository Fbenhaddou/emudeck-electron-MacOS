# Architecture assessment

Audit: 2026-09-30. Application: `EmuDeck-macOS`; neighboring `retrodeck-reference` is read-only research material.

## Untouched reference

HEAD began at `a6848a47610143facefd672350e19595f70007e5`. Both `upstream-baseline^{}` and `macos-verified-baseline^{}` resolve to that commit. Neither tag is modified. Use `git diff upstream-baseline` at each checkpoint.

## Existing application

Electron React Boilerplate, webpack 5, TypeScript 5, React 19, React Router 7, Sass, Electron Builder. Main and preload compile into `release/app/dist/main`; renderer into `release/app/dist/renderer`. Dependencies are installed at repository root; production application metadata is under `release/app`. Webpack transpiles without checking types.

`src/main/main.ts` combines lifecycle, IPC, shell execution, remote backend checkout, settings, updates, library scanning and launch in 1,710 lines. `preload.ts` exposes arbitrary send/on/once channels. `App.tsx` combines routing and global configuration state; mostly JSX pages build shell commands. Emulator metadata is spread across pages, global state and a separately downloaded backend. Darwin backend setup clones and executes Linux-oriented Bash. Linux and Windows have distinct Bash/PowerShell workflows and must be preserved during the Mac work.

The GUI submodule is pinned at `b5efe87b50ea2395f32e67cfe7105fcb79f03cad` (`src/renderer/components`). Keep its pointer unchanged. Existing CI runs on Ubuntu and packages Windows/Linux; it does not verify Mac runtime, storage or IPC. One shallow renderer test exists and currently fails before executing assertions.

## macOS seam

Keep the existing application, bundler, release layout, and upstream paths. Select platform-specific main/preload/renderer entries at build time. The Mac entry does not import the legacy shell broker. This is an incremental platform boundary, not a replacement repository. New main-process services own state and native capabilities; a sandboxed renderer calls explicit typed preload methods. Components own metadata and behavior; shared services own installation transactions, filesystem safety and process supervision.

Machine state belongs in Application Support/Emulation Workspace. User-chosen library content remains portable. Never silently migrate ~/.config/EmuDeck or change existing saves. Management and ES-DE console frontend remain distinct. See COMPONENT_SPEC.md, SECURITY.md and DECISIONS.md.

## Mac main process layout (2026-10-08)

`src/main/macos/main.ts` is only the composition root: app identity, the smoke/test profile guard, then it wires the domain modules in `src/main/macos/app/`:

- `context.ts`: the window, library lookup, the busy guard (`busy`, `addBusy`, `exclusive`) and `handle()`, which validates every IPC caller (trusted main frame, argument allowlist) before a handler runs;
- `emulators.ts`: Dolphin, the pinned-app emulators, the system list, and install/play/reset handlers;
- `console.ts`: the ES-DE session, its install (license sheet answered only by the user) and enter handlers;
- `controllers.ts`, `library.ts`, `firmware.ts`, `diagnostics.ts`, `status.ts`: one domain each, registering its own handlers;
- `window.ts`: the window, menu, single-instance and quit guard.

Packaging while the owner's test app is running from `release/build-macos/mac-arm64` would replace a bundle in use. Package into `release/build-macos/staging` instead (`-c.directories.output=release/build-macos/staging`; the folder is git-ignored).
