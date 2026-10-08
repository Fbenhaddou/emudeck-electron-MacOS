# Console Mode research and implementation design — 2026-10-04

**Status: research and design only.** Product Console Mode stays `planned` (see `src/main/macos/main.ts` capabilities) until the evidence gates in the test plan pass. This builds on [es-de-integration.md](es-de-integration.md), [es-de-artifact.md](es-de-artifact.md), [controllers.md](controllers.md), DECISIONS 005 and SECURITY.md. RetroDECK (`../retrodeck-reference`) was read only.

## 1. Verified facts (checked 2026-10-04)

### Release and artifact

- The [official website](https://www.es-de.org/) still lists **ES-DE 3.5.0, released 2026-09-30**, as the latest release, for macOS 11 "Big Sur" and later. Its Apple Silicon link is [GitLab package file 357717468](https://gitlab.com/es-de/emulationstation-de/-/package_files/357717468/download). A HEAD request today returned HTTP 200 with no redirect, `ES-DE_3.5.0-arm64.dmg`, and 79,383,926 bytes. This matches the bytes inspected in es-de-artifact.md.
- [CHANGELOG 3.5.0](https://gitlab.com/es-de/emulationstation-de/-/raw/master/CHANGELOG.md) updated SDL to **2.32.10** on macOS. The only macOS items are a network error workaround and a Stella core entry. Nothing changes launching, focus or escaping.
- Signing: the website says nothing about signing or notarization. The repo's own inspection of these exact bytes found Developer ID Northwestern Software AB (`K56UAA4SXL`), hardened runtime and Gatekeeper `source=Notarized Developer ID`. **CFBundleIdentifier is `3.5.0`**, the version string rather than a stable reverse-DNS identifier (es-de-artifact.md). This was not re-downloaded today.
- ES-DE has a built-in updater. On macOS it can download the DMG, which "will need to be manually installed" ([USERGUIDE](https://gitlab.com/es-de/emulationstation-de/-/raw/master/USERGUIDE.md) §Upgrading). The pinned setting is `ApplicationUpdaterFrequency` (default `always`, [Settings.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/Settings.cpp)). `--no-update-check` applies only to the current startup ([INSTALL.md](https://gitlab.com/es-de/emulationstation-de/-/raw/master/INSTALL.md) "Command line options").

All source links below are pinned to the v3.5.0 commit `50e4b600ae533d772bae3ff880d11a09b05dbe84` unless they point at master docs.

### Configuration location

- The default application data directory is `/Users/<user>/ES-DE`, and ROMs default to `~/ROMs` (USERGUIDE).
- `--home <dir>` "completely replaces what is considered the home directory". Application data becomes `<dir>/ES-DE`, and `~` in find rules and ROM paths resolves there (INSTALL.md §"Command line options").
- `ESDE_APPDATA_DIR` overrides the application data directory on all platforms except Android and Windows (INSTALL.md).
- `main.cpp` changes `~/Library/Saved Application State/org.es-de.Frontend.savedState` before it parses `--home`. The child `HOME` must therefore also be overridden, as the developer harness already does (es-de-integration.md).
- Overrides live in `ES-DE/custom_systems/es_systems.xml` and `es_find_rules.xml`. `<loadExclusive/>` suppresses the bundled systems (INSTALL.md §"es_systems.xml").
- Settings live in `ES-DE/settings/es_settings.xml`. Relevant pinned keys:
  - `RunInBackground` (default false)
  - `CustomEventScripts` (false)
  - `UIMode` (`full`) and `ForceKiosk`
  - `KeyboardQuitShortcut` (`CmdQ`)
  - `InputControllerType` (`xbox`), `InputOnlyFirstController`, `InputIgnoreKeyboard`
  - `SaveGamelistsMode` (`always`)
  - `ApplicationUpdaterFrequency`
  - `StartupSystem` / `StartupView`
  - `ROMDirectory`

### How games are launched on macOS

- Placeholders (INSTALL.md §"es_systems.xml"):
  - `%EMULATOR_<NAME>%` and `%CORE_<NAME>%` are resolved through find rules.
  - `%ROM%` is the path "with most special characters escaped with a backslash".
  - `%ROMRAW%` is unescaped.
  - `%STARTDIR%=` and `%INJECT%=` also exist. `%INJECT%` injects the contents of a file of up to 4096 bytes into the command line.
- Shell execution ([PlatformUtil.cpp `launchGameUnix`](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/utils/PlatformUtil.cpp)):
  - The command becomes `cmd + " 2>&1 &"` and is run with `popen`.
  - ES-DE reads the pipe until EOF. While it waits, it polls SDL and **drops every event except controller add/remove**.
  - Afterwards it calls `pclose` and uses `returnValue >>= 8`.
  - With `RunInBackground` set, it uses `system()` instead and captures no output.
- An `.app` ROM is rewritten to `open -W -a` ([FileData.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/FileData.cpp)).
- **Finding: ES-DE cannot see the helper's exit code.** The trailing `&` means `pclose` returns the status of `/bin/sh`, which is 0 after it backgrounds the job, not the status of the helper. The pipe EOF is the only completion signal. So ES-DE's "ERROR LAUNCHING GAME … (ERROR CODE %i)" popup will never show a broker or Dolphin failure. This follows from the code; it has not been tested on hardware.
- **Escaping is weaker than the repo currently records.** `getEscapedPath` (pinned [FileSystemUtil.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/utils/FileSystemUtil.cpp) L480–510) escapes only ``\ '"!$^&*(){}[]?;<>`` and the space character.
  - It also omits newline, tab, `~` and `#`, not only backtick and `|`.
  - It skips any character already preceded by `\`. Backslashes are processed first, so the filename `a\;x` becomes `a\\;x`: the shell sees an escaped backslash followed by a **live `;`**.
  - This strengthens DECISIONS 005. Never expose user filenames to `%ROM%`.

### Focus, fullscreen and quitting

- **ES-DE contains no focus-restoration code.** There is no `SDL_RaiseWindow` and no `NSApp` activation in `launchGameUnix`, `FileData::launchGame` or `Window.cpp`. After a game it only calls `normalizeNextUpdate()`. Returning to ES-DE depends entirely on macOS app activation.
- USERGUIDE §"Specific notes for macOS":
  - RetroArch needs "Start in Fullscreen mode" or ES-DE "will not be able to switch to the emulator window"; the workaround is Command + Tab.
  - "Lack of controller support is a bit of a problem on macOS"; Sony controllers are better supported than Xbox controllers.
  - Double-tapping a DualSense/DS4 Share button triggers macOS screen recording. This can be disabled per controller in System Settings → Game Controllers → Share Gestures.
- Window mode ([Renderer.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/renderers/Renderer.cpp)):
  - Without `--resolution`, macOS uses `SDL_WINDOW_BORDERLESS | ALLOW_HIGHDPI`. The upstream comment says real fullscreen "will do lots of weird stuff like preventing window switching or refusing to let emulators run at all".
  - With `--resolution`, it uses a normal bordered window. The developer experiment used this mode (960×640), so it did **not** exercise product fullscreen.
  - Changing the display resolution on the fly is unsupported on macOS (USERGUIDE).
- Quitting ([GuiMenu.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/guis/GuiMenu.cpp)):
  - On `__APPLE__` the main menu always has **"QUIT ES-DE"**, so it can be reached with a controller (Start → menu). It is hidden only when `UIMode` is `kiosk` or `ForceKiosk` is set.
  - Reboot and power-off commands are stubs that return 0 on macOS. `quitES()` pushes `SDL_QUIT`.
  - The keyboard quit shortcut is ⌘Q, configurable to Ctrl+Q or Alt+Q.
  - `RunInBackground` *is* compiled on macOS; it is excluded only on Android and `DEINIT_ON_LAUNCH` builds.

### Controller input facts

- ES-DE sets no `SDL_SetHint` for background joystick input on macOS ([InputManager.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/InputManager.cpp), main.cpp). Custom mappings load from `controllers/es_controller_mappings.cfg`.
- SDL 2.32.10's `SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS` defaults to `"0"` ([SDL_hints.h](https://raw.githubusercontent.com/libsdl-org/SDL/release-2.32.10/include/SDL_hints.h)). Apple's [`GCController.shouldMonitorBackgroundEvents`](https://developer.apple.com/documentation/gamecontroller/gccontroller/shouldmonitorbackgroundevents) defaults to false on macOS 11.3+: input is not forwarded "until the app becomes the frontmost".
- **Consequence: an unfocused ES-DE is unusable with a controller.** Focus restoration is a hard requirement for controller-only play, not a nicety.

### macOS activation APIs

- [`NSRunningApplication.activate(options:)`](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(options:)) is available on macOS 10.6+ and returns false if the app has quit.
- From macOS 14, activation is cooperative. [`NSApplication.activate()`](https://developer.apple.com/documentation/appkit/nsapplication/activate()) "doesn't guarantee app activation"; the active app should call [`yieldActivation(to:)`](https://developer.apple.com/documentation/appkit/nsapplication/yieldactivation(to:)) first. [`activate(from:options:)`](https://developer.apple.com/documentation/appkit/nsrunningapplication/activate(from:options:)) returns true only "if the request is allowed by the system".
- Electron exposes no API to activate *another* process. Neither ES-DE nor Dolphin can be modified to yield activation.

### RetroDECK, for concepts only

- License: **GPLv3** (`LICENSE`). The Mac fork's own GPL/MIT provenance is unresolved (license-inventory.md), so **copy no code**. Ideas only.
- RetroDECK treats ES-DE as the primary frontend. It keeps `custom_systems/es_systems.xml` and `es_find_rules.xml` as tracked "helper files" under `$rd_home_path/ES-DE` (`config/retrodeck/reference_lists/features.json`). It uses `--home` for imports (`functions/dialogs.sh`).
- Upstream disables the ES-DE updater for RetroDECK builds (INSTALL.md).
- RetroDECK quits with `pkill -f "es-de"` (`functions/other_functions.sh` `quit_retrodeck`). Do not copy this: it is name-based and could kill unrelated processes. This port must signal its exact child PID.

## 2. Implementation design (fits the existing broker)

### Phase A: managed ES-DE component (`src/main/components/es-de/`)

1. **Manifest:** pin release `3.5.0`, the exact package URL and path allowlist (`https://gitlab.com` + `/es-de/emulationstation-de/-/package_files/357717468/download`), byte bounds and SHA-256 `060bd289fa17f8f07bac2eb688698047f7be79b80495983f08580b5f1a046e1e` as an audit fingerprint.
2. **Trust policy:** a designated requirement of `anchor apple generic and identifier "3.5.0" and certificate leaf[subject.OU] = "K56UAA4SXL"`, plus all-ARM64 Mach-O and Gatekeeper `spctl` acceptance.
   - Each new release needs a reviewed manifest bump, because the identifier changes with every version.
3. **Install flow:** reuse the Dolphin `ComponentManager` journal flow: download → read-only `hdiutil attach -nobrowse -noautoopen` → copy `ES-DE.app` into owned staging → verify → detach → atomic activation into `~/Library/Application Support/<app>/components/es-de/<version>/ES-DE.app`.
   - The DMG shows an MIT license agreement before it mounts. **Ask the user to accept it in-app; do not pipe `Y` automatically.** This is a terms-acceptance step.
   - Preserve quarantine. Never install into `/Applications`, and never touch a user's own `~/ES-DE`.
4. **Updates and rollback:**
   - Updates come only from a fork-reviewed manifest. Keep the prior version directory until the new one passes a launch smoke.
   - Force `ApplicationUpdaterFrequency=never` and pass `--no-update-check`, so ES-DE never offers its own DMG download.

### Phase B: isolated, persistent profile, regenerated launch boundary

1. **Split the current `createCatalog` session root** (which today requires `home` to be absent) into two parts:
   - **Persistent profile** `P = <AppSupport>/console/esde-home`, mode 0700. ES-DE gets `--home P`, `HOME=P` and `ESDE_APPDATA_DIR=P/ES-DE`. Gamelists, playtime, favorites and settings live here and survive sessions.
   - **Per-session runtime** `R` (`mkdtemp` under `$TMPDIR`, which must canonicalize to ≤100 bytes including `/s`). It holds the socket, key, helper copy and marker directory, exactly as now.
2. **Stable opaque IDs** so gamelist metadata persists:
   - The ID is `HMAC-SHA256(installSecret, libraryVolumeUUID ‖ fileID ‖ relativePath)`, truncated to 32 hex characters.
   - Main keeps the ID → original-path map in memory and revalidates the library identity before every launch, as it does today.
   - Markers stay zero-byte `<id>.ewgame` files under `R/roms/<system>`.
3. **Regenerate the launch-relevant files at every start**, with exclusive create plus atomic rename and back-up-then-replace for files the app itself owns:
   - `custom_systems/es_systems.xml`: `<loadExclusive/>`, one system per *enabled and verified* component (only `gc` for now), absolute `<path>` = `R/roms/gc`, and the fixed helper command from catalog.ts.
   - `custom_systems/es_find_rules.xml` set to `<ruleList/>`.
   - `gamelists/gc/gamelist.xml`: write only `<path>` and `<name>` for new IDs. Merge user metadata by ID; never let it change `<path>`.
   - Required `es_settings.xml` keys:

     | Key | Value |
     | --- | --- |
     | `RunInBackground` | false |
     | `CustomEventScripts` | false |
     | `CustomEventScriptsBrowsing` | false |
     | `ApplicationUpdaterFrequency` | `never` |
     | `UIMode` | `full` or `kid` (**never `kiosk`**: it hides QUIT) |
     | `StartupSystem` | `gc` |
     | `StartupView` | `gamelist` |
     | `InputControllerType` | `ps5` when a DualSense is detected |
     | `KeyboardQuitShortcut` | `CmdQ` |

   - Refuse to start if `P/ES-DE/scripts/` or a per-game `%INJECT%` file exists inside `R`. `R` is owned, so no injection file can be planted there.
4. **Helper location:** the signed helper ships inside the app bundle (`Contents/Helpers/`). Bundle paths may contain spaces, which catalog.ts's ASCII grammar rejects. So keep copying it to `R/helper`, and verify the copy against the bundle's own helper (codesign `-R` requirement + SHA-256) before writing `es_systems.xml`.

### Phase C: launch/return lifecycle (state machine in main)

`idle → starting-frontend → frontend-ready → game-active → returning → frontend-ready → stopping → idle`. Any state can move to `failed`, which is recoverable.

1. **Enter Console Mode** (IPC with no arguments; the renderer never passes paths):
   - Acquire the global operation lock (no install, update, reset or library switch while it is held).
   - Reconcile surviving processes, then build `R`, regenerate `P`, and start the broker.
   - Spawn `P`'s ES-DE with `shell:false` and argv `--home P --no-splash --no-update-check --gamelist-only`. Pass **no** `--resolution`, so ES-DE opens its borderless, display-sized window. Use the minimal env from the harness.
   - Hide all Electron windows with `app.hide()`, so the manager is never a candidate for activation.
2. **Game launch:** the helper authenticates → main resolves the ID → spawns Dolphin (argv; existing `ComponentManager.launch`) and records its PID. The broker holds `active`.
3. **Game exit** (exact child): main records the result and runs **focus restoration** (below) with the recorded ES-DE PID *before* it answers the helper. Then it replies; the helper exits, ES-DE sees the pipe EOF and resumes its UI. The non-zero/signal result is shown by main (see Failure handling), because ES-DE cannot see it.
4. **Exit Console Mode:**
   - The user picks QUIT ES-DE with the controller, or presses ⌘Q.
   - Main sees ES-DE exit 0, refuses while a game is `active` (the existing broker invariant), closes the broker, discards `R` and keeps `P`.
   - It then calls `app.show()` and `mainWindow.focus()`, plus `app.focus({steal:true})`; Electron is activating itself here.
   - Electron quitting while ES-DE runs: send SIGTERM to the exact ES-DE PID only when no game is active; otherwise defer the quit (the existing guard).

### Focus restoration: is a native activation helper needed?

**Yes. Plan for it, but gate it on measurement.**

- macOS ≥14 cooperative activation means activation by whatever app is "next" after Dolphin quits is undefined. Dolphin was launched by the hidden Electron process, not by ES-DE.
- Electron cannot activate a foreign PID. `open -a` is unsafe: identifier `3.5.0` and path-based lookup can start a **second ES-DE with the default `~/ES-DE`**. AppleScript needs Automation consent.

Steps:

1. **Measure first:** borderless ES-DE plus hidden Electron, then quit Dolphin. Record `NSWorkspace.frontmostApplication` after 0.5 s and 2 s across 20 runs, covering USB and Bluetooth DualSense and a second Space or display.
2. **Ship a tiny activation subcommand** in the existing signed Swift client: `console-launcher --activate <pid>`. Main invokes it with `shell:false`; it is not reachable from ES-DE.
   - It validates that `pid` is main's ES-DE child: `NSRunningApplication(processIdentifier:)`, executable URL equal to the managed bundle, and owner UID.
   - It calls `activate(options: [.activateAllWindows])`. It polls `frontmostApplication` for up to 1.5 s, retrying 3 times, and exits 0 only if ES-DE is frontmost.
   - It never activates any other process. No Accessibility, Automation or Input Monitoring permission is required.
3. Also try `NSApplication.yieldActivation(to:)` from Electron before Dolphin starts; this needs Electron to be active at that point, which it is not (it is hidden), so it is likely ineffective, and pursuing it would need a native addon. **Document this as not pursued unless step 2 fails.**
4. **If activation still fails:** main logs a redacted `focus-not-restored` event. Then:
   - Optional, measured experiment: start ES-DE with `SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`. This is safe during games because ES-DE drops non-hotplug events while waiting, but it does not fix keyboard focus or GameController-backend devices.
   - Otherwise tell the user via the manager UI on the next visible state: "Press ⌘Tab".
   - **Do not claim controller-only support in that case.**

### Controller-only exit

- **Game → ES-DE:** a Dolphin hotkey (`General/Exit`). Keep the proposed DualSense default "hold Back(Create)+Start(Options) 1.5 s", `ConfirmStop=False`, written into the managed Dolphin User config. Leave it marked unmeasured until the physical test passes.
- **ES-DE → manager:** Start → QUIT ES-DE → confirm. No custom work is needed, provided UIMode is not kiosk.
- **Emergency:** if a game hangs, there is no controller path. Main exposes "Stop game" in its menu-bar/Dock menu, which sends SIGTERM and then SIGKILL to the exact Dolphin PID after a save-safety warning. The broker then releases normally on the child's exit.

### Failure handling

| Failure | Behaviour |
| --- | --- |
| ES-DE missing or failing signature/Gatekeeper | Refuse to enter Console Mode and offer Repair (reinstall the pinned version). |
| ES-DE exits non-zero or crashes with no game active | Close the broker, show the manager with "Console Mode stopped unexpectedly" and redacted log tail. Keep `P`. |
| ES-DE crashes during a game | Dolphin keeps running (the broker lock is held). When Dolphin exits, show the manager. Never kill the game. |
| Helper authentication or launch failure | The helper exits 1 quickly. Main records the reason (ES-DE shows nothing). Raise a short Electron notification and, on the next manager show, a banner. |
| Dolphin exits non-zero or with a signal | Run focus restoration as usual, then record the result for the manager UI. |
| Library unmounted mid-session | Refuse new launches (the helper fails). ES-DE stays usable. On exit, report it. |
| Electron crash | An orphaned ES-DE or Dolphin is reconciled at the next start. Process reconciliation already exists for Dolphin; extend it to the ES-DE PID and executable path. |

## 3. Test plan

- **Unit (jest):**
  - Persistent-profile generation: preserves `P` metadata, regenerates only owned files, refuses `scripts/`, writes exact `es_settings.xml` keys, keeps stable IDs across runs, survives an ID collision, and never puts a user filename in any `<command>`.
  - Helper-copy verification.
  - State-machine transitions, including quit refused while active.
  - Mocked activation-helper outcomes (0, 1, timeout).
  - A regression fixture for the `\;` escaping bypass that asserts the catalog never exposes it.
- **Swift:** extend the 20 protocol checks with `--activate` argument validation: wrong PID, non-child PID, a different bundle, and a PID that has terminated.
- **Native, on this Mac (record in report.json):**
  1. Managed install from the official URL, plus a tampered-staging refusal.
  2. Borderless launch with no ROM-directory dialog.
  3. Hostile filename launch, then frontmost = ES-DE after Dolphin exit, measured 20 times.
  4. DualSense over USB and over Bluetooth: navigate ES-DE, launch, held exit combo, then navigate ES-DE **with no mouse or keyboard**.
  5. QUIT ES-DE by controller, then the manager is frontmost.
  6. Kill ES-DE during a game: Dolphin survives, then the manager is shown.
  7. Unplug the library volume.
  8. Restart persistence of playtime and favorites.
  9. Fresh macOS user, and a reboot.
  10. Two displays and a separate Space.
- **Evidence rule:** "displayed list after exit" is not focus. Pass only on `frontmostApplication.pid == esdePid` **and** a physical controller action changing ES-DE.

## 4. Open risks

1. **Cooperative activation (macOS 14+, observed on 27.0) may refuse `activate` from a background helper.** If so, controller-only return is not achievable without user action, and Console Mode must ship with a documented ⌘Tab caveat or not ship.
2. **Dolphin may not take focus at launch.** It is spawned from a hidden, inactive Electron process. If it opens behind ES-DE's borderless window, the "Start in Fullscreen" RetroArch symptom applies to Dolphin. Measure this, and set Dolphin fullscreen in the managed config.
3. **Dolphin's fullscreen** behaviour (native Space versus borderless) can add Space transitions and change which app macOS activates next. This is unmeasured.
4. **DualSense shared by ES-DE (SDL2 2.32 HIDAPI) and Dolphin (SDL3):** possible lightbar/rumble or exclusive-access conflicts. The Share double-tap triggers screen recording.
5. **Failures are invisible in ES-DE** because the exit code is lost through the `&` and `pclose`. Users rely on manager notifications.
6. **Version identity:** the identifier changes with every release, so the trust pin needs a manual review per release. The in-app updater must stay disabled.
7. **Distribution:** the ES-DE bundle contains Modern/Slate themes under NC terms with inconsistent licence wording. Downloading the official bundle on the user's behalf avoids redistribution, but the DMG licence agreement needs explicit user acceptance. The fork's own GPL/MIT provenance and the signing of the helper remain blockers (SECURITY.md).
8. **Concurrency:** a user-launched personal ES-DE using `~/ES-DE` can coexist. Distinguish them by exact PID, never by name.
9. **Same-UID adversary:** a process running as the same user can still read `R/key`. This is not a sandbox boundary (unchanged from SECURITY.md).
