import test from 'node:test';
import assert from 'node:assert/strict';
import { alarmInput } from '../core.mjs';
import { nextAlarmInstant } from '../alarm-schedule.mjs';
import { HatchService } from '../service.mjs';
import { Store } from '../store.mjs';
import { fixture, httpFixture, alarm } from './helpers.mjs';

const days = [0, 1, 2, 3, 4, 5, 6];
const recurring = now => ({ ...alarm(now), scheduledAt: undefined, localTime: '07:00', repeatDays: days, label: '' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('alarms accept an optional name and validate reusable schedule fields', () => {
  const now = Date.parse('2026-10-28T13:59:50Z');
  const input = recurring(now); delete input.label;
  const value = alarmInput(input, now);
  assert.equal(value.label, ''); assert.equal(value.enabled, true);
  assert.equal(value.scheduledAt, '2026-10-28T14:00:00.000Z');
  for (const patch of [{ localTime: '24:00' }, { localTime: '7:00' }, { repeatDays: [0, 0] }, { repeatDays: [7] }, { repeatDays: ['1'] }, { enabled: 'true' }]) assert.throws(() => alarmInput({ ...input, ...patch }, now));
});

test('weekly wall times follow DST, skip nonexistent dates and run a folded time once', () => {
  const schedule = { timeZone: 'America/Los_Angeles', localTime: '07:00', repeatDays: days };
  assert.equal(nextAlarmInstant(schedule, Date.parse('2027-03-13T00:00:00Z')), '2027-03-13T15:00:00.000Z');
  assert.equal(nextAlarmInstant(schedule, Date.parse('2027-03-13T15:00:00.001Z')), '2027-03-14T14:00:00.000Z');
  assert.equal(nextAlarmInstant({ ...schedule, localTime: '02:30', repeatDays: [0] }, Date.parse('2027-03-13T00:00:00Z')), '2027-03-21T09:30:00.000Z');
  const fold = { ...schedule, localTime: '01:30', repeatDays: [0] };
  assert.equal(nextAlarmInstant(fold, Date.parse('2026-10-31T00:00:00Z')), '2026-11-01T08:30:00.000Z');
  assert.equal(nextAlarmInstant(fold, Date.parse('2026-11-01T08:31:00Z')), '2026-11-08T09:30:00.000Z');
  assert.equal(nextAlarmInstant({ ...schedule, timeZone: 'Asia/Kathmandu' }, Date.parse('2026-10-28T00:00:00Z')), '2026-10-28T01:15:00.000Z');
});

test('a repeat durably advances before an ambiguous attempt and can run the following day', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(recurring(now)).alarm;
  f.device.onWrite = () => {
    const saved = f.service.alarm(item.id);
    assert.equal(saved.status, 'starting'); assert.equal(saved.nextScheduledAt, '2026-10-29T14:00:00.000Z');
    throw new Error('ambiguous');
  };
  now += 10000; await f.service.tick(); await f.service.tick();
  assert.equal(f.device.writes.length, 1); assert.equal(f.service.alarm(item.id).enabled, true);
  assert.equal(f.service.alarms().alarms[0].lastOccurrence.status, 'failed');
  f.device.onWrite = undefined; now = Date.parse('2026-10-29T14:00:00Z'); await f.service.tick();
  assert.equal(f.device.writes.length, 2);
  assert.notEqual(f.device.writes[0].current.sound.url, f.device.writes[1].current.sound.url);
});

test('tomorrow can replace the same repeating alarm still ringing from today', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(recurring(now)).alarm;
  now += 10000; await f.service.tick();
  const first = structuredClone(f.device.writes[0].current);
  f.device.shadow.state.desired.current = structuredClone(first); f.device.report(first); await f.service.tick();
  assert.equal(f.service.alarm(item.id).status, 'ringing');
  now = Date.parse('2026-10-29T14:00:00Z'); await f.service.tick();
  assert.equal(f.device.writes.length, 2); assert.equal(f.service.alarm(item.id).status, 'starting');
  assert.notEqual(f.device.writes[1].current.sound.url, first.sound.url);
  assert.equal(f.service.alarms().alarms[0].scheduledAt, '2026-10-30T14:00:00.000Z');
});

