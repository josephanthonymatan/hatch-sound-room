import { color, fail, percentRaw, text } from './core.mjs';

export const sequenceCadence = 2000;
export const minimumStopSeconds = sequenceCadence * 2 / 1000;
const acknowledgementTimeout = 15000;
const paths = ['current.playing', 'current.paused', 'current.srId', 'current.step',
  'current.sound.id', 'current.sound.url', 'current.sound.mute',
  ...['id', 'r', 'g', 'b', 'w', 'i', 'until', 'duration'].map(key => `current.color.${key}`),
  'nightlightOn', 'nightlightIntensity', ...['id', 'r', 'g', 'b', 'w'].map(key => `nightlightColor.${key}`)];
const at = (value, path) => path.split('.').reduce((item, key) => item?.[key], value);
const snapshot = state => Object.fromEntries(paths.map(path => [path, at(state, path)]));
// Missing desired fields carry no competing intent. Each defined field may be
// the preceding or expected frame while independent shadow acknowledgements land.
const compatible = (state, allowed) => paths.every(path => at(state, path) === undefined || allowed.some(frame => frame[path] === at(state, path)));
const acknowledges = (state, patch) => state?.nightlightOn === true && state.nightlightIntensity === patch.nightlightIntensity
  && Object.entries(patch.nightlightColor).every(([key, value]) => state.nightlightColor?.[key] === value);

