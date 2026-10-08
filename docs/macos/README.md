# Emulation Workspace for macOS

A Mac-native fork of EmuDeck's Electron app: a Management Mode styled after System Settings and a controller-first Console Mode built on ES-DE, for Apple Silicon. Upstream EmuDeck files at the repository root are unchanged; everything Mac-specific is documented here.

| Document | What it covers |
| --- | --- |
| [STATUS.md](STATUS.md) | What works, what is partial, untested or blocked — with evidence |
| [TESTING.md](TESTING.md) | Test commands, physical-test profile, end-to-end procedures |
| [DECISIONS.md](DECISIONS.md) | Numbered design decisions and their reasons |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Processes, data locations, security boundaries |
| [COMPONENT_SPEC.md](COMPONENT_SPEC.md) | Emulator component manifests and adapters |
| [RELEASING.md](RELEASING.md) | Signing, notarization and release checklist |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Original phased plan |
| [MACOS_PORT.md](MACOS_PORT.md) | Baseline audit of the upstream repository |
| [research/](research/) | Per-component research, artifacts and license inventory |

## Everyday commands

| Command | Result |
| --- | --- |
| `npm run package:macos` | Builds the unsigned app: `release/build-macos/mac-arm64/Emulation Workspace.app` |
| `npm run dmg:macos` | Same, plus `release/build-macos/Emulation Workspace-<version>-arm64.dmg` |
| `npm run test-app:macos` | Opens the built app on the test profile in `~/Emulation Workspace Test` |
| `npm run smoke:macos` | Automated visual and bridge smoke with screenshots |
| `npx jest -c jest.macos.config.js` | Unit, IPC and renderer tests |
| `npm run typecheck:macos` | Strict TypeScript check of the Mac code |
| `npm run release:macos` | Signed, notarized release (needs a Developer ID; see RELEASING.md) |
