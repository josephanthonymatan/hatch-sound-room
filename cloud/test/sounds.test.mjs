import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { Store } from '../store.mjs';
import { HatchService } from '../service.mjs';
import { builtinSounds, captureCandidate, nativePatch, normalizeFavorites, publicSound, soundReference } from '../sounds.mjs';
import { alarm, fixture, httpFixture } from './helpers.mjs';

const sound = { id: 10543, url: 'https://assets.ctfassets.net/hlsdh3zwyrtx/test/sleep.wav', until: 'indefinite', duration: 0, v: 12000, mute: false };
const routine = () => ({ id: 73, name: 'Evening Rain', type: 'flex', enabled: true, button0: true, macAddress: 'private-device-id', steps: [{ enabled: true, sound: { id: sound.id, until: 'indefinite', v: 12000 }, color: { id: 9999, r: 65535, g: 0, b: 0, w: 0, i: 24000 } }] });
const current = (reference = sound) => ({ playing: 'remote', srId: 0, step: 0, paused: false, sound: structuredClone(reference) });
const save = async (f, overrides = {}) => {
  f.device.report(current({ ...sound, ...overrides }));
  const state = await f.service.state();
  return (await f.service.saveCurrent({ title: 'My Rain', category: 'Water', captureKey: state.playback.captureKey })).track;
};

test('42 model-specific built-ins expose labels but keep all playback URLs server-side', async t => {
  const f = await fixture(t);
  const native = f.service.library().tracks.filter(track => track.kind === 'hatch-sound');
  assert.equal(native.length, 42); assert.equal(new Set(native.map(track => track.id)).size, 42);
  assert.ok(builtinSounds.every(track => soundReference(track.reference)));
  assert.deepEqual(Object.fromEntries(['Nature', 'Water', 'Color Noise', 'Household', 'Camp', 'Vehicle', 'Lullaby']
    .map(category => [category, native.filter(track => track.category === category).length])),
  { Nature: 6, Water: 6, 'Color Noise': 8, Household: 8, Camp: 4, Vehicle: 4, Lullaby: 6 });
  assert.ok(native.every(track => track.category && track.tags.includes(track.category)));
  for (const value of ['https://', 'reference', 'soundId', 'routineId']) assert.equal(JSON.stringify(native).includes(value), false);
  await f.service.play({ trackId: 'hatch-sound-10519', volume: 25 });
  const patch = f.device.writes[0];
  assert.equal(patch.current.sound.id, 10519); assert.equal(patch.current.sound.v, Math.ceil(.25 * 65535));
  assert.equal(patch.current.paused, false); assert.equal(patch.current.srId, 0);
  assert.equal(patch.current.sound.until, 'indefinite');
  f.device.report(patch.current);
  assert.equal((await f.service.state()).playback.trackId, 'hatch-sound-10519');
});

test('saved sounds require categories, reuse existing names and persist custom categories', async t => {
  const f = await fixture(t);
  f.device.report(current());
  const { playback: { captureKey } } = await f.service.state();
  for (const category of [undefined, '', '   ', 'x'.repeat(61)]) {
    await assert.rejects(f.service.saveCurrent({ title: 'Rain', captureKey, category }), /Category/);
  }
  const first = await f.service.saveCurrent({ title: 'Rain', captureKey, category: '  Reading   Time  ' });
  assert.equal(first.track.category, 'Reading Time');
  const duplicate = await f.service.saveCurrent({ title: 'Rain again', captureKey, category: 'reading time' });
  assert.equal(duplicate.existing, true); assert.equal(duplicate.track.category, 'Reading Time');
  assert.equal(f.store.value.savedSounds.length, 1);
  const restored = new Store(f.store.db);
  assert.equal(restored.value.savedSounds.find(track => track.id === first.track.id).category, 'Reading Time');
});

test('cached built-ins from before categories retain their category on library reads', async t => {
  const f = await fixture(t);
  f.store.change(state => { state.hatch.sounds = builtinSounds.map(({ category, ...track }) => track); });
  assert.ok(f.service.library().tracks.filter(track => track.kind === 'hatch-sound').every(track => track.category));
});

