# Testing

Baseline commands and failures are recorded in MACOS_PORT.md. Production webpack uses transpileOnly and cannot substitute for typecheck.

Required first gate: strict scoped typecheck for new Mac/shared/component code; focused Jest tests for sender validation, path handling and state persistence; browser-renderer build; real development and packaged Electron smoke. Preserve baseline test results rather than hiding legacy failures with skipLibCheck or disabling assertions globally.

Smoke must launch Electron, load the renderer and its real preload, assert no Node/generic legacy bridge, confirm context isolation/sandbox, observe non-empty content and report renderer crashes/errors. Use a temporary isolated userData directory and capture screenshots. Both production output and packaged asar must be exercised.

Before distribution: real official artifact tests, corrupted download/archive tests, interrupted installs, save-preserving repair/reset/update/rollback, library reconnection, ES-DE launch and focus, homebrew save/restart, physical DualSense, keyboard/VoiceOver, light/dark/small window, clean user and reboot gauntlet. Never distribute proprietary ROMs, BIOS or keys as fixtures.

## Runnable Mac gates

`npm run typecheck:macos`, `npm run lint:macos`, `npm run test:macos`, `npm run build:macos`, `npm run smoke:macos`, `npm run package:macos`, then `npm run smoke:macos -- 'release/build-macos/mac-arm64/Emulation Workspace.app/Contents/MacOS/Emulation Workspace'` and `npm run verify:package:macos` (after `npm run dmg:macos` for the DMG check).

Development smoke: `PORT=4318 npm run smoke:macos -- --dev`. Run builds sequentially: Mac and legacy targets intentionally share generated dist. Scoped typecheck checks all new sources strictly while skipping incompatible third-party declaration checking; legacy full typecheck remains failing. Smoke reports and PNGs stay in fresh OS temporary directories and use isolated userData. They are not copies of the user's library.

macos-15 is an ARM64 hosted runner per [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). The workflow runs on every push to macos-port and passed all steps on 2026-10-08 (run 37791094632). Use `npm run lint:macos` (what CI runs), not a bare `npx eslint`. Physical controller, VoiceOver, external-volume and signing tests cannot be inferred from CI.

## Smoke harness notes

The smoke run is ~50 s of real captures. Its watchdogs are 110 s (in-app) and 120 s (runner). Focus assertions make the window key first because `:focus-visible` only matches in the key window; earlier failures occurred whenever another app was frontmost. One intermittent mid-run stall (watchdog expiry after ~8 captures) was observed on 2026-10-04 and did not reproduce in 6 later runs; treat a single watchdog failure as a rerun signal, two consecutive failures as a regression. `capturePage` cannot see native vibrancy or window chrome, so the harness paints the reduced-transparency sidebar color; review real window captures (`screencapture -l <window id>`) for material and traffic-light placement.

## Console Mode end-to-end (packaged)

The owner's physical-test profile lives in `~/Emulation Workspace Test` (outside iCloud and the purgeable temporary folder): library with legal fixtures, installed Dolphin/ES-DE/PPSSPP, Console Mode state, and `Fixtures/PSP` (YABT, KleleAtoms, Apollo Save Tool with licenses). Open the packaged app on it with:

```
npm run test-app:macos
```

It refuses while another instance runs, and streams diagnostics to `app.log` in the profile. Interactive mode accepts this permanent folder only because it exists, is owned by you and is not group/world-writable; the automated harness is still confined to the temporary folder.

Seed a library (`library.json` with device/inode identity) containing only legal fixtures and copy a verified Dolphin install with its receipt. Install ES-DE through the UI; the owner must answer the license sheet. Pass criteria per cycle, from the stderr `console-mode`/`manager-focus` JSON lines plus `lsappinfo front`: `startFocus`, every `gameFocus` and `manager-focus` are `frontmost`, frontend exit 0, playtime persists, ROM hash unchanged, no `~/ES-DE`. Electron ignores background synthetic input, so drive the window in the foreground. Fixtures kept in `$TMPDIR` are purged by macOS after a few days (Dolphin and ES-DE copies lost their Info.plist mid-session). `ditto` preserves the image's original dates, so a fresh install is born already "old"; refreshing access times alone did not prevent a second purge. After every install into a test environment run `find <env> -exec touch {} +` (access and modification times; code signatures are unaffected), and re-verify signatures before reuse. The product installs into Application Support, which is not purged.

