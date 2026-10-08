# Releasing the macOS app

Nothing here has been run with a real Developer ID yet. The release script's refusal paths and the hardened-runtime entitlements are tested; signing, notarization and stapling are not.

## One-time setup (owner)

1. Join the Apple Developer Program and create a **Developer ID Application** certificate (Apple Development certificates cannot be used for distribution outside the App Store).
2. Store notarization credentials in the keychain; the password is an app-specific password and never appears in the repository or shell history:

   ```bash
   xcrun notarytool store-credentials emulation-workspace --apple-id <apple-id> --team-id <TEAMID>
   ```

## Each release

```bash
EMULATION_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)" EMULATION_NOTARY_PROFILE=emulation-workspace npm run release:macos
```

The script refuses unless the tree is committed, the identity is a Developer ID present in the keychain, and a notary profile is named. It then:

1. builds the native helpers, the source notice and the webpack bundles (failing on any module outside the reviewed boundary);
2. stages everything in the system temporary folder, outside iCloud Drive;
3. signs the app with the hardened runtime (JIT entitlement only), notarizes it with `notarytool`, and staples it;
4. builds the DMG from that exact stapled app, signs, notarizes and staples the DMG;
5. verifies with `codesign --deep --strict`, `spctl` (must report *Notarized Developer ID*), `stapler validate`, and runs the packaged smoke against the signed app;
6. writes `release-manifest.json` with version, source revision, team and the DMG's SHA-256.

## Before announcing a release

- Clean-user and reboot gauntlet from TESTING.md on the downloaded DMG (quarantined, as users receive it).
- Bluetooth and camera prompts appear with the declared wording when ES-DE, Dolphin and PPSSPP start from the signed app.
- Publish the DMG SHA-256 next to the download and tag the source revision.
