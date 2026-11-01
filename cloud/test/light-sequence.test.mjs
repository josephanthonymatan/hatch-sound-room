import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HatchDevice } from '../device.mjs';
import { HatchService } from '../service.mjs';
import { percentRaw } from '../core.mjs';
import { sequenceFrame, validateRecipe } from '../light-sequence.mjs';
import { alarm, fixture, httpFixture } from './helpers.mjs';

const recipe = { version: 1, id: 'test-flow', title: 'Quiet colors', mood: 'Evening', brightness: 35, pace: 1, motion: 'flow', stops: [{ color: '#ff0000', seconds: 4 }, { color: '#0000ff', seconds: 4 }] };
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object') merge(target[key] ??= {}, value);
    else target[key] = value;
  }
  return target;
}
function acknowledge(device, patch, lanes = ['desired', 'reported']) {
  for (const lane of lanes) merge(device.shadow.state[lane], structuredClone(patch));
  device.emit('shadow', { state: Object.fromEntries(lanes.map(lane => [lane, patch])) }, device.shadow);
}

test('recipes enforce the studio bounds and drop provider IDs/unrecognized fields', () => {
  assert.deepEqual(validateRecipe({ ...recipe, nativeLightId: 792, sound: 'never' }), recipe);
  for (const bad of [null, [], { ...recipe, version: 2 }, { ...recipe, title: ' ' }, { ...recipe, mood: 'x'.repeat(281) },
    { ...recipe, id: 4 }, { ...recipe, motion: 'blink' }, { ...recipe, brightness: 0 }, { ...recipe, brightness: 101 }, { ...recipe, pace: .4 }, { ...recipe, pace: Infinity },
    { ...recipe, stops: [] }, { ...recipe, stops: Array(33).fill(recipe.stops[0]) }, { ...recipe, stops: [null, recipe.stops[0]] },
    ...['red', '#fff', '#ff000000'].map(color => ({ ...recipe, stops: [{ color, seconds: 1 }, recipe.stops[1]] })),
    ...[0, 61, '4', NaN].map(seconds => ({ ...recipe, stops: [{ color: '#ff0000', seconds }, recipe.stops[1]] }))]) assert.throws(() => validateRecipe(bad), error => error.status === 400);
});

test('cloud frames loop with pace, smooth flow, breathing, steady and black without audio fields', () => {
  const first = sequenceFrame(recipe, 0), middle = sequenceFrame(recipe, 2);
  assert.deepEqual(first, sequenceFrame(recipe, 8));
  assert.deepEqual(middle.nightlightColor, { id: 0, r: 32768, g: 0, b: 32768, w: 0 });
  assert.deepEqual(middle, sequenceFrame({ ...recipe, pace: 2 }, 4));
  assert.deepEqual(sequenceFrame({ ...recipe, motion: 'steady' }, 5), first);
  assert.equal(sequenceFrame({ ...recipe, motion: 'breathe' }, 0).nightlightIntensity, percentRaw(35 * .55));
  const black = sequenceFrame({ ...recipe, brightness: 1, motion: 'breathe', stops: recipe.stops.map(stop => ({ ...stop, color: '#000000' })) }, 0);
  assert.equal(black.nightlightOn, true); assert.ok(black.nightlightIntensity > 0);
  assert.deepEqual(Object.keys(black), ['nightlightOn', 'nightlightIntensity', 'nightlightColor']);
  const fast = { ...recipe, pace: .5, stops: recipe.stops.map(stop => ({ ...stop, seconds: 1 })) };
  assert.notDeepEqual(sequenceFrame(fast, 0), sequenceFrame(fast, 2));
  assert.equal(sequenceFrame(fast, 4).nightlightColor.b, 65535);
});

test('starting acceptance, reported acknowledgement, cadence and volume preserve native favorite audio', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now });
  f.device.shadow.state.reported.current = { playing: 'routine', paused: false, srId: 71, step: 0, sound: { id: 10543, url: 'https://example.test/private.mp3', v: 12345 }, color: { id: 792, i: 20000 } };
  const before = structuredClone(f.device.shadow.state.reported.current);
  const started = await f.service.startLightSequence(recipe);
  assert.equal(started.status, 'starting'); assert.equal((await f.service.state()).lightSequence.status, 'starting');
  assert.equal(f.device.writes[0].current, undefined);
  acknowledge(f.device, f.device.writes[0]);
  assert.equal(f.service.lightSequence.state().status, 'running');
  now += 1999; await f.service.tick(); assert.equal(f.device.writes.length, 1);
  f.device.shadow.state.reported.current.sound.v = 54321;
  now++; await f.service.tick(); assert.equal(f.device.writes.length, 2);
  assert.deepEqual({ ...f.device.shadow.state.reported.current, sound: { ...f.device.shadow.state.reported.current.sound, v: before.sound.v } }, before);
  assert.equal(f.device.writes[1].current, undefined);
  const previous = f.device.writes[0], expected = f.device.writes[1];
  acknowledge(f.device, previous); // previous reported frame while next is pending
  assert.equal(f.service.lightSequence.state().status, 'running');
  acknowledge(f.device, expected, ['desired']);
  assert.equal(f.service.lightSequence.state().status, 'running');
  acknowledge(f.device, expected, ['reported']);
  assert.equal(f.service.lightSequence.state().status, 'running');
  f.service.stopLightSequence(); now += 20000; await f.service.tick();
  assert.equal(f.device.writes.length, 2); assert.equal(f.service.lightSequence.state().status, 'stopped');
});

