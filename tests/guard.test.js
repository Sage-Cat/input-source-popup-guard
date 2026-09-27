import test from 'node:test';
import assert from 'node:assert/strict';
import {InputSourceGuard} from '../guard.js';

function setup() {
    let now = 0;
    let mods = 8;
    let nextId = 1;
    let releases = 0;
    const children = [];
    const modals = [];
    const timers = new Map();
    const logs = [];
    const manager = {_switcherPopup: null};
    class InputSourcePopup {
        constructor(item = {activate() {}}) {
            this._items = [item];
            this._selectedIndex = 0;
            this._modifierMask = 0;
            this.visible = false;
            this.mapped = false;
            this.opacity = 255;
            this.reactive = true;
            this._haveModal = false;
            this.signals = new Map();
            this.destroyCalls = 0;
            children.push(this);
        }
        connect(_name, cb) { const id = nextId++; this.signals.set(id, cb); return id; }
        disconnect(id) { this.signals.delete(id); }
        show(_backward, _binding, mask = 8) {
            if (!this._items.length)
                return false;
            this._modifierMask = mask;
            this._haveModal = true;
            this.visible = true;
            this.mapped = true;
            modals.push(this);
            return true;
        }
        _resetNoModsTimeout() {}
        _keyPressHandler() {}
        _scrollHandler() {}
        _itemEnteredHandler() {}
        remove_all_transitions() {}
        _popModal() {
            if (!this._haveModal)
                return;
            modals.splice(modals.indexOf(this), 1);
            this._haveModal = false;
        }
        destroy() {
            this.destroyCalls++;
            this._popModal();
            children.splice(children.indexOf(this), 1);
            for (const cb of [...this.signals.values()]) cb();
            this.signals.clear();
        }
        _finish() { throw new Error('original finish'); }
        fadeAndDestroy() { throw new Error('original fade'); }
    }
    const original = Object.getOwnPropertyDescriptors(InputSourcePopup.prototype);
    const guard = new InputSourceGuard({
        Popup: InputSourcePopup, children: () => [...children], manager: () => manager,
        releaseKeyboard: () => releases++, now: () => now, modifiers: () => mods,
        log: value => logs.push(value),
        addTimer: (_ms, callback) => { const id = nextId++; timers.set(id, callback); return id; },
        removeTimer: id => timers.delete(id),
        shellState: () => ({modalCount: modals.length, modalActors: modals.map(x => x.constructor.name),
            currentLayout: {id: 'us'}}),
    });
    function create(item) {
        const popup = new InputSourcePopup(item);
        manager._switcherPopup = popup;
        popup.connect('destroy', () => { manager._switcherPopup = null; });
        return popup;
    }
    return {guard, InputSourcePopup, original, create, children, modals, timers, manager, logs,
        releases: () => releases,
        advance: (ms, modifiers = mods) => { now += ms; mods = modifiers; guard.tick(); }};
}

test('finish activates once after releasing modal, then destroys immediately', () => {
    const h = setup(); h.guard.enable();
    let calls = 0;
    const popup = h.create({activate(interactive) {
        assert.equal(interactive, true); assert.equal(h.modals.length, 0); calls++;
        popup._finish();
    }});
    popup.show(false, '', 8); popup._finish(); popup._finish(); popup.fadeAndDestroy();
    assert.equal(calls, 1); assert.equal(popup.destroyCalls, 1);
    assert.equal(popup.reactive, false); assert.equal(h.children.length, 0);
    assert.equal(h.timers.size, 0); assert.equal(popup.signals.size, 0);
});

test('invalid selections and activation exceptions always destroy', () => {
    for (const index of [-1, 99, 0.5, NaN]) {
        const h = setup(); h.guard.enable();
        const popup = h.create({activate() { assert.fail('invalid activation'); }});
        popup.show(false, '', 8); popup._selectedIndex = index; popup._finish();
        assert.equal(popup.destroyCalls, 1); assert.equal(h.modals.length, 0);
    }
    const h = setup(); h.guard.enable();
    const popup = h.create({activate() { throw new Error('engine failed'); }});
    popup.show(false, '', 8); assert.doesNotThrow(() => popup._finish());
    assert.equal(popup.destroyCalls, 1); assert.equal(h.modals.length, 0);
    assert.equal(h.releases(), 1);
    assert.ok(h.logs.some(line => line.includes('engine failed')));
});

