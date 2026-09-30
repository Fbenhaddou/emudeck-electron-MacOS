# Security model and release blockers

The untouched upstream bridge permits arbitrary shell commands. Other findings include renderer Node integration, unrestricted media paths, shell-based ROM launch, credentials written to logs, unvalidated settings, downloaded Bash execution and upstream update feeds. These are release blockers, not accepted patterns for the Mac port. Existing Linux/Windows implementations remain upstream code and are not newly certified secure.

The macOS build must use separate entries which never register the legacy handlers. Use contextIsolation, sandbox and nodeIntegration:false. IPC methods accept no command strings or renderer-supplied filesystem paths; validate sender, main frame, exact URL and argument count. Block navigation/popups/permissions. Select libraries with a native dialog. Do not globally disable Gatekeeper, strip quarantine, install Rosetta silently or use sudo.

Installer policy: trusted official upstream URLs; redirects checked against an explicit origin policy; bounded downloads; checksum/signature verification when upstream provides it; no downloaded scripts. Verify app identity and Mach-O architecture before activation. Archive extraction must reject absolute/traversal paths, symlink/hardlink escapes and resource-exhaustion inputs. Staging and atomic activation must be on the same volume with a recoverable journal. Saves and ROMs must never be in reset/removal sets. Updates require a separate fork-owned authenticated release strategy; no upstream EmuDeck auto-update in Mac builds.

Diagnostics must redact home identities, private paths, filenames and credentials. Unknown capabilities must remain unknown. Tests with fixtures are not evidence of real controller, Gatekeeper, signing or network-storage support.
