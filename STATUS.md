# Status

Development checkpoint, 2026-09-30. This is not a production-ready emulator environment.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Untouched source baseline | working | Both tags resolve to initial commit; reference repository untouched |
| Baseline production bundle | working | npm run build exit 0 |
| Baseline unsigned ARM64 .app | partial | Packages using installed Electron; launches legacy backend-loading screen |
| Baseline development tooling | blocked | DLL/postinstall npm 11 lifecycle error and module.parent assumption |
| Baseline typecheck/tests/lint | blocked | Existing failures recorded in MACOS_PORT.md |
| Safe Mac bootstrap | planned | Narrow IPC, no legacy shell operations |
| Component architecture | planned | Dolphin/GameCube first; research in docs/research |
| Emulator install/config/update/rollback | planned | No verified end-to-end installation |
| ES-DE and homebrew game lifecycle | planned | Requires real launch/save verification |
| DualSense / controller-only | untested | Physical device and real frontend needed |
| Signing/notarization | blocked | Distribution identity and credentials not configured |
| License/trademark clearance | blocked | Mixed notices and GUI submodule provenance unresolved |
| External/network storage, reboot, clean user | untested | Required before release |
| Visual/accessibility gauntlet | planned | All important states and VoiceOver remain to verify |
