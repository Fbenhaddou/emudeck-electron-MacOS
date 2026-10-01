# macOS baseline and port

Observed host: ARM64, macOS 27.0 build 26A428, Node 24.19.0, npm 11.17.0, installed Electron 41.10.7. Dependency ranges differ from actual installed versions; preserve package-lock as the reproducibility source.

## Untouched baseline observations

- `npm ls --depth=0`: dependencies available.
- `npm run build`: succeeds. This is transpilation, not type safety.
- `tsc --noEmit`: fails in legacy main/preload/renderer and older Node declarations.
- `npm test -- --runInBand`: fails during compilation, zero tests run.
- `npm run lint`: webpack import resolver triggers dependency setup as a side effect and fails.
- `npm start`: initial sandbox port check misleadingly reports an occupied port. Running on port 4317 with local-network permission reaches actual webpack configuration errors: missing DLL invokes postinstall; npm 11 rejects propagated allow-scripts; fallback ESM load dereferences absent module.parent.
- Default directory package attempts to download Electron and fails restricted DNS. Using installed Electron distribution succeeds: `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64 --dir --publish never -c.electronDist=node_modules/electron/dist`.
- Unsigned baseline .app launches. Native accessibility inspection sees a real EmuDeck window and “EmuDeck is loading… Building EmuDeck backend and running autodiagnostics in the background…”. Closed immediately. This is evidence of launch only; it is not successful onboarding/install. No user games were used.

## First implementation sequence

1. Record baseline and preserve tags/submodule/other platforms.
2. Fix development tooling without dependency installation inside lint/config evaluation.
3. Add isolated Mac main/preload entries, native state paths, typed read-only status and folder-picker IPC. Disable legacy shell broker and upstream auto-updater on Mac.
4. Add a minimal accessible management bootstrap, not a full visual redesign before launch verification.
5. Verify development build, production build, unsigned ARM64 .app launch with automated renderer/preload smoke and screenshots.
6. Add validated Dolphin/GameCube component and unit tests; keep unimplemented installation features explicitly planned.
7. Implement official artifact resolution, staging/verification/install, isolated config/save preservation and rollback before exposing install UI.
8. Integrate ES-DE with legal homebrew test content; verify game lifecycle, actual controller, saves and reset on physical Mac.
9. Only then expand management UI and emulator count; run visual, security and clean-environment gauntlets.

Signing, notarization, fresh-user/reboot tests, physically disconnected storage and DualSense tests must be reported separately. Never infer them from a webpack success.

## Verified implementation checkpoint (2026-10-02)

- `npm start` routes to the bounded Mac build on Darwin; `PORT=4318 node .erb/scripts/smoke-macos.js --dev` passes real preload/status/security checks. Production/default webpack eval bundling was inappropriate for sandboxed development preload; explicit source maps fix it without relaxing CSP. Main/preload edits require restarting the dev process; renderer recompilation is automatic (refresh the window to display it).
- `npm run build:macos` and `npm run package:macos` succeed using installed native Electron. Packaged smoke passed at `emulation-smoke-KHN26v/report.json` in the host temporary directory, with light/dark/small captures. This is unsigned development packaging, not distributable notarization.
- `npm run build:legacy` still succeeds. Explicit Windows/Linux scripts select that build regardless of host OS. Existing CI remains; a separate macos-15 ARM64 smoke workflow was added but has not run remotely.
- Dependency postinstall no longer asks Electron Builder to run a nested install for an empty production dependency manifest. Lint's webpack resolver is side-effect-free. Full legacy lint now reaches its pre-existing debt (thousands of findings), rather than failing in dependency setup; new Mac code has a separate gate.
- Scoped Mac typecheck uses strict source checking with skipLibCheck only for third-party declaration incompatibilities (@types/node17 versus TypeScript5.9). This does not repair the legacy whole-repository typecheck. Existing ts-jest28 warns about TypeScript5.9; upgrading that test stack remains work.
- No submodule pointer or baseline tag changed. No reference files copied or modified.
