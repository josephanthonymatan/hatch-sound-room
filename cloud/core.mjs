import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { alarmLocalTime, nextAlarmInstant } from './alarm-schedule.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (message, status = 400) => { throw new HttpError(status, message); };
export const percentRaw = value => Math.ceil(value / 100 * 65535);
export const rawPercent = value => Number.isFinite(value) ? Math.round(value / 65535 * 100) : 0;
export function percentage(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) fail(`${name} must be a number from 0 to 100.`);
  return value;
}
export function text(value, name, max = 180, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(`${name} must be ${required ? 'nonempty ' : ''}text of at most ${max} characters.`);
  return value.trim();
}
export function color(value) {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) fail('Color must use #RRGGBB.');
  return value.toLowerCase();
}
export function rgb(value) {
  const [r, g, b] = color(value).slice(1).match(/../g).map(part => parseInt(part, 16) * 257);
  return { r, g, b, w: 0 };
}
export function validateLight(value) {
  if (value.color === undefined && value.brightness === undefined) fail('Choose a color or brightness.');
  if (value.color !== undefined) color(value.color);
  if (value.brightness !== undefined) percentage(value.brightness, 'Brightness');
}
export const activePlayback = current => ['routine', 'remote'].includes(current?.playing) && current.paused !== true;
export const lightChannels = reported => reported.nightlightOn === true
  ? { ...reported.nightlightColor, i: reported.nightlightIntensity }
  : reported.current?.color ?? {};
const hasLight = c => ['r', 'g', 'b', 'w'].some(key => c?.[key] > 0);
// Known native effects may report zero/null RGBW while the device runs its series.
// These swatches represent the effects; they do not describe the current frame.
const nativeLightEffects = new Map([
  [792, { name: 'Aurora', color: '#050aff' }],
  [888, { name: 'Mangrove Orchid', color: '#c47691' }],
]);
export function lightState(reported) {
  const channels = lightChannels(reported), nightlight = reported.nightlightOn === true;
  const effect = !nightlight && nativeLightEffects.get(channels.id);
  const on = (nightlight || activePlayback(reported.current) && ![0, 9998].includes(channels.id)) && (hasLight(channels) || Boolean(effect)) && channels.i > 0;
  // RGB is a display approximation when the device uses its separate white LED.
  const hex = '#' + ['r', 'g', 'b'].map(key => Math.max(0, Math.min(255, Math.round(((channels[key] ?? 0) + (channels.w ?? 0)) / 257))).toString(16).padStart(2, '0')).join('');
  return { on, color: on && effect && !hasLight(channels) ? effect.color : hex, brightness: on ? rawPercent(channels.i) : 0,
    ...(on && effect ? { effectId: channels.id, effectName: effect.name } : {}) };
}
export function lightPatch(value, reported = {}) {
  validateLight(value);
  const current = reported.current ?? {};
  const effective = lightChannels(reported);
  const existing = hasLight(effective) ? effective : reported.nightlightColor ?? effective;
  const channels = value.color !== undefined ? rgb(value.color) : hasLight(existing)
    ? Object.fromEntries(['r', 'g', 'b', 'w'].map(key => [key, existing[key] ?? 0])) : rgb('#ff8800');
  const intensity = percentRaw(value.brightness ?? (lightState(reported).brightness || 65));
  if (intensity === 0 || !hasLight(channels)) return {
    nightlightOn: false, nightlightIntensity: 0,
    current: { color: { i: 0 } },
  };
  // The dedicated nightlight can wake independently without resuming paused audio.
  if (reported.nightlightOn === true || !activePlayback(current)) return {
    nightlightOn: true, nightlightIntensity: intensity,
    nightlightColor: { id: 0, ...channels },
  };
  // 9999 explicitly enables custom RGB; a retained 9998/0 leaves the LEDs dark.
  return { current: { playing: 'remote', color: { id: 9999, ...channels, i: intensity, until: 'indefinite', duration: 0 } } };
}
export const stopPatch = () => ({ nightlightOn: false, current: { playing: 'none', step: 0, srId: 0, paused: false } });
export function playPatch(url, volume) {
  return { current: { playing: 'remote', step: 0, paused: false, sound: {
    id: 10543, url, v: percentRaw(percentage(volume, 'Volume')), mute: false, until: 'indefinite', duration: 0,
  } } };
}
export function authorized(header, token) {
  const digest = value => createHash('sha256').update(value).digest();
  return typeof header === 'string' && timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}
