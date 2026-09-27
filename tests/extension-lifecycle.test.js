import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../extension.js', import.meta.url), 'utf8');
test('a diagnostics export failure unwinds guard installation after unexport', () => {
    const events = [];
    const ExtensionClass = runInNewContext(
        source.replace(/^import .*;\n/gm, '').replace('export default class', 'class') +
        '\nInputSourcePopupGuardExtension;', {
            Extension: class {}, BUILD_REVISION: 'development',
            Keyboard: {InputSourcePopup: class {}},
            InputSourceGuard: class {enable() { events.push('guard-enable'); } disable() { events.push('guard-disable'); }},
            Gio: {DBus: {session: {}}, DBusExportedObject: {wrapJSObject() { return {
                export() { throw new Error('export failed'); }, unexport() { events.push('unexport'); },
            }; }}},
        });
    const extension = new ExtensionClass();
    assert.throws(() => extension.enable(), /export failed/);
    assert.deepEqual(events, ['guard-enable', 'unexport', 'guard-disable']);
    assert.equal(extension._guard, null);
});
