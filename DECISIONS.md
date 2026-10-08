# Decisions

## 001 — Preserve the upstream platform implementation

Keep baseline tags, source history, GUI submodule and Linux/Windows build paths. Build-time Mac entry selection prevents loading unsafe legacy IPC while native services are introduced. Avoid mechanically rewriting the 1,710-line shell broker.

## 002 — Dolphin / GameCube first

Official Dolphin supplies a Universal macOS build and explicit --user directory isolation, making configuration versus save ownership testable. GameCube has a mature emulator and no mandatory proprietary BIOS for ordinary use. Wii, other emulators and speculative hardware tuning wait for the vertical slice. Research evidence and limitations live in docs/research/components.md.

## 003 — Neutral development identity

Use Emulation Workspace / dev.emulation.workspace for Mac development builds. Do not imply affiliation with EmuDeck or RetroDECK. Keep source attribution and all notices. Do not publish until GUI submodule and mixed MIT/GPL/Pegasus notices are resolved.

## 004 — Facts before product claims

Unsigned package, working window, validated manifest and passing unit tests are separate milestones. None imply a working controller/game/save/install lifecycle. STATUS.md distinguishes working, partial, untested, blocked and planned.

## 005 — Original ROM paths stay out of the frontend shell

Pinned ES-DE3.5 source launches Unix commands through a shell and does not escape every metacharacter in ROM filenames. Use an opaque owned catalog and a small native authenticated wait client; resolve the original ROM only in main and pass it directly as Dolphin argv. This preserves original filename-based save identity without moving/renaming user files. Do not enable product Console Mode until its real launch/return/save/controller flow passes.

## 006 — Deliberately unsigned development packages

The local preview does not silently select an installed Apple Development certificate. A reviewed Developer ID must be explicitly selected using EMULATION_SIGNING_IDENTITY. No notarization success is claimed. Preserve full Electron/Chromium and React runtime notices, the upstream license documents and research inventory alongside an original neutral icon.

## 007 — Keep text zoom; degrade like a native split view

The macOS visual critic recommended disabling page zoom because native apps do not page-zoom. Rejected: it is this app's only text-size accommodation and 200% zoom is an existing accessibility gate. Instead, type never changes size at breakpoints and narrow or zoomed windows collapse the sidebar behind a toolbar toggle (NSSplitView behaviour) rather than shrinking it.

## 008 — Native helpers only where Electron cannot reach

`activate-app` exists because Electron cannot activate another process and ES-DE has no focus restoration, while an unfocused ES-DE ignores controller input. It is a separate single-purpose binary that main invokes with argv; it validates exact PID, owner UID and managed bundle and activates nothing else. SF Symbols are never exported or embedded (licensing ambiguity). Instead main asks AppKit to render the system's own symbols at runtime (`nativeImage.createFromNamedImage`) and injects them as CSS masks via `insertCSS`; fixed names only, base64-PNG-validated, with the original vector glyphs as fallback when a symbol is unavailable.

## 009 — The manager owns its children's privacy identity

macOS attributes a spawned process's protected-resource access (TCC) to the responsible launcher. ES-DE was terminated with SIGABRT when SDL probed Bluetooth controllers from a launcher lacking `NSBluetoothAlwaysUsageDescription`. The packaged app therefore declares every usage key its managed frontends and emulators need, with honest wording (Bluetooth now; camera before PPSSPP ships; microphone if a component emulates one). Developer harnesses that spawn emulators run inside the packaged binary through LaunchServices (`open -n --env ELECTRON_RUN_AS_NODE=1 -a …`) so their identity matches the product.

## 010 — The Mac app is a GPL-3.0-or-later fork with a checked module boundary

Upstream's `LICENSE.md` is GPL-3.0-or-later; `LICENSE` is the MIT notice of Electron React Boilerplate, from which the build tooling descends. The Mac package is distributed as GPL-3.0-or-later (`extraMetadata.license`), keeps both notices, and ships `licenses/SOURCE.txt` naming the exact public commit as Corresponding Source; `Info.plist` records that revision and whether the tree was dirty. The version line restarts at 0.1.0 rather than continuing EmuDeck's 2.x numbering.

The GUI submodule's provenance question does not reach the Mac package: webpack stats show zero submodule or legacy renderer/main files, and the only bundled packages are react, react-dom, scheduler (MIT, notices shipped) and the css-loader runtime. `verify-macos-modules.js` now fails every Mac build that bundles anything outside `src/main/macos`, `src/main/components`, `src/renderer/macos`, `src/shared/macos.ts` or that package allowlist. The submodule stays in the repository for the upstream Linux/Windows build (Decision 001). This is an engineering record, not legal advice; the owner confirms before the first public release.

## 011 — Hardened runtime with JIT only; sign outside iCloud

Electron needs `com.apple.security.cs.allow-jit` and nothing else: an ad-hoc, hardened-runtime copy with only JIT (plus `disable-library-validation`, needed solely because ad-hoc signatures have no Team ID) passed the full packaged smoke on 2026-10-08. Upstream's file also grants `allow-unsigned-executable-memory`, so the Mac config uses its own `entitlements.macos-workspace.plist` and leaves upstream's untouched. Developer ID builds share one team and need no library-validation exception.

A checkout in iCloud Drive gets `com.apple.FinderInfo`/File Provider attributes on bundle folders, which codesign rejects, and iCloud re-adds them within seconds. `afterPack` strips them, and `release:macos` stages the whole build in the system temporary folder. Releases use `notarytool` with a keychain profile; the upstream `electron-notarize`/Apple-ID-password hook is not used.