## Relaunching the test app

The app enforces a single instance, and its quit guard refuses to quit while an emulator or Console Mode is active. A scripted quit can therefore silently leave the old build running; a new `open -n` then exits immediately. Before every physical test, quit any emulator first, wait until the old process is gone, relaunch, and compare the running process start time (`ps -o lstart`) with the package build time. (On 2026-10-07 one physical PPSSPP test ran against a stale build this way.)

## Native activation helper

`node .erb/scripts/build-macos-native.js` builds `release/native/activate-app` alongside the console client. `focus.test.ts` exercises its argv contract and, when built, real native refusals (root-owned process, process outside the bundle). The 2026-10-04 manual measurement on macOS 27 activated a background-launched app 6/6 times with Finder or TextEdit frontmost (verified with `lsappinfo front` before and after). This is not yet ES-DE evidence.

Real ES-DE return was measured on 2026-10-05 with owner approval (3/3 frontmost; see STATUS). Launch the harness through LaunchServices inside the packaged app so ES-DE inherits the product's privacy identity; launched from a terminal `node`, ES-DE is killed by TCC as soon as SDL probes Bluetooth controllers:

```
open -n -W --env ELECTRON_RUN_AS_NODE=1 --stdout <out> --stderr <err> -a "release/build-macos/mac-arm64/Emulation Workspace.app" --args "$PWD/.erb/scripts/verify-esde-macos.js" --dmg … --fixture … --dolphin-install … --activate-helper "$PWD/release/native/activate-app" --borderless
```

After any frontend crash, check for an orphaned ES-DE (`pgrep -fl ES-DE`) and for `~/ES-DE` or `~/Library/Saved Application State/org.es-de.Frontend.savedState` in the real home; macOS relaunched a crashed ES-DE without its isolation arguments once. The original note follows: add `--activate-helper release/native/activate-app --borderless` to the `verify-esde-macos.js` command below. Pass only if every recorded `focus` outcome is `frontmost` **and** a physical controller action then changes ES-DE.

## Private runtime evidence

As of2026-10-03, the scoped Jest suite passed287 tests and the strict Mac typecheck/scoped lint passed. Production, development and packaged smoke each passed40 states, including native Electron's real preload, synthetic busy/error/recovery states and200% text zoom. Simulated installed state in a screenshot does not prove installation; the official Dolphin2609 runtime was tested separately.

`npm run verify:dolphin:macos -- --fixture /absolute/path/to/verified/legal.dol --align-fixture --hold 600 --reuse-install /absolute/path/to/disposable/components/dolphin` exercises only explicitly allowed legal fixtures and disposable test data. Review the script arguments and [homebrew provenance](docs/macos/research/homebrew-fixtures.md) first. Keep the source ZIP/license alongside the fixture. The exact original240p1.20 DOL is incompatible with Dolphin2609's section alignment; the opt-in derivative appends20 zero bytes and preserves the original. A visible menu and normal exit were observed. Preservation sentinels establish byte preservation, not gameplay-created saves.

The experimental frontend is not enabled or bundled in the product. Build the ARM64 Swift client with `node .erb/scripts/build-macos-native.js`, then run `node .erb/scripts/verify-console-client.js` on a normal macOS desktop host:20 real native checks cover authentication, exact-child wait beyond handshake timeout, concurrent refusal, disconnect lock retention, path/link/ownership rejection and malformed completion frames. Catalog/broker adversarial tests are also included in `test:macos`.

