# Visual guide

![Read-only diagnostics](screenshots/diagnostics.png)

Read-only diagnostics from GNOME Shell 46.0. This image uses the current extension's
actual `GetState` response in a disposable headless GNOME Shell with a private
session bus and configuration. The guard is idle: no layout popup is being held
open. The terminal-style image renders selected output fields, not a native
settings window; the guard has no settings panel.

The screenshot shows the observable baseline rather than manufacturing a frozen
keyboard. The watchdog and finish paths are covered by the Shell-independent
regression tests (`make check test`). Optional real-popup testing is described
under `RunSelfTest` in the [README](../README.md).

## Refresh diagnostics

With the extension enabled, the renderer makes a read-only D-Bus call and writes
`docs/screenshots/diagnostics.png`:

```sh
python3 docs/capture-cli.py
```

It requires Python 3 and an installed `google-chrome` or `chromium` executable;
only Python standard-library modules are used. To render an
already captured JSON response from a disposable session instead:

```sh
python3 docs/capture-cli.py --from-json /tmp/input-source-guard.json
```

`GetState` returns a D-Bus string containing JSON. In the intended session, capture
that JSON without invoking a popup or changing layouts:

```sh
gdbus call --session --dest org.gnome.Shell \
  --object-path /org/sagecat/InputSourceGuard \
  --method org.sagecat.InputSourceGuard.GetState |
python3 -c 'import ast,json,sys; print(json.dumps(json.loads(ast.literal_eval(sys.stdin.read())[0]), indent=2))' \
  > /tmp/input-source-guard.json
```

The renderer allowlists public health and build fields. Full diagnostic responses
can contain layout identities and previous recovery snapshots; keep raw captures
private and review the resulting image before publication. `development` means
an unstamped source revision, not a verified release identity.

## Architecture image

Edit `architecture.puml`, then regenerate the SVG without embedded source metadata:

```sh
plantuml -nometadata -tsvg docs/architecture.puml
```

Update the screenshots when visible diagnostic fields or behavior change.