test('sync reads enabled favorites, keeps stable opaque IDs and falls back when catalog fails', async t => {
  const f = await fixture(t); f.device.favorites = [routine(), { ...routine(), id: 74, button0: false }, { ...routine(), id: 75, enabled: false }];
  f.device.fetchSounds = async () => { throw Error('private provider detail'); };
  const first = await f.service.syncHatch(); const favorite = first.tracks.find(track => track.kind === 'hatch-favorite');
  assert.ok(favorite); assert.equal(first.tracks.filter(track => track.kind === 'hatch-favorite').length, 1);
  assert.equal(first.hatch.catalogStatus, 'bundled'); assert.equal(f.device.writes.length, 0);
  assert.equal((await f.service.syncHatch()).tracks.find(track => track.kind === 'hatch-favorite').id, favorite.id);
  assert.doesNotMatch(JSON.stringify(first), /private-device-id|routineId|signature|ctfassets/);
  await f.service.play({ trackId: favorite.id });
  assert.deepEqual(f.device.writes[0], { nightlightOn: false, current: { playing: 'routine', srId: 73, step: 1, paused: false } });
  f.device.report({ ...f.device.writes[0].current, sound });
  assert.equal((await f.service.state()).playback.title, 'Evening Rain');
  f.device.report({ playing: 'none', paused: false });
  await assert.rejects(f.service.play({ trackId: favorite.id, volume: 90 }), /saved Hatch volume/);
  f.device.fetchFavorites = async () => { throw Error('secret error'); };
  await assert.rejects(f.service.syncHatch(), /could not be refreshed/);
  assert.equal(f.store.value.hatch.favorites.length, 1, 'failed sync preserves cache');
});

test('dynamic favorite metadata uses the first enabled light without changing native playback or fingerprints', async t => {
  const f = await fixture(t), source = routine();
  source.steps[0].color = { id: 792, r: null, g: 0, b: 0, w: null, i: 24000 };
  source.steps.unshift({ ...structuredClone(source.steps[0]), enabled: false, color: { id: 888 } });
  source.steps.push({ ...structuredClone(source.steps[1]), color: { id: 888 } });
  f.device.favorites = [source];
  const { tracks } = await f.service.syncHatch();
  const favorite = tracks.find(track => track.kind === 'hatch-favorite');
  assert.equal(favorite.nativeLightId, 792);
  assert.doesNotMatch(JSON.stringify(favorite), /"(?:routineId|signature|macAddress|steps)":/);
  const stored = f.store.value.hatch.favorites[0];
  const renamed = normalizeFavorites([{ ...source, name: 'Another title' }], [stored])[0];
  assert.equal(renamed.id, stored.id); assert.equal(renamed.signature, stored.signature);
  const changed = structuredClone(source); changed.steps[1].color.id = 888;
  assert.notEqual(normalizeFavorites([changed], [stored])[0].signature, stored.signature);
  await f.service.play({ trackId: favorite.id });
  assert.deepEqual(f.device.writes[0], { nightlightOn: false, current: { playing: 'routine', srId: source.id, step: 1, paused: false } });
  assert.deepEqual(nativePatch(stored), f.device.writes[0]);
  f.device.report({ ...f.device.writes[0].current, color: source.steps[1].color, sound });
  const state = await f.service.state();
  assert.equal(state.light.on, true); assert.equal(state.light.effectId, 792); assert.equal(state.light.effectName, 'Aurora');
});

test('favorites omit light metadata when the first enabled step has no valid color ID', () => {
  for (const color of [undefined, { id: -1 }, { id: '792' }, { id: 792.5 }]) {
    const source = routine(); source.steps[0].color = color;
    assert.equal('nativeLightId' in publicSound(normalizeFavorites([source])[0]), false);
  }
});

test('catalog refresh never substitutes another product ID or premium media', async t => {
  const f = await fixture(t);
  f.device.sounds = [{ id: 1, tier: 'free', wavUrl: sound.url }, { id: 10519, tier: 'premium', wavUrl: sound.url }, { id: 10543, tier: 'free', wavUrl: sound.url }];
  await f.service.syncHatch();
  assert.equal(f.service.track('hatch-sound-10543').reference.url, sound.url);
  assert.notEqual(f.service.track('hatch-sound-10519').reference.url, sound.url);
  assert.equal(f.service.library().tracks.filter(track => track.kind === 'hatch-sound').length, 42);
});

test('capture saves a timed sound without writes, deduplicates and survives a favorite deletion', async t => {
  const f = await fixture(t); const track = await save(f, { until: 'duration', duration: 180 });
  assert.equal(track.kind, 'saved-sound'); assert.equal(track.durationSeconds, 180); assert.equal(f.device.writes.length, 0);
  const key = (await f.service.state()).playback.captureKey;
  assert.equal((await f.service.saveCurrent({ title: 'Duplicate', category: 'Water', captureKey: key })).existing, true);
  f.device.favorites = []; await f.service.syncHatch();
  await f.service.play({ trackId: track.id, volume: 16 });
  assert.equal(f.device.writes[0].current.sound.duration, 180);
  assert.equal(f.device.writes[0].current.sound.until, 'duration');
  assert.equal((await f.service.state()).playback.trackId, track.id);
  assert.doesNotMatch(JSON.stringify(f.service.library()), /ctfassets|reference/);
});