export function validateRecipe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) fail('Choose a version 1 light recipe.');
  if (typeof input.id !== 'string' || input.id.length > 100) fail('Recipe ID must be text of at most 100 characters.');
  const title = text(input.title, 'Recipe title', 80), mood = text(input.mood, 'Recipe mood', 280, false);
  if (!['flow', 'breathe', 'steady'].includes(input.motion)) fail('Recipe motion must be flow, breathe, or steady.');
  const bounded = (value, min, max, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name} must be a number from ${min} to ${max}.`);
    return value;
  };
  if (!Array.isArray(input.stops) || input.stops.length < 2 || input.stops.length > 32) fail('A recipe needs 2 to 32 color stops.');
  const stops = input.stops.map(stop => {
    if (!stop || typeof stop !== 'object') fail('Each recipe stop needs a color and duration.');
    return { color: color(stop.color), seconds: bounded(stop.seconds, 1, 60, 'Stop duration') };
  });
  const recipe = { version: 1, id: input.id, title, mood, motion: input.motion,
    brightness: bounded(input.brightness, 1, 100, 'Recipe brightness'), pace: bounded(input.pace, .5, 2, 'Recipe pace'), stops };
  if (input.effects === undefined) return recipe;
  const fx = input.effects;
  if (!fx || typeof fx !== 'object' || Array.isArray(fx)) fail('Recipe effects must be an object.');
  const effects = {};
  if (fx.blend !== undefined) {
    if (!blends.includes(fx.blend)) fail('Effect blend must be rgb, vivid, or spectrum.');
    effects.blend = fx.blend;
  }
  if (fx.hold !== undefined) effects.hold = bounded(fx.hold, 0, .8, 'Effect hold');
  for (const key of ['drift', 'layer', 'bloom']) if (fx[key] !== undefined) effects[key] = bounded(fx[key], 0, 1, `Effect ${key}`);
  if (fx.bloomColor !== undefined) effects.bloomColor = color(fx.bloomColor);
  if (fx.breath !== undefined) {
    if (!fx.breath || typeof fx.breath !== 'object') fail('Effect breath needs seconds, depth and inhale.');
    effects.breath = { seconds: bounded(fx.breath.seconds, 8, 30, 'Breath length'), depth: bounded(fx.breath.depth, .1, .8, 'Breath depth'),
      inhale: bounded(fx.breath.inhale, .2, .5, 'Breath inhale') };
  }
  return { ...recipe, effects };
}

// Optional effects. Without them, a recipe keeps the original RGB flow and
// per-color breathing exactly. web/src/components/light-recipes.ts mirrors
// this math; test/light-sequence.test.mjs checks both produce identical frames.
export const blends = ['rgb', 'vivid', 'spectrum'];
const smooth = p => p * p * (3 - 2 * p);
const wave = (t, terms) => terms.reduce((sum, [weight, period, phase]) => sum + weight * Math.sin(2 * Math.PI * t / period + phase), 0);
const linear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const encode = c => c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055;
// Channels are 0–65535 so the plain RGB path matches earlier integer frames.
function oklch(channels) {
  const [r, g, b] = channels.map(c => linear(c / 65535));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b),
    s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, bb = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)];
}
function linearFromLch(L, C, h) {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
}
// Out-of-gamut colors keep lightness and hue and lose chroma, rather than clipping toward a different hue.
function fromLch([L, C, h]) {
  L = Math.min(1, Math.max(0, L));
  const fits = chroma => linearFromLch(L, chroma, h).every(c => c >= -1e-4 && c <= 1 + 1e-4);
  let low = 0, high = Math.max(0, C);
  if (!fits(high)) for (let step = 0; step < 16; step++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
  else low = high;
  return linearFromLch(L, low, h).map(c => encode(Math.min(1, Math.max(0, c))) * 65535);
}
function mix(from, to, amount, blend) {
  if (blend === 'rgb') return from.map((c, i) => c + (to[i] - c) * amount);
  const [L1, C1, h1] = oklch(from), [L2, C2, h2] = oklch(to);
  // A gray, black or white stop takes its partner's hue so it cannot swing through unrelated colors.
  const start = C1 < .02 ? h2 : h1, end = C2 < .02 ? h1 : h2;
  let turn = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  if (blend === 'spectrum' && C1 >= .02 && C2 >= .02 && turn !== 0) turn -= Math.sign(turn) * 2 * Math.PI;
  return fromLch([L1 + (L2 - L1) * amount, C1 + (C2 - C1) * amount, start + turn * amount]);
}
function seedOf(id) { let h = 2166136261; for (const char of id) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return h; }
function random(seed, n) {
  let x = Math.imul(seed ^ Math.imul(n, 0x9e3779b1), 0x45d9f3b); x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const bloomWindow = 12;
// Rare light leaks: up to one per 12-second window, a fast rise and a few seconds of decay.
function bloomAt(recipe, elapsed) {
  const chance = recipe.effects.bloom * .5, seed = seedOf(recipe.id), current = Math.floor(elapsed / bloomWindow);
  let envelope = 0;
  for (const window of [current - 1, current]) {
    if (window < 0 || random(seed, window * 2) >= chance) continue;
    const age = elapsed - (window + .7 * random(seed, window * 2 + 1)) * bloomWindow;
    if (age >= 0 && age < 9) envelope = Math.max(envelope, age < 1 ? smooth(age) : Math.exp(-(age - 1) / 2.5));
  }
  return envelope;
}

// Shared by the cloud controller and the studio preview. minimumSeconds is the
// per-color floor: the device needs at least two cloud samples per color.
export function motionFrame(recipe, elapsedSeconds, minimumSeconds) {
  const fx = recipe.effects ?? {}, blend = fx.blend ?? 'rgb', hold = fx.hold ?? 0, steady = recipe.motion === 'steady';
  const durations = recipe.stops.map(stop => Math.max(minimumSeconds, stop.seconds * recipe.pace));
  const total = durations.reduce((sum, seconds) => sum + seconds, 0);
  const channels = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) * 257);
  const at = position => {
    let index = 0;
    while (index < durations.length - 1 && position >= durations[index]) { position -= durations[index]; index++; }
    const progress = position / durations[index], next = (index + 1) % recipe.stops.length;
    const amount = progress < hold ? 0 : smooth((progress - hold) / (1 - hold));
    return { index, next, progress, amount, color: mix(channels(recipe.stops[index].color), channels(recipe.stops[next].color), amount, blend) };
  };
  const elapsed = Math.max(0, elapsedSeconds);
  if (steady) return { index: 0, next: 0, blend: 0, rgb: channels(recipe.stops[0].color).map(Math.round), brightness: recipe.brightness };
  const frame = at(elapsed % total);
  let color = frame.color, brightness = recipe.brightness;
  // The layer replays the palette backwards at a golden-ratio period, so the two never line up into a short loop.
  if (fx.layer) color = mix(color, at((total - (elapsed / 1.618034 + total / 2) % total) % total).color, fx.layer * .5, blend === 'rgb' ? 'rgb' : 'vivid');
  if (recipe.motion === 'breathe') {
    if (fx.breath) {
      const period = Math.max(8, fx.breath.seconds * recipe.pace), phase = elapsed % period / period, inhale = fx.breath.inhale;
      const rise = phase < inhale ? smooth(phase / inhale) : 1 - smooth((phase - inhale) / (1 - inhale));
      brightness *= 1 - fx.breath.depth + fx.breath.depth * rise;
    } else brightness *= .55 + .45 * (1 - Math.cos(frame.progress * Math.PI * 2)) / 2;
  }
  const bloom = fx.bloom ? bloomAt(recipe, elapsed) : 0;
  if (fx.drift || bloom) {
    let [L, C, h] = oklch(color);
    if (fx.drift) {
      h += fx.drift * .14 * wave(elapsed, [[.5, 23, .7], [.3, 41, 2.6], [.2, 61, 1.9]]);
      C *= 1 + fx.drift * .12 * wave(elapsed, [[.6, 31, .2], [.4, 53, 1.1]]);
      brightness *= 1 + fx.drift * .15 * wave(elapsed, [[.5, 17, 1.3], [.3, 29, .4], [.2, 47, 2.1]]);
    }
    color = fromLch([L, C, h]);
    if (bloom) {
      const tint = fx.bloomColor ? channels(fx.bloomColor) : fromLch([.93, C * .5, h]);
      color = mix(color, tint, .6 * bloom, 'vivid');
      brightness *= 1 + .7 * bloom;
    }
  }
  return { index: frame.index, next: frame.next, blend: frame.amount, rgb: color.map(c => Math.round(Math.min(65535, Math.max(0, c)))), brightness: Math.min(100, brightness) };
}

// Matches the studio's preview interpretation, sampled at a bounded cloud cadence.
// This is not a firmware animation payload or a claim of frame-perfect timing.
export function sequenceFrame(recipe, elapsedSeconds) {
  const { rgb: [r, g, b], brightness } = motionFrame(recipe, elapsedSeconds, minimumStopSeconds);
  // Always use the independent nightlight, including during favorites. The
  // ordinary active-audio lightPatch sets playing=remote; frames must not do so.
  return { nightlightOn: true, nightlightIntensity: percentRaw(brightness), nightlightColor: { id: 0, r, g, b, w: 0 } };
}

export class LightSequence {
  constructor({ device, fresh, now }) { Object.assign(this, { device, fresh, now }); this.runtime = null; this.value = null; this.generation = 0; }
  state() { return this.value && { ...this.value }; }
  cancel(reason, status = 'stopped') {
    this.generation++;
    this.runtime = null;
    if (this.value && ['starting', 'running'].includes(this.value.status)) this.value = { ...this.value, status, reason };
    return this.state();
  }
  reserve() { this.cancel('Replaced by another light sequence.'); return this.generation; }
  owns(runtime) { return this.runtime === runtime && runtime.ticket === this.generation && this.device.client === runtime.connection; }
  observe(update, full) {
    const runtime = this.runtime;
    if (!runtime) return;
    if (!this.owns(runtime) || full.state?.reported?.connected !== true) {
      this.cancel('Hatch disconnected; the sequence will not resume automatically.', 'failed'); return;
    }
    for (const lane of ['reported', 'desired']) {
      if (!compatible(full.state?.[lane], runtime.allowed[lane])) {
        this.cancel('Device playback or lighting changed; the sequence stopped.'); return;
      }
      if (runtime.expected && acknowledges(full.state?.[lane], runtime.expected.patch)) {
        // Once acknowledged, the old off/baseline frame no longer grants
        // ownership. In particular, a hold from light-only playback must win.
        runtime.allowed[lane] = [runtime.expected[lane]];
        if (lane === 'reported') { runtime.awaitingReport = false; this.value = { ...this.value, status: 'running' }; }
      }
    }
  }
  async start(recipe, shadow, ticket) {
    if (ticket !== this.generation) fail('This sequence request was cancelled before it started.', 409);
    const runtime = { recipe, ticket, startedAt: this.now(), connection: this.device.client,
      allowed: Object.fromEntries(['reported', 'desired'].map(lane => [lane, [snapshot(shadow.state?.[lane])]])) };
    this.runtime = runtime;
    this.value = { id: recipe.id, title: recipe.title, status: 'starting', startedAt: new Date(runtime.startedAt).toISOString(), cadenceSeconds: sequenceCadence / 1000 };
    try {
      if (!await this.dispatch(runtime)) fail('Hatch controls changed before the sequence started. Refresh and start it explicitly.', 409);
    } catch (error) {
      if (this.runtime === runtime) this.cancel('Sequence start failed or its result is unknown; no retry.', 'failed');
      throw error;
    }
    return this.state();
  }
  async dispatch(runtime) {
    const patch = sequenceFrame(runtime.recipe, (this.now() - runtime.startedAt) / 1000);
    const result = await this.device.write(patch, { guard: latest => {
      if (!this.owns(runtime) || !['reported', 'desired'].every(lane => compatible(latest.state?.[lane], runtime.allowed[lane]))) return false;
      runtime.expected = { patch };
      for (const lane of ['reported', 'desired']) {
        const projected = snapshot({ ...latest.state?.[lane], ...patch });
        runtime.expected[lane] = projected;
        runtime.allowed[lane] = [snapshot(latest.state?.[lane]), projected];
      }
      runtime.lastDispatchAt = this.now(); runtime.nextAt = this.now() + sequenceCadence; runtime.nextReadAt = runtime.nextAt; runtime.awaitingReport = true;
      // The production device evaluates this synchronously immediately before MQTT.
      return true;
    } });
    if (result?.skipped) { if (this.runtime === runtime) this.cancel('Hatch controls changed before the next frame; no command sent.'); return false; }
    return true;
  }
  async tick() {
    const runtime = this.runtime;
    if (!runtime) return;
    if (!this.owns(runtime)) { this.cancel('Hatch connection changed; the sequence will not resume automatically.', 'failed'); return; }
    if (runtime.awaitingReport) {
      if (this.now() - runtime.lastDispatchAt >= acknowledgementTimeout) { this.cancel('The last light frame was not reported within 15 seconds; no further writes or retries.', 'failed'); return; }
      if (this.now() < runtime.nextReadAt) return;
      runtime.nextReadAt = this.now() + sequenceCadence;
    }
    if (this.now() < runtime.nextAt) return;
    try {
      await this.fresh();
      if (this.owns(runtime) && !runtime.awaitingReport) await this.dispatch(runtime);
    } catch { if (this.runtime === runtime) this.cancel('Light sequence interrupted or its result is unknown; no further writes or retries.', 'failed'); }
  }
}
