# Second component: PPSSPP (PSP) — research and generalization plan (2026-10-04)

Status: research, with the official artifact inspected and isolation measured on 2026-10-05 (see §0). Remaining facts marked **UNVERIFIED** still need evidence. Facts marked **UNVERIFIED** must be confirmed by inspecting the real DMG with the existing helper sequence (`hdiutil attach -readonly …`, `plutil`, `lipo -archs`, `codesign`, `spctl`) before any manifest or trust policy uses them. Source citations pin the `v1.20.4` tag (`T` = `https://github.com/hrydgard/ppsspp/blob/v1.20.4`).


## 0. Verified evidence (2026-10-05, macOS 27.0, Apple Silicon)

Official `https://www.ppsspp.org/files/1_20_4/PPSSPP_macOS.dmg`: 37,090,805 bytes, SHA-256 `bad86fc544a2c2fc5795d6a5832a8925d6db43e5789fe507f742305aaa357e17` (audit fingerprint only; upstream publishes no checksum). Mounted read-only, `-nobrowse -noautoopen`; no license prompt.

| Fact | Verified value |
| --- | --- |
| `.app` name | `PPSSPPSDL.app` (DMG also holds an `Applications` link) |
| Bundle identifier / executable | `org.ppsspp.ppsspp` / `Contents/MacOS/PPSSPPSDL` |
| Version keys | `CFBundleShortVersionString` = `CFBundleVersion` = `1.20.4` |
| Architecture | Universal: `x86_64 arm64` |
| Minimum macOS | No `LSMinimumSystemVersion`; arm64 Mach-O `minos 11.0` (`vtool -show-build`) |
| Signature | Developer ID Application: Millionth Line AB (**97NS59EENG**), hardened runtime; `codesign --verify --deep --strict` passes |
| Gatekeeper | `spctl --assess --type execute`: accepted, `source=Notarized Developer ID` |
| Entitlements | `allow-jit`, `allow-unsigned-executable-memory`, `disable-executable-page-protection` |
| Privacy usage keys | `NSCameraUsageDescription` present; no Bluetooth or microphone key |

**HOME isolation measured.** Launched through LaunchServices with `HOME=<private temp dir>`, quit normally after 10 s. Created only `<home>/.config/ppsspp/PSP/{SYSTEM/ppsspp.ini, SYSTEM/controls.ini, SAVEDATA, PPSSPP_STATE, GAME, TEXTURES, PLUGINS, Cheats, SYSTEM/CACHE}`. Before and after: no `~/.config/ppsspp`, `~/Documents/PPSSPP`, `~/Library/Application Support/PPSSPP`, `~/Library/Preferences/org.ppsspp.ppsspp.plist`, `defaults` domain or Saved Application State in the real home. No crash report. Not yet measured: a game run, savestate creation, controller input.

**Privacy identity.** When the manager spawns PPSSPP, macOS charges its privacy access to the manager (observed for ES-DE, see STATUS). PPSSPP's camera emulation therefore needs an `NSCameraUsageDescription` in the manager's own Info.plist before the component ships, or a camera-using game would terminate PPSSPP.

## 1. Why PPSSPP (and not a RetroArch core)

| Candidate | What it would prove | Why not first |
|---|---|---|
| **PPSSPP** | A second standalone app with **different** discovery (two sources), a bundle name that differs from its executable, **no `--user` flag** (it needs isolation through the environment), no BIOS, and a different save layout | Recommended |
| RetroArch + core | Mostly a different abstraction: one host app, many cores, core download/updater, per-core options | Would grow the schema toward a "host + plugin" model before two simple adapters exist |
| DuckStation / PCSX2 | A second standalone app | Both need user-supplied BIOS, and that capability is still `planned` |
| melonDS / mGBA | Small, standalone | Weaker test: config isolation is more like Dolphin's, so it proves less |

PPSSPP is the strongest test of generalization because its config isolation works **differently** from Dolphin's. If the framework can express it without special cases, the adapter boundary is right.

## 2. Verified release facts