test('capture refuses stopped, paused, mute, unknown timers, uploads, unsafe hosts and changed selections', async t => {
  const f = await fixture(t);
  for (const change of [{ playing: 'none' }, { paused: true }, { sound: { ...sound, mute: true } }, { sound: { ...sound, until: 'unknown' } }, { sound: { ...sound, url: f.service.audioUrl(f.store.value.tracks[0].audioCapability) } }]) {
    const value = { ...current(), ...change };
    assert.equal(captureCandidate(value), null);
    f.device.report(value);
    await assert.rejects(f.service.saveCurrent({ title: 'No', captureKey: 'bad' }), /cannot be captured/);
  }
  for (const url of ['http://assets.ctfassets.net/hlsdh3zwyrtx/test.wav', 'https://assets.ctfassets.net.evil.test/hlsdh3zwyrtx/test.wav', 'https://user:pass@assets.ctfassets.net/hlsdh3zwyrtx/test.wav', 'https://127.0.0.1/test.wav', 'https://assets.ctfassets.net/another-space/test.wav']) assert.equal(soundReference({ ...sound, url }), null);
  f.device.report(current()); const captureKey = (await f.service.state()).playback.captureKey;
  f.device.report(current({ ...sound, id: 10519 }));
  await assert.rejects(f.service.saveCurrent({ title: 'Stale', captureKey }), /sound changed/);
  assert.equal(f.store.value.savedSounds.length, 0); assert.equal(f.device.writes.length, 0);
});

test('additive migration and restart preserve uploads, saved references and pending instants', async t => {
  const f = await fixture(t); const track = await save(f);
  const item = f.service.createAlarm({ ...alarm(), trackId: track.id }).alarm;
  f.service.close(); f.store.close(); f.store.close = () => {};
  const reopened = await Store.open(f.directory);
  assert.equal(reopened.value.savedSounds[0].id, track.id);
  assert.equal(reopened.value.alarms[0].scheduledAt, item.scheduledAt);
  assert.equal(reopened.value.tracks[0].id, 'bach-allemanda');
  reopened.close();
  // A pre-feature version-1 DB migrates without losing its existing alarm.
  const db = new DatabaseSync(path.join(f.directory, 'hatch.sqlite'));
  const old = f.store.snapshot(); delete old.savedSounds; delete old.hatch;
  db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(old)); db.close();
  const migrated = await Store.open(f.directory);
  assert.deepEqual(migrated.value.savedSounds, []); assert.equal(migrated.value.alarms[0].scheduledAt, item.scheduledAt);
  migrated.close();
});

test('a removed favorite cannot play and a changed favorite fails its alarm without a write', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now }); f.device.favorites = [routine()];
  await f.service.syncHatch(); const favorite = f.store.value.hatch.favorites[0];
  const item = f.service.createAlarm({ ...alarm(now), trackId: favorite.id }).alarm;
  assert.equal(item.usesFavoriteSettings, true);
  f.device.favorites[0].steps[0].sound.id = 10519;
  now += 10000; await f.service.tick();
  assert.equal(f.service.alarm(item.id).status, 'failed'); assert.equal(f.device.writes.length, 0);
  f.device.favorites = [];
  await assert.rejects(f.service.play({ trackId: favorite.id }), /Sound not found/);
  assert.equal(f.device.writes.length, 0);
});

test('native favorite alarms preserve playlist steps, stop on hold and never replay after restart', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now });
  f.device.favorites = [routine()]; f.device.favorites[0].steps.push({ ...structuredClone(f.device.favorites[0].steps[0]), sound: { ...sound, id: 10519 } });
  await f.service.syncHatch(); const favorite = f.store.value.hatch.favorites[0];
  const item = f.service.createAlarm({ ...alarm(now), trackId: favorite.id }).alarm;
  now += 10000; await f.service.tick();
  assert.equal(f.device.writes.length, 1); assert.equal(f.device.writes[0].current.sound, undefined);
  assert.equal(f.service.alarm(item.id).status, 'starting');
  f.device.shadow.state.desired.current = structuredClone(f.device.writes[0].current);
  f.device.report({ ...f.device.writes[0].current, step: 2, sound: { ...sound, id: 10519 } });
  await f.service.tick(); assert.equal(f.service.alarm(item.id).status, 'ringing');
  now += 20000; await f.service.tick(); assert.equal(f.device.writes.length, 1, 'favorite has no app light ramp');
  f.device.report({ playing: 'none', paused: false }); await f.service.tick();
  assert.equal(f.service.alarm(item.id).status, 'dismissed'); assert.equal(f.device.writes.length, 1);
  f.service.close(); const restarted = new HatchService({ store: f.store, device: f.device, origin: f.config.origin, dataDir: f.directory, now: () => now });
  await restarted.tick(); restarted.close(); assert.equal(f.device.writes.length, 1);
});

