import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFormResult, isRoomState, mergeSyncedLibrary, RoomUpdates } from '../src/components/room-state.ts';

const alarm = (id, enabled = true) => ({ id, enabled, label: id, localTime: '07:00', repeatDays: [], trackId: 'rain', scheduledAt: '2030-01-01T07:00:00.000Z', timeZone: 'UTC', volume: 30, light: { color: '#ffffff', from: 0, to: 75, rampSeconds: 15 }, status: enabled ? 'pending' : 'cancelled', createdAt: '2026-01-01T00:00:00.000Z' });
const track = id => ({ id, title: id, kind: 'music', durationSeconds: 60, tags: [] });
const room = () => ({ ready: true, connected: true, device: { product: 'Preview', firmware: '', hardware: '' }, playback: { active: false, status: 'none', trackId: null, title: 'Stopped', volume: 20, brightness: 0, color: '#ffffff', updatedAt: '' }, light: { on: false, color: '#ffffff', brightness: 0 }, library: [track('rain')], scenes: [], alarms: [alarm('a'), alarm('b')] });

test('a delayed GET cannot undo an accepted alarm change or an uploaded track', () => {
  const updates = new RoomUpdates();
  const before = room();
  const oldRead = updates.read();
  const finishAlarm = updates.begin('alarms');
  const finishUpload = updates.begin('library');
  let current = applyFormResult(before, { alarm: alarm('a', false), track: track('new-upload') });
  finishAlarm(); finishUpload();
  current = updates.merge(current, structuredClone(before), oldRead);
  assert.equal(current.alarms[0].enabled, false);
  assert.equal(current.library.at(-1).id, 'new-upload');
  const fresh = { ...current, playback: { ...current.playback, volume: 35 } };
  current = updates.merge(current, fresh, updates.read());
  assert.equal(current.playback.volume, 35);
});

test('a GET started during a write stays excluded even if it arrives after acceptance', () => {
  const updates = new RoomUpdates();
  const before = room();
  const finish = updates.begin('alarms');
  const overlappingRead = updates.read();
  const accepted = applyFormResult(before, { alarm: alarm('a', false) });
  finish();
  const current = updates.merge(accepted, structuredClone(before), overlappingRead);
  assert.equal(current.alarms[0].enabled, false);
});

test('one rejected alarm request cannot roll back a different accepted alarm', () => {
  const updates = new RoomUpdates();
  let current = room();
  const finishA = updates.begin('alarms');
  const finishB = updates.begin('alarms');
  current = applyFormResult(current, { alarm: alarm('b', false) });
  finishB();
  // A rejects: there is no snapshot rollback, only removal of its UI intent.
  finishA();
  assert.equal(current.alarms[0].enabled, true);
  assert.equal(current.alarms[1].enabled, false);
});

test('pending device controls do not hide disconnects or block accepted alarm results', () => {
  const updates = new RoomUpdates();
  const before = room();
  const finish = updates.begin('device');
  const current = applyFormResult(before, { alarm: alarm('b', false) });
  const report = { ...room(), connected: false, ready: false, alarms: current.alarms, playback: { ...before.playback, active: true, volume: 90 } };
  const merged = updates.merge(current, report, updates.read());
  assert.equal(merged.connected, false);
  assert.equal(merged.ready, false);
  assert.equal(merged.playback.active, false);
  assert.equal(merged.playback.volume, 20);
  assert.equal(merged.alarms[1].enabled, false);
  finish();
});

test('device acceptance does not invent physical success; fresh reports settle it', () => {
  const updates = new RoomUpdates();
  const before = room();
  const staleRead = updates.read();
  const finish = updates.begin('device');
  finish();
  assert.equal(updates.merge(before, { ...before, playback: { ...before.playback, active: true } }, staleRead).playback.active, false);
  const actual = { ...before, playback: { ...before.playback, active: true, volume: 42 }, light: { ...before.light, on: true, brightness: 75 } };
  const settled = updates.merge(before, actual, updates.read());
  assert.equal(settled.playback.active, true);
  assert.equal(settled.playback.volume, 42);
  assert.equal(settled.light.on, true);
});

test('deleted alarms stay removed when an older GET arrives late', () => {
  const updates = new RoomUpdates();
  const before = room();
  const staleRead = updates.read();
  const finish = updates.begin('alarms');
  const current = applyFormResult(before, { deletedAlarmId: 'a' });
  finish();
  assert.deepEqual(updates.merge(current, before, staleRead).alarms.map(alarm => alarm.id), ['b']);
});

test('unchanged polls preserve collection references and the entire room object', () => {
  const updates = new RoomUpdates();
  const current = room();
  assert.equal(updates.merge(current, structuredClone(current), updates.read()), current);
  const next = updates.merge(current, { ...structuredClone(current), playback: { ...current.playback, updatedAt: '2030-01-01T00:00:00Z' } }, updates.read());
  assert.equal(next.library, current.library);
  assert.equal(next.scenes, current.scenes);
  assert.equal(next.alarms, current.alarms);
  assert.notEqual(next.playback, current.playback);
});

test('bootstrap and polling reject incomplete room payloads', () => {
  assert.equal(isRoomState(room()), true);
  for (const value of [null, {}, { ...room(), library: null }, { ...room(), playback: {} }, { ...room(), light: null }, { ...room(), device: null }]) assert.equal(isRoomState(value), false);
});

test('a delayed Hatch sync preserves newly accepted uploads and saved categories', () => {
  const current = [track('new-upload'), { ...track('saved'), kind: 'saved-sound', category: 'New category' }, { ...track('old-favorite'), kind: 'hatch-favorite' }];
  const synced = [{ ...track('saved'), kind: 'saved-sound', category: 'Old category' }, { ...track('new-favorite'), kind: 'hatch-favorite' }, { ...track('builtin'), kind: 'hatch-sound' }];
  const merged = mergeSyncedLibrary(current, synced);
  assert.deepEqual(merged.map(track => track.id), ['new-upload', 'new-favorite', 'saved', 'builtin']);
  assert.equal(merged.find(track => track.id === 'saved').category, 'New category');
});
