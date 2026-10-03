# Homebrew fixture provenance — 2026-10-02

These are developer runtime fixtures retained outside the repository. No fixture binary, source archive, or third-party notice is bundled into the application. The research agent downloaded and inspected files; native emulator experiments were performed separately by the main task. Process survival, a successful installation, and a synthetic save-preservation check do not establish rendered frames, controller input, or in-game saving.

## GCMM 1.5.2

Official sources are the author's [release](https://github.com/suloku/gcmm/releases/tag/1.5.2), [ZIP](https://github.com/suloku/gcmm/releases/download/1.5.2/gcmm_1.5.2.zip), [tagged README](https://github.com/suloku/gcmm/blob/1.5.2/readme.txt), [tagged COPYING](https://github.com/suloku/gcmm/blob/1.5.2/COPYING), and [tagged entry point](https://github.com/suloku/gcmm/blob/1.5.2/source/main.c). The release was published on 2021-11-20. The exact tag tree is `95c737c2af0ebecfa2ef02a8c6c30496d0036e87`.

The ZIP contains the GameCube DOL and full source, including `gcmm_1.5.2/src/COPYING` with GPL version 3. Only the exact DOL and COPYING members were extracted using bounded `zipfile.read` calls; duplicate names, symlinks, encrypted members and oversized files were rejected. The full source-containing ZIP remains adjacent.

| Retained file in `/private/tmp/emulation-homebrew-3gvt59tt` | Bytes | Observed SHA-256 |
| --- | ---: | --- |
| `GCMM-1.5.2.zip` | 4,637,030 | `840dbfea6d4fbd5f266dcda92e69088d78fb95987685a2d65285d07b66986f5f` |
| `gcmm_GC.dol` | 3,800,640 | `1da85a35f494c8a491a16267be1c43097ad85e5fb5d2c9624a9f7504e8815b98` |
| `COPYING` | 35,821 | `0b383d5a63da644f628d99c33976ea6487ed89aaa59f0b3257992deac1171e6b` |

GCMM is a memory-card manager. Its README describes SD Gecko, SD2SP2 and GCLoader devices; it does not promise that the application boots correctly in Dolphin. References to Dolphin's memory-card manager and compatible RAW images are different claims. The native test produced a **black render window** titled with Dolphin 2609/JIT ARM64/Metal/HLE. Normal native quit and preservation of synthetic save files passed, but rendering, input and a GCMM-created card record remain unverified.

The exact archive's `src/source/main.c` initializes video and clears both framebuffers to black at lines 622–623. `main` calls `Initialise`, `FT_Init` and `detect_devices` at lines 1145–1152; device probing occurs before the first normal `ClearScreen`/`ShowScreen` at lines 1248–1249. The probes cover SD Gecko A/B, SD2SP2 and GCLoader. Missing storage should eventually reach the visible `NOFAT_MSG` prompt at lines 331–334. A probe stall or video initialization issue is a hypothesis, not a demonstrated cause of the black output. Never exercise GCMM format/restore against real user saves; any future card-write test needs disposable isolated media.

## 240p Test Suite for GameCube 1.20

The author's [official download page](https://artemiourbina.itch.io/240p-test-suite), linked by the [official source repository](https://github.com/ArtemioUrbina/240pTestSuite), offers a free download. The [1.20 release announcement](https://artemiourbina.itch.io/240p-test-suite/devlog/1478648/new-versions-of-the-240p-test-suite-for-wii-gc-snes-genesis-and-sega-cd) identifies the GameCube release dated 2026-04-03. The author-generated download page labels upload **17035732** as “240p Test Suite for GameCube 1.20”, uploaded **2026-04-03 04:22 UTC**. The public “No thanks, just take me to the downloads” flow was used without payment or login; the resulting HTTPS CDN URL is temporary, not a permanent release link.

The exact ZIP has three members: `GameCube-240pSuite-1.20.dol`, `GameCube-240pSuite-1.20.iso`, and `README.TXT`. Only the DOL and README were extracted with exact-member, duplicate, type and size checks. The ISO remains unextracted in the original ZIP.