test('built-in and captured alarms claim once, preserve timers and cancel ramps on favorite departure', async t => {
  for (const kind of ['builtin', 'saved']) {
    let now = Date.now(); const f = await fixture(t, { now: () => now });
    const trackId = kind === 'saved' ? (await save(f, { until: 'duration', duration: 90 })).id : 'hatch-sound-10519';
    const item = f.service.createAlarm({ ...alarm(now), trackId }).alarm;
    f.device.onWrite = () => assert.equal(f.service.alarm(item.id).status, 'starting');
    now += 10000; await f.service.tick(); delete f.device.onWrite;
    const start = f.device.writes[0].current;
    if (kind === 'saved') { assert.equal(start.sound.duration, 90); assert.equal(start.sound.until, 'duration'); }
    else assert.equal(start.sound.id, 10519);
    f.device.shadow.state.desired.current = structuredClone(start); f.device.report(start); await f.service.tick();
    now += 5000; await f.service.tick();
    assert.deepEqual(Object.keys(f.device.writes[1].current), ['color']);
    f.device.report({ playing: 'routine', srId: 999, paused: false, sound: start.sound });
    now += 60000; await f.service.tick();
    assert.equal(f.service.alarm(item.id).status, 'dismissed'); assert.equal(f.device.writes.length, 2);
  }
});

test('a hold while favorites refresh vetoes both manual playback and an alarm start', async t => {
  for (const mode of ['play', 'alarm']) {
    let now = Date.now(); const f = await fixture(t, { now: () => now }); f.device.favorites = [routine()];
    await f.service.syncHatch(); const favorite = f.store.value.hatch.favorites[0];
    f.device.report(current());
    f.device.fetchFavorites = async () => { f.device.report({ playing: 'none', paused: false }); return [routine()]; };
    if (mode === 'play') await assert.rejects(f.service.play({ trackId: favorite.id }), /controls changed/);
    else { const item = f.service.createAlarm({ ...alarm(now), trackId: favorite.id }).alarm; now += 10000; await f.service.tick(); assert.equal(f.service.alarm(item.id).status, 'dismissed'); }
    assert.equal(f.device.writes.length, 0);
  }
});

test('a favorite with retained native identity needs an explicit stop, never a hidden restart', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now }); f.device.favorites = [routine()];
  await f.service.syncHatch(); const favorite = f.store.value.hatch.favorites[0];
  f.device.report({ ...current(), srId: 73 });
  await assert.rejects(f.service.play({ trackId: favorite.id }), /Turn off your Hatch/);
  const item = f.service.createAlarm({ ...alarm(now), trackId: favorite.id }).alarm;
  now += 10000; await f.service.tick();
  assert.equal(f.service.alarm(item.id).status, 'failed'); assert.equal(f.device.writes.length, 0);
  f.device.report({ playing: 'none', srId: 73, paused: false });
  await f.service.play({ trackId: favorite.id }); assert.equal(f.device.writes.length, 1);
});

test('new HTTP routes enforce auth and same-origin and never return provider references', async t => {
  const f = await httpFixture(t); f.device.favorites = [routine()]; f.device.report(current());
  for (const route of ['/api/hatch/hatch/sync', '/api/hatch/sounds/save-current']) {
    assert.equal((await fetch(f.base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  }
  const login = await fetch(f.base + '/auth/login', { method: 'POST', headers: { origin: f.config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email: f.config.email, password: f.config.password }) });
  const cookie = login.headers.get('set-cookie');
  for (const route of ['/api/hatch/hatch/sync', '/api/hatch/sounds/save-current']) assert.equal((await fetch(f.base + route, { method: 'POST', headers: { cookie, origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  const sync = await f.call('/v1/hatch/sync', { method: 'POST', body: '{}' }); assert.equal(sync.status, 200);
  const state = await (await f.call('/v1/state')).json();
  const saved = await f.call('/v1/sounds/save-current', { method: 'POST', body: JSON.stringify({ title: 'Saved Rain', category: 'Water', captureKey: state.playback.captureKey }) });
  assert.equal(saved.status, 201); const result = await saved.json();
  for (const body of [await sync.json(), state, result]) assert.doesNotMatch(JSON.stringify(body), /ctfassets|reference|routineId|macAddress|private-device-id|signature/);
  assert.equal(f.device.writes.length, 0);
  const item = f.service.createAlarm({ ...alarm(), trackId: result.track.id }).alarm;
  assert.equal((await f.call('/v1/library/' + result.track.id, { method: 'DELETE' })).status, 409);
  await f.service.cancelAlarm(item.id); f.device.report({ playing: 'none', paused: false });
  assert.equal((await f.call('/v1/library/' + result.track.id, { method: 'DELETE' })).status, 200);
  assert.equal((await f.call('/v1/library/hatch-sound-10519', { method: 'DELETE' })).status, 409);
});