export const capability = () => randomBytes(32).toString('hex');
export const scenes = Object.freeze([
  { id: 'amber', title: 'Amber', color: '#ff8800', brightness: 65, description: 'Warm amber light.' },
  { id: 'blue-hour', title: 'Blue hour', color: '#405cff', brightness: 45, description: 'Deep blue light.' },
  { id: 'rose', title: 'Rose', color: '#ff4080', brightness: 50, description: 'Soft rose light.' },
]);
export function alarmInput(input, now = Date.now()) {
  const label = text(input.label ?? '', 'Label', 180, false);
  const trackId = text(input.trackId, 'Track ID', 100);
  const timeZone = text(input.timeZone, 'Time zone', 100);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { fail('timeZone must be a valid IANA time zone.'); }
  const repeatDays = input.repeatDays ?? [];
  if (!Array.isArray(repeatDays) || repeatDays.length > 7 || repeatDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(repeatDays).size !== repeatDays.length) fail('repeatDays must contain distinct weekdays from 0 (Sunday) to 6 (Saturday).');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail('enabled must be a boolean.');
  if (input.localTime !== undefined && (typeof input.localTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime))) fail('localTime must use HH:MM in 24-hour time.');
  let due;
  if (input.scheduledAt !== undefined) {
    if (typeof input.scheduledAt !== 'string') fail('scheduledAt must be an ISO instant with an explicit UTC offset.');
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(input.scheduledAt);
    if (!parts) fail('scheduledAt must include seconds and an explicit UTC offset.');
    const [, y, m, d, h, min, sec, , , oh = '0', om = '0'] = parts;
    const lastDay = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
    if (+m < 1 || +m > 12 || +d < 1 || +d > lastDay || +h > 23 || +min > 59 || +sec > 59 || +oh > 23 || +om > 59) fail('scheduledAt contains an invalid calendar date or time.');
    due = Date.parse(input.scheduledAt);
    if (!Number.isFinite(due) || due - now < 5000 || due - now > 366 * 86400000) fail('Schedule the alarm between 5 seconds and 366 days in the future.');
  }
  const localTime = input.localTime ?? (due === undefined ? fail('Choose a localTime or scheduledAt.') : alarmLocalTime(due, timeZone));
  if (input.localTime !== undefined || repeatDays.length) due = Date.parse(nextAlarmInstant({ localTime, timeZone, repeatDays }, now + 5000));
  if (!input.light || typeof input.light !== 'object') fail('A light ramp is required.');
  const light = { color: color(input.light.color), from: percentage(input.light.from, 'Starting brightness'), to: percentage(input.light.to, 'Ending brightness'), rampSeconds: input.light.rampSeconds };
  if (light.to < light.from) fail('Ending brightness must be at least starting brightness.');
  if (!Number.isInteger(light.rampSeconds) || light.rampSeconds < 0 || light.rampSeconds > 1800) fail('Ramp duration must be an integer from 0 to 1800 seconds.');
  return { label, trackId, scheduledAt: new Date(due).toISOString(), localTime, timeZone, repeatDays: [...repeatDays].sort(), enabled: input.enabled ?? true, volume: percentage(input.volume, 'Volume'), light };
}
export function readConfig(env = process.env) {
  for (const key of ['HATCH_EMAIL', 'HATCH_PASSWORD', 'API_TOKEN', 'PUBLIC_ORIGIN', 'DATA_DIR']) if (!env[key]) throw new Error(`${key} is required.`);
  if (env.API_TOKEN.length < 32) throw new Error('API_TOKEN must contain at least 32 random characters.');
  const cleanOrigin = (value, name) => {
    let origin;
    try { origin = new URL(value); } catch { throw new Error(`${name} must be a valid HTTP(S) origin.`); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error(`${name} must be an HTTP(S) origin without credentials, path, or query.`);
    return origin.origin;
  };
  if (env.SESSION_SECRET !== undefined && env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 random characters.');
  const origin = cleanOrigin(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN');
  const audioOrigin = cleanOrigin(env.AUDIO_ORIGIN ?? env.PUBLIC_ORIGIN, 'AUDIO_ORIGIN');
  const ownerName = text(env.OWNER_NAME ?? 'Owner', 'OWNER_NAME', 80);
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535.');
  return { email: env.HATCH_EMAIL, password: env.HATCH_PASSWORD, token: env.API_TOKEN, origin, audioOrigin, ownerName, dataDir: env.DATA_DIR, port, ...(env.SESSION_SECRET === undefined ? {} : { sessionSecret: env.SESSION_SECRET }) };
}