test('light-only hold, manual lighting, playback changes and reconnect permanently cancel the loop', async t => {
  for (const change of [
    device => acknowledge(device, { nightlightOn: false }),
    device => acknowledge(device, { nightlightIntensity: 1234 }, ['desired']),
    device => acknowledge(device, { current: { playing: 'routine', srId: 72 } }),
    device => { device.emit('unavailable'); device.online = false; },
    device => { device.client = {}; },
  ]) {
    let now = Date.now(); const f = await fixture(t, { now: () => now });
    f.device.onWrite = patch => acknowledge(f.device, patch);
    await f.service.startLightSequence(recipe); assert.equal(f.service.lightSequence.state().status, 'running');
    change(f.device); now += 3000; await f.service.tick();
    f.device.online = true; now += 3000; await f.service.tick();
    assert.equal(f.device.writes.length, 1); assert.ok(['stopped', 'failed'].includes(f.service.lightSequence.state().status));
  }
});

test('unreported frames, ambiguous writes and restart never resend or resume a sequence', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now });
  await f.service.startLightSequence(recipe);
  now += 2000; await f.service.tick(); assert.equal(f.device.writes.length, 1);
  now += 13000; await f.service.tick(); assert.equal(f.service.lightSequence.state().status, 'failed');
  f.device.onWrite = () => { throw new Error('unknown'); };
  await assert.rejects(f.service.startLightSequence(recipe));
  now += 10000; await f.service.tick(); assert.equal(f.device.writes.length, 2);
  const replacement = new HatchService({ store: f.store, device: f.device, origin: f.config.origin, dataDir: f.directory });
  t.after(() => replacement.close()); assert.equal(replacement.lightSequence.state(), null);
  await replacement.tick(); assert.equal(f.device.writes.length, 2);
});

test('a fresh read acquires delayed reported acknowledgement before the next frame is sent', async t => {
  let now = Date.now(); const f = await fixture(t, { now: () => now });
  await f.service.startLightSequence(recipe);
  const read = f.device.read.bind(f.device);
  f.device.read = async () => {
    // No foreign-change event arrived; the get response first reveals the frame.
    merge(f.device.shadow.state.reported, f.device.writes[0]);
    return read();
  };
  now += 2000; await f.service.tick();
  assert.equal(f.service.lightSequence.state().status, 'running'); assert.equal(f.device.writes.length, 2);
  now += 2000; await f.service.tick();
  assert.equal(f.device.writes.length, 2, 'the newly pending second frame is not resent');
});

test('app light-off, stop, play, due alarm and shutdown invalidate a running sequence', async t => {
  for (const action of ['light', 'stop', 'play', 'alarm', 'close']) {
    let now = Date.now(); const f = await fixture(t, { now: () => now });
    f.device.onWrite = patch => acknowledge(f.device, patch);
    await f.service.startLightSequence(recipe);
    if (action === 'light') await f.service.light({ brightness: 0 });
    if (action === 'stop') await f.service.stop();
    if (action === 'play') await f.service.play({ trackId: 'bach-allemanda', volume: 20 });
    if (action === 'alarm') { f.service.createAlarm(alarm(now)); now += 10000; await f.service.tick(); }
    if (action === 'close') f.service.close();
    assert.equal(f.service.lightSequence.state().status, 'stopped');
    const count = f.device.writes.length; now += 2000; await f.service.lightSequence.tick(); assert.equal(f.device.writes.length, count);
  }
});