test('restart abandons a claimed repeat while retaining its next instant', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(recurring(now)).alarm;
  now += 10000; await f.service.tick(); f.service.close();
  const second = new HatchService({ store: f.store, device: f.device, origin: f.config.origin, dataDir: f.directory, now: () => now });
  t.after(() => second.close()); await second.tick();
  assert.equal(second.alarm(item.id).status, 'failed'); assert.equal(f.device.writes.length, 1);
  assert.equal(second.alarm(item.id).nextScheduledAt, '2026-10-29T14:00:00.000Z');
  now = Date.parse('2026-10-29T14:00:00Z'); await second.tick(); assert.equal(f.device.writes.length, 2);
});

test('overdue repeats skip all missed dates and retain the next future occurrence', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(recurring(now)).alarm;
  now = Date.parse('2026-11-02T18:00:00Z'); await f.service.tick();
  assert.equal(f.device.writes.length, 0); assert.equal(f.service.alarm(item.id).status, 'missed');
  assert.equal(f.service.alarm(item.id).nextScheduledAt, '2026-11-03T15:00:00.000Z');
});

test('a fired one-off remains saved and can be enabled for its next local time', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm({ ...recurring(now), repeatDays: [] }).alarm;
  now += 10000; await f.service.tick();
  assert.equal(f.service.alarm(item.id).enabled, false);
  const updated = f.service.updateAlarmSettings(item.id, { enabled: true }).alarm;
  assert.equal(updated.id, item.id); assert.equal(updated.scheduledAt, '2026-10-29T14:00:00.000Z');
  await f.service.tick(); assert.equal(f.device.writes.length, 1);
});

test('full-form name and light edits preserve an unchanged future one-off instant', async t => {
  const now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm({ ...alarm(now), scheduledAt: '2026-10-31T14:00:00.000Z' }).alarm;
  const updated = f.service.updateAlarmSettings(item.id, { label: 'Renamed', localTime: item.localTime, timeZone: item.timeZone, repeatDays: item.repeatDays, light: { ...item.light, to: 90 } }).alarm;
  assert.equal(updated.scheduledAt, item.scheduledAt); assert.equal(updated.label, 'Renamed'); assert.equal(updated.light.to, 90);
});

test('disabling future repeats abandons the ramp without stopping accepted sound', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(recurring(now)).alarm; now += 10000; await f.service.tick();
  const current = structuredClone(f.device.writes[0].current); f.device.report(current); await f.service.tick();
  f.service.updateAlarmSettings(item.id, { enabled: false });
  now += 86400000; await f.service.tick();
  assert.equal(f.device.writes.length, 1); assert.equal(f.device.shadow.state.reported.current.playing, 'remote');
  assert.equal(f.service.active.has(item.id), false); assert.equal(f.service.alarm(item.id).enabled, false);
});

test('HTTP disable, edit and delete immediately veto a start waiting in dispatch', async t => {
  for (const action of ['disable', 'edit', 'delete']) {
    let now = Date.parse('2026-10-28T13:59:50Z'); const f = await httpFixture(t, { now: () => now });
    const item = f.service.createAlarm(recurring(now)).alarm;
    const waiting = deferred(), release = deferred(), invalidated = deferred();
    const invalidate = f.service.invalidateAlarm.bind(f.service);
    f.service.invalidateAlarm = id => { const generation = invalidate(id); invalidated.resolve(); return generation; };
    const write = f.device.write.bind(f.device);
    f.device.write = async (...args) => { waiting.resolve(); await release.promise; return write(...args); };
    now += 10000; const tick = f.service.run(() => f.service.tick()); await waiting.promise;
    const mutation = f.call(`/v1/alarms/${item.id}`, action === 'delete' ? { method: 'DELETE' } : { method: 'PATCH', body: JSON.stringify(action === 'disable' ? { enabled: false } : { localTime: '08:00' }) });
    await invalidated.promise; release.resolve(); await tick;
    const response = await mutation; assert.equal(response.status, 200);
    assert.equal(f.device.writes.length, 0, action);
    if (action === 'delete') assert.equal(f.service.alarm(item.id), undefined);
    else assert.equal(f.service.alarm(item.id).enabled, action === 'edit');
  }
});

test('old occurrence capabilities remain tied to their source after edits and protect deletion', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const base = f.store.value.tracks[0];
  f.store.change(state => state.tracks.push({ ...base, id: 'upload-a', seeded: false, filename: 'source-a.mp3' }, { ...base, id: 'upload-b', seeded: false, filename: 'source-b.mp3' }));
  const item = f.service.createAlarm({ ...recurring(now), trackId: 'upload-a' }).alarm;
  now += 10000; await f.service.tick();
  const current = structuredClone(f.device.writes[0].current), token = current.sound.url.split('/').at(-1).slice(0, -4);
  f.device.report(current); f.device.shadow.state.desired.current = structuredClone(current);
  f.service.updateAlarmSettings(item.id, { trackId: 'upload-b' });
  assert.equal(f.service.audioFile(token), 'source-a.mp3');
  await assert.rejects(f.service.deleteTrack('upload-a'), /playing/);
  assert.equal((await f.service.state()).playback.trackId, 'upload-a');
});