- **Latest stable: 1.20.4.** GitHub `releases/latest` returns tag `v1.20.4`, published 2026-05-16T12:35:08Z, not a prerelease. Earlier releases: v1.20.3 (2026-03-15), v1.20.2, v1.20.1, v1.20. Sources: `https://api.github.com/repos/hrydgard/ppsspp/releases/latest` (queried 2026-10-04) and https://www.ppsspp.org/download/ ("What's new in 1.20.4").
- **Official macOS artifact (free build):** `https://www.ppsspp.org/files/1_20_4/PPSSPP_macOS.dmg`. It is a DMG. A HEAD request returned 200, `content-length: 37090805` and `last-modified: Sat, 16 May 2026 12:52:09 GMT` from Cloudflare. Source: the download page links above.
  - The URL pattern `https://www.ppsspp.org/files/<M_m[_p]>/PPSSPP_macOS.dmg` holds for every version listed back to 1.14.4 (for example `1_20`, `1_19_3`). Note `1_20`, not `1_20_0`.
  - The paid Gold DMG is at `/api/goldfiles/…/PPSSPPGold_macOS.dmg` and needs authentication. It is out of scope.
- **The GitHub release has no DMG.** It only carries `PPSSPPSDL-macOS-v1.20.4.zip` (37389023 bytes, API digest `sha256:fb32a215…2665`). CI builds it with `./b.sh … --fat` and zips `PPSSPPSDL.app` (T/.github/workflows/build.yml lines 239, 344-351, 388-391; T/b.sh line 22 `--fat` → `arm64;x86_64`). The workflow has **no codesign or notarization step**. Treat that zip as an unsigned CI artifact and **do not install it**.
- **Machine-readable discovery:** use the GitHub releases API for the version tag (`tag_name` matching `^v\d+\.\d+(\.\d+)?$`, `prerelease:false`, `draft:false`). Build the ppsspp.org DMG URL from that tag. ppsspp.org itself has no JSON release endpoint we could find (**UNVERIFIED** absence).
  - Risk: the two sources can disagree for a short window after a release. If the DMG returns 404, fail closed.
- **Checksums:** ppsspp.org publishes **none** for the DMG (download page inspected). GitHub asset `digest` fields cover only the GitHub assets, not the DMG. As with Dolphin, record SHA-256 as an audit fingerprint only. Authenticity comes from the code signature and Gatekeeper.

## 3. Bundle identity and signing

