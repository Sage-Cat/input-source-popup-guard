# Input Source Popup Guard v2

GNOME Shell 46 only. Replaces `InputSourcePopup` finish/fade/show lifecycle,
leaving other switchers and modal grabs alone. Valid selections activate once;
all finish paths immediately destroy the popup even if activation throws.
Older input-source popups are reaped before a new popup grabs input, preserving
the manager's newer reference. Enable logs before/after state and reaps existing
input-source popups, then releases the input-source keyboard hold.

A 250 ms watchdog confirms modifier release for at least 500 ms before finishing;
zero-mask popups finish only after 2 seconds without navigation activity. Hidden, unmapped,
or fully transparent popups lasting over 1 second are destroyed. A visible popup
with a held modifier has no age limit. Native GNOME no-modifier completion still
applies. Failed enable unwinds acquired hooks and diagnostics in reverse order. Disable destroys tracked popups, removes watchdogs and connections, and
restores prototype methods.

Run `make check test`, then `make install` to copy only this extension. Installation
does not enable it. Disable the previous guard before enabling this version.
Normal Wayland extension discovery may require a later login; runtime loading
must be handled separately without restarting an active Shell.

Read-only diagnostics (no eval):

```sh
gdbus call --session --dest org.gnome.Shell \
  --object-path /org/sagecat/InputSourceGuard \
  --method org.sagecat.InputSourceGuard.GetState
```

The JSON response includes version, modal count and actor constructor names,
tracked popup state, current input source, recovery counters, and the latest
before/after recovery evidence. Diagnostics share GNOME Shell's existing bus
name; the interface is `org.sagecat.InputSourceGuard`.

`RunSelfTest` is the sole bounded diagnostic action. It refuses locked sessions,
existing modal actors, or existing input popups. It creates real input popups with
dummy items and checks valid/invalid finishes, stacking and immediate destruction,
without synthetic key events or layout changes. It always destroys its test
actors. Invoke it using the same command with method suffix `.RunSelfTest`.

Running diagnostics include `build: {uuid, version, revision, sourceIdentityKnown}`.
Release staging stamps `buildInfo.js`; the default `development` revision explicitly
means the exact running source identity is unknown. Installing does not reload an
already imported Shell module.

## Checks and releases

```sh
make check test
```

The [CI workflow](.github/workflows/ci.yml) verifies each change. Successful pushes
to the default branch publish a commit-addressed `build-<full-commit-SHA>` release
with a source archive, applicable extension bundles, and SHA-256 checksums.
See the [release process](https://github.com/Sage-Cat/workspace-state/blob/main/docs/publication.md) for artifact and verification details.

The local pre-commit privacy gate blocks private files before they enter a commit.
Enable it in a fresh clone with `git config core.hooksPath .githooks`.
CI repeats the privacy check before building or publishing.
