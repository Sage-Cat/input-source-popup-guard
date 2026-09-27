import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import * as KeyboardManager from 'resource:///org/gnome/shell/misc/keyboardManager.js';
import {InputSourceGuard} from './guard.js';
import {BUILD_REVISION} from './buildInfo.js';

const XML = `<node><interface name="org.sagecat.InputSourceGuard">
<method name="GetState"><arg type="s" direction="out"/></method>
<method name="RunSelfTest"><arg type="s" direction="out"/></method>
</interface></node>`;

export default class InputSourcePopupGuardExtension extends Extension {
    enable() {
        try {
            this._enable();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _enable() {
        this._guard = new InputSourceGuard({
            Popup: Keyboard.InputSourcePopup,
            children: () => Main.uiGroup.get_children(),
            manager: () => Keyboard.getInputSourceManager(),
            releaseKeyboard: () => KeyboardManager.releaseKeyboard(),
            now: () => GLib.get_monotonic_time() / 1000,
            modifiers: () => global.get_pointer()[2],
            addTimer: (ms, callback) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms,
                () => callback() ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE),
            removeTimer: id => GLib.source_remove(id),
            log: message => console.log(`[InputSourceGuard v2] ${message}`),
            shellState: () => {
                const source = Keyboard.getInputSourceManager().currentSource;
                return {
                    modalCount: Main.modalCount,
                    sessionMode: Main.sessionMode.currentMode,
                    isLocked: Main.sessionMode.isLocked,
                    actionMode: Main.actionMode,
                    modalActors: Main.modalActorFocusStack.map(record => record.actor?.constructor?.name ?? 'unknown'),
                    currentLayout: source ? {id: source.id, type: source.type, displayName: source.displayName} : null,
                };
            },
        });
        this._guard.enable();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(XML, {
            GetState: () => JSON.stringify({...this._guard.getState(), build: {
                uuid: this.uuid, version: this.metadata.version, revision: BUILD_REVISION,
                sourceIdentityKnown: BUILD_REVISION !== 'development',
            }}),
            RunSelfTest: () => JSON.stringify(this._selfTest()),
        });
        this._dbus.export(Gio.DBus.session, '/org/sagecat/InputSourceGuard');
    }

    _selfTest() {
        if (Main.modalCount !== 0 || Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return {ok: false, skipped: 'requires unlocked session with no modal actors'};
        const manager = Keyboard.getInputSourceManager();
        const before = this._guard.getState();
        if (before.popups.length)
            return {ok: false, skipped: 'existing input-source popup'};
        const previousReference = manager._switcherPopup;
        const popups = [];
        const checks = [];
        let activated = 0;
        const check = (name, value) => {
            checks.push({name, passed: Boolean(value)});
            if (!value)
                throw new Error(name);
        };
        const create = () => {
            const popup = new Keyboard.InputSourcePopup([
                {shortName: 'test', displayName: 'Input guard test', activate: () => activated++},
            ], 0, 0);
            popups.push(popup);
            // Reproduce the manager's legacy unconditional destroy closure.
            manager._switcherPopup = popup;
            popup.connect('destroy', () => { manager._switcherPopup = null; });
            check('show acquired own modal', popup.show(false, 'input-guard-self-test', 0));
            return popup;
        };
        let error = null;
        try {
            const valid = create();
            valid._finish();
            valid._finish();
            check('valid selection activated exactly once', activated === 1);
            check('valid finish released modal', Main.modalCount === 0);
            const invalid = create();
            invalid._selectedIndex = -1;
            invalid._finish();
            check('invalid selection did not activate', activated === 1);
            check('invalid finish released modal', Main.modalCount === 0);
            const older = create();
            const newer = create();
            check('stack prevention destroyed previous popup', this._guard.destroyed.has(older));
            check('new manager reference preserved', manager._switcherPopup === newer);
            check('only one input modal remains', Main.modalCount === 1);
            newer.fadeAndDestroy();
            check('fade destroys immediately', this._guard.destroyed.has(newer) && Main.modalCount === 0);
            check('layout unchanged', manager.currentSource?.id === before.currentLayout?.id);
        } catch (caught) {
            error = String(caught);
        } finally {
            for (const popup of popups)
                this._guard.destroy(popup);
            manager._switcherPopup = previousReference;
        }
        const after = this._guard.getState();
        return {ok: !error && after.modalCount === 0 && after.tracked.length === 0,
            error, activated, checks, before, after};
    }

    disable() {
        try {
            this._dbus?.unexport();
        } finally {
            this._dbus = null;
            this._guard?.disable();
            this._guard = null;
        }
    }
}