test('sequence endpoints require auth, validate recipes, report status and freeze on DELETE', async t => {
  const f = await httpFixture(t);
  assert.equal((await fetch(f.base + '/api/hatch/light-sequence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(recipe) })).status, 401);
  assert.equal((await f.call('/api/hatch/light-sequence', { method: 'POST', body: '{}' })).status, 400);
  assert.equal(f.device.writes.length, 0);
  const response = await f.call('/api/hatch/light-sequence', { method: 'POST', body: JSON.stringify(recipe) });
  assert.equal(response.status, 200); assert.equal((await response.json()).lightSequence.status, 'starting');
  const stopped = await f.call('/api/hatch/light-sequence', { method: 'DELETE' });
  assert.equal(stopped.status, 200); assert.equal((await stopped.json()).lightSequence.status, 'stopped');
  assert.equal(f.device.writes.length, 1);
});

test('DELETE cancels starts during fresh reads and starts still waiting in the service queue', async t => {
  for (const phase of ['fresh', 'queue']) {
    const f = await httpFixture(t); let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    if (phase === 'fresh') {
      const read = f.device.read.bind(f.device);
      f.device.read = async () => { entered(); await blocked; return read(); };
    } else f.service.run(async () => { entered(); await blocked; });
    const originalPrepare = f.service.prepareLightSequence.bind(f.service);
    let prepared; const accepted = new Promise(resolve => { prepared = resolve; });
    f.service.prepareLightSequence = input => { const value = originalPrepare(input); prepared(); return value; };
    const starting = f.call('/api/hatch/light-sequence', { method: 'POST', body: JSON.stringify(recipe) });
    await waiting; await accepted;
    const originalStop = f.service.stopLightSequence.bind(f.service);
    let cancelled; const cancellation = new Promise(resolve => { cancelled = resolve; });
    f.service.stopLightSequence = () => { const value = originalStop(); cancelled(); return value; };
    const stopping = f.call('/api/hatch/light-sequence', { method: 'DELETE' });
    await cancellation; release();
    assert.equal((await starting).status, 409); assert.equal((await stopping).status, 200); assert.equal(f.device.writes.length, 0);
  }
});

// Production queue + operation implementation; only the MQTT transport is fake.
async function queuedSequence(t) {
  const f = await fixture(t); f.service.close(); let now = Date.now();
  const device = new HatchDevice({}), mqtt = new EventEmitter(), writes = [];
  let cloud = structuredClone(f.device.shadow), serial = 0, poll, mutate;
  const service = new HatchService({ store: f.store, device, origin: f.config.origin, dataDir: f.directory, now: () => now });
  t.after(() => service.close());
  Object.assign(device, { client: mqtt, device: { thingName: 'test-thing' }, online: true, lastReadAt: Date.now(), shadow: structuredClone(cloud) });
  mqtt.get = name => {
    const token = 'get-' + ++serial;
    if (mutate) {
      const change = mutate; mutate = null;
      queueMicrotask(() => {
        poll = device.read();
        mqtt.emit('status', name, 'accepted', token, structuredClone(cloud));
      });
      const ordinary = mqtt.get;
      mqtt.get = pollName => {
        mqtt.get = ordinary; const pollToken = 'poll-' + ++serial;
        setImmediate(() => {
          change(); device.shadow = structuredClone(cloud); device.emit('shadow', cloud, cloud);
          mqtt.emit('status', pollName, 'accepted', pollToken, structuredClone(cloud));
        });
        return pollToken;
      };
    } else queueMicrotask(() => mqtt.emit('status', name, 'accepted', token, structuredClone(cloud)));
    return token;
  };
  mqtt.update = (name, value) => {
    const patch = value.state.desired, token = 'update-' + ++serial; writes.push(structuredClone(patch));
    queueMicrotask(() => {
      for (const lane of ['desired', 'reported']) merge(cloud.state[lane], structuredClone(patch));
      device.shadow = structuredClone(cloud); device.emit('shadow', cloud, cloud);
      mqtt.emit('status', name, 'accepted', token, { version: serial });
    }); return token;
  };
  await service.startLightSequence(recipe); assert.equal(service.lightSequence.state().status, 'running');
  return { service, device, writes, race: async change => {
    now += 2000; mutate = () => change(cloud, service, device);
    await service.tick(); await poll;
  } };
}

test('native hold, desired favorite, manual lighting, explicit cancel and shutdown veto frames queued behind a poll', async t => {
  for (const change of [
    cloud => { cloud.state.reported.nightlightOn = false; },
    cloud => { cloud.state.desired.current = { playing: 'routine', srId: 92, step: 0 }; },
    cloud => { cloud.state.reported.nightlightIntensity = 4321; },
    (cloud, service) => { service.stopLightSequence(); },
    (cloud, service) => { service.close(); },
    (cloud, service, device) => { device.emit('unavailable'); },
  ]) {
    const f = await queuedSequence(t); await f.race(change);
    assert.equal(f.writes.length, 1, 'only the acknowledged first frame was sent');
    assert.ok(['stopped', 'failed'].includes(f.service.lightSequence.state().status));
  }
});

test('expanded imported palettes validate and loop through every color through the maximum', () => {
  for (const count of [8,32]) {
    const stops=Array.from({length:count},(_,i)=>({color:'#'+(i*5021).toString(16).padStart(6,'0'),seconds:6}));
    const expanded=validateRecipe({...recipe,stops});
    assert.equal(expanded.stops.length,count);
    for (let i=0;i<count;i++) {
      const frame=sequenceFrame(expanded,i*6).nightlightColor;
      assert.equal(frame.r,parseInt(stops[i].color.slice(1,3),16)*257);
      assert.equal(frame.g,parseInt(stops[i].color.slice(3,5),16)*257);
      assert.equal(frame.b,parseInt(stops[i].color.slice(5,7),16)*257);
    }
    assert.deepEqual(sequenceFrame(expanded,count*6),sequenceFrame(expanded,0));
  }
});
