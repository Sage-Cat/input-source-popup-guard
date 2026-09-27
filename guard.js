// Shell-independent policy, with a deliberately narrow injected runtime surface.
export class InputSourceGuard {
    constructor(runtime) {
        this.r = runtime;
        this.tracked = new Map();
        this.destroyed = new WeakSet();
        this.finishing = new WeakSet();
        this.overrides = [];
        this.timer = 0;
        this.enabled = false;
        this.counts = {};
        this.lastRecovery = null;
    }

    enable() {
        if (this.enabled)
            return;
        this.enabled = true;
        try {
            this._install();
        } catch (error) {
            this.disable();
            throw error;
        }
    }

    _install() {
        const guard = this;
        this.override('fadeAndDestroy', function () { guard.destroy(this); });
        this.override('_finish', function () { guard.finish(this); });
        const originalShow = this.r.Popup.prototype.show;
        this.override('show', function (...args) {
            if (guard.destroyed.has(this))
                return false;
            guard.reap('stack-prevention', this);
            guard.track(this);
            try {
                const shown = originalShow.apply(this, args);
                if (!shown)
                    guard.destroy(this);
                return shown;
            } catch (error) {
                guard.r.log(`show failed: ${error}`);
                guard.destroy(this);
                return false;
            }
        });
        // Preserve native inactivity resets as well as the fallback watchdog.
        for (const name of ['_keyPressHandler', '_scrollHandler', '_itemEnteredHandler', '_resetNoModsTimeout']) {
            const original = this.r.Popup.prototype[name];
            if (typeof original !== 'function')
                continue;
            this.override(name, function (...args) {
                guard.activity(this);
                if (name !== '_resetNoModsTimeout' && !this._modifierMask)
                    this._resetNoModsTimeout?.();
                return original.apply(this, args);
            });
        }
        this.reap('enable-cleanup');
    }

    override(name, method) {
        const proto = this.r.Popup.prototype;
        this.overrides.push({name, descriptor: Object.getOwnPropertyDescriptor(proto, name), method});
        Object.defineProperty(proto, name, {value: method, configurable: true, writable: true});
    }

    popups() {
        return this.r.children().filter(actor => actor instanceof this.r.Popup && !this.destroyed.has(actor));
    }

    snapshot() {
        const now = this.r.now();
        const stats = popup => ({
            constructor: popup.constructor.name,
            visible: Boolean(popup.visible), mapped: Boolean(popup.mapped),
            opacity: popup.opacity, reactive: Boolean(popup.reactive),
            haveModal: Boolean(popup._haveModal), modifierMask: popup._modifierMask,
            selectedIndex: popup._selectedIndex, itemCount: popup._items?.length ?? 0,
        });
        return {
            ...this.r.shellState(),
            popups: this.popups().map(stats),
            tracked: [...this.tracked].map(([popup, state]) => ({
                ...stats(popup), ageMs: now - state.start,
                releasedSamples: state.releasedSamples,
                hiddenMs: state.hiddenSince === null ? 0 : now - state.hiddenSince,
            })),
        };
    }

    getState() {
        return {version: 2, enabled: this.enabled, ...this.snapshot(),
            recoveryCounts: {...this.counts}, lastRecovery: this.lastRecovery};
    }

    recover(reason, action) {
        const before = this.snapshot();
        this.r.log(JSON.stringify({reason, before}));
        try {
            action();
        } finally {
            this.counts[reason] = (this.counts[reason] ?? 0) + 1;
            this.lastRecovery = {reason, atMs: this.r.now(), before, after: this.snapshot()};
            this.r.log(JSON.stringify(this.lastRecovery));
        }
    }

    reap(reason, keep = null) {
        const stale = this.popups().filter(popup => popup !== keep);
        if (!stale.length)
            return;
        this.recover(reason, () => {
            for (const popup of stale)
                this.destroy(popup);
            // This is the input-source manager's hold, never a foreign modal grab.
            this.r.releaseKeyboard();
        });
    }