| Fact | Value | Evidence |
|---|---|---|
| Bundle identifier | `org.ppsspp.ppsspp` (Gold: `org.ppsspp.ppssppgold`) | T/macOS/Info.plist; T/CMakeLists.txt lines 3029, 3034 |
| `CFBundleExecutable` | `PPSSPPSDL` → `Contents/MacOS/PPSSPPSDL` | T/macOS/Info.plist; T/CMakeLists.txt line 1505 (`TargetBin PPSSPPSDL`) |
| `.app` name inside the DMG | **UNVERIFIED.** Likely `PPSSPP.app` (CFBundleName `PPSSPP`); CI produces `PPSSPPSDL.app` | Inspect the DMG |
| Architecture | **UNVERIFIED.** The download page does not say "Universal". The CI build is fat (arm64+x86_64) | Run `lipo -archs` on the real binary |
| Minimum macOS | **UNVERIFIED.** CMake sets deployment target 10.13 for non-iOS Apple builds (T/CMakeLists.txt line 497). Read `LSMinimumSystemVersion` from the DMG | — |
| Hardened runtime / notarization | The source intends notarization: T/macOS/README.md says hardened runtime is enabled "to make notarization happy". Entitlements are `cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `cs.disable-executable-page-protection`. **No app-sandbox entitlement** (T/macOS/Entitlements.plist) | — |
| Developer ID Team | **UNVERIFIED, non-official lead only.** A third-party site (desktopinsights.com/apps/ppsspp) reports "Developer ID Application: Millionth Line AB (97NS59EENG)". Not acceptable as policy input | Must verify |

How to verify, using the same helper as Dolphin with the values parametrized:

1. Run `codesign -dv --verbose=4 <app>`. Read `TeamIdentifier` and `Authority=Developer ID Application: …`.
2. Run `codesign --verify --deep --strict <app>`.
3. Run `codesign --verify --strict -R '=anchor apple generic and identifier "org.ppsspp.ppsspp" and certificate leaf[subject.OU] = "<TEAM>"' <app>`.
4. Run `spctl --assess --type execute --verbose=2 <app>`. It must report `source=Notarized Developer ID`.
5. Optionally run `xcrun stapler validate <app>` for the stapled ticket.

Pin the Team ID only after a human has reviewed that output.

## 4. Config and save isolation (critical; differs from Dolphin)

PPSSPP has **no `--user`/`--memstick`/`--config` flag**. The flags it accepts are listed in T/SDL/SDLMain.cpp lines 1385-1411 and T/UI/NativeApp.cpp lines 532-655. On macOS the data root is resolved like this:

1. SDL `main` sets the user path from **`getenv("HOME")`**, falling back to `getpwuid` (T/SDL/SDLMain.cpp lines 1630-1637). `SYSPROP_USER_DOCUMENTS_DIR` also returns `getenv("HOME")` (lines 625-629).
2. `NativeInit` sets `defaultCurrentDirectory = SYSPROP_USER_DOCUMENTS_DIR` on MAC (T/UI/NativeApp.cpp lines 382-383). It then sets `memStickDirectory = DarwinFileSystemServices::appropriateMemoryStickDirectoryToUse()` (lines 467-469).
3. That function first checks **NSUserDefaults key `UserPreferredMemoryStickDirectoryPath`** (T/Core/Util/DarwinFileSystemServices.h line 16). Otherwise it uses `defaultCurrentDirectory / ".config/ppsspp"` (T/Core/Util/DarwinFileSystemServices.mm lines 309-325). This matches https://www.ppsspp.org/docs/reference/mac/ ("stored in .config/ppsspp under your home directory").
4. `memstick_dir.txt` and the Windows `installed.txt` portable mode apply only to Android/UWP/Windows, not to Mac (T/UI/NativeApp.cpp lines 416, 443 are inside `#if ANDROID` / `UWP`).

**Recommended mechanism:** launch with a child environment of `HOME=<library>/emulators/ppsspp`. The memstick then becomes `<library>/emulators/ppsspp/.config/ppsspp`. There are no extra arguments and no files are written into PPSSPP's bundle. The app is not sandboxed, so `HOME` is honoured by the code paths cited above.

Required guards:

- **NSUserDefaults leak.** If the user ever picked a custom memstick in a global PPSSPP with the same bundle ID, that preference wins over `HOME`. Before every launch, run a read-only preflight: `/usr/bin/defaults read org.ppsspp.ppsspp UserPreferredMemoryStickDirectoryPath`. If the key exists and differs from our path, refuse the launch with a clear message. Never delete the user's key.
  - **UNVERIFIED:** whether CFPreferences resolves `~/Library/Preferences` through `$HOME`. Assume it uses the real home, so the key is shared with any global PPSSPP install.
  - Changing the memstick in our managed instance's UI would therefore write a *global* preference. Document this and detect it after exit.
- The NSArgumentDomain trick (`-UserPreferredMemoryStickDirectoryPath <path>`) is **not usable**. PPSSPP's argv parser treats the value as a second boot file and calls `exit(1)` with "Can only boot one file" (T/UI/NativeApp.cpp lines 532-541, 647-655).
- `HOME` also changes the in-app file browser's default directory and any other `$HOME`-relative lookups. Do not pass `HOME` through from renderer input. The executor builds it from the validated library root.

**Layout** under memstick `M` (T/Core/Util/PathUtil.cpp lines 45-75; `PSP` is appended unless `M` is already named PSP):