`node .erb/scripts/verify-esde-macos.js --dmg /absolute/path/to/exact/ES-DE_3.5.0-arm64.dmg --fixture /absolute/path/to/documented/padded-240p.dol --dolphin-install /absolute/path/to/disposable/components/dolphin` retains an isolated catalog/profile/report. It validates exact artifact hashes, publisher signatures and Gatekeeper before executing either copied frontend or emulator. Its first actual frontend startup stalled in SDL's VSync wait. The later `ew-console-uRv3gg/report.json` passed the VSync-disabled developer experiment: one authenticated launch, rendered 240p menu, exact-child wait, normal Dolphin exit0, return to the frontend and normal frontend exit0. That observation required native inspection; the report alone does not prove rendering or automatic focus restoration. The original ROM hash stayed unchanged. This is not a verified VSync-disabled product default. Physical controller input, controller-only exit, focus, real saves and reboot remain separate tests.

For manual native management review, `EMULATION_SMOKE_DIR` must be a fresh absolute directory lexically inside `os.tmpdir()` (or, with `EMULATION_SMOKE_INTERACTIVE=1` only, an existing owner-only folder such as the test profile). Set `EMULATION_SMOKE_INTERACTIVE=1` to keep the real packaged window open with isolated preferences. Do not use a real library for fault injection. The default smoke still captures then exits under a watchdog.

## Native savestate restoration

The isolated `emulation-dolphin-runtime-hy9iw5` native-menu session saved Slot1 through Dolphin. Its initial observation window was interrupted by the usage quota and finished with `SIGTERM-test-cleanup`, not a proven normal exit. The state remained unchanged after its first Config backup/reset.

`node .erb/scripts/verify-dolphin-state.js --runtime /absolute/path/to/private/emulation-dolphin-runtime-XXXXXX --dolphin-install /absolute/path/to/private/components/dolphin` reopens the same exact permitted ROM from a retained report, requires the same installed version and exact executable, waits without signaling the emulator, and resets settings only after normal exit. It reserves its output exclusively before launch; a retained report makes that runtime non-reusable. Use a new disposable runtime for another observation. An incomplete report is not a pass.

The actual later hy9iw5 native inspection observed Slot1 “Loaded State”, then quit normally. `state-reopen-report.json` records exit `{code:0, signal:null}`, Config backup and byte equality after a second reset. State size:3,859,858 bytes; SHA256:`d945a41b19a92558f68a0eb0d2aa167292c19113a2c265447897734e2fbeea1a`. The report records preservation; the native observation establishes restoration. This does not establish gameplay-created memory-card progress, physical-controller input, external storage or reboot persistence.

## Package contents and preview identity

`npm run verify:package:macos` inspects the actual local bundle read-only. It checks the exact10-entry asar, byte equality with current production output, no runtime Node dependencies, fork-owned author and neutral bundle/copyright metadata, ARM64 main executable and Electron framework, exact byte correspondence of the unsigned native runtime with installed Electron41.10.7, icon presence, all17 copied notice/research files byte-for-byte and a present DMG. It does not verify signing, notarization, minimum-OS compatibility, the complete dependency license audit, DMG contents or clean installation. Its metadata and notice checks passed on the final local preview.

Latest real reports: production `emulation-smoke-r6JayT/report.json`, development `emulation-smoke-a3yn3l/report.json`, packaged `emulation-smoke-JY3vFC/report.json`, each40 states in fresh host temporary roots. All four pages have exact200% zoom captures; final This Mac/Development facts are scrolled into view and checked against both viewport axes. Independent visual review accepted those values in both themes. Native management review `emulation-native-final-mftEOk/native-critic-review.json` separately passed Refresh page/focus/visible-scroll preservation, Close while remaining running, executable/Finder reopen and normal quit. CUA Raise was used for subsequent actions, so automatic focus restoration is not inferred. The full scoped suite again passed287 tests across13 suites.

A read-only specialist exercised the state utility's refusal paths with real manager/library code and disposable files, mocking only native operations: an existing report refuses before manager/launch/reset; an installed2610 receipt refuses before launch; a version change between inspection and launch refuses at the executable check. No emulator was started and retained hy9iw5 reports/state stayed unchanged.

## Real update and failed-update preservation

