# Input Source Popup Guard v2

GNOME Shell 46 extension that closes stuck keyboard-layout popups and releases
their input grab. Use your usual layout-switching shortcut.

- Activates a valid selection once and closes the popup immediately.
- Recovers hidden popups and popups left open after modifier release.
- Affects only the layout popup; other switchers and input grabs are unchanged.

![Guard diagnostics](docs/screenshots/diagnostics.png)

Read-only output from a disposable GNOME session. [Capture details](docs/visual-guide.md).

## Install and use

Requires GNOME Shell **46**, Make, and Node.js (20 is tested).
Disable any older input-source guard before enabling this version.

```sh
make check test
make install
gnome-extensions enable input-source-popup-guard-v2@sagecat.local
```

On Wayland, log out and back in if GNOME has not discovered the extension or still
runs an older version. For a workspace-state-managed install, use its next-login deployment.

To disable:

```sh
gnome-extensions disable input-source-popup-guard-v2@sagecat.local
```

## Diagnose

```sh
gdbus call --session --dest org.gnome.Shell \
  --object-path /org/sagecat/InputSourceGuard \
  --method org.sagecat.InputSourceGuard.GetState
```

For an optional `RunSelfTest`, replace `GetState` with `RunSelfTest`. It creates and
cleans up test popups without changing layouts; it refuses locked or modal sessions.

## Documentation

- [Diagnostics and screenshots](docs/visual-guide.md)
- [Design diagram](docs/architecture.svg) · [PlantUML source](docs/architecture.puml)
- [Releases](https://github.com/Sage-Cat/input-source-popup-guard/releases)
