# Decisions

## 001 — Preserve the upstream platform implementation

Keep baseline tags, source history, GUI submodule and Linux/Windows build paths. Build-time Mac entry selection prevents loading unsafe legacy IPC while native services are introduced. Avoid mechanically rewriting the 1,710-line shell broker.

## 002 — Dolphin / GameCube first

Official Dolphin supplies a Universal macOS build and explicit --user directory isolation, making configuration versus save ownership testable. GameCube has a mature emulator and no mandatory proprietary BIOS for ordinary use. Wii, other emulators and speculative hardware tuning wait for the vertical slice. Research evidence and limitations live in docs/research/components.md.

## 003 — Neutral development identity

Use Emulation Workspace / dev.emulation.workspace for Mac development builds. Do not imply affiliation with EmuDeck or RetroDECK. Keep source attribution and all notices. Do not publish until GUI submodule and mixed MIT/GPL/Pegasus notices are resolved.

## 004 — Facts before product claims

Unsigned package, working window, validated manifest and passing unit tests are separate milestones. None imply a working controller/game/save/install lifecycle. STATUS.md distinguishes working, partial, untested, blocked and planned.
