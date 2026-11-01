import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HatchDevice } from '../device.mjs';
import { HatchService } from '../service.mjs';
import { playPatch, percentRaw, rgb } from '../core.mjs';
import { alarm, fixture } from './helpers.mjs';
import { nativePatch, normalizeFavorites } from '../sounds.mjs';

// Uses the production device queue and operation dispatcher; only MQTT transport is fake.
async function queuedAlarm(t, { phase = 'ringing', departure = 'hold', desiredDeparture = true, source = 'upload' } = {}) {
  const f = await fixture(t); f.service.close();
  const now = Date.now(), device = new HatchDevice({});
  const service = new HatchService({ store: f.store, device, origin: f.config.origin, dataDir: f.directory, now: () => now });
  t.after(() => service.close());
  if (source === 'favorite') f.store.change(state => { state.hatch.favorites = normalizeFavorites([{ id: 71, name: 'Test Favorite', type: 'favorite', enabled: true, steps: [{ sound: { id: 10543, until: 'indefinite', v: 12000 } }] }]); });
  const trackId = source === 'favorite' ? f.store.value.hatch.favorites[0].id : source === 'native' ? 'hatch-sound-10519' : 'bach-allemanda';
  const item = service.createAlarm({ ...alarm(now), trackId }).alarm;
  service.updateAlarm(item.id, { status: phase });
  const stored = service.alarm(item.id), url = stored.soundReference?.url ?? service.audioUrl(stored.audioCapability);
  const initial = (source === 'upload' ? playPatch(url, 35) : nativePatch(service.track(trackId), 35)).current; initial.color = { ...rgb(stored.light.color), i: percentRaw(stored.light.from) };
  const baseline = phase === 'starting' ? { playing: 'none', paused: false, sound: { url: 'https://original.example.test/baseline.mp3' }, color: { i: 0 } } : structuredClone(initial);
  let cloud = { version: 1, state: { reported: { connected: true, current: baseline }, desired: { current: structuredClone(initial) } } };
  const runtime = { url, soundId: stored.soundReference?.id, routineId: source === 'favorite' ? 71 : undefined, rgb: rgb(stored.light.color), lastIntensity: initial.color.i, previousIntensity: initial.color.i, attemptedAt: now - 5000, rampStartedAt: now - 5000, nextLightAt: now - 1, seenReported: phase === 'ringing', seenDesired: true, rampCancelled: source === 'favorite' };
  service.active.set(item.id, runtime);
  let background, reads = 0; const writes = [], mqtt = new EventEmitter();
  Object.assign(device, { client: mqtt, device: { thingName: 'test-thing' }, online: true, lastReadAt: Date.now(), shadow: structuredClone(cloud) });
  mqtt.get = name => {
    const number = ++reads, token = 'read-' + number;
    if (number === 1) queueMicrotask(() => {
      // Place a poll ahead of the ramp/stop write before the fresh read resolves.
      background = device.read();
      mqtt.emit('status', name, 'accepted', token, structuredClone(cloud));
    });
    else if (number === 2) setImmediate(() => {
      assert.equal(writes.length, 0, 'the command is still behind the poll');
      const current = departure === 'brightness'
        ? { ...structuredClone(initial), color: { ...initial.color, i: 12345 } }
        : departure === 'hold'
        ? { playing: 'none', paused: false, sound: { url }, color: { i: 0 } }
        : { playing: 'routine', paused: false, srId: 298875192, step: 1, sound: { url: 'https://original.example.test/favorite.mp3' }, color: { i: 1000 } };
      cloud = { version: 2, state: { reported: { connected: true, current }, desired: { current: desiredDeparture ? structuredClone(current) : structuredClone(initial) } } };
      device.shadow = structuredClone(cloud); device.emit('shadow', cloud, cloud);
      if (phase === 'ringing' && departure !== 'brightness' && service.alarm(item.id).status !== 'cancelled') {
        assert.equal(service.alarm(item.id).status, 'dismissed');
        assert.equal(service.active.has(item.id), false);
      }
      mqtt.emit('status', name, 'accepted', token, structuredClone(cloud));
    });
    else queueMicrotask(() => mqtt.emit('status', name, 'accepted', token, structuredClone(cloud)));
    return token;
  };
  mqtt.update = (name, value) => {
    writes.push(structuredClone(value)); const token = 'write-' + writes.length;
    queueMicrotask(() => mqtt.emit('status', name, 'accepted', token, { version: 3 })); return token;
  };
  return { service, device, item, writes, background: () => background };
}

test('a native hold observed while a ramp waits behind a poll prevents its MQTT dispatch', async t => {
  const f = await queuedAlarm(t); await f.service.tick(); await f.background();
  assert.equal(f.service.alarm(f.item.id).status, 'dismissed'); assert.deepEqual(f.writes, []);
});
test('a desired favorite switch observed while a ramp waits prevents its MQTT dispatch', async t => {
  const f = await queuedAlarm(t, { departure: 'favorite' }); await f.service.tick(); await f.background();
  assert.equal(f.service.alarm(f.item.id).status, 'dismissed'); assert.deepEqual(f.writes, []);
});
test('cancellation stop does not overwrite a reported favorite that arrives while queued', async t => {
  const f = await queuedAlarm(t, { departure: 'favorite', desiredDeparture: false });
  await f.service.cancelAlarm(f.item.id); await f.background();
  assert.equal(f.service.alarm(f.item.id).status, 'cancelled'); assert.deepEqual(f.writes, []);
});
test('pending-start cancellation also protects a queued reported favorite with stale desired audio', async t => {
  const f = await queuedAlarm(t, { phase: 'starting', departure: 'favorite', desiredDeparture: false });
  await f.service.cancelAlarm(f.item.id); await f.background();
  assert.equal(f.service.alarm(f.item.id).status, 'cancelled'); assert.deepEqual(f.writes, []);
});

test('a manual brightness override observed while a ramp waits vetoes its dispatch', async t => {
  const f = await queuedAlarm(t, { departure: 'brightness' }); await f.service.tick(); await f.background();
  assert.equal(f.service.alarm(f.item.id).status, 'ringing'); assert.equal(f.service.active.get(f.item.id).rampCancelled, true); assert.deepEqual(f.writes, []);
});

test('a native hold while a manual scene waits prevents the scene from waking the device', async t => {
  const f = await queuedAlarm(t);
  await assert.rejects(f.service.light({ color: '#ff8800', brightness: 65 }), error => error.status === 409);
  await f.background();
  assert.deepEqual(f.writes, []);
});

test('a newer manual brightness change while a scene waits prevents stale light dispatch', async t => {
  const f = await queuedAlarm(t, { departure: 'brightness' });
  await assert.rejects(f.service.light({ color: '#ff8800', brightness: 65 }), error => error.status === 409);
  await f.background(); assert.deepEqual(f.writes, []);
});

test('native sound ramps honor a hold observed inside the production MQTT queue', async t => {
  const f = await queuedAlarm(t, { source: 'native' });
  await f.service.tick(); await f.background(); assert.deepEqual(f.writes, []);
  assert.equal(f.service.alarm(f.item.id).status, 'dismissed');
});
test('cancelling native sound or favorite alarms never stops a newer favorite while queued', async t => {
  for (const source of ['native', 'favorite']) {
    for (const phase of ['starting', 'ringing']) {
      const f = await queuedAlarm(t, { source, phase, departure: 'favorite', desiredDeparture: false });
      await f.service.cancelAlarm(f.item.id); await f.background();
      assert.deepEqual(f.writes, []); assert.equal(f.service.alarm(f.item.id).status, 'cancelled');
    }
  }
});
