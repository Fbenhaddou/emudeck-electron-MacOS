# Implementation sequence and audit — 2026-10-03

This is an incremental macOS port of the existing EmuDeck Electron repository. The actual directory is `EmuDeck-macOS` (capitalization matters). `../retrodeck-reference` is read-only. Baseline tags and the GUI submodule pointer remain unchanged. Work already present at the start of this audit was verified and saved locally as `79ec80b` before further changes.

## 1. Architecture assessment

The upstream Electron React Boilerplate build uses webpack, TypeScript, React, Sass, Electron Builder, a GUI-components submodule, and a remotely checked-out shell backend. Upstream main combines lifecycle, IPC, settings, shell execution, backend installation, filesystem work, launches, and auto-update in one 1,710-line module. The upstream preload permits generic IPC channels and the renderer has Node/Electron imports. These are unsuitable for a sandboxed macOS management renderer. Linux/Windows behavior remains in its existing entries and workflows.

The existing Mac seam retains the repository, bundler and release layout while selecting independent main/preload/renderer entries. Main owns native dialogs, trusted installation and process supervision; preload exports explicit zero-argument methods; React has no Node access. The component registry validates trusted manifests and produces argument arrays rather than shell commands. See ARCHITECTURE.md and COMPONENT_SPEC.md for boundaries. Do not expand to a multi-emulator dispatcher until the Dolphin lifecycle is verified.

## 2. Current development build

Dependencies are already installed and `npm ls --depth=0` succeeds. Host is Apple Silicon ARM64, macOS 27.0, Node 24.19.0, npm 11.17.0, Electron 41.10.7. At entry, scoped typecheck, lint and89 existing Mac tests passed. The current suite has287 passing tests plus20 actual Swift protocol checks; legacy debt remains documented. `npm run smoke:macos -- --dev` launched the real development Electron window and exercised its real sandboxed preload. The restricted shell initially denied the localhost listener (`EPERM ::1:4318`); rerunning with local desktop/network access passed. That was a sandbox restriction, not a port conflict.

## 3. Current production build

`npm run build:macos` and `npm run package:macos` succeed with installed native Electron. The newly packaged `.app` passed the real renderer/preload smoke. This confirms local unsigned development packaging only. No Developer ID Application identity is configured, and no notarization succeeded. Production webpack transpilation is not typechecking. Existing baseline full-repository typecheck/test/lint failures remain documented in MACOS_PORT.md.

## 4. Major blockers

- Resolved in this checkpoint: surviving managed Dolphin processes block reset/second launch; management quit is guarded during active operations.
- Resolved in this checkpoint: renderer polling continues through game exit, and native Refresh preserves page/focus while updating status.
- Resolved within tested owned-install boundaries: journaled staging and recovery permit retry while preserving unknown data. Real update/rollback gauntlet remains.
- ES-DE uses a shell launcher. Its current escaping omits backticks and pipes; plain XML generation with `%ROM%` is unsafe for arbitrary untrusted filenames. Console Mode needs a reviewed safe launch boundary and real lifecycle tests.
- Physical DualSense, homebrew gameplay/save/restart, external APFS/exFAT remount, fresh user, reboot and VoiceOver have not passed the requested gauntlet.
- Signing credentials, fork-owned update feed, distribution license provenance and final product branding remain unresolved. Do not claim production readiness or use the upstream EmuDeck update feed.

## 5. Component architecture

Retain `src/main/components/<id>` for metadata, artifact policy, launch arguments and emulator-specific configuration. Main-process shared services own bounded transport, install journals, signature/Gatekeeper verification, operation coordination, process lifecycle, library availability and diagnostics. Component-specific data remains with the component. Persist installed bundles/receipts in machine-local Application Support; ROMs, controlled emulator user directories and saves remain in the chosen portable library. Frontend integration is a separate boundary; never accept arbitrary executable paths/commands over IPC. RetroDECK recipes/manifests/launchers inform the separation, not implementation copying or Flatpak porting.

## 6. First vertical slice

Dolphin / GameCube remains the best first slice: mature official upstream, Universal macOS artifact, native ARM64 executable, developer signature/Gatekeeper verification already proven on an official image, explicit `--user`, and no mandatory proprietary GameCube BIOS for ordinary use. PPSSPP is a later candidate. Keep the other researched emulators out of the UI until the complete slice works. Confirm latest release metadata at install time, rather than hardcoding a machine generation or promising game compatibility.

## 7. Exact next implementation order

1. Verify and checkpoint existing Mac changes; independently audit architecture, security, current official sources and actual screenshots. **Done at entry to this checkpoint.**
2. Reconcile surviving managed Dolphin processes at startup and before mutations; prevent management quit during live games/operations. Recheck selected library identity before configuration and process creation. Add regression tests for these boundaries. **Implemented and tested.**
3. Install into owned journaled staging, verify native architecture/publisher/Gatekeeper, detach before activation, recover only proven-owned incomplete installs, preserve unknown folders. Test failed attach, failed detach, interruption and retry. **Implemented and tested, including real2606a→2609 failed-signature/retry/restart preservation. Product rollback/repair and cross-version save compatibility remain.**
4. Fix operation-specific UI feedback, automatic return to idle, dark-mode contrast and narrow-window/text-zoom behavior. Capture every currently implemented state and have the Mac critic review it. **40-state smoke and native Close/Refresh/reopen/quit and all-page zoom reviews passed. VoiceOver remains.**
5. Exercise actual official Dolphin installation and native launch with isolated temporary data and licensed/authored homebrew only. Compare save/config data before and after reset; clearly separate synthetic preservation evidence from real gameplay saves. **Official trusted Dolphin and documented homebrew derivative rendered; real emulator savestate restored and preserved across Config resets. Game-created memory-card progress remains.**
6. Implement a safe ES-DE launch boundary for arbitrary game filenames; verify frontend discovery, attached emulator lifecycle and focus. Then test physical DualSense and actual save/restart behavior. **Developer-only frontend launch/exact-child exit/return passed with VSync disabled; automatic focus, physical DualSense and product integration remain.**
7. Expand management capabilities and emulator count only after that slice is reliable. Add BIOS/firmware workflows, controller capability detection, profiles, diagnostics, update/rollback, real storage recovery and accessibility evidence in tested milestones.
8. Complete DMG metadata/icon/notices, signing/notarization and clean-environment gauntlet before any production release. Keep local logical commits; no experimental automatic push.

Each implementation step is followed by scoped lint/typecheck/tests, real build/launch checks when affected, specialist review, fixes and honest STATUS.md updates. Screenshot fixtures prove rendering only, not installation, gameplay or controller behavior.
