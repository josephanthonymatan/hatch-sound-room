import test from 'node:test';
import assert from 'node:assert/strict';
import { lightPatch, lightState, percentRaw } from '../core.mjs';
import { fixture } from './helpers.mjs';

test('known native dynamic effects remain visible with empty RGBW channels during playback', () => {
  for (const [id, name, color] of [[792, 'Aurora', '#050aff'], [888, 'Mangrove Orchid', '#c47691']]) {
    for (const playing of ['routine', 'remote']) {
      for (const channels of [{ r: 0, g: 0, b: 0, w: 0 }, { r: null, g: null, b: null, w: null }]) {
        assert.deepEqual(lightState({ current: { playing, color: { id, ...channels, i: percentRaw(45) } } }),
          { on: true, color, brightness: 45, effectId: id, effectName: name });
      }
    }
  }
});

test('native effect recognition preserves stopped, paused, zero-intensity and disabled light states', () => {
  const effect = { id: 792, r: 0, g: 0, b: 0, w: 0, i: percentRaw(45) };
  for (const current of [
    { playing: 'none', color: effect },
    { playing: 'routine', paused: true, color: effect },
    { playing: 'routine', color: { ...effect, i: 0 } },
    { playing: 'routine', color: { ...effect, i: null } },
    { playing: 'routine', color: { ...effect, id: 1234 } },
    ...[0, 9998].map(id => ({ playing: 'routine', color: { ...effect, id, r: 65535 } })),
  ]) {
    const light = lightState({ current });
    assert.equal(light.on, false); assert.equal(light.brightness, 0);
    assert.equal(light.effectId, undefined); assert.equal(light.effectName, undefined);
  }
});

test('reported color channels and an enabled nightlight take precedence over effect display colors', () => {
  const current = { playing: 'routine', color: { id: 792, r: 65535, g: 0, b: 0, w: 0, i: percentRaw(45) } };
  assert.deepEqual(lightState({ current }), { on: true, color: '#ff0000', brightness: 45, effectId: 792, effectName: 'Aurora' });
  assert.deepEqual(lightState({ current, nightlightOn: true, nightlightColor: { id: 0, r: 0, g: 65535, b: 0, w: 0 }, nightlightIntensity: percentRaw(65) }),
    { on: true, color: '#00ff00', brightness: 65 });
  assert.equal(lightState({ current, nightlightOn: true, nightlightColor: { id: 792, r: 0, g: 0, b: 0, w: 0 }, nightlightIntensity: percentRaw(65) }).on, false);
});

test('a stopped or paused Hatch uses its independent nightlight without resuming audio', () => {
  for (const current of [{ playing: 'none' }, { playing: 'remote', paused: true, sound: { id: 10543, v: 20000 } }]) {
    const patch = lightPatch({ color: '#ff8800', brightness: 65 }, { current });
    assert.equal(patch.current, undefined);
    assert.equal(patch.nightlightOn, true);
    assert.equal(patch.nightlightIntensity, percentRaw(65));
    assert.deepEqual(patch.nightlightColor, { id: 0, r: 65535, g: 34952, b: 0, w: 0 });
  }
});

test('brightness from black selects visible amber and preserves an existing white LED', () => {
  const off = { current: { playing: 'none', color: { id: 9998, r: 0, g: 0, b: 0, w: 0, i: 64000 } } };
  assert.equal(lightState(off).brightness, 0);
  assert.equal(lightPatch({ brightness: 97 }, off).nightlightColor.r, 65535);
  const white = { nightlightOn: true, nightlightColor: { id: 0, r: 0, g: 0, b: 0, w: 65535 }, nightlightIntensity: 30000 };
  assert.equal(lightState(white).color, '#ffffff');
  assert.deepEqual(lightPatch({ brightness: 80 }, white).nightlightColor, white.nightlightColor);
  assert.equal(lightPatch({ brightness: 0 }, white).nightlightOn, false);
  const offWhite = { ...white, nightlightOn: false, current: off.current };
  assert.deepEqual(lightPatch({ brightness: 80 }, offWhite).nightlightColor, white.nightlightColor);
});

test('color selection turns on at a visible level and active playback gets an enabled custom color', () => {
  const stopped = lightPatch({ color: '#405cff' }, { current: { playing: 'none' } });
  assert.equal(stopped.nightlightIntensity, percentRaw(65));
  const active = lightPatch({ color: '#405cff', brightness: 45 }, { current: { playing: 'routine', sound: { id: 10543, v: 20000 }, color: { id: 9998 } } });
  assert.equal(active.current.color.id, 9999);
  assert.equal(active.current.sound, undefined);
  assert.equal(active.current.paused, undefined);
  assert.equal(lightState({ current: { playing: 'remote', color: active.current.color } }).on, true);
  assert.throws(() => lightPatch({}));
});

test('state distinguishes silent remote lighting and a stopped-device nightlight from audio', async t => {
  const { device, service } = await fixture(t);
  device.shadow.state.reported.current = { playing: 'remote', paused: false, sound: { id: 19998, mute: true }, color: { id: 9999, r: 65535, g: 0, b: 0, w: 0, i: percentRaw(65) } };
  let state = await service.state();
  assert.equal(state.playback.active, false); assert.equal(state.light.on, true); assert.equal(state.light.brightness, 65);
  Object.assign(device.shadow.state.reported, { nightlightOn: true, nightlightColor: { id: 0, r: 65535, g: 34952, b: 0, w: 0 }, nightlightIntensity: percentRaw(45) });
  device.shadow.state.reported.current.playing = 'none';
  state = await service.state();
  assert.equal(state.playback.active, false); assert.equal(state.light.on, true); assert.equal(state.light.brightness, 45); assert.equal(state.light.color, '#ff8800');
});

test('playing music transfers an existing nightlight color to playback; stop turns both off', async t => {
  const { device, service } = await fixture(t);
  Object.assign(device.shadow.state.reported, { nightlightOn: true, nightlightColor: { id: 0, r: 65535, g: 34952, b: 0, w: 0 }, nightlightIntensity: percentRaw(65) });
  await service.play({ trackId: 'bach-allemanda', volume: 35 });
  const patch = device.writes.at(-1);
  assert.equal(patch.nightlightOn, false); assert.equal(patch.current.color.id, 9999); assert.equal(patch.current.color.i, percentRaw(65));
  assert.equal(patch.current.sound.mute, false);
  await service.stop();
  assert.equal(device.writes.at(-1).nightlightOn, false); assert.equal(device.writes.at(-1).current.playing, 'none');
});

test('light-off extinguishes both a nightlight and an underlying playback light without stopping audio', () => {
  const current = { playing: 'remote', paused: false, sound: { id: 10543 }, color: { id: 9999, r: 65535, g: 0, b: 0, w: 0, i: 30000 } };
  const reported = { current, nightlightOn: true, nightlightColor: { r: 0, g: 65535, b: 0, w: 0 }, nightlightIntensity: 30000 };
  const patch = lightPatch({ brightness: 0 }, reported);
  const after = { ...reported, ...patch, current: { ...current, ...patch.current, color: { ...current.color, ...patch.current.color } } };
  assert.equal(lightState(after).on, false);
  assert.deepEqual(after.current.sound, current.sound); assert.equal(after.current.playing, 'remote');
});
