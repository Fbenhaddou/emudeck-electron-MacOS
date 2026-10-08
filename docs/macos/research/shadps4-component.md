# shadPS4 (PS4) as a managed macOS component: research spike

## Project verdict (2026-10-08): framework **go**, emulator **not yet** (owner decision pending)

- **Re-checked by hand from upstream's own files:**
  - The 0.19.0 macOS asset size and SHA-256.
  - `-DCMAKE_OSX_ARCHITECTURES=x86_64` in CI.
  - The `sysctl.proc_translated` check in `main.cpp`: the binary refuses to run unless Rosetta translates it.
  - No `codesign` or `notarytool` step in CI.
- **That fails three of our rules.** Native ARM64 over Rosetta; never install Rosetta silently; downloads pinned to a signing team. So it does not ship on the default path.
- **Build the framework now.** These pieces are needed for PS4 and help PS3/Wii U too:
  - folder games (`eboot.bin` + `sce_sys/param.sfo`);
  - a "PS4 system module" firmware kind validated by allowlisted name and header, labelled *unverified* because no hash list exists;
  - update/DLC folders;
  - `cwd`-based config isolation (`user/` portable folder).
- **Our layout is simpler than ES-DE's.** ES-DE only ever sees our opaque catalog (Decision 005), so PS4 game folders can live in `roms/ps4/<game>/` like any other system. We don't need ES-DE's `.ps4` serial-file convention.
- **Owner decision needed (proposed Decision 012).** Should an opt-in **Experimental, unsigned-upstream** tier exist? It would mean:
  - URL, size and SHA-256 pinned;
  - Gatekeeper left alone;
  - the user approves the first launch in Privacy & Security;
  - Rosetta only on the user's explicit confirmation.
  - Alternatives: build from source and sign with the owner's Developer ID, or wait for an arm64 build (issue #4637).
  - Apple ends general Rosetta in macOS 28 (expected 2027), so the unsigned tier has a sunset.
- **Hardware.** 16 GB RAM is the practical minimum (24–32 GB preferred), on macOS 26+. Evidence is in §3.

---

Date: 2026-10-08. Method: read-only. GitHub REST API JSON, raw source files on `main`, official README/site, ES-DE GitLab, web search. Nothing executable was downloaded or run.
Labels: **[V]** = verified from a primary source (code, API, official doc). **[I]** = inference or secondary source.

## Recommendation: **EXPERIMENTAL** (opt-in, clearly labelled). Not "go".

