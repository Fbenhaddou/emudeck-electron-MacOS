# Roadmap

Work through the phases in order. Within a phase, items can be reordered when one unblocks another.

## How to use this file

- Tick an item (`[x]`) only when its **Done when** criteria are met, verified and reflected in STATUS.md.
- Use `[~]` for built but awaiting the owner's physical verification.
- Items marked **(proposed)** are suggestions added on 2026-10-08. The owner may strike them.
- Items marked **(owner)** need the owner: physical hardware, accepting a license, Apple credentials.
- Prepare everything around these items, then hand over with exact instructions.

Legend: `[ ]` to do · `[~]` built, awaiting verification · `[x]` done · `[-]` dropped (say why)

---

## Phase 0 — Close out what's built

- [ ] **(owner)** Repair ES-DE in the test profile (accept its license). macOS purged its Info.plist before the profile moved to `~/Emulation Workspace Test`.
- [~] **(owner)** Escape-hatch hold rescues a deliberately frozen game (Dolphin and PPSSPP).
- [~] **(owner)** Precise stick response feels right in Dolphin; measure it, don't guess.
- [~] **(owner)** PSP save create → quit → reopen persists. Use Apollo Save Tool from `Fixtures/PSP`.
- [~] **(owner)** Real GameCube IPL import is recognized; Dolphin boots with it.
- [~] **(owner)** A real diagnostics report after a Console Mode session. Review it by hand: no names, paths or account data.
- [ ] **(owner)** Bluetooth DualSense, and two controllers at once.
- [ ] Console Mode crash reconciliation on a real ES-DE crash: the manager comes back, and the state is honest.
  - 2026-10-08: implemented and unit-tested (SIGABRT mid-game: waits for the game, removes the runtime, shows the manager with an honest message; stray unisolated ES-DE killed on next start). The real crash needs a working ES-DE, so it waits on the ES-DE repair above.

## Phase 1 — Code health before scaling (proposed)

Adding many emulators to today's structure would multiply the cost of every later change.

- [x] Split `src/main/macos/main.ts` (~1,200 lines) into per-domain modules: library, emulators, console, controllers, firmware, diagnostics, window.
  - Each module registers its own IPC handlers.
  - Behaviour unchanged; all tests green.
  - Done 2026-10-08: `main.ts` is 98 lines; modules in `src/main/macos/app/` (ARCHITECTURE.md). 576 tests, typecheck, lint, production and packaged smoke unchanged.
- [x] Split `src/renderer/macos/MacApp.tsx` (~1,500 lines) into one component per page, plus shared controls (`Hero`, `Segmented`, `Spinner`…).
  - Done 2026-10-08: `MacApp.tsx` (window shell, 452 lines), `controls.tsx`, `pages/*Page.tsx` with shared `PageProps`. Tests, production and packaged smoke unchanged; captures reviewed.
- [ ] Generate the four IPC/bridge inventories from one source, so a new method can't be forgotten in one of them:
  - the preload test;
  - the main-ipc channel list;
  - both smoke harness lists.
- [ ] One registry drives Console Mode systems, the library overview and firmware. A new emulator then touches only its own component folder plus one registry line.
  - **Done when:** adding a stub component needs no edits elsewhere except the registry and its tests.
- [ ] **Folder-format games.** The framework currently accepts only single-file games (`validateGame` requires a regular file), but PS4 (shadPS4), PS3 (RPCS3) and Wii U (Cemu) games are folders. Support folder games end to end:
  - component manifests declare a game as a file or as a folder with required markers (PS4: `eboot.bin` and `sce_sys/param.sfo`);
  - PS4 update (`<game>-UPDATE`/`-patch`) and DLC folders are recognised as such, not counted as games;
  - safe validation (no symlinks escaping the library, bounded scan);
  - ES-DE catalog entries;
  - library counts;
  - launch argv.
  - **Done when:** a synthetic folder game passes catalog → launch-plan → validation tests, with traversal and symlink refusals.