    track(popup) {
        if (this.tracked.has(popup) || this.destroyed.has(popup))
            return;
        const state = {start: this.r.now(), lastActivity: this.r.now(), releasedSamples: 0, releasedSince: null,
            hiddenSince: null, destroyId: 0};
        state.destroyId = popup.connect('destroy', () => {
            this.destroyed.add(popup);
            this.untrack(popup, false);
        });
        this.tracked.set(popup, state);
        if (!this.timer)
            this.timer = this.r.addTimer(250, () => this.tick());
    }

    untrack(popup, disconnect = true) {
        const state = this.tracked.get(popup);
        if (!state)
            return;
        this.tracked.delete(popup);
        if (disconnect && state.destroyId)
            popup.disconnect(state.destroyId);
        if (!this.tracked.size && this.timer) {
            this.r.removeTimer(this.timer);
            this.timer = 0;
        }
    }

    destroy(popup) {
        if (this.destroyed.has(popup))
            return;
        this.destroyed.add(popup);
        this.untrack(popup);
        const manager = this.r.manager();
        const current = manager._switcherPopup;
        try {
            popup.reactive = false;
            popup.remove_all_transitions();
        } catch (error) {
            this.r.log(`transition cleanup failed: ${error}`);
        }
        try {
            popup._popModal();
        } catch (error) {
            this.r.log(`own modal cleanup failed: ${error}`);
        }
        try {
            popup.destroy(); // Native _onDestroy releases only this popup's grab/timers.
        } catch (error) {
            this.r.log(`destroy failed: ${error}`);
        } finally {
            // Old manager destroy callbacks unconditionally clear the newer reference.
            if (current && current !== popup && !this.destroyed.has(current))
                manager._switcherPopup = current;
        }
    }

    finish(popup) {
        if (this.destroyed.has(popup) || this.finishing.has(popup))
            return;
        this.finishing.add(popup);
        let activating = false;
        try {
            const index = popup._selectedIndex;
            const item = Number.isInteger(index) && index >= 0 ? popup._items?.[index] : null;
            popup._popModal();
            if (typeof item?.activate === 'function') {
                activating = true;
                item.activate(true);
            }
        } catch (error) {
            this.r.log(`finish failed: ${error}`);
            if (activating)
                this.r.releaseKeyboard();
        } finally {
            this.destroy(popup);
        }
    }

    activity(popup) {
        const state = this.tracked.get(popup);
        if (state)
            state.lastActivity = this.r.now();
    }

    tick() {
        const now = this.r.now();
        const modifiers = this.r.modifiers();
        for (const [popup, state] of [...this.tracked]) {
            const hidden = !popup.visible || !popup.mapped || popup.opacity === 0;
            state.hiddenSince = hidden ? (state.hiddenSince ?? now) : null;
            if (state.hiddenSince !== null && now - state.hiddenSince > 1000) {
                this.recover('hidden-timeout', () => this.destroy(popup));
                continue;
            }
            const mask = popup._modifierMask;
            if (!mask) {
                if (now - state.lastActivity >= 2000)
                    this.recover('no-modifier-timeout', () => this.finish(popup));
                continue;
            }
            if (modifiers & mask) {
                state.releasedSamples = 0;
                state.releasedSince = null;
                continue;
            }
            state.releasedSamples++;
            state.releasedSince ??= now;
            // At least two observations, and a full 500 ms confirmed release.
            if (state.releasedSamples >= 2 && now - state.releasedSince >= 500)
                this.recover('modifier-release', () => this.finish(popup));
        }
        return this.enabled && this.tracked.size > 0;
    }

    disable() {
        if (!this.enabled)
            return;
        this.enabled = false;
        for (const popup of [...this.tracked.keys()])
            this.destroy(popup);
        if (this.timer)
            this.r.removeTimer(this.timer);
        this.timer = 0;
        const proto = this.r.Popup.prototype;
        for (const {name, descriptor, method} of this.overrides.reverse()) {
            if (proto[name] !== method)
                continue;
            if (descriptor)
                Object.defineProperty(proto, name, descriptor);
            else
                delete proto[name];
        }
        this.overrides = [];
    }
}