The release README grants **GPL version 2 or any later version**, credits Artemio Urbina for code and Asher for main-menu graphics, and points to the official documentation/source. The author's current download page lists code GPLv3 and assets CC BY 4.0; GPLv3 is compatible with the README's “or later” grant. Keep these distinct observations instead of assigning the current site badge to every historical asset or dependency. Local fixture use is authorized; full product redistribution/source-correspondence and third-party asset auditing have not been completed.

| Retained file in `/private/tmp/emulation-240p-qut555zg` | Bytes | Observed SHA-256 |
| --- | ---: | --- |
| `240p-Test-Suite-GameCube-1.20.zip` | 2,600,770 | `c263a18be2250bebb839e9ca1fcd3e457c0fdd7144968f1f485c8d090d90eb38` |
| `GameCube-240pSuite-1.20.dol` | 1,723,724 | `ff44d090fde3239b624abac78ac17d29a9f1ac6b113474091fc4024b623205d3` |
| `README.TXT` | 5,388 | `c07c7c77315e5fe57ec2967afe9200901c23cbf814eedfbdca2c23fe10945b85` |
| `240pTestSuite-source-57adc5b0360ec55ed23b3bee0013e6369d6a324a.zip` | 68,617,072 | `ef8c7af33668320911af7370084944802f3fbffefb94e1d3045e0d9238df610e` |
| `SOURCE-LICENSE` | 17,698 | `8bd5e7a6f2bb7c2b0dc879a4e732f396d8a7de0164d1e1b2df26a14dfd8a2052` |

