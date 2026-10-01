# Status

Development checkpoint, 2026-09-30. This is not a production-ready emulator environment.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Untouched source baseline | working | Both tags resolve to initial commit; reference repository untouched |
| Baseline production bundle | working | npm run build exit 0 |
| Baseline unsigned ARM64 .app | partial | Packages using installed Electron; launches legacy backend-loading screen |
| Mac development tooling | working | Isolated development preload/status/screenshot smoke passes |
| Baseline typecheck/tests/lint | blocked | Existing failures recorded in MACOS_PORT.md |
| Safe Mac bootstrap | working | Native folder picker, narrow IPC, no legacy broker, packaged smoke passes |
| Component architecture | partial | Validated Dolphin manifest and launch plans; other emulators research only |
| Emulator install/config/update/rollback | partial | Verified installer helper under runtime test; config reset preservation tests pass; lifecycle not complete |
| ES-DE and homebrew game lifecycle | planned | Requires real launch/save verification |
| DualSense / controller-only | untested | Physical device and real frontend needed |
| Signing/notarization | blocked | Distribution identity and credentials not configured |
| License/trademark clearance | blocked | Mixed notices and GUI submodule provenance unresolved |
| External/network storage, reboot, clean user | untested | Required before release |
| Visual/accessibility gauntlet | partial | First-launch light/dark/small reviewed twice; other states and VoiceOver remain |