shadPS4 is very active, and its macOS build is official. But it fails two of our hard install rules, and it has a sunset risk:
1. The macOS build is **x86_64 only and runs under Rosetta 2**. Apple says Intel-only apps will not launch on macOS 28 (expected 2027), apart from an unspecified "older games" subset. The native arm64 build crashes today (issue #4637).
2. The build is **not Developer ID signed and not notarized**, so we cannot pin a signing team.
3. Compatibility on macOS is thin (24 "playable" macOS-labelled reports), and there is a memory-growth bug on unified-memory Macs.

Build the framework pieces now (folder games, sys_modules declarations, update/DLC overlays, isolated config). That work is useful and low-risk. Ship shadPS4 itself only as "Experimental", and only after the owner records a new decision on the unsigned-binary exception (see Design §G).

---

## 1. Release source **[V]**
- Repo: https://github.com/shadps4-emu/shadPS4 (33.2k stars, default branch `main`, last push 2026-10-07).
- **Latest stable:** `v.0.19.0` "The Shadoween special", published 2026-10-02T14:03:45Z.
  - macOS asset: `shadps4-macos-sdl-0.19.0.zip`
  - Size: 36,656,177 bytes
  - API digest: `sha256:47676b4875343b69f49689c7668d71de79ecaaa17ffeab3415d4137800b7ee02`
  - URL: https://github.com/shadps4-emu/shadPS4/releases/download/v.0.19.0/shadps4-macos-sdl-0.19.0.zip
  - The same release also ships `shadps4-linux-sdl-0.19.0.zip` and `shadps4-win64-sdl-0.19.0.zip`.
- **Nightly / pre-release:** one per push to `main`, tagged `Pre-release-shadPS4-<date>-<fullhash>`. Latest is `Pre-release-shadPS4-2026-10-07-0fe263a…` (2026-10-07T19:46:17Z).
  - Asset: `shadps4-macos-sdl-2026-10-07-0fe263a.zip`
  - Size: 36,771,178 bytes
  - Digest: `sha256:20484953dd94cdfd8221503e2bb60f8cf8d6fcae63eed2f1a1e92cb08697433c`
- Older stable macOS assets all carry API `digest` fields: 0.18.0 (2026-08-18), 0.17.0 (07-30), 0.16.0 (06-01), 0.15.0 (03-17), 0.14.0 (02-07), 0.13.0 (2025-12-24).
- **Format:** a `.zip`, not a `.app` or `.dmg`. The CI job (`.github/workflows/build.yml`, job `macos-sdl`) puts four files in it: `shadps4`, `libvulkan.dylib`, `libvulkan_kosmickrisp.dylib` and `kosmickrisp_mesa_icd.json`. That means a bare CLI executable with an `@executable_path` rpath. The zip listing itself was not inspected; it is inferred from CI. [V for CI, I for zip contents]
- **Architecture: x86_64 only.**
  - CI configures with `-DCMAKE_OSX_ARCHITECTURES=x86_64`. [V]
  - `main.cpp` refuses to start unless it is running under Rosetta (`sysctl.proc_translated == 1`), with the message "shadPS4 only supports Apple Silicon Macs". [V]
  - The x86_64 link uses fixed segment addresses (`-pagezero_size 0x4000`, `USER_AREA 0x7000000000`, …) to reproduce the PS4 address space. [V]
  - A native arm64 build compiles but aborts: "_runOnAnotherStack not implemented" (issue #4637, open). [V]
  - No Universal build exists.
- **Signing/notarization: none in CI** (no `codesign` or `notarytool` step in build.yml). [V]
  - Issue #4520 shows a user running `./shadps4` from Terminal and then approving it under Privacy & Security, which is consistent with a non-notarized binary. [V]
  - Developer ID team: **none**. Whether the binary carries an ad-hoc signature is **unknown** (we did not download it).
- **Qt GUI is a separate repo:** https://github.com/shadps4-emu/shadps4-qtlauncher. Latest pre-release 2026-10-07 has `shadPS4QtLauncher-macos-qt-2026-10-07-4e32b32.zip` (46,108,002 bytes, `sha256:5e05ecb7…a238`). The core is a CLI. Started with no arguments, it prints help and points users to the QtLauncher; `-b` opens a built-in "Big Picture" mode. [V] **We do not need the Qt launcher.**

## 2. Graphics on macOS
- **Current renderer: Vulkan on KosmicKrisp**, the LunarG Mesa Vulkan-on-Metal driver. It is bundled as `libvulkan_kosmickrisp.dylib` plus the Khronos loader `libvulkan.dylib`. [V]
  - It is built from submodule `externals/mesa-kosmickrisp` → github.com/shadexternals/mesa-kosmickrisp (a shadPS4 fork; the commit is pinned by the submodule and there is no release version number). [V]
  - KosmicKrisp needs **macOS 26+ and Metal 4 on Apple Silicon**. CMake sets `CMAKE_OSX_DEPLOYMENT_TARGET 26.0` with the comment "Minimum OS version for KosmicKrisp". [V]
  - The README says "at least macOS 26.0… Intel Macs are not supported". [V]
- History: v0.16.0 notes say "Updated MoltenVK integration". The switch to KosmicKrisp came with 0.17.0, per issue #4877, which tested "v0.17.0 (KosmicKrisp) and v0.16.0 (MoltenVK)". [V]
  - `-DENABLE_SYSTEM_VULKAN=ON` would let a source build use another Vulkan. [V]
- KosmicKrisp is Vulkan 1.4 conformant (Khronos, 2026). Performance is "not too far behind native Metal", per Phoronix (Oct 2026). [I, secondary]
- Known Metal-side limitation (#4877, open):
  - KosmicKrisp reports one device-local heap equal to all system RAM, so shadPS4's integrated-GPU budget clamp does nothing.
  - On a 16 GB Mac, process footprint grows from about 3.5 GB to about 8 GB while idle in Bloodborne. The game then slows to a slideshow and is killed by the OS. [V]
- The official site's quickstart still says "macOS 15.4" and "Rosetta 2". That is stale compared with the README's macOS 26. [V, conflicting docs]

## 3. Compatibility and performance on M-series
- Compatibility tracker: https://github.com/shadps4-compatibility/shadps4-game-compatibility. Open-issue counts from the GitHub search API on 2026-10-08 [V]:
  - Everything (2,250): playable 392 (17%), ingame 596 (26%), menus 329, boots 354, nothing 579.
  - Labelled `os-macOS`: 321 reports, of which **playable 24 and ingame 63**. Windows has 970. There is also an `issues: rosetta` label.
- M-series reports [V]:
  - #4520: M1 / 16 GB / macOS 26.5. 0.16.0 hangs; 0.15.0 works.
  - #4877: 16 GB Apple Silicon, memory runaway.
  - #3289: The Last Guardian crashes on macOS.
  - No chip-by-chip (M1 vs M4) benchmarks were found. [I]
- Official minimums (shadps4.net/quickstart, undated): 8 GB RAM, a 4-core/6-thread CPU with x86-64-v3, and Vulkan 1.3 with 2 GB VRAM. Rosetta translates x86-64-v3 (AVX2), which the macOS build requires. [V doc; Rosetta AVX2 support is I]
- Apple Silicon specifics [V]:
  - 16K pages are the reason for `-pagezero_size 0x4000`.
  - Address-space carving failures (`CarveVMA: Mapping cannot fit inside free region`) are reported under Rosetta (#4637).
- **Evidence-based minimums [I]:**
  - Apple Silicon, macOS 26.0+.
  - **16 GB RAM as the practical minimum, 24–32 GB recommended.** 8 GB will boot only light titles, and the #4877 leak eats roughly 8 GB of unified memory.
  - Prefer M2 Pro / M3 / M4 class or better. M1 base is "may boot", with no performance claims.
  - Rosetta must be installed. One report says macOS 27 removes Rosetta on upgrade, so we should detect it rather than assume (unverified, secondary).
- **Platform sunset [V, Apple via press]:** Rosetta stays general-purpose through macOS 27. "Intel-based apps running on Rosetta will not open in macOS 28", except a limited games subset whose scope Apple has not defined (Macworld, AppleInsider). macOS 26.4+ already warns when Rosetta apps launch.

## 4. PS4 system modules (firmware)
- **Location** [V, `path_util.cpp` and `emulator_settings.cpp`]:
  - Default is `<UserDir>/sys_modules/`.
  - It can be overridden with `General.sys_modules_dir` in `config.json`.
  - **Per-game override:** `sys_modules/<SERIAL>/<name>.sprx` is always loaded first. Any module is allowed there.
- **Allowed global modules (LLE allowlist in `sysmodule_internal.cpp`)** [V]. "HLE" means shadPS4 has its own fallback; "none" means the game may break without the dump.
  - With HLE fallback: libSceNgs2, libSceAvPlayer, libSceRtc, libSceJpegEnc, libScePngDec, libScePngEnc, libSceFont, libSceFontFt, libSceRudp, libSceSystemGesture.
  - No HLE: libSceUlt, libSceAvPlayerStreaming, libSceJpegDec, libSceJson, libSceJson2, libSceCesCs, libSceAt9Enc, libSceAudiodec, libSceAudiodecCpu, libSceAudiodecCpuDdp, libSceAudiodecCpuM4aac, libSceAudiodecCpuDtsHdLbr, libSceAudiodecCpuHevag, libSceFreeTypeOt, libSceFreeTypeOl, libSceFreeTypeOptOl, libSceBeisobmf, libSceBemp2sys, libSceWkFontConfig, libScePsmKitSystem, libSceDepth, libScePadTracker, libSceMoveTracker, libSceXml.
  - Modules not on the allowlist are stubbed silently. The README lists the same set (plus LibcInternal) and says they "are required to run the games properly and must be dumped from your legally owned PlayStation 4 console."
- `libc` and `libSceFios2` normally come from the game's own `sce_module/` folder. [V for the code path; that they ship with the game is I]
- **How users dump them** (quickstart) [V]:
  - Sources: decrypting FTP (GoldHEN recommended) from `/system/common/lib/`.
  - **Fonts:** `/preinst/common/font` and `/system/common/font2` go into `<UserDir>/fonts` (or `General.font_dir`).
  - **Licenses:** RIF files from `user/home/<id>/license` go into `<UserDir>/licenses`.
  - **Trophy key:** stored in `<UserDir>/keys.json`. It is a console key: never ship it; it is needed only for trophies. [V]
- **Hashes:** shadPS4 publishes no known-hash list, and module bytes vary by firmware version. [I] Our "validate against known hashes" model will not fit cleanly.

## 5. Game layout [V unless marked]
- **Folder format:** `CUSAxxxxx/` containing `eboot.bin` and `sce_sys/param.sfo` (the emulator reads TITLE_ID, TITLE, APP_VER, SYSTEM_VER and CONTENT_ID from `/app0/sce_sys/param.sfo`), plus `sce_module/`, trophies and so on.
  - The game folder is mounted as `/app0` (and `/hostapp`).
  - `.zar` archives (ZArchive) are accepted too, for games and DLC.
- **Updates:** a sibling overlay folder named `<game>-UPDATE` or `<game>-patch` (a `-mods` overlay also exists). It is overlaid on the base game.
  - Launching from the update folder rebases to the base game automatically.
  - `--ignore-game-patch` / `-i` disables the overlay.
- **DLC:** `<addon_install_dir>/<TITLE_ID>/<one folder or .zar per DLC>`, each with `sce_sys/param.sfo`. Matching uses CONTENT_ID → entitlement label.
  - The default is `<UserDir>/addcont`.
  - Set it with `General.addon_install_dir` or `shadps4 --set-addon-folder <dir>`.
  - License-only DLC needs RIF files in `licenses/`.
- **PKG:** the core has no PKG code (no pkg sources in the `main` tree). Community guides say PKG install was dropped around v0.7. [V for the code, I for the date] **Do not accept or handle `.pkg`.** It brings in decryption, piracy-adjacent tooling and fake-PKG concerns.

## 6. Controllers [V, `src/input/*`, `sdl_window.cpp`, `controller.cpp`]
- Input uses SDL3 gamepads. Xbox and DualShock/DualSense "work out of the box".
- DualSense features:
  - **Touchpad:** real SDL touchpad events (down/up/motion), and touchpad L/C/R as buttons.
  - **Motion:** gyro and accel via SDL sensors (`Input.motion_controls_enabled`, default true).
  - **Lightbar:** `SDL_SetGamepadLED`, with an `override_controller_color` option.
  - **Rumble:** `SDL_RumbleGamepad`. No adaptive-trigger or HD-haptics code was found. [I]
- **Mapping files:** `<UserDir>/input_config/default.ini`, `<SERIAL>.ini` and `global.ini`, as plain `output = input[, input2, input3]` lines.
  - Examples: `cross = cross`, `axis_left_x = axis_left_x`, `analog_deadzone = leftjoystick, 5, 127`.
  - `Input.use_unified_input_config` defaults to true, meaning one config for all games.
- **Hotkeys** (live in `global.ini`):
  - `hotkey_quit = lctrl, lshift, end` opens an in-emulator **quit confirmation window**, not an instant exit.
  - Others: F11 fullscreen (Cmd+F11 on Mac), F9 pause, F10 FPS, F8 reload inputs, F3 emulator settings.
  - Whether a pad-button chord can be bound to `hotkey_quit` is not confirmed. [I]
- `background_controller_input` defaults to false. If the window loses focus, the pad stops working, which is relevant for our focus hand-offs.

## 7. Config files and CLI [V, `path_util.cpp`, `main.cpp`, `emulator_settings.cpp`]
- **User dir:**
  - If `<current working dir>/user` exists, it is used (portable mode).
  - Otherwise `~/Library/Application Support/shadPS4/`.
  - No env var or flag sets it; `--override-root` is a guest-root option, not the user dir.
  - **We isolate by spawning with `cwd` = our component folder, after pre-creating `user/` there.**
- **Config:** `user/config.json`, with groups General, Log, Debug, Input, Audio, GPU, Vulkan.
  - Per-game overrides go in `user/custom_configs/<SERIAL>.json`.
  - The old `config.toml` triggers an SDL **migration dialog**. Never leave a `config.toml` in a managed dir.
  - Other subfolders: log, shader, cache, data (saves), home, trophy, fonts, sys_modules, licenses, patches, cheats, screenshots.
- **CLI** (a CLI11 parser):
  - `shadps4 [-g|--game] <path-to-eboot.bin | dir | SERIAL> [--fullscreen true|false] [--config-clean|--config-global] [-i] [-p patch] [--show-fps] [-- guest args]`.
  - Utility commands that persist into config: `--add-game-folder <dir>` and `--set-addon-folder <dir>`.
  - The game argument may also be the last positional argument.
  - A serial is resolved by searching `General.install_dirs`.
  - No Qt is needed.
  - ES-DE notes that macOS needs fullscreen for window switching, so pass `--fullscreen true`.

## 8. ES-DE [V, master `resources/systems/macos/es_systems.xml`, `es_find_rules.xml`, `USERGUIDE.md`]
- macOS has a `ps4` system: path `%ROMPATH%/ps4`, extensions `.bin .BIN .ps4 .PS4`. Commands:
  - Default: `%EMULATOR_SHADPS4% -g %INJECT%=%BASENAME%.ps4`. This "Game Serial" method uses a small `<Name>.ps4` text file whose content is the serial, e.g. `CUSA07010`.
  - `%EMULATOR_SHADPS4% %ROM%` (eboot.bin method).
  - `[GUI]` variants: `%EMULATOR_SHADPS4-GUI% -d -g …`.
- Find rules: static paths `/Applications/shadps4.app/Contents/MacOS/shadps4` and `/Applications/shadPS4QtLauncher.app/…`. These do **not** match the official zip, which ships a bare binary, so we must supply our own find rule or command, as we already do for other managed emulators. [I]
- The guide recommends installing PS4 games *outside* the ROMs tree, because thousands of files slow scanning. The shortcut method is unavailable on macOS.

## 9. Legal homebrew test fixture
- **OpenOrbis PS4 Toolchain:** https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain, **GPL-3.0** (bundled LLVM is Apache-2.0). Release v0.5.4 is dated 2026-01-04; v0.5.3 (2025-02-17) has `samples-elf-llvm-18.zip` at 6.78 MB. [V]
  - `samples/hello_world` has Title ID **BREW00083** and its own `sce_sys/` (icon0.png); the build creates `eboot.bin` and `param.sfo`.
  - Other samples: graphics, input, font, audio-wav, SDL2, trophies, and more. [V]
- **Caution:** the sample layout expects `sce_module/libc.prx`, `libSceFios2.prx` and `sce_sys/about/right.prx`. The repo ships only `.gitkeep` there. **Do not obtain or ship those prx files.** Use an ELF-only build of a sample that links OpenOrbis's static musl, and write our own synthetic `param.sfo`. [V layout, I approach]
- No report was found of shadPS4 running OpenOrbis samples; the compatibility list has no BREW entries. A physical test is needed. [V/I]
- Keep legal material in place: GPL-3.0 text, source pointer and a build recipe.

## 10. Licenses [V]
- shadPS4: `LICENSE` is GPL-2.0. Source headers and REUSE.toml say **GPL-2.0-or-later**. The README calls it "GPL-2.0".
- Bundled: Mesa/KosmicKrisp (MIT), Khronos Vulkan-Loader (Apache-2.0). REUSE.toml also lists MIT, BSL-1.0, BSD-3-Clause, OFL-1.1 and CC0 for assets and externals.
- It is a separately downloaded, separately run program, so there is no linking conflict with our GPL-3.0-or-later app. Show its license in the component's legal panel. [I]

## 11. Maintenance [V]
- 348 commits on `main` from 2026-07-08 to 2026-10-08 (API pagination count). Pre-release builds appear on almost every push.
- Stable releases about every 1–2 months:
  - 2025-12-24, 2026-02-07, 03-17, 06-01, 07-30, 08-18, 10-02.
- Shadps4.net blog: Oct 1 v0.19.0 post, Sep 5 progress report.

---

## Design implications for our framework

**A. Component manifest (`shadps4`)**
- Pin only stable releases: URL + size + `sha256` from the API `digest` (for example the 0.19.0 values above). Never track nightlies by default.
- Extract into `components/shadps4/<version>/` without following symlinks.
- Before enabling, check:
  - `lipo -archs` = `x86_64`;
  - the expected 4 files exist;
  - the ICD json points to a sibling dylib.
- Preflight before showing "Ready":
  - macOS ≥ 26.0;
  - Apple Silicon;
  - **Rosetta installed** (`arch -x86_64 /usr/bin/true` or `pkgutil --pkg-info com.apple.pkg.RosettaUpdateAuto`);
  - RAM ≥ 16 GB (otherwise a warning, not a block).
- Show a standing banner: "x86_64 under Rosetta; Apple ends general Rosetta in macOS 28."

**B. Folder-game marker**
- A PS4 game is a directory, recognised by a validated `eboot.bin` plus `sce_sys/param.sfo`. We parse the SFO ourselves (TITLE_ID, TITLE, APP_VER, CONTENT_ID) with a bounded parser.
- Keep games outside the ES-DE ROM tree, e.g. `Library/PS4/Games/CUSAxxxxx/`.
- In `roms/ps4/`, write `<Title>.ps4` marker files that contain only the serial. ES-DE's macOS default already uses this convention.
- Our launch resolver maps the serial to an absolute `eboot.bin` path, after the symlink and traversal checks.
- Never move or rename the user's dumps; only index them.

**C. Firmware declarations**
- Use a new firmware kind, "PS4 system module".
- Declare the 34 allowlisted names, each with `hasHle: true|false`.
- Import into `user/sys_modules/`, or `sys_modules/<SERIAL>/` for per-game modules.
- Validate by exact filename from the allowlist, a size sanity check and the ELF/SELF magic.
- Store the user's own SHA-256 for change detection. **No authoritative hash list exists**, so the UI should say "unverified dump" rather than "verified".
- Fonts (font/font2 folders), licenses (RIF) and `keys.json` (trophy key) are separate optional user-supplied items.
- Never download any of these items.

**D. Updates and DLC**
- Accept `CUSAxxxxx-UPDATE` or `-patch` as siblings of the base folder. Show the base and update `APP_VER` from both SFOs.
- DLC lives under our isolated `addcont/<TITLE_ID>/<dlc-folder>` (or `.zar`), referenced via `General.addon_install_dir` in our generated config.
- No `.pkg` handling at all. If a `.pkg` is dropped in, refuse it with a plain explanation.

**E. Launch argv** (spawn, `shell:false`)
- `[<bin>/shadps4, "--fullscreen", "true", "-g", <abs eboot.bin>]`.
- `cwd = <component data dir>`, which holds the pre-created `user/`.
- Never pass a bare serial: that would trigger a search of `install_dirs`.
- No `--` guest args from untrusted input. Allowlist our own flags, e.g. `--show-fps` and `-i`.
- Exit hold: shadPS4's quit hotkey opens a confirm dialog, so our existing escape-hatch hold (terminate the process group) remains the reliable exit. Test it physically.

**F. Config isolation**
- Generate `user/config.json` only, never `config.toml`. Set:
  - `General.install_dirs` = our games root;
  - `General.addon_install_dir`;
  - `General.sys_modules_dir` and `font_dir`;
  - `GPU.full_screen = true`.
- Generate `user/input_config/default.ini` and `global.ini` from our controller profile, including DualSense touchpad → `touchpad_center`.
- Saves live in `user/data` and `user/home`. Include them in backup-before-replace.
- Logs come from `user/log/`; diagnostics should collect them.

**G. Decision needed (owner)**
- shadPS4 cannot meet "Developer ID team + codesign requirement".
- Options:
  1. Record **Decision 012**: an "unsigned upstream" tier (SHA-256 + size + URL pinned, opt-in, Experimental badge, Gatekeeper left untouched). The user approves the first launch in Privacy & Security themselves; we never strip quarantine for them.
  2. Build from tagged source and sign with the owner's Developer ID. That is heavier, and we would then be a GPL-2.0-or-later binary distributor.
  3. Wait.
- Recommended: option 1 for an Experimental tier, revisited when upstream ships arm64 or signed builds, or when macOS 28 lands.

## Sources (accessed 2026-10-08)
- Releases API: https://api.github.com/repos/shadps4-emu/shadPS4/releases ; QtLauncher: https://api.github.com/repos/shadps4-emu/shadps4-qtlauncher/releases
- CI: https://github.com/shadps4-emu/shadPS4/blob/main/.github/workflows/build.yml ; CMake: …/CMakeLists.txt ; README: …/README.md
- Code: `src/main.cpp`, `src/common/path_util.cpp`, `src/core/emulator_settings.{h,cpp}`, `src/core/file_sys/fs.cpp`, `src/core/libraries/app_content/app_content.cpp`, `src/core/libraries/sysmodule/sysmodule_internal.cpp`, `src/input/input_handler.cpp`, `src/input/controller.cpp`, `src/sdl_window.cpp`, `src/common/key_manager.cpp`, `REUSE.toml`, `LICENSE`
- Issues: #4877, #4637, #4520, #3289 (github.com/shadps4-emu/shadPS4/issues/N)
- Quickstart: https://www.shadps4.net/quickstart ; site: https://shadps4.net
- Compatibility: https://github.com/shadps4-compatibility/shadps4-game-compatibility (search API counts)
- ES-DE: https://gitlab.com/es-de/emulationstation-de/-/raw/master/resources/systems/macos/es_systems.xml , …/es_find_rules.xml , …/USERGUIDE.md (§ Sony PlayStation 4)
- OpenOrbis: https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain (README, samples/hello_world)
- Rosetta: https://www.macworld.com/article/3063982/apple-ends-rosetta-support-macos-28.html ; https://appleinsider.com/articles/26/02/16/macos-tahoe-264-warns-if-your-apps-wont-work-when-rosetta-2-dies
- KosmicKrisp: https://www.khronos.org/news/permalink/kosmickrisp-achieves-vulkan-1.4-conformance-on-apple-silicon ; https://www.phoronix.com/news/KosmicKrisp-Vulkan-1.4-2026