`node .erb/scripts/verify-dolphin-update.js` accepts no existing runtime/library arguments and creates only a fresh owned private test tree. It uses pinned official2606a/2609 metadata and the real downloader/installer/publisher, native architecture, exact revision and Gatekeeper checks. It never launches or resets Dolphin. Three official downloads exercise initial installation, a deliberately corrupted **owned staging copy**, and an untampered retry. It keeps a bounded0600 report synced throughout; an incomplete report is not a pass. The whole test has a30-minute budget while allowing bounded detach cleanup to finish.

Successful evidence: `/private/tmp/emulation-dolphin-update-OLnzLd/update-report.json`, SHA256 `9786f48c286607701c28927224ec25caab44c4fd2016165793f32afd7a31b154`. Both trusted bundles are Universalx86_64/ARM64, minimumOS11.0.0, Developer ID Stichting Dolphin Emulator, Team97835T4369. The2606a artifact is43,312,410 bytes, SHA256 `15df1afeac686951647d81b0b62e11d82e8715c92927b849e2858379cee6b5ca`;2609 is41,965,559 bytes, SHA256 `b8910a6f8710cbe93b916f5b3867a46e67e49aa8272657d282d4accae359cd6b`. These hashes were measured from the official transfers; they are not described as published checksum validation.

Actual strict codesign refused the altered staging resource; the installer detached the image and did not publish a new receipt. Older bundle/receipt full inventory, library Config/ROM/GC/StateSaves bytes and preferences stayed unchanged. The retry activated2609 after detach; a fresh manager selected2609, and a repeated same-version install verified without downloading. All3 detach boundaries had no activated receipt. The older2,842 entries (including empty files) and15 synthetic-library entries were compared. Emulator spawn count was zero. This proves installation recovery and byte retention, not gameplay-created saves, cross-version savestate compatibility, reboot or rollback.

First attempt xLQILk is preserved with `ready:false`: an extra diagnostic assertion incorrectly required a particular stderr filename after the actual codesign refusal. Its old installation/library and mount cleanup were independently rechecked. The corrected utility ran in a new private runtime; no failed report was overwritten or counted as a pass.

The final unsigned DMG also passed `hdiutil verify` image checksums. Mounted image contents, fresh-user installation and public distribution trust remain separate gates.

## Firmware import (owner-run)

Firmware tests use synthetic random bytes with a declared CRC32; no proprietary file is ever stored in the repository. To check a real import, the owner uses a GameCube IPL they dumped from their own console: Firmware › GameCube IPL › Add…, then confirm the row reads "Added and recognized: <region>", the original file is unchanged, and the library contains `emulators/dolphin/User/GC/<region>/IPL.bin`. Adding an unrelated file must show "not a known good … dump" and change nothing. Replacing a different existing file must leave `IPL.bin.before-<timestamp>` beside it.

## Adding a bridge method

1. Add it to `MacAPI` in `src/shared/macos.ts` and hand-write it in `preload.ts` (zero arguments, or one literal that main checks with `acceptsOneOf`).
2. Add one line to `src/shared/macos-bridge-inventory.json` with its channel, argument rule and, for one-argument methods, a valid sample.
3. Register the handler in the domain module under `src/main/macos/app/`, and add the mock to the renderer test.

The preload test, the main IPC test, both smoke harnesses and the type check all read the inventory, so a method missing from any of them fails a gate.

## External drives (real volumes, throwaway images)

`node .erb/scripts/verify-volumes-macos.js [--parent <dir>] [--images <dir>]` creates (or copies prepared) exFAT and APFS disk images in a fresh work folder, mounts them hidden from Finder, and checks library identity, impostor refusal, rename, snapshot/restore and the library tools on each file system. It never attaches an existing drive and detaches everything at the end. `--images` expects `ExFAT.dmg`, `ExFAT-other.dmg` (a separately created image with the same volume name, for the impostor check) and `APFS.dmg`; it attaches copies, never the originals. In some sandboxed sessions `hdiutil create` is refused; use `--images` there.
