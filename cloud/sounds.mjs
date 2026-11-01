import { createHash, randomUUID } from 'node:crypto';
import catalog from './catalog.json' with { type: 'json' };
import { activePlayback, fail, lightState, percentage, percentRaw, rawPercent, text } from './core.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const soundId = id => Number.isSafeInteger(id) && id > 0 && id !== 19998;
const raw = value => Number.isInteger(value) && value >= 0 && value <= 65535;

// Only provider audio references are captured. Never accept a URL from the browser,
// fetch media on the server, or capture one of our private upload capabilities.
export function soundReference(value) {
  if (!value || !soundId(value.id) || typeof value.url !== 'string' || value.url.length > 4096) return null;
  let url;
  try { url = new URL(value.url); } catch { return null; }
  if (url.protocol !== 'https:' || !['assets.ctfassets.net', 'downloads.ctfassets.net'].includes(url.hostname) ||
      url.port || url.username || url.password || !url.pathname.startsWith('/hlsdh3zwyrtx/')) return null;
  const until = value.until, duration = value.duration ?? 0;
  if (until !== 'indefinite' && until !== 'duration') return null;
  if (until === 'duration' && (!Number.isInteger(duration) || duration <= 0 || duration > 86400)) return null;
  return { id: value.id, url: url.href, until, duration: until === 'indefinite' ? 0 : duration };
}

export const builtinSounds = catalog.map(item => ({
  id: `hatch-sound-${item.id}`, title: item.title, kind: 'hatch-sound',
  source: 'Hatch · built-in sound', category: item.category, tags: ['Hatch', 'sleep', item.category], durationSeconds: 0,
  timing: 'Until stopped', removable: false, reference: soundReference({ ...item, until: 'indefinite' }),
}));

// The published restBaby mappings remain usable when the undocumented catalog is
// incomplete. Only matching model-specific IDs may update them from the API.
export function catalogSounds(items = []) {
  return builtinSounds.map(track => {
    const item = items.find(item => item?.id === track.reference.id && item.hidden !== true && item.tier === 'free');
    const reference = item && soundReference({ id: item.id, url: item.wavUrl || item.mp3Url, until: 'indefinite' });
    return { ...track, reference: reference ?? track.reference };
  });
}

export function normalizeFavorites(routines, previous = []) {
  if (!Array.isArray(routines) || routines.length > 500) fail('Hatch returned an unreadable favorites list. Try syncing again.', 502);
  const favorites = [];
  for (const routine of [...routines].sort((a, b) => (a?.displayOrder ?? 0) - (b?.displayOrder ?? 0))) {
    if (!routine || !(routine.button0 === true || routine.type === 'favorite') || routine.enabled === false ||
        !Number.isSafeInteger(routine.id) || routine.id <= 0 || !Array.isArray(routine.steps) || !routine.steps.length || routine.steps.length > 100) continue;
    if (favorites.some(f => f.routineId === routine.id)) continue;
    const steps = routine.steps.filter(step => step?.enabled !== false);
    if (!steps.length) continue;
    // Keep only playback fields for change detection, never device/account IDs.
    const signature = digest({ type: routine.type, followBySleepScene: routine.followBySleepScene, sleepScene: routine.sleepScene, sunriseAlarm: routine.sunriseAlarm,
      steps: steps.map(step => ({ sound: step.sound, color: step.color, type: step.type, mixId: step.mixId, dayOffset: step.dayOffset, respectColorUrl: step.respectColorUrl })) });
    const first = steps[0], audible = steps.some(step => soundId(step.sound?.id) && step.sound?.mute !== true && step.sound?.ignore !== true);
    const volume = raw(first.sound?.v) ? rawPercent(first.sound.v) : 0;
    const light = lightState({ current: { playing: 'routine', color: first.color } });
    const title = typeof routine.name === 'string' && routine.name.trim() ? routine.name.trim().slice(0, 180) : `Favorite ${favorites.length + 1}`;
    const forever = steps.some(step => step.sound?.until === 'indefinite');
    const duration = steps.every(step => step.sound?.until === 'duration' && Number.isFinite(step.sound.duration) && step.sound.duration > 0)
      ? steps.reduce((sum, step) => sum + step.sound.duration, 0) : 0;
    favorites.push({
      id: previous.find(item => item.routineId === routine.id)?.id ?? `hatch-favorite-${randomUUID()}`,
      kind: 'hatch-favorite', title, routineId: routine.id, signature, volume,
      ...(Number.isSafeInteger(first.color?.id) && first.color.id >= 0 ? { nativeLightId: first.color.id } : {}),
      light: { color: light.color, from: light.brightness, to: light.brightness, rampSeconds: 0 },
      source: 'Hatch · saved favorite', tags: ['Hatch', 'favorite'], durationSeconds: duration,
      timing: `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} · ${forever ? 'until stopped' : 'Hatch timing'}`,
      stepCount: steps.length, alarmEligible: audible, removable: false,
    });
  }
  return favorites;
}

export function publicSound(track) {
  return Object.fromEntries(['id', 'title', 'kind', 'category', 'source', 'tags', 'durationSeconds', 'timing', 'createdAt', 'stepCount', 'alarmEligible', 'removable', 'volume', 'light', 'nativeLightId']
    .filter(key => track[key] !== undefined).map(key => [key, track[key]]));
}

export function captureCandidate(current) {
  if (!activePlayback(current) || current.sound?.mute === true || current.sound?.ignore === true) return null;
  const reference = soundReference(current.sound);
  if (!reference) return null;
  return { reference, key: digest([current.playing, current.srId, current.step, reference]) };
}

export function savedSound(current, input, now) {
  const title = text(input.title, 'Title'), candidate = captureCandidate(current);
  if (!candidate) fail('Play a Hatch sound in the Hatch app, refresh this page, then save it here. This sound cannot be captured.', 409);
  if (typeof input.captureKey !== 'string' || input.captureKey !== candidate.key) fail('The sound changed while you were saving it. Refresh the room and try again.', 409);
  return {
    id: `saved-sound-${randomUUID()}`, title, kind: 'saved-sound', reference: candidate.reference,
    source: 'Saved from your Hatch', tags: ['Hatch', 'saved'], createdAt: new Date(now).toISOString(),
    durationSeconds: candidate.reference.duration,
    timing: candidate.reference.until === 'indefinite' ? 'Until stopped' : 'Saved timer', removable: true,
  };
}

export function nativePatch(track, volume) {
  if (track.kind === 'hatch-favorite') return { nightlightOn: false, current: { playing: 'routine', srId: track.routineId, step: 1, paused: false } };
  const reference = soundReference(track.reference);
  if (!reference) fail('This saved sound is unavailable. Play it in Hatch and save it again.', 409);
  return { current: { playing: 'remote', srId: 0, step: 0, paused: false, sound: {
    ...reference, mute: false, v: percentRaw(percentage(volume, 'Volume')),
  } } };
}

export function checkFavoriteStart(track, current) {
  // The bench observed that reselecting an active srId after remote overrides
  // retained the old settings. Require an explicit stop; never stop/restart in
  // the background, since a native dismissal must win over a deferred start.
  if (track.kind === 'hatch-favorite' && current?.playing !== 'none' && current?.srId === track.routineId)
    fail('Turn off your Hatch before starting this favorite again so its saved settings can take effect.', 409);
}
