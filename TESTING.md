# Testing

Baseline commands and failures are recorded in MACOS_PORT.md. Production webpack uses transpileOnly and cannot substitute for typecheck.

Required first gate: strict scoped typecheck for new Mac/shared/component code; focused Jest tests for sender validation, path handling and state persistence; browser-renderer build; real development and packaged Electron smoke. Preserve baseline test results rather than hiding legacy failures with skipLibCheck or disabling assertions globally.

Smoke must launch Electron, load the renderer and its real preload, assert no Node/generic legacy bridge, confirm context isolation/sandbox, observe non-empty content and report renderer crashes/errors. Use a temporary isolated userData directory and capture screenshots. Both production output and packaged asar must be exercised.

Before distribution: real official artifact tests, corrupted download/archive tests, interrupted installs, save-preserving repair/reset/update/rollback, library reconnection, ES-DE launch and focus, homebrew save/restart, physical DualSense, keyboard/VoiceOver, light/dark/small window, clean user and reboot gauntlet. Never distribute proprietary ROMs, BIOS or keys as fixtures.

## Runnable Mac gates

`npm run typecheck:macos`, `npm run lint:macos`, `npm run test:macos`, `npm run build:macos`, `npm run smoke:macos`, `npm run package:macos`, then `npm run smoke:macos -- 'release/build-macos/mac-arm64/Emulation Workspace.app/Contents/MacOS/Emulation Workspace'`.

Development smoke: `PORT=4318 npm run smoke:macos -- --dev`. Run builds sequentially: Mac and legacy targets intentionally share generated dist. Scoped typecheck checks all new sources strictly while skipping incompatible third-party declaration checking; legacy full typecheck remains failing. Smoke reports and PNGs stay in fresh OS temporary directories and use isolated userData. They are not copies of the user's library.

macos-15 is an ARM64 hosted runner per [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners); workflow execution is not yet verified. Physical controller, VoiceOver, external-volume and signing tests cannot be inferred from CI.