test('historical capabilities are bounded and keep currently observed audio', async t => {
  const f = await fixture(t); const token = 'b'.repeat(64);
  f.store.change(state => { state.alarmMedia = [{ token, trackId: 'bach-allemanda' }, ...Array.from({ length: 1005 }, (_, i) => ({ token: String(i).padStart(64, '0'), trackId: 'bach-allemanda' }))]; });
  f.device.shadow.state.reported.current.sound.url = f.service.audioUrl(token);
  f.service.createAlarm(alarm());
  assert.ok(f.store.value.alarmMedia.length <= 1001);
  assert.ok(f.service.audioFile(token));
});

test('missing sources fail re-enable actionably and permit choosing a replacement', async t => {
  const f = await fixture(t);
  const item = f.service.createAlarm({ ...alarm(), enabled: false }).alarm;
  f.store.change(state => { state.tracks = []; });
  assert.equal(f.service.updateAlarmSettings(item.id, { enabled: false }).alarm.enabled, false);
  assert.throws(() => f.service.updateAlarmSettings(item.id, { enabled: true }), /Sound not found.*choose another sound/);
  const updated = f.service.updateAlarmSettings(item.id, { enabled: true, trackId: 'hatch-sound-10519' });
  assert.equal(updated.alarm.enabled, true);
});

test('explicit Stop dismisses current sound while keeping later repeats enabled', async t => {
  let now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(recurring(now)).alarm; now += 10000; await f.service.tick();
  f.device.report(f.device.writes[0].current); await f.service.tick();
  await f.service.stop();
  assert.equal(f.service.alarm(item.id).status, 'dismissed'); assert.equal(f.service.alarm(item.id).enabled, true);
  assert.equal(f.service.alarm(item.id).nextScheduledAt, '2026-10-29T14:00:00.000Z');
  assert.equal(f.device.writes.at(-1).current.playing, 'none');
});

test('HTTP reusable CRUD persists without leaking media capabilities', async t => {
  const now = Date.parse('2026-10-28T13:59:50Z'); const f = await httpFixture(t, { now: () => now });
  assert.equal((await fetch(f.base + '/v1/alarms/missing', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const created = await f.call('/api/hatch/alarms', { method: 'POST', body: JSON.stringify(recurring(now)) });
  assert.equal(created.status, 201); const item = (await created.json()).alarm;
  const updated = await f.call(`/api/hatch/alarms/${item.id}`, { method: 'PATCH', body: JSON.stringify({ label: 'Weekdays', repeatDays: [1, 2, 3, 4, 5], localTime: '08:00' }) });
  assert.equal(updated.status, 200); assert.equal((await updated.json()).alarm.label, 'Weekdays');
  const listing = await (await f.call('/v1/alarms')).json();
  assert.doesNotMatch(JSON.stringify(listing), /audioCapability|alarmMedia|favoriteSignature|soundReference/);
  assert.equal((await f.call(`/v1/alarms/${item.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await (await f.call('/v1/alarms')).json()).alarms, []);
});

test('version-one migration retains pending absolute instants and keeps past alarms disabled', async t => {
  const now = Date.parse('2026-10-28T13:59:50Z'); const f = await fixture(t, { now: () => now });
  const item = f.service.createAlarm(alarm(now)).alarm;
  f.service.close();
  f.store.change(state => { for (const key of ['enabled', 'repeatDays', 'localTime', 'nextScheduledAt']) delete state.alarms[0][key]; state.alarms.push({ ...state.alarms[0], id: 'past', status: 'dismissed' }); });
  f.store.close(); const reopened = await Store.open(f.directory);
  // The fixture's cleanup closes this replacement connection.
  f.store.db = reopened.db;
  assert.equal(reopened.value.alarms[0].nextScheduledAt, item.scheduledAt);
  assert.equal(reopened.value.alarms[0].enabled, true);
  assert.equal(reopened.value.alarms[1].enabled, false);
  assert.equal(reopened.value.alarms[0].localTime, '07:00');
});
