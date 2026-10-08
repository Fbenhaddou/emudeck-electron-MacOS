# ES-DE 3.5.0 Apple Silicon artifact verification

Inspected on 2026-10-02 on an ARM64 Mac running macOS 27.0 (26A428). This is read-only artifact and publisher verification, not application launch, integration, controller testing, or redistribution clearance. No ES-DE executable/helper was run. No security protection or quarantine attribute was removed.

## Exact download and provenance

The [official ES-DE website](https://www.es-de.org/) linked the Apple macOS release directly to [GitLab package file 357717468](https://gitlab.com/es-de/emulationstation-de/-/package_files/357717468/download). The website identified release 3.5.0, dated 2026-09-30. The inspected bytes were retrieved at 2026-10-01 21:35:42 UTC (2026-10-02 00:35:42 Asia/Riyadh).

| Field | Observed value |
| --- | --- |
| Filename from Content-Disposition | `ES-DE_3.5.0-arm64.dmg` |
| HTTP result | `200`, `application/x-apple-diskimage` |
| Redirects observed | **0**; no CDN or alternate origin was contacted |
| Bytes | `79,383,926` |
| SHA-256 | `060bd289fa17f8f07bac2eb688698047f7be79b80495983f08580b5f1a046e1e` |
| Transport verification | HTTPS certificate/hostname verification with the macOS `/etc/ssl/cert.pem` trust bundle |
| Bounds | 512 MiB, three redirects maximum, 30-second request timeout, 180-second download deadline |

Automatic redirect following was disabled. Each potential redirect required HTTPS, no credentials/port/query/fragment, and the same exact GitLab artifact path; anything else would have stopped the download. The SHA-256 above identifies observed bytes. No independently published checksum was verified, so this fingerprint alone does not authenticate the publisher.

The Python installation's default certificate lookup initially failed; using the macOS trusted CA bundle fixed it while retaining verification. No TLS verification bypass was used.

## Read-only image and actual bundle

The image was attached with `hdiutil attach -readonly -nobrowse -noautoopen -mountpoint <owned temporary mount> -plist`. The DMG displayed the MIT license and required explicit acceptance before mounting; an initial attempt with closed standard input canceled without a mount. The subsequent mount used `Y` only after inspecting that displayed license. The single mounted HFS volume matched the exact owned mount point. The root contained `ES-DE.app` and a conventional `/Applications` link; that link was never followed for installation.

Actual `Contents/Info.plist` values:

| Field | Observed value |
| --- | --- |
| Bundle/display name | `ES-DE` |
| Executable | `Contents/MacOS/ES-DE` |
| CFBundleIdentifier | **`3.5.0`** |
| CFBundleVersion / CFBundleShortVersionString | `3.5.0` / `3.5.0` |
| LSMinimumSystemVersion | `11.0.0` |
| Main executable architecture | `arm64` only |
| High resolution | `NSHighResolutionCapable=true` |
| Application category | `public.app-category.education` |

The identifier is a release version, not a stable reverse-DNS identifier. A future adapter must validate the reviewed release's actual identity rather than fabricate one or permit arbitrary identities under the same team.

## Publisher, sealed code, and Gatekeeper

Normal macOS trust-service access produced these results:

- `codesign -dv --verbose=4`: **Developer ID Application: Northwestern Software AB (`K56UAA4SXL`)**, chained through Developer ID Certification Authority and Apple Root CA. The reported signing date was 2026-09-25. Hardened runtime was present (`flags=0x10000(runtime)`).
- `codesign --verify --deep --strict --verbose=2`: exit **0**, bundle valid on disk and satisfying its designated requirement; nested helper and dylibs were validated.
- `codesign --verify --strict -R '=anchor apple generic and identifier "3.5.0" and certificate leaf[subject.OU] = "K56UAA4SXL"'`: exit **0**.
- `spctl --assess --type execute --verbose=2`: exit **0**, accepted with `source=Notarized Developer ID`.
- Main executable CDHash: `14b78a4948bc601bd318cc318b09ea9eff28a96f`.

The recorded designated requirement includes identifier `3.5.0`, the Apple generic anchor, Developer ID certificate extension requirements, and leaf organizational unit `K56UAA4SXL`. The observed team now comes from this exact official artifact, not only a historical crash report.

An initial restricted-shell `codesign` attempt reported unavailable authorities and an invalid signature. Repeating the read-only checks with normal trust-service access succeeded. Treat that first result as an inspection-environment failure, not evidence that this official artifact was modified.

`xattr -l` showed no `com.apple.quarantine` attribute on the CLI-downloaded DMG or mounted bundle. No attribute was stripped or changed by this task. Explicit Gatekeeper assessment was performed regardless. This does not establish the behavior of a future in-app downloader or a Finder first-launch flow.

## Native dependencies

All **24** packaged Mach-O files were inspected without executing them: main ES-DE, `es-pdf-convert`, and **22 dylibs**. Every file contained only ARM64. Packaged libraries included SDL2, FFmpeg's six libav/sw libraries, libgit2, FreeType, HarfBuzz, ICU, gettext/libintl, Poppler, fontconfig, dav1d, JPEG/OpenJPEG, TIFF, and zstd.

Direct absolute link dependencies were confined to macOS system libraries/frameworks. Every `@rpath` dependency name resolved to a packaged file under `Contents/MacOS`; the main executable and PDF helper supplied `@executable_path` as their run path. Main ES-DE links the system OpenGL framework. This inspection does not establish Metal rendering, runtime compatibility, performance, or game/controller behavior.

Three packaged libraries still contain publisher-machine absolute run paths: `libpoppler-cpp.3.dylib` refers to a publisher-home `release_build/emulationstation-de/external/poppler/build` directory; `libpoppler.161.dylib` and `libtiff.6.dylib` refer to a publisher-home `external/local_install/lib` directory. These are additional `LC_RPATH` entries, not missing direct dependencies. They deserve upstream packaging review before treating the bundle as a fully cleaned relocatable dependency closure. This task did not edit signed binaries or claim an exploitable loader bypass.

## Packaged license evidence

The actual bundle contains four named license files. Their scopes differ:

| Bundle path under Contents/Resources | Observed notice | SHA-256 |
| --- | --- | --- |
| `LICENSE` | MIT; Northwestern Software AB, Leon Styhre, Alec Lofquist copyrights | `656c65b8ac04f57afe92b38f21a2f0a514956e1d6ce63563f9d3e2b3b019accc` |
| `themes/linear-es-de/LICENSE` | MIT | `549a3eac9e72be3b022d81a792b046c2211450f9603fa7303948902f1ece60cf` |
| `themes/modern-es-de/LICENSE` | Attribution, NonCommercial, ShareAlike; version wording conflicts | `a0a6fbb9706f5d8de49aae78e5edd1e14fab2ac7c36b5f6bebe0c4bf1433d034` |
| `themes/slate-es-de/LICENSE` | Same notice and bytes as Modern | `a0a6fbb9706f5d8de49aae78e5edd1e14fab2ac7c36b5f6bebe0c4bf1433d034` |

The [core source license](https://gitlab.com/es-de/emulationstation-de/-/raw/master/LICENSE) corroborates the bundled MIT notice. The official [Modern theme license](https://gitlab.com/es-de/themes/modern-es-de/-/raw/master/LICENSE) and [Slate theme license](https://gitlab.com/es-de/themes/slate-es-de/-/raw/master/LICENSE) corroborate their separate restrictions: their summary prohibits commercial distribution, the heading names CC-BY-NC-SA 2.0, and the following full-license text names 4.0. Resolve this wording with upstream rather than choosing a version by assumption. Both notices also acknowledge separately owned logos/trademarks.

The core MIT notice does **not** clear the full signed bundle. No comprehensive separate dependency-license directory or source offer was found among named license/notice files. Embedded notices, dependency build options, font/artwork provenance, corresponding-source obligations, and release-specific third-party terms still need review. For example, [FFmpeg's official licensing guidance](https://ffmpeg.org/legal.html) makes its resulting obligations depend on build configuration. Do not infer the exact bundled FFmpeg/Poppler licensing configuration solely from dylib names or the core project's MIT designation.

Preserve the signed upstream bundle and its notices for private artifact testing. Do not strip unwanted themes from that signed bundle as a shortcut: modification would require new verification and a deliberately maintained distribution. Public redistribution and commercial bundling remain separate unfinished decisions.

## Cleanup and evidence retained

Before detachment, `hdiutil info -plist` identified the exact downloaded image and its single owned mount point. Only that mount was detached; afterward the exact image was absent from the inventory. Other mounted images were untouched. No application was installed into Applications or the user's library.

Temporary evidence remains in `/private/tmp/emulation-esde-verification.ADoNLU`: original DMG, download/attach/trust/detach JSON or text, bundle metadata, all-Mach-O dependency evidence, and copies/hashes of the four license notices. These temporary files are inspection evidence, not repository dependencies or product assets.

The artifact's official source, ARM64 slices, reviewed publisher, sealed code, and Gatekeeper acceptance are verified. Console Mode remains planned until the controlled-catalog shell boundary, real homebrew launch/exit/focus/save behavior, and physical controller flow described in [ES-DE integration research](es-de-integration.md) are implemented and exercised.