No Git tags were returned by the official repository API. The retained [source commit](https://github.com/ArtemioUrbina/240pTestSuite/commit/57adc5b0360ec55ed23b3bee0013e6369d6a324a), dated 2026-04-03 03:08:09 UTC, is the last change to the shared Wii/GameCube source before the upload timestamp. Its source headers grant GPL-2.0-or-later. The upstream `.gitattributes` exports text with CRLF; selected archive files match their official Git blob identities after CRLF normalization. The source archive is retained whole, with only its exact root LICENSE extracted as a notice. This is pinned release-date source evidence, **not a reproducible build proof**: upstream `release/meta.xml` still says 1.19, and no publisher build attestation ties the DOL to this commit.

The shared source initializes controllers, loads options, initializes VI/GX, and renders an intro/menu. It scans pad 0 and uses GameCube D-pad/A/B/Start. Options persistence uses `options.xml` on FAT storage; it is not a memory-card game save. Successful menu rendering/navigation would therefore establish graphics/input smoke coverage, not ordinary gameplay or in-game save persistence.

## Dolphin 2609 parser compatibility finding

The unmodified 240p DOL produced Dolphin's **“Failed to init core”** dialog. Its process later remained alive without a render window until isolated test cleanup. The file's unaligned section sizes explain a specific rejection in the official Dolphin revision `f84df02055ab9610feec48e65648cac5a3c098fa`:

- [DolReader.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/Boot/DolReader.cpp#L57): lines 61 and 95 round section read sizes up to 32 bytes; lines 70–71 and 105–106 reject reads beyond the file.
- The final data section starts at `0x78d40`, has size `0x12c00c`, and ends exactly at byte 1,723,724. Its rounded read requires **20 additional bytes**. Text size `0x78c24` also generates a warning but is followed by sufficient file data.
- [ConfigManager.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/ConfigManager.cpp#L382) rejects an invalid executable reader at lines 384–385; [MainWindow.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/DolphinQt/MainWindow.cpp#L1221) displays the observed dialog when `BootCore` returns false.

A separately named, developer-only diagnostic derivative appends exactly **20 zero bytes**. The original DOL and ZIP were re-read and preserved byte-for-byte; headers, section contents, addresses and entry point are unchanged.

| Test derivative | Bytes | Observed SHA-256 |
| --- | ---: | --- |
| `/private/tmp/emulation-240p-qut555zg/GameCube-240pSuite-1.20-dolphin2609-test-padding.dol` | 1,723,744 | `6b273803b960113565f0b0ff8f0109a9e58e17b1fae34a262957e8fc6f4cec70` |

Adjacent `TEST-DERIVATIVE-NOTICE.txt` records the date, original grant/credits, exact modification and both hashes. This experiment concerns upstream fixture/parser compatibility. It is not automatic ROM repair and never mutates a user's ROM.

The main task subsequently observed a real native screenshot of the derivative's **240p main menu**, including **NTSC 320×240p**, under **JIT ARM64/Metal/HLE**. Native Command-Q followed by the confirmation sheet closed it normally. This establishes visible rendering for this diagnostic application. Attempts with the default mapped keyboard buttons did not visibly change the menu, so keyboard input and physical-controller operation remain unverified. Gameplay, a game-created save and reopening that save remain unverified; synthetic preservation is separate evidence.

The retained `/private/var/folders/3j/q15p6r8x41x00k0n_vrxmd440000gn/T/emulation-dolphin-runtime-gtMslt/report.json` was subsequently read directly. It records **native exit code 0**, signal `null`, the original fixture ROM unchanged, synthetic save/state preservation, settings backup, reset refusal while running, running-game detection and library/version preservation on restart. The report keeps graphical output as requiring the separate native inspection described above. These are lifecycle and preservation results, separate from the screenshot and from an application-created save.

## Diagnostic flags for the exact Dolphin revision

The pinned [CLI parser](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/UICommon/CommandLineParse.cpp#L76) supports `-u`/`--user`, `-e`/`--exec`, and repeated `-C`/`--config` arguments in `System.Section.Key=Value` form. `-l` opens the logger UI. Pass each configuration as a separate argument through the existing `shell: false` launch path; use only an isolated diagnostic profile.

For an informative warning log, set `Logger.Options.WriteToFile=True`, `Logger.Options.WriteToConsole=True`, `Logger.Options.Verbosity=4`, and `Logger.Logs.BOOT=True`. Add `CORE`, `COMMON`, `Video`, `VI`, and `OSREPORT_HLE` channels when investigating runtime initialization. In [LogManager.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Common/Logging/LogManager.cpp#L26), file logging defaults false and channels default false, explaining why an unconfigured log can be empty. [Log.h](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Common/Logging/Log.h#L79) defines warning level 3 and info level 4; release builds clamp at info. Capture bounded stdout/stderr and the isolated profile's log instead of interpreting silence as success.

Exact pinned diagnostic stages:

- `DolReader.cpp` lines 64–67 and 99–102 warn about unaligned text/data section sizes. The subsequent out-of-bounds rejection returns false without an explicit error log. An alignment warning alone is not a failure marker: the padded derivative still has an unaligned text size.
- [Core.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/Core.cpp#L237) emits BOOT `Starting core = GameCube mode` and `CPU Thread separate = Yes/No`. [Boot.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/Boot/Boot.cpp#L546) emits BOOT `Booting from executable: <path>` before completing the memory load. These are startup-attempt evidence, not rendered-frame evidence.
- CORE `Active title: ...` at `ConfigManager.cpp` line 279 is metadata activation before boot. It is not a success marker. The “Failed to init core” modal is created directly by Qt and is not itself a BOOT/CORE log message.
- No definitive BOOT/CORE “successfully booted” message was found in this pinned DOL path. `Core.cpp` lines 639–640 return early if `BootUp` fails; only subsequently does line 674 enter the CPU thread. The CPU state transition/run loop has no matching BOOT/CORE success log. Enable `CONSOLE` to observe `Stop\t\t---- Shutdown complete ----` at line 521, but that cleanup guard also runs on failed initialization.

A developer harness should report process launch, static DOL compatibility, observed boot stages, rendered-frame verification, input verification, native exit and preservation as separate fields. Missing required diagnostic stages can fail a known-fixture smoke test, while their presence alone must never set rendered/gameplay success. A surviving GUI process or exit code 0 can occur after a boot error. Capture the actual modal/frame through native UI evidence; the normal unmodified 240p DOL should be a negative regression case for its precise padded-read requirement.

All hashes in this document are locally observed fingerprints. Neither release supplies a separately verified publisher digest. Trust evidence comes from the official author/release retrieval and exact notices, with the remaining provenance limits stated above.

## Rendered diagnostic fixture through ES-DE — 2026-10-03

The later developer experiment `/private/tmp/ew-console-uRv3gg/report.json` was read directly. One owned opaque marker was authenticated and mapped to the original library file ``ألعاب GameCube Library/roms/gc/اختبار `not-a-command` | & %ROM%.dol``. That file was independently read and hashed: 1,723,744 bytes, SHA-256 `6b273803b960113565f0b0ff8f0109a9e58e17b1fae34a262957e8fc6f4cec70`, exactly the separately named 20-byte diagnostic derivative documented above. The alias was not passed to Dolphin and the original library file was not renamed or repaired.

The parent task observed the actual 240p menu through native computer-use inspection, then normal Dolphin completion and the returned ES-DE list. The broker report records one launch, exit `0`/signal `null`, no launch failures, `originalROMPreserved=true`, and `ready=true`/`boundaryPassed=true`; the frontend also exited normally. The gamelist records one play and 80 seconds, displayed as one minute in the parent's returned-list observation. Parent checks also found the official Dolphin `yNpzP9` bundle's resource seal intact after both standalone and frontend exits. See [ES-DE launch boundary evidence](es-de-integration.md#successful-experimental-launch-boundary--2026-10-03) for exact helper/catalog details and the preceding failed discovery experiment.

This extends the derivative's visible-rendering smoke evidence to the controlled frontend launch path. It does not establish physical controller input, controller-only exit, automatic foreground focus, gameplay-created saves or ordinary gameplay. The original unmodified 240p DOL rejection and GCMM black-output result remain recorded above; neither is retroactively a successful rendering result. Binary/source archives and derivative notices remain outside the repository, and product fixture bundling is not enabled.

## Emulator-created Slot 1: reset and reopen evidence

The reports under `/private/var/folders/3j/q15p6r8x41x00k0n_vrxmd440000gn/T/emulation-dolphin-runtime-hy9iw5` were read directly. This experiment uses the same legal 240p diagnostic derivative and private Dolphin 2609 User directory; an emulator save state is a snapshot of emulation, not an application-created memory-card save.

| Evidence | Observed result and source |
| --- | --- |
| Initial native-menu test | `report.json` lists the emulator-created Slot 1 state and preservation checks, but its final exit is `code=null`, `signal=SIGTERM`, `exitMethod=SIGTERM-test-cleanup`. The parent attributes cleanup to a quota interruption; the first run does **not** establish normal native exit. |
| Reopen after first Config reset | `state-reopen-report.json` identifies the same private ROM/state after configuration reset. The parent task's native CUA inspection observed the **Loaded State** on-screen message. The report explicitly leaves the native load result to separate computer-use observation; automation alone does not establish it. |
| Later normal completion | The reopen report records `exit.code=0`, `exit.signal=null`, independently of the earlier SIGTERM cleanup. |
| Second Config reset | The reopen report records `unchangedAfterNormalExitAndSecondReset=true` and `settingsBackedUp=true`. The retained state was independently read and hashed after that report, matching both reports exactly. |

The retained file is `<private library>/emulators/dolphin/User/StateSaves/ID-240p 1.20 alignment test derivative.s01`: **3,859,858 bytes**, SHA-256 **`d945a41b19a92558f68a0eb0d2aa167292c19113a2c265447897734e2fbeea1a`**. The original test ROM fingerprint remains the documented padded-derivative identity `6b273803b960113565f0b0ff8f0109a9e58e17b1fae34a262957e8fc6f4cec70`; reopening used the same private ROM after the first configuration reset.

The source-supported native route is **Emulation → Save State → Save State to Slot → Slot 1**. The pinned [menu action](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/DolphinQt/MenuBar.cpp#L425) reaches [State::Save](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/State.cpp#L905). [State.cpp](https://github.com/dolphin-emu/dolphin/blob/f84df02055ab9610feec48e65648cac5a3c098fa/Source/Core/Core/State.cpp#L306) derives the slot filename from the actual homebrew GameID, and emits the saved-state message only after moving the written temporary file to its final name at lines 455–469. This research agent did not execute the native action or emulator.

Together, retained-file verification, separate native load observation, subsequent normal exit and a second configuration reset establish this **Dolphin-created state's preservation and reopening on the same private Mac/profile**. They do not establish gameplay-created memory-card saving, physical controller navigation or exit, automatic frontend focus, Mac reboot persistence, a clean user, external-volume remount, cross-version state compatibility or an ES-DE-triggered state-load flow. The initial interrupted exit and earlier fixture failures remain part of the evidence.
