# ES-DE integration research — 2026-10-02

**Status: research and experimental catalog/broker work; product Console Mode remains disabled.** The catalog has filesystem adversarial tests, and the parent task is measuring a developer-only native frontend flow. Physical controller navigation, frontend focus restoration, and real game-created save persistence require separate evidence. Research used official documentation, upstream source, and release metadata. The RetroDECK reference checkout was read only; no source implementation was copied.

## Component boundary

The [RetroDECK Architecture Overview](https://retrodeck.readthedocs.io/en/latest/wiki_development/general/retrodeck-architecture-overview/) separates build recipes from runtime component files. Its transferable principle is to keep emulator metadata, configuration, and launch behavior with each component. Its Flatpak runtime, library layers, XDG overrides, and subsandboxes are Linux implementation details.

The [Creating Component Files guide](https://retrodeck.readthedocs.io/en/latest/wiki_development/components/component-guide/creating-components-ingredients-guide/) proves the launcher before completing metadata/configuration and frontend integration. The [manifest documentation](https://retrodeck.readthedocs.io/en/latest/wiki_development/components/component-files/component-ingredient-manifest/) covers systems, presets, menu integration, cores, and optional BIOS information. The [launcher documentation](https://retrodeck.readthedocs.io/en/latest/wiki_development/components/component-files/component-ingredient-launcher/) establishes one component entry point for the frontend, configurator, and CLI.

For this port, preserve the existing strict manifest and typed launch-plan separation. Implement ES-DE as a frontend component with its own release resolution, installation verification, data paths, generated catalog, and lifecycle adapter. A shared main-process service should execute trusted plans and own operation locks. Do not add another emulator until Dolphin's complete vertical slice is measured. The current Dolphin manifest's planned capability literals need reconciliation with its implemented manager when the schema evolves; they should never advertise untested frontend/controller behavior.

## Current upstream distribution and identity

The [official website](https://www.es-de.org/) currently lists **ES-DE 3.5.0**, released **2026-09-30**, with separate Apple and Intel macOS packages and macOS 11 or later. It permits desktop redistribution. The [desktop source license](https://gitlab.com/es-de/emulationstation-de/-/raw/master/LICENSE) is MIT; packaged dependency/theme/media notices still need their own audit.

Fresh official website links:

- [Apple macOS DMG](https://gitlab.com/es-de/emulationstation-de/-/package_files/357717468/download)
- [Intel macOS DMG](https://gitlab.com/es-de/emulationstation-de/-/package_files/357717755/download)

These numeric package URLs identify this release; they are not permanent latest aliases. Discover future releases from the official source and record the selected immutable release and redirects.

Live HTTPS retrieval of [ES-DE_Info.plist](https://gitlab.com/es-de/emulationstation-de/-/raw/master/es-app/assets/ES-DE_Info.plist) found executable/name `ES-DE`, minimum system `11.0.0`, and **CFBundleIdentifier `3.5.0`**. Therefore the expected executable is `ES-DE.app/Contents/MacOS/ES-DE`; do not invent a reverse-DNS bundle identifier or assume the identifier is stable across updates. The [packaging source](https://gitlab.com/es-de/emulationstation-de/-/raw/master/es-app/CMakeLists.txt) names Northwestern Software AB as vendor. An [official issue containing a 3.2.0 crash report](https://gitlab.com/es-de/emulationstation-de/-/issues/1961) reports signing Team ID `K56UAA4SXL`, an ARM64 process, and bundle identifier `3.2.0`. This is historical evidence, **not verification of the 3.5.0 publisher**.

Before executing 3.5.0, inspect the actual official artifact: readonly DMG mount; actual bundle/executable/architecture/minimum OS; `codesign` signature and designated requirement; Gatekeeper assessment; receipt. Preserve quarantine. Bind the trust policy to the reviewed publisher and exact release identity. A computed hash is an audit fingerprint, not publisher authentication. No security bypass is justified by these source observations.

## Paths, CLI, and missing integration

The [advanced configuration guide](https://gitlab.com/es-de/emulationstation-de/-/raw/master/INSTALL.md) documents **`--home` with two dashes**. With `--home <libraryRoot>`, application data goes in `<libraryRoot>/ES-DE`, and default ROM resolution changes with that home. Choose explicit absolute paths instead of relying on `~/ROMs` or older `.emulationstation` layouts. Owned overrides belong in `ES-DE/custom_systems/es_systems.xml` and `es_find_rules.xml`.

The upstream [macOS system definitions](https://gitlab.com/es-de/emulationstation-de/-/raw/master/resources/systems/macos/es_systems.xml) select a RetroArch Dolphin core before standalone Dolphin. The [macOS find rules](https://gitlab.com/es-de/emulationstation-de/-/raw/master/resources/systems/macos/es_find_rules.xml) search `/Applications/Dolphin.app/Contents/MacOS/Dolphin`. Neither matches this port's privately managed versioned installation or isolated Dolphin user directory. Generate only a GameCube override initially; retain user-owned configuration and back up conflicts. Never overwrite the entire system list from upstream.

## Shell expansion is a security boundary

Live source inspection identified a concrete limitation in stock ES-DE. In [FileSystemUtil.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/master/es-core/src/utils/FileSystemUtil.cpp), `getEscapedPath` escapes spaces, quotes, dollar signs, and several shell metacharacters, but omits **backticks and pipe characters**. In [FileData.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/master/es-app/src/FileData.cpp), `%ROM%` expands to that escaped path while `%ROMRAW%` expands to the raw path. [PlatformUtil.cpp](https://gitlab.com/es-de/emulationstation-de/-/raw/master/es-core/src/utils/PlatformUtil.cpp) executes the expanded command through `popen`/`system`. XML escaping consequently does not prevent command injection from arbitrary filenames.

Do not expose Console Mode by pointing stock ES-DE directly at an unrestricted user ROM directory. Do not wrap `%ROM%` in another quotation layer or treat `%ROMRAW%` as safe. A name-rejection check is a temporary limitation only, and must cover all launchable paths before frontend discovery; validation inside a helper runs too late to stop shell parsing. Direct managed Dolphin launch with `shell: false` and an argument array remains the preferred path today.

Architecture for arbitrary user filenames (the current experimental protocol below implements only part of this design):

1. Generate an application-owned catalog of marker files with opaque hexadecimal identifiers and a controlled extension. Store the original ROM paths in a versioned mapping outside the shell command. The catalog is disposable machine-local state, not a renamed or relocated ROM library.
2. Let ES-DE browse only that catalog. Generated gamelist metadata supplies display names. Launch a trusted helper with a fixed controlled ASCII executable path and an opaque marker basename; never interpolate an original filename into the command. Enforce the marker-name grammar and reject unknown catalog entries before starting ES-DE.
3. The helper validates the identifier and submits a typed request to the running management process over a private local channel. Main process resolves the mapping, revalidates the real library/game/bundle boundaries, verifies the managed component, and spawns Dolphin with its existing argument array. Use per-session authorization and owned-file permissions; do not expose an unrestricted localhost launch endpoint.
4. Keep the helper waiting until that exact emulator process exits. It should retain the output pipe, return the actual emulator outcome, and handle manager/helper disconnects. Coordinate reset, update, library switch, and duplicate launches with the same operation lock. This preserves main-process process ownership and diagnostics while ES-DE can observe completion.

The catalog and bounded local broker now have focused adversarial tests; that is not complete product integration or an OS sandbox. End-to-end frontend, volume, renderer, input, save and lifecycle evidence must still be measured. A reviewed upstream fix replacing shell execution with a structured spawn interface would be another path; no such fix is claimed here.

Stock ES-DE's Unix launcher appends a background operator but normally waits on its captured output pipe until the child closes it. Its explicit background setting instead detaches and loses useful outcome handling. A helper must keep its pipe alive and await the real child. Avoid a detached `open` launch or early-return broker acknowledgment; neither proves emulator exit or focus restoration. Focus/controller-only exit must be verified on the physical Mac.

## Legal GameCube runtime fixtures

### GC-Controller-Test v1.2: unresolved release licensing

The [v1.2 release](https://github.com/corenting/GC-Controller-Test/releases/tag/v1.2) provides `gc-1-2.zip`, published 2014-06-07, without a release digest. Its exact [tag tree](https://api.github.com/repos/corenting/GC-Controller-Test/git/trees/v1.2?recursive=1), SHA `a00252d556da5f71a6cd19ca78457e484c127aab`, contains no license file or source license headers. The present [zlib license](https://github.com/corenting/GC-Controller-Test/blob/master/LICENSE.md), copyright 2023, was added by [a later build-system/license commit](https://github.com/corenting/GC-Controller-Test/commit/1baa41ed4cf437cc6cbc2fa05edadbd5351610f1). The tagged binary therefore does not provide the requested clear release/license provenance. Do not bundle it on the basis of a current repository badge. Private local use and redistribution are distinct questions; user authorization alone does not establish third-party redistribution permission. This fixture also does not exercise save creation.

### GCMM 1.5.2: verified downloadable GPL test application

The author's [GCMM 1.5.2 release](https://github.com/suloku/gcmm/releases/tag/1.5.2), published 2021-11-20, provides [gcmm_1.5.2.zip](https://github.com/suloku/gcmm/releases/download/1.5.2/gcmm_1.5.2.zip). Read-only in-memory archive inspection found `gcmm_1.5.2/gamecube/gcmm_GC.dol`, full `src/`, and `src/COPYING` containing GPL version 3. The [tagged COPYING](https://raw.githubusercontent.com/suloku/gcmm/1.5.2/COPYING) and [tagged readme](https://raw.githubusercontent.com/suloku/gcmm/1.5.2/readme.txt) corroborate the GPL designation. Exact tag tree: `95c737c2af0ebecfa2ef02a8c6c30496d0036e87`.

Observed SHA-256 fingerprints on 2026-10-02:

- ZIP: `840dbfea6d4fbd5f266dcda92e69088d78fb95987685a2d65285d07b66986f5f`
- GameCube DOL, 3,800,640 bytes: `1da85a35f494c8a491a16267be1c43097ad85e5fb5d2c9624a9f7504e8815b98`

GitHub release metadata supplies no upstream digest. These are observed byte identities only. Preserve the included license and corresponding source if distributing a fixture. Audit bundled font/graphics notices before product bundling rather than broadening this local-test finding into a redistribution audit.

GCMM is a memory-card management homebrew application, not a game. It can provide rendering and input smoke evidence and potentially exercise writes to an **isolated disposable emulated card**. It must never be pointed at a user's real saves during testing. Its storage-device requirements may need an emulated SD device. A format/write-and-reopen test proves card persistence only; it does not prove ordinary in-game saves or the complete frontend flow. No GCMM runtime was performed by this research task.

### Dolphin hardware tests and an original fixture

The official [dolphin-emu/hwtests](https://github.com/dolphin-emu/hwtests) repository explicitly identifies GPLv2 and requires devkitPPC/libogc. It currently contains no prebuilt DOLs or published releases. The guessed `dolphin-emu/dol-tests` repository returns 404; do not invent an upstream download source or reuse an unrelated artifact's license. Building a pinned hardware-test source is a possible later CPU/GPU test route, with its exact source and dependency notices preserved.

An independently authored GameCube homebrew fixture with explicit SPDX/license, a reproducible DOL build, visible frame output, controller input, and a known memory-card record would be the cleanest long-term automated fixture. It requires an actual PowerPC toolchain/runtime and validation; a file with a DOL extension or a loop that merely stays alive does not establish successful emulation. No compiler was installed and no fixture source/binary was authored in this research task.

## Evidence required before enabling Console Mode

Record the verified ES-DE 3.5.0 publisher/artifact, installation receipt, controlled catalog escaping tests, real homebrew frame output, managed child exit, and frontend restoration. Then measure DualSense navigation and controller-only exit, save creation/reopening, restart persistence, and reset preservation. Keep signing/notarization of this application's package separate from upstream component verification. Until those checks pass, advertise direct Dolphin launch according to its measured state and leave Console Mode planned.

## Current experiment: one system, opaque aliases, native wait broker

**Experimental developer path; no enabled product Console Mode.** The repository now contains an isolated [catalog generator](../../src/main/components/es-de/catalog.ts), its [filesystem adversarial tests](../../src/main/components/__tests__/esde-catalog.test.ts), and a [main-process wait broker](../../src/main/macos/console-broker.ts). The parent task owns the native helper and developer harness. A verified ES-DE component installer, application UI and durable frontend metadata are separate work. See [homebrew-fixtures.md](homebrew-fixtures.md) for exact fixture provenance and the observed 240p rendering experiment; rendered output alone does not complete the frontend/controller/save flow.

### Owned profile and startup

For ES-DE **v3.5.0**, official GitLab tag metadata resolves to commit `50e4b600ae533d772bae3ff880d11a09b05dbe84`. The [pinned argument parser](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/main.cpp#L197) accepts this argv array for the isolated test:

```text
--home <session-root>/home --resolution 960 640 --fullscreen-padding 0 --no-splash --no-update-check --gamelist-only
```

There is no `--windowed` switch. The [macOS renderer](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/renderers/Renderer.cpp#L226) uses a normal bordered window when an explicit resolution is supplied. `--no-update-check` is compiled under `APPLICATION_UPDATER`; check the actual selected artifact's help output when changing distributions. Spawn the executable directly with `shell: false` and an argv array.

Set the child environment `HOME=<session-root>/home` and `ESDE_APPDATA_DIR=<session-root>/home/ES-DE`, or explicitly remove any inherited `ESDE_APPDATA_DIR`. These are child-process values, not shell assignments changing the user's home. [FileSystemUtil.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/utils/FileSystemUtil.cpp#L259) lets the latter environment variable override app-data placement. Critically, [main.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/main.cpp#L588) clears/chmods the macOS `~/Library/Saved Application State/org.es-de.Frontend.savedState` directory **before** parsing `--home`, so `--home` alone does not isolate that behavior.

The generated profile lives under `<session-root>/home/ES-DE`. It uses `custom_systems/es_systems.xml`, an empty `custom_systems/es_find_rules.xml`, and `gamelists/gc/gamelist.xml`. The documented `<loadExclusive/>` is a **top-level sibling** of `<systemList>`, as confirmed by [SystemData.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/SystemData.cpp#L885); it suppresses the bundled systems. The sole GameCube system points to the absolute owned `<session-root>/roms/gc` marker directory, not the user's library. No external event scripts, imported launch commands, alternate emulator definitions or resource overrides are added.

An explicit `ROMDirectory` is not required for the absolute custom system path. The [startup path](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/main.cpp#L1171) shows the ROM-path dialog when loading produces `NO_ROMS`, not merely when the setting is empty. A valid marker plus its gamelist should avoid that dialog; actual startup remains a native observation. If the developer harness sets the global path for consistency, the [settings reader](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/Settings.cpp#L450) reads `<session-root>/home/ES-DE/settings/es_settings.xml` and accepts a `<settings>` root with `<string name="ROMDirectory" value="<session-root>/roms"/>`. `StartupSystem=gc` and `StartupView=gamelist` are supported strings. The catalog generator does not write these optional settings.

### Marker namespace and fixed command

The caller creates a short canonical ASCII session root, owned by the current UID with mode `0700`, and first copies its verified native helper to the ordinary executable `<session-root>/helper`. The catalog rejects unsafe/noncanonical paths, an unowned/nonprivate root, helper symlinks/hardlinks, unsafe helper modes, duplicate or malformed IDs, preexisting catalog/profile state, and detected symlink boundaries. Mutations use exclusive creation; failures leave disposable owned partial state rather than recursively deleting possibly replaced paths. The caller must not allow another process to mutate the private root during construction. These checks do not claim `openat`-level isolation against a hostile same-account process.

Each marker is a zero-byte mode-`0600` file `<32-lowercase-hex-id>.ewgame`; `.ewgame` is the only launchable extension. Names appear only in XML-escaped gamelist display metadata. XML-invalid codepoints are discarded, with the ID used when no display characters remain. Original filenames remain unchanged. The main process alone keeps the ID-to-original-path mapping in memory; no source ROM path or display name enters the command. The fixed command is exactly:

```text
<session-root>/helper --session '<session-root>' --game %ROM%
```

Here `%ROM%` expands only to an owned canonical ASCII marker path, for example `<session-root>/roms/gc/11111111111111111111111111111111.ewgame`. Its alphabet cannot contain a shell metacharacter or another ES-DE expansion token. This constrained use differs from substituting unrestricted user filenames: stock ES-DE's incomplete escaping of backticks/pipes remains a blocker for a direct user-ROM catalog. Shell quoting does not make an arbitrary `%ROM%` safe. The root grammar also excludes `%` in the fixed helper path, because ES-DE substitutes tokens even within quotes. Do not enable background launch, per-game commands or other raw filename/name substitutions.

The literal helper executable is intentionally unquoted. Its validated canonical ASCII alphabet excludes whitespace and shell metacharacters. Pinned [FileData.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/FileData.cpp#L2713) recognizes an initial double quote but treats single quotes as literal filename characters; a real developer run proved that single-quoting this executable fails discovery before the helper runs. Session arguments stay quoted. This correction changes no user-ROM interpolation policy.

The helper accepts only the generated marker shape and derives the opaque ID. Main's independently supplied allowed-ID set is the launch authority. Neither a marker's existence nor a syntactically valid ID authorizes an unknown game. Main revalidates the original library/game/bundle and launches Dolphin using its existing argument array. The broker accepts no executable, ROM path, options, shell text or environment.

### Actual experimental wire protocol

The broker creates `<session-root>/s`, a private mode-`0600` Unix socket, and `<session-root>/key`, an exclusively created mode-`0600` file containing a fresh 32-byte key encoded as 64 lowercase hexadecimal characters. It verifies the root's ownership/canonical device/inode identity, refuses occupied boundaries, limits the socket pathname to 100 bytes and copies the allowed IDs into its own set. Credentials stay out of CLI arguments, logs and the renderer. The private root/key limit unrelated or stale requests; they are not a same-user macOS sandbox.

Each connection receives one newline-terminated UTF-8 JSON challenge:

```json
{"schema":1,"challenge":"<64-lowercase-hex>"}
```

The helper returns exactly one newline-terminated request and then **half-closes its write side** while keeping the read side open:

```json
{"schema":1,"id":"<32-lowercase-hex>","proof":"<64-lowercase-hex>"}
```

The proof is HMAC-SHA-256 using the binary key over the UTF-8 bytes of `challenge + "\n" + id`. Main compares it in constant time. There is no separate hello, length prefix, generation, session token, request ID or heartbeat protocol in this experiment. A fresh random challenge is generated per connection, and only one request can be processed on that connection. The broker allows at most two connections, imposes a five-second request deadline and rejects requests larger than 4096 bytes, extra fields, duplicate keys, malformed IDs/proofs, extra frames and trailing bytes. Validation and launch occur **after write-side EOF**, which prevents a valid prefix followed later by hostile trailing data from starting a game. Allowed-ID membership is checked independently of proof validity.

Before calling the launch callback, main claims an active flag synchronously. It holds that flag until the callback settles, even if the client disappears, and rejects concurrent launch requests. The callback uses `ComponentManager.launchAndWait(library, originalGamePath)` so its promise tracks that exact child's completion. A successful terminal reply is `{"ok":true,"code":<integer-or-null>,"signal":<signal-or-null>}` followed by a newline. Rejection uses the bounded generic `{"ok":false,"error":"launch-failed"}` reply. There is no intermediate started message or claim that an emulated title rendered.

### Completion and save boundaries

The native helper waits for the terminal reply and retains its stdout pipe. Stock ES-DE's normal `popen` path observes pipe EOF; returning after authentication or spawn would restore the frontend while the game still ran. Broker close refuses an active game, and cleanup verifies owned file/socket identity before unlinking. A client disconnect does not release the game's active lock or stop the emulator. The manager's existing lock, surviving-process probe and quit policy continue to protect update/reset/library-switch/duplicate-launch operations.

No gameplay timeout, heartbeat recovery, reconnect protocol or persisted launch generation is implemented here. Native focus restoration and controller-only exit require actual Mac measurements. Failed core initialization can leave Dolphin alive, so process existence, terminal exit, rendered output, input and save behavior must be reported separately.

Always pass **the original game path** to Dolphin, with its existing isolated user directory inside the selected portable library. Do not pass the marker, rename/copy the ROM or derive saves from its opaque ID. Dolphin's [pinned executable metadata code](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/ConfigManager.cpp#L390) derives a homebrew ID from the executable filename, so an alias can change configuration/save identity even when the bytes match. The frontend catalog is disposable machine state; original ROMs, Dolphin user data and existing saves retain their locations.

Stable game IDs, favorite/play-count migration, rename reconciliation and cross-Mac metadata portability remain **planned**. Current input IDs and in-memory mapping do not establish persistence across rescan/restart. Future catalog regeneration should preserve typed metadata by stable ID and back up conflicting configuration; it must never reuse arbitrary imported command fields. Resetting component configuration must remain separate from disposable frontend-profile cleanup and preserve saves while idle. Disconnected/replaced volumes must fail closed; transparent renamed-volume recovery is not claimed.

Before enabling product Console Mode, measure the verified frontend artifact, original UTF-8 filenames, real frontend→emulator→frontend transitions, duplicate/disconnect races, mapped input/physical DualSense and a game-created save reopened after quit/restart/reset. Catalog and broker tests support their own boundaries; the 240p rendered menu does not substitute for the final input/save tests.

## Native startup experiment — 2026-10-03

This section records the completed experiment in `/private/tmp/ew-console-NRBYUi`. It does not claim the later corrected session `/private/tmp/ew-console-EEwqc9` passed. The retained `report.json` and `home/ES-DE/logs/es_log.txt` were read directly; native frame observations below were reported by the parent task's computer-use inspection.

The preceding stalled process sample, `/private/tmp/emulation-esde-stalled-sample.txt`, identifies ARM64 ES-DE 3.5.0 on macOS 27.0 (26A428). Every sampled main-thread stack was inside `Window::init → Renderer::init → RendererOpenGL::swapBuffers → Cocoa_GL_SwapWindow → SDL_CondWait_REAL`. This places the wait at the initial black-frame swap, after configuration and OpenGL context setup. It does not identify a HOME-directory or broker wait. The exact bundled dylib contains version string `SDL-release-2.32.10-0-g5d2495703`; the [pinned ES-DE dependency script](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/tools/macOS_dependencies_setup.sh#L359) selects that version.

The matching [SDL commit](https://github.com/libsdl-org/SDL/blob/5d249570393f7a37e037abf22cd6012a4cc56a71/src/video/cocoa/SDL_cocoaopengl.m#L474) waits on a condition when the swap interval is nonzero; its display-link callback supplies the signal. Interval zero skips that wait. The code does not check the display-link initialization/start results. The sampled wait and successful workaround support a VSync/display-link startup problem on this host; the reason the callback was unavailable, and whether this affects other macOS versions or display configurations, remain unproven.

The new session retained the verified signed bundle, controlled catalog and isolated child `HOME`/`ESDE_APPDATA_DIR`, adding **`--vsync 0 --debug`** as an explicit developer experiment. Its log reports Apple M4 Pro, OpenGL 3.3, SDL 2.32.10, a 120 Hz display, windowed 960×640 logical resolution and VSync disabled.

| Boundary | Observed result |
| --- | --- |
| Initialization milestone | `Application startup time: 787 ms`; log also reports one loaded system and one game |
| Frontend rendering | Parent native screenshot showed Nintendo GameCube and one generated entry |
| Frontend keyboard interaction | Return opened the entry; the log records keyboard Return mapped to `a` and the attempted launch |
| Helper discovery | Failed before helper execution: executable's leading single quotes were treated as literal filename characters |
| Dolphin launches | `0`; broker outcomes `[]`; no managed game remained active |
| Frontend exit | Normal process code `0`, signal `null` |
| Original fixture | Report records original ROM bytes preserved |
| Overall lifecycle | `ready=false`, `boundaryPassed=false`; retained report explicitly states no frontend-to-Dolphin launch was observed |

The attempted display name contained Unicode, backticks, pipes, an ampersand and `%ROM%`. It remained gamelist metadata; the raw launch command contained only the owned helper/session paths and the controlled `%ROM%` marker substitution. Discovery failed for this exact command:

```text
'/private/tmp/ew-console-NRBYUi/helper' --session '/private/tmp/ew-console-NRBYUi' --game %ROM%
```

[FileData.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/FileData.cpp#L2713) handles an initial double quote specially and otherwise extracts through the first space. Its regular-file check consequently received a path with literal single quotes. The corrected catalog uses the validated ASCII helper path without executable quotes, as documented above. That correction is source-supported; this completed session does not prove it launched Dolphin successfully.

The startup log milestone is emitted before the main application loop. It is not proof of a visible frame, input, focus or playable emulation. The native screenshot supplies the frontend rendering observation. The log contains only keyboard discovery/input evidence for this experiment; physical DualSense navigation, controller-only exit, return focus, game-created saves, production installation, persistent metadata and a clean-user/reboot flow remain unverified here.

### VSync workaround and pacing limits

VSync disabled does not make this macOS renderer a completely unrestricted busy loop. [RendererOpenGL.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/renderers/RendererOpenGL.cpp#L410) adds a 10 ms delay when a swap takes less than 3 ms. Despite the comment's background rationale, the macOS code applies that test on every swap, including foreground operation. Fast swaps therefore receive a modest pacing delay; this is not a uniform or configurable 30/60/120 FPS cap, and swaps taking at least 3 ms skip that extra delay.

The [pinned CLI](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/main.cpp#L308) accepts `--vsync 0/off/1/on`. No separate UI FPS cap was found in that parser or its settings defaults. `--max-vram` controls memory; `VideoUpscaleFrameRate` concerns video media. Neither supplies UI frame pacing. VSync enabled is the supported display-synchronized option, but it stalled in the observed host configuration. No other supported fixed-rate pacing option has been verified on this host. Actual FPS, CPU usage, thermals and power consumption were not measured; `--vsync 0` remains an experiment, not a validated production default.

### Return to the frontend: internal state versus macOS focus

The [Unix launch path](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-core/src/utils/PlatformUtil.cpp#L226) waits on the helper's output pipe and handles only controller add/remove events during that wait. It does not explicitly raise/focus the ES-DE window or activate its macOS application. After return, [FileData.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/FileData.cpp#L2347) restores scrolling/animations and closes the launch screen; [ViewController.cpp](https://gitlab.com/es-de/emulationstation-de/-/blob/50e4b600ae533d772bae3ff880d11a09b05dbe84/es-app/src/views/ViewController.cpp#L1080) briefly blocks exit-button carryover before enabling input. These are internal UI transitions, not an explicit macOS foreground guarantee.

macOS may return to the preceding app after Dolphin closes, but that must be observed. A valid controller-only return test must show the original generated entry again and accept a fresh physical navigation/menu action **without clicking the frontend or using a keyboard to restore focus**. Preserve the actual Dolphin terminal result in the broker report: this Unix command is backgrounded with `&`, and the shell status returned by `pclose` need not be the helper's or emulator's exit status. Frontend exit code zero already coexists with a failed launch in this completed experiment.

## Successful experimental launch boundary — 2026-10-03

The later completed session `/private/tmp/ew-console-uRv3gg` used the corrected executable token and the same explicit `--vsync 0 --debug` experiment. Its `report.json`, ES-DE log and generated gamelist were read directly. The native frame observations and post-exit Dolphin resource-seal checks below were reported by the parent task. This result does not erase the preceding `NRBYUi` discovery failure or turn the VSync workaround into a production default.

| Boundary | Measured evidence |
| --- | --- |
| Frontend startup | ES-DE log records `Application startup time: 703 ms`; the milestone alone is not a frame/input/focus assertion |
| Controlled launch | Exactly one known marker ID, `988ca110d5e919afe6cb5ad657333862`, passed helper/broker authentication and launched the original library path |
| Original filename | The Unicode/backtick/pipe/ampersand/literal `%ROM%` path below was resolved by main and passed to Dolphin through an argv array |
| Native rendering | Parent computer-use inspection observed the actual 240p Test Suite menu in Dolphin |
| Emulator completion | Broker outcome `code=0`, `signal=null`; `launches=1`, `launchFailures=[]`, no managed game active afterward |
| Frontend return | Parent native inspection observed the ES-DE list again with one minute of playtime; the retained gamelist records `playcount=1` and `playtime=80` seconds |
| Frontend completion | Normal `code=0`, `signal=null`; report `ready=true`, `boundaryPassed=true`, `evidenceError=null` |
| Preservation and sealing | Report `originalROMPreserved=true`; the library file was independently rehashed to the exact diagnostic-derivative fingerprint below; parent reports the official Dolphin bundle in session `yNpzP9` still passed its resource seal after both standalone and frontend exits |

The shell-visible command in the actual ES-DE log is:

```text
/private/tmp/ew-console-uRv3gg/helper --session '/private/tmp/ew-console-uRv3gg' --game /private/tmp/ew-console-uRv3gg/roms/gc/988ca110d5e919afe6cb5ad657333862.ewgame
```

The original library file is ``ألعاب GameCube Library/roms/gc/اختبار `not-a-command` | & %ROM%.dol``. That filename is absent from the shell command. The hostile-looking display name stayed in gamelist metadata. Helper SHA-256 was `510e9a54138cfebb1805b9c32444541464d52b1e970d298dbc543eedfba32b78`. The library file is the separately documented **240p 1.20 diagnostic derivative**, 1,723,744 bytes, SHA-256 `6b273803b960113565f0b0ff8f0109a9e58e17b1fae34a262957e8fc6f4cec70`; it is not evidence that the unmodified author DOL now boots. See [fixture provenance](homebrew-fixtures.md).

This proves the measured developer frontend → authenticated marker → managed original path → rendered diagnostic menu → normal child completion → displayed frontend boundary for this session. A displayed list after exit does not prove automatic macOS focus restoration. The report explicitly leaves physical controller input, controller-only exit, focus restoration, game-created saves, production frontend installation, persistent metadata and a clean-user/reboot flow unverified. Its private DualSense hotkey configuration has `measured=false`. The persisted 80-second playtime is disposable-session metadata; migration and restart persistence remain planned. Product Console Mode stays disabled until the remaining first-slice tests pass.

## Official download origins for a future installer — 2026-10-03

The [official website](https://www.es-de.org/) was checked again and still linked these exact 3.5.0 files. Header-only requests and bounded one-byte GET range requests both completed with **zero client-visible redirects**:

| Architecture | Exact official package URL | Observed filename | Total bytes |
| --- | --- | --- | ---: |
| Apple Silicon | [GitLab package file 357717468](https://gitlab.com/es-de/emulationstation-de/-/package_files/357717468/download) | `ES-DE_3.5.0-arm64.dmg` | 79,383,926 |
| Intel | [GitLab package file 357717755](https://gitlab.com/es-de/emulationstation-de/-/package_files/357717755/download) | `ES-DE_3.5.0-x64.dmg` | 81,525,485 |

HEAD returned HTTP 200. GET with `Range: bytes=0-0`, a 1 KiB transfer limit, HTTPS-only redirect policy and finite request/deadline bounds returned HTTP 206, one byte and the matching `Content-Range` totals. Neither request contacted an alternate origin. These observations agree with the earlier complete Apple download in [es-de-artifact.md](es-de-artifact.md), which also recorded zero redirects and the signed publisher/artifact verification.

For this exact Apple release, the transport allowlist needs only **`https://gitlab.com`** and the exact `/es-de/emulationstation-de/-/package_files/357717468/download` path. No CDN/object-storage wildcard is evidenced or required. A future release may change transport; resolve it from the official source and review any newly observed origin before accepting it. The proposed installer should reject credentials, non-HTTPS URLs, unexpected ports/query/fragment and unreviewed redirects, with bounded redirects, bytes and elapsed time. Content-Disposition is descriptive metadata, not a destination pathname or trust decision.

Download origin and a local fingerprint do not replace verification of the actual selected signed bundle: ARM64, exact release/bundle identity, numeric minimum OS, reviewed Team ID `K56UAA4SXL`, intact resource seal and Gatekeeper acceptance. Preserve the upstream notices and quarantine; comprehensive redistribution terms remain a separate open item. This research adds a concrete transport boundary and does not implement the ES-DE component installer or enable product Console Mode.