test('enable reaps stale input popups and records before evidence without touching foreign modal', () => {
    const h = setup();
    const foreign = {constructor: {name: 'UnrelatedDialog'}};
    h.children.push(foreign); h.modals.push(foreign);
    const popup = h.create(); popup.show(false, '', 8);
    h.guard.enable();
    assert.equal(h.guard.lastRecovery.before.modalCount, 2);
    assert.equal(h.guard.lastRecovery.after.modalCount, 1);
    assert.deepEqual(h.modals, [foreign]); assert.deepEqual(h.children, [foreign]);
    assert.equal(h.releases(), 1);
    h.guard.disable(); assert.deepEqual(h.modals, [foreign]);
});

test('new popup reaps old popup before show and preserves manager reference', () => {
    const h = setup(); h.guard.enable();
    const old = h.create(); old.show(false, '', 8);
    const next = h.create(); next.show(false, '', 8);
    assert.equal(old.destroyCalls, 1); assert.deepEqual(h.modals, [next]);
    assert.equal(h.manager._switcherPopup, next); assert.equal(h.releases(), 1);
    next.fadeAndDestroy(); assert.equal(h.manager._switcherPopup, null);
});

test('watchdog waits for confirmed modifier release, resets samples when held', () => {
    const h = setup(); h.guard.enable();
    let calls = 0; const popup = h.create({activate() { calls++; }});
    popup.show(false, '', 8);
    h.advance(100000, 8); assert.equal(calls, 0);
    h.advance(250, 0); h.advance(250, 0); assert.equal(calls, 0);
    h.advance(250, 8); h.advance(250, 0); h.advance(250, 0); assert.equal(calls, 0);
    h.advance(250, 0); assert.equal(calls, 1); assert.equal(h.timers.size, 0);
});

test('zero-mask watchdog grants 2000ms, hidden watchdog requires over1000ms', () => {
    const h = setup(); h.guard.enable();
    const zero = h.create(); zero.show(false, '', 0);
    h.advance(1999); assert.equal(zero.destroyCalls, 0);
    h.advance(1); assert.equal(zero.destroyCalls, 1);
    const hidden = h.create(); hidden.show(false, '', 8); hidden.mapped = false;
    h.advance(250); h.advance(1000); assert.equal(hidden.destroyCalls, 0);
    h.advance(250); assert.equal(hidden.destroyCalls, 1);
});

test('failed show, external destroy and disable leave no timer or injected connection', () => {
    const h = setup(); h.guard.enable();
    const failed = h.create(); failed._items = [];
    assert.equal(failed.show(false, '', 8), false); assert.equal(failed.destroyCalls, 1);
    const external = h.create(); external.show(false, '', 8); external.destroy();
    assert.equal(h.timers.size, 0); assert.equal(h.guard.tracked.size, 0);
    const popup = h.create(); popup.show(false, '', 8);
    h.guard.disable(); h.guard.disable();
    assert.equal(popup.destroyCalls, 1); assert.equal(popup.signals.size, 0);
    assert.equal(h.timers.size, 0); assert.equal(h.guard.tracked.size, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(h.InputSourcePopup.prototype), h.original);
    h.guard.enable(); const again = h.create(); again.show(false, '', 8); again._finish();
    assert.equal(again.destroyCalls, 1); h.guard.disable();
});


test('zero-mask navigation resets native and fallback inactivity clocks', () => {
    const h = setup(); h.guard.enable();
    const popup = h.create(); popup.show(false, '', 0);
    for (const handler of ['_keyPressHandler', '_scrollHandler', '_itemEnteredHandler']) {
        h.advance(1500);
        popup[handler]();
        assert.equal(popup.destroyCalls, 0);
    }
    h.advance(1999); assert.equal(popup.destroyCalls, 0);
    h.advance(1); assert.equal(popup.destroyCalls, 1);
});

test('failed enable restores acquired prototype overrides', () => {
    const h = setup();
    const override = h.guard.override.bind(h.guard);
    h.guard.override = (name, method) => {
        if (name === '_finish') throw new Error('injected installation failure');
        override(name, method);
    };
    assert.throws(() => h.guard.enable(), /installation failure/);
    assert.equal(h.guard.enabled, false);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(h.InputSourcePopup.prototype), h.original);
});
