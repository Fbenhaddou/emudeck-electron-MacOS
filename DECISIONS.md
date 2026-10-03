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
