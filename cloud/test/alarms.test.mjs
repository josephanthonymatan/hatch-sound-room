import test from 'node:test';
import assert from 'node:assert/strict';
import { HatchService } from '../service.mjs';
import { fixture, alarm } from './helpers.mjs';

async function dueFixture(t) {
  let now = 1792922400000;
  const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(alarm(now)).alarm;
  const advance = ms => { now += ms; };
  return { ...f, item, advance };
}
function acceptOwn(f) {
  const current = structuredClone(f.device.writes[0].current);
  f.device.shadow.state.desired.current = structuredClone(current);
  f.device.report(current);
}
test('alarm durably claims before one send and never repeats an ambiguous attempt', async t => {
  const f = await dueFixture(t); f.advance(10000);
  f.device.onWrite = () => { assert.equal(f.service.alarm(f.item.id).status, 'starting'); throw new Error('ambiguous timeout'); };
  await f.service.tick(); await f.service.tick();
  assert.equal(f.device.writes.length, 1); assert.equal(f.service.alarm(f.item.id).status, 'failed');
});
test('restart abandons claimed/ringing jobs without playback or ramp replay', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick();
  assert.equal(f.service.alarm(f.item.id).status, 'starting'); f.service.close();
  const second = new HatchService({ store: f.store, device: f.device, origin: f.config.origin, dataDir: f.directory, now: () => Date.parse(f.item.scheduledAt) + 5000 });
  t.after(() => second.close()); await second.tick();
  assert.equal(f.device.writes.length, 1); assert.equal(second.alarm(f.item.id).status, 'failed');
});
test('stale pending alarms are missed and unavailable devices get only 30 seconds grace', async t => {
  const f = await dueFixture(t); f.device.online = false; f.advance(10000); await f.service.tick();
  assert.equal(f.service.alarm(f.item.id).status, 'pending'); f.advance(30001); await f.service.tick();
  assert.equal(f.service.alarm(f.item.id).status, 'missed'); assert.equal(f.device.writes.length, 0);
});
test('native hold/different routine cancels the remaining ramp permanently', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick(); acceptOwn(f); await f.service.tick();
  assert.equal(f.service.alarm(f.item.id).status, 'ringing');
  f.device.report({ playing: 'none', paused: false, sound: f.device.shadow.state.reported.current.sound, color: { i: 0 } });
  f.advance(10000); await f.service.tick(); f.device.emit('unavailable'); await f.service.tick();
  assert.equal(f.service.alarm(f.item.id).status, 'dismissed'); assert.equal(f.device.writes.length, 1);
});
test('ramp steps are intensity-only and manual volume remains intact', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick(); acceptOwn(f); await f.service.tick();
  f.device.shadow.state.reported.current.sound.v = 1234; f.advance(5000); await f.service.tick();
  assert.deepEqual(Object.keys(f.device.writes[1].current), ['color']);
  assert.deepEqual(Object.keys(f.device.writes[1].current.color), ['i']); assert.equal(f.device.shadow.state.reported.current.sound.v, 1234);
});
test('manual RGB/intensity override cancels subsequent ramp writes', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick(); acceptOwn(f); await f.service.tick();
  const current = structuredClone(f.device.shadow.state.reported.current); current.color.i = 12345; f.device.report(current);
  f.advance(10000); await f.service.tick();
  assert.equal(f.device.writes.length, 1); assert.match(f.service.alarm(f.item.id).reason, /Manual light/);
});
test('native nightlight and disabled-color overrides cancel the alarm light ramp', async t => {
  for (const override of ['nightlight', 'color-id']) {
    const f = await dueFixture(t); f.advance(10000); await f.service.tick(); acceptOwn(f); await f.service.tick();
    if (override === 'nightlight') {
      f.device.shadow.state.reported.nightlightOn = true;
      f.device.emit('shadow', { state: { reported: { nightlightOn: true } } }, f.device.shadow);
    } else {
      const current = structuredClone(f.device.shadow.state.reported.current); current.color.id = 9998; f.device.report(current);
    }
    f.advance(10000); await f.service.tick();
    assert.equal(f.device.writes.length, 1); assert.equal(f.service.active.get(f.item.id).rampCancelled, true);
  }
});
test('cancel pending never sends and cancel active stops only its own audio', async t => {
  const f = await dueFixture(t); await f.service.cancelAlarm(f.item.id); f.advance(20000); await f.service.tick(); assert.equal(f.device.writes.length, 0);
  const next = f.service.createAlarm(alarm(Date.parse(f.item.scheduledAt) + 10000)).alarm;
  f.advance(10000); await f.service.tick();
  const ours = structuredClone(f.device.writes[0].current); f.device.shadow.state.desired.current = ours; f.device.report(ours);
  await f.service.cancelAlarm(next.id); assert.equal(f.device.writes.at(-1).current.playing, 'none');
});
test('cancel after manual favorite never overwrites that favorite', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick(); acceptOwn(f); await f.service.tick();
  f.device.report({ playing: 'routine', sound: { url: 'https://original.example.test/favorite.mp3', v: 10000 } });
  await f.service.cancelAlarm(f.item.id); assert.equal(f.device.writes.length, 1);
});

test('zero-second ramp sets ending brightness in the sole initial playback command', async t => {
  const f = await fixture(t, { now: () => 1792922400000 });
  let now = 1792922400000; f.service.now = () => now;
  const input = alarm(now); input.light.rampSeconds = 0; f.service.createAlarm(input);
  now += 10000; await f.service.tick(); acceptOwn(f); await f.service.tick(); now += 10000; await f.service.tick();
  assert.equal(f.device.writes[0].current.color.i, 65535); assert.equal(f.device.writes.length, 1);
});

test('cancelling an accepted but unreported start stops its own desired audio', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick();
  assert.equal(f.device.shadow.state.reported.current.playing, 'none');
  f.device.shadow.state.desired.current = structuredClone(f.device.writes[0].current);
  await f.service.cancelAlarm(f.item.id);
  assert.equal(f.service.alarm(f.item.id).status, 'cancelled'); assert.equal(f.device.writes.length, 2); assert.equal(f.device.writes[1].current.playing, 'none');
});
test('a desired manual departure wins even before the alarm start is reported', async t => {
  const f = await dueFixture(t); f.advance(10000); await f.service.tick();
  f.device.shadow.state.desired.current = { playing: 'routine', sound: { url: 'https://original.example.test/favorite.mp3' } };
  await f.service.cancelAlarm(f.item.id); assert.equal(f.device.writes.length, 1);
});

test('audio origin can differ from the browser cookie/CSRF origin', async t => {
  const f = await dueFixture(t); f.service.audioOrigin = 'http://192.0.2.10:3001';
  await f.service.play({ trackId: 'bach-allemanda', volume: 30 });
  assert.match(f.device.writes[0].current.sound.url, /^http:\/\/192\.0\.2\.10:3001\/audio\/[a-f\d]{64}\.mp3$/);
  assert.equal(f.service.origin, f.config.origin);
});