- [x] **PS4 research spike** (owner priority; shapes the framework, so do it in this phase). Research shadPS4's current state on macOS:
  - official release source and whether it has a native Apple Silicon build;
  - Metal/MoltenVK path;
  - compatibility and performance on M-series chips;
  - which PS4 system modules (firmware) users must dump from their own console, and where they go;
  - the expected game layout (game folder, updates, DLC);
  - controller and DualSense support;
  - config files and command-line launch;
  - ES-DE's `ps4` system support;
  - legally redistributable PS4 homebrew usable as a test fixture;
  - license.
  - Write `docs/macos/research/shadps4-component.md`, with a go / experimental / not-yet recommendation and RAM/chip minimums based on evidence.
  - Done 2026-10-08. Verdict: framework go, emulator not yet. shadPS4's Mac build is x86_64-only (refuses to run without Rosetta), unsigned and not notarized; needs macOS 26+; 16 GB practical minimum.
- [ ] **(owner)** Decide **Decision 012** (proposed): allow an opt-in *Experimental, unsigned upstream* tier for shadPS4? Pinned URL, size and SHA-256; Gatekeeper untouched; first launch approved by you in Privacy & Security; Rosetta only on your explicit confirmation. Alternatives: build from source signed with your Developer ID, or wait for upstream arm64. See the research doc's verdict.
- [ ] macOS ARM64 GitHub Actions workflow.
  - 2026-10-08: `.github/workflows/macos-smoke.yml` already exists but has never run (it triggers only on pull requests and is not on the default branch).
  - Runs jest, typecheck, lint, `build:macos` (module boundary) and smoke.
  - Existing Linux/Windows CI untouched.

## Phase 2 — Trust: saves and library safety (proposed)

- [ ] **Save snapshots:** automatic, versioned copies of every emulator's saves and save states:
  - before any update, reset, repair or managed-config change;
  - daily while the app is in use, with bounded retention.
  - **Done when:** a destructive test (corrupt a save, reset an emulator) restores byte-identically from the UI.
- [ ] **Saves page:** per system and per game, shows last played, snapshot history, Restore… (with confirmation), and Show in Finder.
- [ ] **Library health check:** read-only scan that reports problems:
  - games in the wrong system folder;
  - unsupported formats;
  - multi-disc sets without `.m3u`;
  - zero-byte or duplicate files;
  - names ES-DE will mis-parse.
  - Offers fixes that copy, or move only after explicit confirmation.
- [ ] **External drive resilience:**
  - unplug mid-session;
  - renamed volume;
  - exFAT case/permission quirks;
  - drive reconnected under a different mount path (identity already uses device/inode; extend to a volume UUID).

## Phase 3 — Effortless setup (proposed)

- [ ] **First-run setup** as a sheet sequence:
  1. Welcome.
  2. Choose library, with storage advice: free space, internal vs external.
  3. Pick systems: grid with system art and what each needs (BIOS yes/no).
  4. Install queue.
  5. Controller check.
  6. "Add your games" with an open folder.
  - It never appears again unless asked.
- [ ] **Install queue:**
  - installs every emulator for the chosen systems with one progress list;
  - individual retry;
  - resumable after quit;
  - honest per-item errors.
- [ ] **Drag and drop games** onto the window or Dock icon:
  - detected by extension and, where cheap, header magic;
  - copied into the right `roms/<system>`;
  - ambiguous files ask;
  - never moves or deletes the original.
- [ ] **Import from OpenEmu** (the main existing Mac emulator):
  - detect its library;
  - copy games, and saves where formats are compatible;
  - report what couldn't be migrated.
  - Also detect existing EmuDeck/RetroDECK folder layouts on an external drive.
- [ ] **Firmware guidance:** for each required file, say exactly what it is and where it comes from (dumped from your console), then validate it.
  - Where the manufacturer distributes firmware publicly (PS3 system software from Sony), open the official page or download from the official host with hash verification.

## Phase 4 — More systems

Each emulator follows the PPSSPP pattern:

- research doc;
- adapter;
- pinned app spec (exact URL, bytes, SHA-256, team, arm64);
- runtime;
- registry line;
- firmware declarations;
- managed controls for DualSense/Xbox;
- tests;
- smoke;
- package;
- owner physical check.

Verify each upstream is actively maintained and ships native Apple Silicon. Show any Intel-only requirement and never install Rosetta silently.

Order, by value and ease:

- [ ] **DuckStation** (PS1). Exercises the *required* BIOS path end to end, `.m3u` multi-disc and `.chd`. Check its current license and redistribution terms first.
- [ ] **PCSX2** (PS2). Required BIOS; heavier per-game settings.
- [ ] **RetroArch with curated cores** (NES, SNES, Game Boy/Color/Advance, Genesis/Mega Drive, Master System, PC Engine, N64, arcade where sensible). One component, per-core sub-manifests. Notes:
  - Cores come from the official buildbot with verification.
  - Audit each core's license: some are non-commercial.
  - Prefer one recommended core per system.
- [ ] **melonDS** (DS). Optional BIOS/firmware; dual-screen layout presets.
- [ ] **Azahar** (3DS, Citra's maintained successor). Verify status at the time.
- [ ] **Flycast** (Dreamcast).
- [ ] **RPCS3** (PS3). Official Sony firmware workflow (see Phase 3).
- [ ] **Cemu** (Wii U). User-supplied keys, treated like firmware.
- [ ] **shadPS4** (PS4), owner priority: a committed target, scheduled right after PCSX2 so the folder-game and firmware work is fresh. Labelled **Experimental** in the UI with plain expectations (limited compatibility, demanding on hardware).
  - Requirements:
    - user-dumped PS4 system modules through the firmware manager;
    - user's own game dumps only, never decrypted commercial content;
    - capability check (RAM, GPU family) with an honest warning on lower-end Macs;
    - managed DualSense controls;
    - exit hold;
    - Console Mode `ps4` system;
    - separate folders for updates and DLC.
  - If shadPS4 has no usable native Apple Silicon build when we reach it: say so in the app (no Rosetta install), and keep the component ready behind a version check so it switches on when upstream ships.
  - **Done when:** a legal PS4 homebrew fixture launches from Console Mode with the DualSense and exits cleanly; the owner verifies one of their own dumped games.
- [ ] **Vita3K** (PS Vita): only if mature on Apple Silicon at the time; mark experimental.
- [-] Switch emulation: deliberately excluded (legal risk; console keys).
- [ ] **Alternate emulator per system** (advanced). Example: PS1 via DuckStation or a RetroArch core. A per-system choice with sensible default.

## Phase 5 — Console Mode feels like a console (proposed)

- [ ] **One hotkey language across every emulator:**
  - hold Create+Options = quit (exists);
  - PS + R1 = save state;
  - PS + L1 = load state;
  - PS + Triangle = pause menu where the emulator has one.
  - Write it into each managed config, and show it once in Console Mode.
- [ ] **Artwork and metadata** via ES-DE's scraper. The owner's own ScreenScraper/TheGamesDB account, kept in the Keychain, never in plain files.
- [ ] **RetroAchievements** (Dolphin, DuckStation, PCSX2, PPSSPP and RetroArch support it): sign in once in Management Mode; token in the Keychain; hardcore toggle.
- [ ] **TV and display handling:**
  - choose the display for Console Mode;
  - handle HDMI hot-plug;
  - audio output follows the display;
  - macOS Game Mode engages;
  - ProMotion/VRR and HDR used only where detected.
- [ ] **Open Console Mode at login** (optional), and Dock/menu-bar "Open Console Mode".
- [ ] **Sleep/wake:** a running game survives sleep; controllers reconnect; no stuck fullscreen.
- [ ] **Per-game controller profiles,** and player assignment for multiple pads.
- [ ] **A curated ES-DE theme** that matches the product, if a license-compatible one exists or can be commissioned. Otherwise configure the default theme well.

## Phase 6 — Management Mode depth

- [ ] **Library browser:** games per system with cover art, playtime, last played; per-game sheet with settings overrides, saves, Show in Finder.
- [ ] **Capability-based profiles:** Recommended, Performance, Quality, Battery Saver, Maximum Compatibility, Custom.
  - Chosen from measured hardware (GPU family, RAM, display, power source).
  - Per-game overrides never leak into global settings.
- [ ] **Emulator updates:** check, review the change, update, automatic save snapshot, one-click rollback to the previous verified version.
- [ ] **Signed emulator catalog** (proposed): new pinned emulator versions ship as a small catalog file signed with the project's key (e.g. minisign/Ed25519). Updates can then land without a full app release; the app refuses unsigned or downgraded catalogs.
- [ ] **Storage page:**
  - usage per system, saves and states;
  - move library to another drive (copy → verify → switch → keep the old copy until confirmed).
- [ ] **Failure explanations:** when a launch fails, say why in plain words:
  - missing/invalid BIOS;
  - quarantine;
  - wrong architecture;
  - drive unplugged;
  - unsupported format;
  - known emulator limitation;
  - crash.
  - Each with a fix button where possible.
- [ ] **Accessibility pass:** VoiceOver audit of every page, Reduce Motion, Reduce Transparency, Increase Contrast, full keyboard navigation.
- [ ] **Localization:** reuse upstream's i18n where possible; start with languages the owner chooses.

## Phase 7 — Ship it

Current state of the three distribution blockers (2026-10-08):

- **Signing and notarization:** the pipeline is ready and its refusal paths are tested (`npm run release:macos`, docs/macos/RELEASING.md). Waiting only on the owner's Developer ID.
- **Licensing:** resolved for the Mac app (Decision 010). The GUI submodule is not in the Mac package at all; `verify-macos-modules.js` proves it on every build. The package is GPL-3.0-or-later with all notices and an exact-source notice. Remaining:
  - the owner's sign-off;
  - a license check of every emulator, ES-DE theme and RetroArch core as each is added.
  - The submodule question still applies to upstream's Linux/Windows build, which this project does not ship.
- **Clean-install testing:** not started. It needs a second macOS user account (the owner creates it; admin password), a reboot, and an external drive.

- [ ] **(owner)** Developer ID Application certificate (Apple Developer Program) and a notarytool keychain profile. Steps in RELEASING.md.
- [ ] **(owner)** License sign-off: read Decision 010 and confirm GPL-3.0-or-later distribution of the Mac app.
- [ ] First `npm run release:macos`: signed, notarized and stapled app and DMG; manifest with SHA-256.
- [ ] **Unsigned dry run first** (can start before the Developer ID). On a second macOS user account (the owner creates it), install the unsigned DMG and record every Gatekeeper prompt. Run first launch, onboarding, one emulator, a reboot and an external drive. This finds clean-environment bugs early; the signed run below then only re-checks trust.
- [ ] **(owner)** **Clean-environment gauntlet** on the downloaded, quarantined, signed DMG:
  - new macOS user;
  - install;
  - onboarding;
  - several emulators;
  - BIOS;
  - legal games;
  - DualSense only;
  - multiple systems;
  - save, restart the app, restart the Mac;
  - reconnect the external drive;
  - update and roll back an emulator;
  - corrupt and repair a config;
  - saves intact.
- [ ] **App self-updates:** signed update feed (electron-updater with a verified GitHub Releases feed, or a Sparkle-style appcast), with a decision recorded in DECISIONS.md.
- [ ] **User-facing docs:**
  - a fork README;
  - a short user guide (getting started, BIOS, controllers, troubleshooting);
  - GitHub issue templates that ask for the diagnostics report.
- [ ] **Privacy statement:** no telemetry, no accounts required, no network access except listed official download hosts and services the user turns on.
- [ ] **(owner)** Final project name and identity; trademark check before replacing the neutral development branding.
- [ ] **Independent review panel** (sub-agents): beginner, enthusiast, Mac developer, Electron security engineer, emulator developer, macOS designer, couch user, accessibility tester, future maintainer. Each must answer yes to: "Would you trust this application with your actual game library and saves?"
