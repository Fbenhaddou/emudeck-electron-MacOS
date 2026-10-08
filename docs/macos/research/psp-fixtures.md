# PSP homebrew fixture candidates for PPSSPP 1.20.4 — 2026-10-07

Research only. Nothing was executed: the EBOOTs were downloaded, unzipped with exact-member checks, and parsed statically (PBP header and PARAM.SFO). No fixture is bundled into the repository. All hashes below are fingerprints observed locally. None of the authors publishes a digest. Trust rests on retrieval from the author's own GitHub release and on the license text in the tagged source. **No candidate has been booted in PPSSPP yet.** Rendering, input and saves are claims read from source code and must be confirmed natively, using the same separate-field reporting as the Dolphin fixtures in [homebrew-fixtures.md](homebrew-fixtures.md).

All files are retained in `/private/tmp/psp-fixtures-VsIA`. Shallow source clones used for reading are in `/private/tmp/psp-fixtures-src`.

## 1. YABT ("Yet Another Button Tester") v1.1 — recommended input fixture

- Official sources: [repo](https://github.com/krazynez/YABT), [v1.1 release](https://github.com/krazynez/YABT/releases/tag/v1.1) (published 2024-10-25), [ZIP](https://github.com/krazynez/YABT/releases/download/v1.1/YABT.zip). The tag commit is `68b4ad58836bc60d38d96460edb069d92f481267`. The author is Brennen Murphy (krazynez).
- License: **MIT** (SPDX `MIT`), in [`LICENSE` at the v1.1 tag](https://github.com/krazynez/YABT/blob/v1.1/LICENSE) ("Copyright (c) 2023 Brennen Murphy"). The ZIP itself contains no license file, so keep the LICENSE file next to it.
- The ZIP contains only `PSP/GAME/YABT/EBOOT.PBP`. PARAM.SFO: TITLE `YABT`, CATEGORY `MG`, DISC_ID `UCJS10041` (the PSPSDK default).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `YABT-v1.1.zip` | 646,806 | `5849af647405a612d4521367ba84d1feade6e221b8b161609df7dab4c4be0b11` |
| `YABT-v1.1-EBOOT.PBP` (extracted) | 653,378 | `d7c6b594cd87569b496bf059cf9ae9195e83d04bf722bc1e76a84a69b72f3756` |
| `YABT-LICENSE` (tag) | 1,071 | `d70b6d7285f53e3db5b991d5edaeab9b061ff0a29262ebede4683c8b5c7fa5bf` |

- What it exercises: `main.c` (182 lines) uses `pspDebugScreen` text rendering and `sceCtrlSetSamplingMode(PSP_CTRL_MODE_ANALOG)`. Every frame it prints `Axis X/Y` (Lx/Ly) plus the name of the last button pressed: Cross, Circle, Triangle, Square, L, R, D-pad, Select, Start, Note, Screen and Volume ±. It registers an exit callback that calls `sceKernelExitGame`, so PPSSPP's Home/exit path applies. **It creates no save.** This makes it close to the ideal controller tester: each mapped button changes on-screen text you can check.
- PPSSPP evidence (static only): `DATA.PSP` is **encrypted** (`~PSP`), signed for official firmware using Infinity's vendored `psptools/pack_ms_game.py` with tag `0x0C000000`. The PSP header at offset 0xD0 was read to confirm the tag. PPSSPP v1.20.4 has a decryption entry for this tag: [`Core/ELF/PrxDecrypter.cpp` line 308](https://github.com/hrydgard/ppsspp/blob/v1.20.4/Core/ELF/PrxDecrypter.cpp#L308) `{ 0x0C000000, g_keyDEMOS27X, 0x4F }`, looked up through `GetTagInfo` (lines 316–320, 718). No PPSSPP issue or compatibility report mentions YABT.
- Caveats:
  - The packed `SND0.AT3` (482 KB audio) and `PIC1` (`res/`) have no separate provenance statement. Only the repository-wide MIT grant covers them.
  - It is a small single-maintainer repository with 0 stars.
  - Because the binary is encrypted, a PPSSPP decryption regression would appear as a boot failure. Record decryption as its own diagnostic stage.

## 2. KleleAtoms-PSP v1.1 — recommended render/gameplay fixture (cleanest notices)

- Official sources: [repo](https://github.com/Nightwolf-47/KleleAtoms-PSP), [v1.1 release](https://github.com/Nightwolf-47/KleleAtoms-PSP/releases/tag/v1.1) (2025-12-23), [unsigned ZIP](https://github.com/Nightwolf-47/KleleAtoms-PSP/releases/download/v1.1/kleleatoms-psp-1.1.zip). The tag commit is `778526d027f296ca09700e3db1289f0b894b69d9`. There is also a `-signed` ZIP for official firmware, which was not used.
- License: **MIT** (SPDX `MIT`), in [`LICENSE` at the tag](https://github.com/Nightwolf-47/KleleAtoms-PSP/blob/v1.1/LICENSE) ("Copyright (c) 2025 Nightwolf-47"). The README's "License" section says the DejaVu font is under its own license (Bitstream Vera/DejaVu, `res/font/LICENSE`) and stb is Unlicense/MIT. Sound effects were made with SFXR by the author.
  - The ZIP ships `third-party-licenses/` for SDL2 and SDL2_image (zlib), libpng, IJG jpeg, zlib, newlib, pthread-embedded, pspgl, libpspvram, PSPSDK (BSD) and DejaVu. It does **not** include the game's own MIT LICENSE, so keep the tag copy.
- Fixture unit: the whole `kleleatoms/` directory. `EBOOT.PBP` needs the adjacent `resources.pak` (824,195 bytes). Do not copy the EBOOT alone.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `kleleatoms-psp-1.1.zip` | 1,496,191 | `a3a0f41a17e8ac958d5a8c6cfd576feddef4c0b867428ddff1e4cc9bef3a54ff` |
| `KleleAtoms-1.1-EBOOT.PBP` (extracted) | 2,355,948 | `a9fe0257eff544e1dc662d254494a555dbaf1302825af409b73e6df60ff4438b` |
| `KleleAtoms-LICENSE` (tag) | 1,069 | `72179cd989a1530fbf61b3b2711ed298d98941b4eecfeec7deb5fb76f0f8378c` |

- What it exercises: SDL2 GPU rendering (menu, grid and pause screens), a turn-based game against an AI, and `SDL_GameController` button input across menus and gameplay (`src/game/game.c` line 286, `menustate.c`, `gamestate.c`). It does not use the analog stick for anything meaningful. **No save:** the only `fopen` is a read of the resource pack. The `DATA.PSP` is an unencrypted ELF.
- PPSSPP evidence: none found. There are no issues in `hrydgard/ppsspp` or in the repo. It uses a standard PSPSDK and SDL2 stack.

## 3. Apollo Save Tool (PSP) v2.3.2 — save-creation fixture (use with care)

- Official sources: [repo](https://github.com/bucanero/apollo-psp), [v2.3.2 release](https://github.com/bucanero/apollo-psp/releases/tag/v2.3.2) (2026-05-12), [ZIP](https://github.com/bucanero/apollo-psp/releases/download/v2.3.2/apollo-psp.zip). The tag commit is `769c198b8c261d547fdd201a267a597918fbf036`. The author is Damian Parrino (bucanero).
- License: **GPL-3.0-or-later** (SPDX `GPL-3.0-or-later`). The README "License" section at the tag says "either version 3 of the License, or (at your option) any later version". The full text is in [`LICENSE`](https://github.com/bucanero/apollo-psp/blob/v2.3.2/LICENSE). The bundled Noto Sans JP font ships with `APOLLO/DATA/OFL.txt` (OFL-1.1). The README credits a background-music track to PiNk/abyss without stating its license. The ZIP has no GPL text, and `CACHE/appdata.zip` is a cheat/patch database for commercial games, which is data and not game content.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `apollo-psp-v2.3.2.zip` | 7,362,152 | `3ed0ccf9b5eb2d5b10af014630d6ff57070f63d5e8d6a725b3a5619da5e71d41` |
| `apollo-psp-2.3.2-EBOOT.PBP` (extracted) | 4,258,199 | `0b81704ec370b7c697977b4d345f8a4ad673d8aa71f1b37810d3aabf35342a61` |
| `apollo-psp-LICENSE` (tag) | 35,149 | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |

- What it exercises: SDL2 rendering, pad input and a **real `PSP/SAVEDATA` directory**. At the tag, `load_app_settings` falls back to `save_app_settings` on first run (`source/settings.c` lines 379–433). That writes `ms0:/PSP/SAVEDATA/NP0APOLLO-Settings/{ICON0.PNG,PARAM.SFO,SETTINGS.BIN}` with direct file I/O. It does **not** go through `sceUtilitySavedata`: that code path is commented out. On a later launch it reads `SETTINGS.BIN` back, which gives a "create, then reopen" save test with no gameplay required.
- Hazards:
  - Run it only on an isolated, disposable memstick. Apollo's purpose is to scan, patch, copy and delete other saves.
  - On first run it asks "Install the Save-game Key dumper plugin?" (`main.c` lines 525–529). Answer **No**. "Yes" writes a plugin and a CFW plugin list.
  - It calls `http_init()` at startup.
  - It creates `DATA/` and `CACHE/` relative to its own directory (`APOLLO_APP_PATH "./"`). Place the ZIP's `APOLLO/` folder at `PSP/GAME/APOLLO` inside the isolated memstick, never inside a user ROM folder.
- PPSSPP evidence: none found for booting. Issue #14 in the Apollo repo discusses PPSSPP only for loading saves.

## Considered and rejected

- **hrydgard/pspautotests:** `LICENSE.txt` says only "TO FILL WITH THE LEAST RESTRICTIVE COMPATIBLE LICENSE", and the GitHub API reports `NOASSERTION`. Not redistributable as evidence.
- **240p Test Suite:** `ArtemioUrbina/240pTestSuite/240psuite` has Dreamcast, Genesis, N64, NeoGeo, PCE, SNES, Saturn, Wii and X68000 ports. There is **no PSP port**.
- **PSPSDK samples** (`pspdev/pspsdk`, commit `6f15c154c902963864ea5c4538cc94febf8a2dad`, `LICENSE` is BSD-3-Clause, 1,529 bytes, SHA-256 `2a72b3d5…1c1c82`): these are ideal for coverage but have **no prebuilt binaries**. `src/samples/controller/basic/main.c` prints every button plus Lx/Ly/Rx/Ry. `src/samples/savedata/utility/main.c` drives real `sceUtilitySavedata` LISTSAVE/LISTLOAD dialogs for `DEMO11111` + `0000`. A future build with the pspdev toolchain would be the best fully controlled fixture, with source and binary corresponding exactly.
- **SuDokuL v1.5** (Mode8fx, MIT code): it has PSP and GameCube builds. However, its bundled MOD music (modarchive), its font and its OpenGameArt art have no stated redistribution terms. Its PSP `save.bin` is written relative to the current directory (`rootDir = ""`), which could land beside the ROM.
- **Trogdor-Reburninated:** it recreates third-party IP. Most other GitHub hits are 2026 repositories with no license, no releases, or little history.

## Recommendation

1. **Primary input + render smoke test: YABT v1.1.** It is MIT-licensed and shows visible text for every button and the left stick. Treat its encrypted EBOOT as a separate decryption/boot stage.
2. **Render/gameplay fallback with the cleanest notice set: KleleAtoms-PSP v1.1.**
3. **Save creation and reopen: Apollo v2.3.2**, only on a disposable isolated memstick, answering No to the plugin prompt.

Next step for the main task: boot each one natively in PPSSPP 1.20.4 under the isolated `HOME`. Record boot, decryption, rendered frame, input, save files (hash `SETTINGS.BIN`/`PARAM.SFO`), native exit and preservation as separate fields. Note that all three use the PSPSDK default DISC_ID `UCJS10041`, so per-game IDs and configs may collide. Confirm how PPSSPP disambiguates homebrew before relying on per-game settings.