| Purpose | Path |
|---|---|
| configuration | `M/PSP/SYSTEM/ppsspp.ini`, `M/PSP/SYSTEM/controls.ini` (INI). Filenames from T/Core/Config.cpp lines 1245-1249; the VR variants `ppssppvr.ini` and `controlsvr.ini` are not relevant on Mac |
| save data | `M/PSP/SAVEDATA` |
| save states | `M/PSP/PPSSPP_STATE` |
| also preserved | cheats, textures, screenshots and per-game configs in `PSP/SYSTEM` (https://www.ppsspp.org/docs/reference/custom-game-configs/, filename pattern **UNVERIFIED**) |

Reset may touch **only** the two INI files, never `PSP/SYSTEM/` as a whole. `--appendconfig=FILE` (T/UI/NativeApp.cpp lines 595-596) could layer EmuDeck defaults without rewriting the user INI. Whether appended values persist after a save is **UNVERIFIED**.

## 5. Launch, ROMs, BIOS, controllers, limitations

- **Launch plan:**
  - executable: `<bundle>/Contents/MacOS/PPSSPPSDL`
  - args: `['--fullscreen', '--pause-menu-exit', <rom>]`
  - env: `{ HOME }`
  - cwd: the bundle
  - `--escape-exit` (Esc quits immediately) is an optional keyboard alternative.
  - Flags documented at https://www.ppsspp.org/docs/reference/command-line/; parsing in T/UI/NativeApp.cpp lines 574-586.
  - Options match by `strncmp` prefix, and a missing boot file makes the process `exit(1)` on Mac (lines 630-640). The executor should check the ROM exists first so the failure is understandable.
- **ROM suffixes for the manifest:** `.iso .cso .chd .pbp` (T/Core/Loaders.cpp lines 110, 264). `.elf .prx` are homebrew executables (line 227-228); include them so the legal homebrew test fixture boots. Exclude `.zip/.7z/.rar`: PPSSPP treats those as install archives, not boot targets (lines 269-277).
- **BIOS:** none. PPSSPP is HLE (T/README.md line 14). Firmware fonts (flash0) are bundled in the app's assets (T/SDL/SDLMain.cpp lines 1642-1646).
- **Controllers:** SDL2 GameController with `gamecontrollerdb.txt` mappings (T/SDL/SDLJoystick.cpp lines 27-35). `GCSupportsGameMode` is true (Info.plist). DualSense haptics, motion and Bluetooth behaviour on macOS are **UNVERIFIED**; measure on hardware.
- **Known macOS limitations (changelog):**
  - Vulkan via MoltenVK is blacklisted on older Intel Macs (#20236).
  - Fixed: Mac audio device selection (#20482), stuck hidden mouse (#20612), TextEdit crash (#21601).
  - Source: T/README.md lines 191-279, 538.
- **License:** GPL-2.0-or-later. Source headers say "version 2.0 or later versions" (T/Core/System.cpp lines 1-5); LICENSE.TXT carries the GPLv2 text plus bundled third-party notices (PSPSDK BSD and others). Redistribution obligations apply if we ever mirror the binary. We will not mirror it.

## 6. Dolphin-specific code that must become shared or a hook

| Location | Dolphin coupling | Change |
|---|---|---|
| `src/main/components/types.ts:54-58` `LaunchPlan` | No environment | Add `env: Readonly<Record<string,string>>`. The executor allowlists keys (`HOME` only, for now) and starts from a minimal environment rather than `process.env` |
| `types.ts:40-46` `ComponentPaths` | Implies config is a directory | Add `configFiles: readonly string[]` (Dolphin: `Config/*.ini` it owns; PPSSPP: the two INIs) so reset targets files |
| `types.ts:27-32` `TrustPolicy` | No signing identity | Add `bundleIdentifier`, `teamIdentifier`, `artifactHost`. Today these are hardcoded in `install.ts:54-55,111` |
| `dolphin/index.ts:57-69` | Bundle-basename, ROM containment and extension checks inline | Extract a shared `validateLaunchInputs(manifest, paths, request)` |
| `dolphin/download.ts:6, 13-32, 34-61` | `RELEASE_API`, `artifactURL` regex, `selectRelease` | These stay in the adapter behind a `ReleaseSource { discover(transport), isTrustedArtifact(url, version), maxBytes }` hook |
| `dolphin/download.ts:63-141` (`Transport`, `transport`, `consume`) | Trust is decided by `RELEASE_API`/`artifactURL` at lines 106 and 116 | Move to `src/main/components/shared/fetch.ts`, taking `isTrusted(url)` and limits as parameters. The user agent at line 82 is already generic |
| `dolphin/download.ts:166-203` `downloadArtifact` | `artifactURL` check (171), 512 MiB limit, `DolphinRelease` type | Make it generic over `ComponentRelease { version; revision?; artifactURL }` |
| `dolphin/install.ts:9-32` `runProcess`; `123-164` `validateMount`, `checkBundleLinks`; `275-347` `mountedImages`, `detachStage` | Already generic | Move unchanged to `shared/dmg.ts` |
| `install.ts:35-121` `verifyBundle` | Bundle ID and executable (54-55), `MacOS/Dolphin` path (97), requirement string (111), version keys (58-66), messages | Parametrize with `BundleIdentity { bundleIdentifier, executable, teamIdentifier }` plus an adapter `versionMatches(info, release)` hook. Dolphin's `CFBundleLongVersionString` revision check stays Dolphin-only; PPSSPP's plist version format is **UNVERIFIED** |
| `install.ts:176-268` journal | `.dolphin-install.json`, format string, `.dolphin-stage-` regex, `^\d{4}[a-z]?$` version (244), 40-hex revision (246) | Key everything by `manifest.id`. Version validation comes from an adapter regex; revision becomes optional |
| `install.ts:349-401, 404-518` recovery and `installDolphin` | `'Dolphin.app'` (366, 388, 465, 468, 483), stage prefix (375, 437), version regexes (412, 415) | Rename to `installFromDmg(adapter, release, root)`, using `manifest.bundleName`. `installDolphin` becomes a thin wrapper so existing tests still pass |
| `src/main/components/es-de/catalog.ts:178-226` | Hardcoded `gc`, `.ewgame` and `label="Dolphin"` | Later: build `<system>` from `manifest.systems` and `manifest.name` |
| `__tests__/components.test.ts:19-21` | Asserts exactly one component | Update when PPSSPP is registered at `index.ts:5` |

The manifest schema (`schema.ts:48-138`) needs **no change**:
- `PPSSPPSDL.app` or `PPSSPP.app` passes the bundle regex at line 88.
- `Contents/MacOS/PPSSPPSDL` passes the executable checks.
- `psp` passes the system ID regex.
- The suffixes pass the regex at line 131.

Keep capability literals unchanged until real implementations exist.

## 7. Minimal interface proposal

```ts
interface LaunchPlan { executable: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }
interface ComponentPaths { roms; user; configuration; saves; states; configFiles: readonly string[] }
interface ComponentRelease { version: string; revision?: string; artifactURL: string }
interface ReleaseSource { discover(t: Transport): Promise<ComponentRelease>; isTrustedArtifact(url: string, version?: string): boolean; maxBytes: number }
interface BundleIdentity { bundleIdentifier: string; executable: string; teamIdentifier: string }
interface ComponentAdapter { manifest; paths; planLaunch; release?: ReleaseSource; bundle?: BundleIdentity; preflight?(paths): PreflightCheck[] }
```

`preflight` returns declarative read-only checks. For PPSSPP that is the `defaults read` check for `UserPreferredMemoryStickDirectoryPath`. The main-process runner executes these checks; adapters never spawn processes themselves.

## 8. Open items before implementation

1. Inspect the official 1.20.4 DMG: `.app` name, `lipo` architectures, `LSMinimumSystemVersion`, version-key format, Team ID and notarization.
2. Confirm on real hardware that `HOME` redirection leaves `~/.config/ppsspp` untouched. Also check what gets written to `~/Library/Preferences/org.ppsspp.ppsspp.plist`.
3. Pick a legally redistributable PSP homebrew fixture (`.pbp`/`.elf`) and record its license and hash.
