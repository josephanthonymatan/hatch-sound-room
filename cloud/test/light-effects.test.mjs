import test from 'node:test';
import assert from 'node:assert/strict';
import { percentRaw } from '../core.mjs';
import { minimumStopSeconds, motionFrame, sequenceFrame, validateRecipe } from '../light-sequence.mjs';
// Node 24 strips the preview's TypeScript types, so both engines run side by side.
import { lightRecipes, motionFrame as previewMotion, validRecipe } from '../../web/src/components/light-recipes.ts';

const base = { version: 1, id: 'effects', title: 'Effects', mood: '', brightness: 50, pace: 1, motion: 'flow', stops: [{ color: '#ff0000', seconds: 10 }, { color: '#0000ff', seconds: 10 }] };
const withEffects = effects => ({ ...base, effects });
const peak = frame => Math.max(...frame.rgb);

test('effects validate, normalize and keep earlier recipes unchanged', () => {
  assert.deepEqual(validateRecipe(base), base);
  const full = { blend: 'spectrum', hold: .8, drift: 1, layer: 0, bloom: .5, bloomColor: '#FFD1E8', breath: { seconds: 8, depth: .8, inhale: .2, extra: 1 } };
  assert.deepEqual(validateRecipe({ ...withEffects(full), motion: 'breathe' }).effects, { ...full, bloomColor: '#ffd1e8', breath: { seconds: 8, depth: .8, inhale: .2 } });
  assert.deepEqual(validateRecipe(withEffects({ unknown: true })).effects, {});
  for (const effects of [null, [], 'vivid', { blend: 'hsl' }, { hold: .9 }, { drift: -.1 }, { layer: 2 }, { bloom: NaN }, { bloomColor: 'pink' },
    { breath: null }, { breath: { seconds: 7, depth: .5, inhale: .3 } }, { breath: { seconds: 10, depth: .9, inhale: .3 } }, { breath: { seconds: 10, depth: .5, inhale: .6 } }]) {
    assert.throws(() => validateRecipe(withEffects(effects)), error => error.status === 400, JSON.stringify(effects));
    assert.equal(validRecipe(withEffects(effects)), false, JSON.stringify(effects));
  }
  for (const recipe of lightRecipes) assert.deepEqual(validateRecipe(recipe), Object.fromEntries(Object.entries(recipe).filter(([key]) => key !== 'nativeLightId')));
});

test('the studio preview and cloud controller compute identical frames', () => {
  const variants = [base, withEffects({ blend: 'vivid', hold: .4 }), withEffects({ blend: 'spectrum', layer: 1 }), withEffects({ drift: 1, bloom: 1 }),
    { ...withEffects({ breath: { seconds: 9, depth: .6, inhale: .3 }, bloom: .8, bloomColor: '#ffffff' }), motion: 'breathe', pace: 1.7 },
    { ...withEffects({ blend: 'vivid', drift: .5 }), stops: [{ color: '#000000', seconds: 4 }, { color: '#ffffff', seconds: 4 }, { color: '#808080', seconds: 4 }] },
    ...lightRecipes];
  for (const recipe of variants) for (let t = 0; t < 400; t += .73) assert.deepEqual(previewMotion(recipe, t, minimumStopSeconds), motionFrame(recipe, t, minimumStopSeconds), `${recipe.id} at ${t}`);
});

test('vivid blending keeps transitions saturated; spectrum takes the long way round', () => {
  const rgb = motionFrame(base, 5, 4), vivid = motionFrame(withEffects({ blend: 'vivid' }), 5, 4), spectrum = motionFrame(withEffects({ blend: 'spectrum' }), 5, 4);
  assert.deepEqual(rgb.rgb, [32768, 0, 32768]);
  assert.ok(peak(vivid) > 1.4 * peak(rgb), `vivid ${vivid.rgb} vs rgb ${rgb.rgb}`);
  assert.ok(vivid.rgb[1] < 20000, 'red to blue stays in the purples');
  assert.ok(spectrum.rgb[1] > spectrum.rgb[0] && spectrum.rgb[1] > spectrum.rgb[2], `spectrum midpoint ${spectrum.rgb} passes through green`);
  for (const blend of ['vivid', 'spectrum']) {
    const ends = [0, 10].map(t => motionFrame(withEffects({ blend }), t, 4).rgb);
    assert.deepEqual(ends, [[65535, 0, 0], [0, 0, 65535]]);
  }
  const fromBlack = { ...withEffects({ blend: 'spectrum' }), stops: [{ color: '#000000', seconds: 10 }, { color: '#ff0000', seconds: 10 }] };
  const dusk = motionFrame(fromBlack, 5, 4).rgb;
  assert.ok(dusk[0] > dusk[1] && dusk[0] > dusk[2], `black takes red's hue, not a rainbow: ${dusk}`);
});

