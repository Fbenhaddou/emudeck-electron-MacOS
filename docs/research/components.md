# Component research — 2026-09-30

## RetroDECK concepts adopted, runtime excluded

Read-only reference inspected at commit `9aff8f68a4f521fffb835d5f62ed18628d8dc349`. No reference code was copied or modified.

[Architecture Overview](https://retrodeck.readthedocs.io/en/latest/wiki_development/general/retrodeck-architecture-overview/) separates build recipes from runtime component metadata, launchers and configuration functions. It keeps component-specific behavior with its component. Its Flatpak subsandboxes, shared library layers, Linux XDG directories and Alchemist artifact assembly are Linux implementation choices; none should be reproduced in this application.

[Creating Component Files](https://retrodeck.readthedocs.io/en/latest/wiki_development/components/component-guide/creating-components-ingredients-guide/) tests a launcher before adding remaining ingredients and integrating ES-DE. Transfer that order: prove one macOS launch, then configuration, preservation and frontend integration.

[component_manifest.json](https://retrodeck.readthedocs.io/en/latest/wiki_development/components/component-files/component-ingredient-manifest/) holds identity, supported systems, menu metadata, presets, actions and optional core/BIOS data. [component_launcher.sh](https://retrodeck.readthedocs.io/en/latest/wiki_development/components/component-files/component-ingredient-launcher/) sets up the component environment and is the common entry point for frontend, configurator and CLI. Our equivalent should produce a typed process plan and let a reviewed main-process runner execute it, without evaluating configuration as shell code.

Local evidence: `functions/api_data_processing.sh:140` discovers manifests and returns component metadata; `functions/presets.sh` applies component-owned preset declarations; `functions/other_functions.sh:1225` dispatches a component launcher. `automation_tools/install_components.sh` expects `FLATPAK_DEST`, extracts component archives and merges shared libraries. This is useful architectural evidence, not portable installer code. The reference's top-level LICENSE is GPLv3; independently implement concepts and preserve attribution to the research. Do not assume MIT compatibility for copied implementations.

## First vertical slice: Dolphin, GameCube only

The [official Dolphin download page](https://dolphin-emu.org/download/) currently offers release **2609** as **macOS ARM/Intel Universal**. [Upstream README](https://github.com/dolphin-emu/dolphin) specifies macOS 11+, GPLv2-or-later, `--user`, `--exec`, `--batch` and version detection. A controlled user directory makes configuration reset and save preservation testable without changing an existing global Dolphin installation. Select one GameCube homebrew application, not Wii firmware/NAND workflows, for the first runtime test.

[PPSSPP downloads](https://www.ppsspp.org/download/) currently offer **1.20.4** and a macOS DMG; [macOS guidance](https://www.ppsspp.org/docs/reference/mac/) describes conventional drag-to-Applications installation. It is a strong second candidate. The landing page does not establish the DMG's Mach-O architectures; inspect the actual artifact before labeling it ARM64/Universal. [PPSSPP license](https://github.com/hrydgard/ppsspp/blob/master/LICENSE.TXT) is GPLv2, not the host application's MIT license. Do not infer that free download means no redistribution obligations.

For either emulator, select stable upstream releases, inspect architecture with Mach-O tooling, verify bundle metadata and upstream signing/checksums where available. A locally computed hash records bytes but does not establish publisher authenticity. Preserve quarantine; never globally disable Gatekeeper. No signing, artifact or gameplay verification was performed by this research task.

## ES-DE on macOS

[Official ES-DE site](https://es-de.org/) lists **3.5.0**, released today, separate Apple and Intel macOS packages, and macOS 11+. It expressly distinguishes freely distributable desktop releases from restricted Android distribution. [Desktop source license](https://gitlab.com/es-de/emulationstation-de/-/raw/master/LICENSE) is MIT; include its notices and separately audit bundled dependencies/themes/artwork.

[Current advanced configuration guide](https://gitlab.com/es-de/emulationstation-de/-/raw/master/INSTALL.md) documents `--home`: passing a library root gives an `ES-DE` data subdirectory and changes default ROM resolution. Generate only owned overrides in `ES-DE/custom_systems/es_systems.xml` and `es_find_rules.xml`, backing up conflicts. Older guides use `.emulationstation`; do not import that obsolete path. Use an explicit absolute ROM directory and an executable/argument template tested against ES-DE's escaping rules. XML escaping alone does not prevent command injection. Keep the emulator process attached so ES-DE can observe exit and restore its frontend. Do not use a detached `open` invocation as proof of lifecycle integration.

## Proposed TypeScript boundaries

- A versioned, strict manifest describes identity, platform requirements, source/provenance, bundle executable, supported ROM formats, lifecycle capabilities and documentation links. Unknown fields are rejected. A separately trusted policy restricts executable paths and release URLs; a downloaded manifest cannot enlarge its own allowlist.
- A component adapter owns compatibility checks, release selection, launch argument generation, configuration migration/reset plans and typed paths. No giant central emulator switch.
- Main-process services own downloads, bounded extraction, signature checks, staging/atomic replacement, cancellation, operation locks and rollback. Components describe plans; renderer IPC requests narrow operations by component ID.
- Separate machine-local application state/cache/installed bundles from portable library ROMs and emulator user data. Pass an explicit library root, validate path boundaries, and never recursively reset the entire emulator user directory.
- Reset backs up and changes only declared configuration files. Save/state folders are preserved. Rollback binary and configuration schema together; keep migration journal and old version until a tested recovery point.

The initial schema deliberately covers only the first adapter's proven metadata and pure launch/path planning. Installation, controller mapping, frontend generation and firmware are capability states, not fake completed operations.

## Required evidence before declaring the slice working

Unit tests: malformed manifests; attacker URLs/credentials/ports; executable traversal; unsupported architecture/OS; spaces, Unicode, shell metacharacters, traversal; save/config separation; unsupported ROM formats; deterministic launch argument arrays. Filesystem tests must additionally resolve symlinks, verify volume availability and permissions, and prevent TOCTOU misuse. Pure lexical path validation is not a filesystem security boundary.

Runtime: download verified official artifact; inspect ARM64; launch managed user directory; legally licensed homebrew loads; ES-DE discovers it; DualSense maps and exits without keyboard; ES-DE focus restores; saving survives restart; reset preserves save bytes. Record exact homebrew source, license, build instructions and artifact hash. Do not fetch commercial ROMs, firmware or console keys. Controller haptics/motion/battery and external-volume reconnect remain untested until measured on real hardware.
