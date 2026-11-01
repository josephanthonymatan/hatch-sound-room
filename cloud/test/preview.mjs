// Isolated UI preview. Never imports credentials, starts HatchDevice, or uses a
// persistent DATA_DIR. All commands terminate in FakeDevice and temp storage.
import { fixture } from './helpers.mjs';
import { createServer } from '../server.mjs';
import { builtinSounds } from '../sounds.mjs';

const cleanups = [];
const f = await fixture({ after: callback => cleanups.push(callback) });
f.config.origin = 'http://127.0.0.1:4183';
f.config.email = 'preview@example.test'; f.config.password = 'preview-only';
f.config.ownerName = 'Preview';
f.device.favorites = [{ id: 73, name: 'Rain & Rose', type: 'flex', button0: true, enabled: true, steps: [{ enabled: true, sound: { id: 10543, v: 12000, until: 'indefinite' }, color: { id: 9999, r: 65535, g: 16448, b: 32896, w: 0, i: 32768 } }] }];
const sound = builtinSounds.find(track => track.reference.id === 10543).reference;
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) merge(target[key] ??= {}, value);
    else target[key] = value;
  }
}
f.device.onWrite = patch => {
  merge(f.device.shadow.state.desired, structuredClone(patch));
  merge(f.device.shadow.state.reported, structuredClone(patch));
  if (patch.current?.playing === 'routine') {
    const step = f.device.favorites[0].steps[0];
    merge(f.device.shadow.state.reported.current, { sound: { ...sound, ...step.sound }, color: step.color });
  }
  f.device.emit('shadow', f.device.shadow, f.device.shadow);
};
f.device.report({ playing: 'remote', paused: false, step: 0, srId: 0, sound: { ...sound, v: 12000, mute: false }, color: { id: 9999, r: 65535, g: 16448, b: 32896, w: 0, i: 32768 } });
const server = createServer({ service: f.service, config: f.config });
await new Promise(resolve => server.listen(4183, '127.0.0.1', resolve));
f.service.start();
console.log('Fake-device preview: http://127.0.0.1:4183 — sign in with preview@example.test / preview-only. No real device connection.');
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  for (const cleanup of cleanups) await cleanup();
  process.exit(0);
}
process.on('SIGTERM', close); process.on('SIGINT', close);
setTimeout(close, 30 * 60000).unref();