test('hold rests on each color before an eased transition', () => {
  const held = withEffects({ hold: .5 });
  for (const t of [0, 2, 4.9]) assert.deepEqual(motionFrame(held, t, 4).rgb, [65535, 0, 0]);
  assert.equal(motionFrame(held, 7.5, 4).blend, .5);
  for (const t of [10, 14]) assert.deepEqual(motionFrame(held, t, 4).rgb, [0, 0, 65535]);
});

test('rhythmic breathing has its own period, depth and a shorter in-breath', () => {
  const recipe = { ...withEffects({ breath: { seconds: 10, depth: .5, inhale: .3 } }), motion: 'breathe' };
  assert.equal(motionFrame(recipe, 0, 4).brightness, 25);
  assert.equal(motionFrame(recipe, 3, 4).brightness, 50, 'the peak arrives 30% into the breath');
  assert.equal(motionFrame(recipe, 10, 4).brightness, 25);
  assert.ok(Math.abs(motionFrame(recipe, 1.5, 4).brightness - 37.5) < 1e-9 && Math.abs(motionFrame(recipe, 6.5, 4).brightness - 37.5) < 1e-9);
  assert.equal(motionFrame({ ...recipe, pace: .5 }, 8, 4).brightness, 25, 'pace shortens the breath but never below 8 seconds');
  for (let t = 0; t < 60; t += .25) { const b = motionFrame(recipe, t, 4).brightness; assert.ok(b >= 25 - 1e-9 && b <= 50 + 1e-9); }
});

test('drift wanders within bounds without repeating each palette loop', () => {
  const recipe = withEffects({ drift: 1 });
  let differs = false, recolored = 0;
  for (let t = 0; t < 300; t += .5) {
    const frame = motionFrame(recipe, t, 4), plain = motionFrame(base, t, 4);
    assert.ok(frame.brightness >= 50 * .85 - 1e-9 && frame.brightness <= 50 * 1.15 + 1e-9);
    assert.ok(frame.rgb.every(c => Number.isInteger(c) && c >= 0 && c <= 65535));
    if (Math.abs(frame.brightness - motionFrame(recipe, t + 20, 4).brightness) > 1) differs = true;
    if (frame.rgb.join() !== plain.rgb.join()) recolored++;
  }
  assert.ok(differs, 'one 20-second loop later the light is not the same');
  assert.ok(recolored > 500, 'drift shifts hue and chroma as well as brightness');
});

test('blooms are rare, deterministic, capped and absent when off', () => {
  const recipe = withEffects({ bloom: 1, bloomColor: '#ffd1e8' }), brightness = t => motionFrame(recipe, t, 4).brightness;
  const samples = Array.from({ length: 600 }, (_, i) => brightness(i / 2));
  assert.ok(samples.some(b => b > 70), 'a light leak occurs within five minutes at full bloom');
  assert.ok(samples.filter(b => b > 52).length < samples.length * .7, 'most of the time is unflared');
  assert.ok(samples.every(b => b <= 100));
  assert.deepEqual(samples, Array.from({ length: 600 }, (_, i) => brightness(i / 2)));
  assert.ok(Array.from({ length: 600 }, (_, i) => motionFrame({ ...recipe, brightness: 100 }, i / 2, 4).brightness).every(b => b <= 100));
  for (let t = 0; t < 300; t += .5) assert.deepEqual(motionFrame(withEffects({ bloom: 0 }), t, 4), motionFrame(base, t, 4));
});

test('layering mixes a second, slower pass of the palette', () => {
  const layered = withEffects({ blend: 'vivid', layer: 1 });
  let changed = 0;
  for (let t = 0; t < 120; t += 1) if (motionFrame(layered, t, 4).rgb.join() !== motionFrame(withEffects({ blend: 'vivid' }), t, 4).rgb.join()) changed++;
  assert.ok(changed > 100);
});

test('effect frames are still nightlight-only patches at the device floor', () => {
  for (const recipe of lightRecipes) for (let t = 0; t < 200; t += 2) {
    const frame = sequenceFrame(recipe, t);
    assert.deepEqual(Object.keys(frame), ['nightlightOn', 'nightlightIntensity', 'nightlightColor']);
    assert.equal(frame.nightlightColor.w, 0);
    assert.ok(frame.nightlightIntensity > 0 && frame.nightlightIntensity <= percentRaw(100));
  }
});
