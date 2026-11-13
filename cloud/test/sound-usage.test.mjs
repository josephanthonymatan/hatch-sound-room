import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../store.mjs';
import { alarm, fixture, httpFixture } from './helpers.mjs';

const count = (service, id) => service.library().tracks.find(track => track.id === id)?.playCount;

test('accepted manual choices count once, persist, and are exposed through the owner library', async t => {
  const f = await httpFixture(t), id = 'hatch-sound-10519';
  assert.equal(count(f.service, id), 0);
  for (let i = 1; i <= 2; i++) {
    const response = await f.call('/v1/play', { method: 'POST', body: JSON.stringify({ trackId: id }) });
    assert.equal(response.status, 200);
    assert.equal(count(f.service, id), i);
  }
  await f.service.play({ trackId: 'bach-allemanda' });
  await f.service.state(); await f.service.state(); await f.service.syncHatch();
  assert.equal(count(f.service, id), 2, 'polls and catalog sync leave counts alone');
  const library = await (await f.call('/v1/library')).json();
  assert.equal(library.tracks.find(track => track.id === id).playCount, 2);
  const restored = new Store(f.store.db);
  assert.equal(restored.value.soundPlays[id], 2);
  assert.equal(restored.value.soundPlays['bach-allemanda'], 1);
  assert.equal((await fetch(f.base + '/v1/library')).status, 401);
});

test('rejected, skipped and ambiguous starts do not increase usage; alarms do not count', async t => {
  const now = Date.now(), f = await fixture(t, { now: () => now }), id = 'hatch-sound-10519';
  await assert.rejects(f.service.play({ trackId: 'missing' }), /not found/);
  await assert.rejects(f.service.play({ trackId: id, volume: 101 }), /Volume/);
  const write = f.device.write.bind(f.device);
  f.device.write = async () => ({ skipped: true });
  await assert.rejects(f.service.play({ trackId: id }), /controls changed/);
  f.device.write = async () => { throw Error('Outcome unknown'); };
  await assert.rejects(f.service.play({ trackId: id }), /unknown/);
  assert.equal(count(f.service, id), 0);
  f.device.write = write;
  const scheduled = (await f.service.createAlarm(alarm(now))).alarm;
  f.service.updateAlarm(scheduled.id, { nextScheduledAt: new Date(now).toISOString() });
  await f.service.tick();
  assert.equal(f.device.writes.length, 1);
  assert.equal(count(f.service, 'bach-allemanda'), 0);
});

test('favorite counts survive sync, saved-sound removal clears its count, and old stores migrate', async t => {
  const f = await fixture(t);
  f.device.favorites = [{ id: 73, name: 'Rain', type: 'flex', enabled: true, button0: true, steps: [{ enabled: true, sound: { id: 10543, until: 'indefinite', v: 12000 } }] }];
  const favorite = (await f.service.syncHatch()).tracks.find(track => track.kind === 'hatch-favorite');
  await f.service.play({ trackId: favorite.id });
  f.device.favorites[0].name = 'Evening Rain';
  await f.service.syncHatch();
  assert.equal(count(f.service, favorite.id), 1);
  f.device.report({ playing: 'remote', srId: 0, paused: false, sound: { id: 10543, url: 'https://assets.ctfassets.net/hlsdh3zwyrtx/test/sleep.wav', until: 'indefinite', v: 12000, mute: false } });
  const state = await f.service.state();
  const saved = (await f.service.saveCurrent({ title: 'My Rain', category: 'Water', captureKey: state.playback.captureKey })).track;
  await f.service.play({ trackId: saved.id });
  assert.equal(count(f.service, saved.id), 1);
  const again = await f.service.state();
  const duplicate = await f.service.saveCurrent({ title: 'My Rain', category: 'Water', captureKey: again.playback.captureKey });
  assert.equal(duplicate.track.playCount, 1, 'saving the same reference again preserves its count in the immediate response');
  f.device.report({ playing: 'none', paused: false });
  await f.service.deleteTrack(saved.id);
  assert.equal(f.store.value.soundPlays[saved.id], undefined);
  const before = f.store.snapshot();
  f.store.change(state => { delete state.soundPlays; });
  const migrated = new Store(f.store.db);
  assert.deepEqual(migrated.value.soundPlays, {});
  assert.deepEqual(migrated.value.tracks, before.tracks);
  assert.deepEqual(migrated.value.alarms, before.alarms);
});
