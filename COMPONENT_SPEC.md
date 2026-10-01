# Component specification v1

The first implementation is `src/main/components`. A component exports a validated immutable manifest and adapter. Registry consumers use `getComponent(id)`, `checkCompatibility`, `paths` and `planLaunch`; no shell commands are accepted from the renderer.

A manifest requires schema version, safe ID, display name, system IDs, Darwin minimum OS, native architecture, official project/release URLs, license, exact bundle/executable, ROM suffixes and explicit lifecycle capability states. Unknown keys are rejected. Trust policy is supplied independently by code; metadata cannot authorize a new executable or download origin by itself. See `schema.ts` and its tests for the executable contract.

Dolphin/GameCube is the only initial adapter. The plan returns executable + argument array + working directory. `--user` scopes configuration and saves to the chosen library; ROMs are under `roms/gc`. Config lives in `emulators/dolphin/User/Config`, GameCube save data in `User/GC`, save states in `User/StateSaves`. Reset must only affect declared configuration, never the whole User tree. Later migration must preserve unknown files.

Plans are NOT execution authority. At execution, resolve and verify realpaths, volume identity, permissions, bundle identity/architecture/signature and supported files. Lexical path containment does not defend against symlinks or a removed/replaced drive. Do not execute a plan directly from imported metadata.

Installer evolution: official source discovery → bounded verified staging → read-only image inspection → bundle/architecture/Gatekeeper checks → owned versioned machine-local installation → journaled activation. Retain prior versions until migration/rollback has been proven. No global emulator installation is overwritten. No artifact-local scripts run.

Capability states are intentionally conservative. BIOS, firmware, profiles, per-game settings, update/rollback, controller mapping and ES-DE must gain real implementations and tests before their state changes to available. See source-linked research in `docs/research/components.md`.
