export type LightRecipe = {
  version: 1;
  id: string;
  title: string;
  mood: string;
  brightness: number;
  pace: number;
  motion: "flow" | "breathe" | "steady";
  stops: { color: string; seconds: number }[];
  effects?: LightEffects;
  nativeLightId?: number;
};
export type LightBlend = "rgb" | "vivid" | "spectrum";
export type LightEffects = {
  blend?: LightBlend;
  hold?: number;
  drift?: number;
  layer?: number;
  bloom?: number;
  bloomColor?: string;
  breath?: { seconds: number; depth: number; inhale: number };
};

export const maxPaletteColors = 32;

export function parsePalette(input: string): string[] {
  const cells = input.trim().split(/[,\t\r\n]+/).map(cell => cell.trim()).filter(Boolean);
  if (cells.length < 2 || cells.length > maxPaletteColors) throw new Error(`Paste 2–${maxPaletteColors} hex colors, separated by commas, tabs or new lines.`);
  return cells.map((cell, index) => {
    const hex = cell.replace(/^"(.*)"$/, "$1").replace(/^#/, "");
    if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) throw new Error(`Color ${index + 1} is invalid. Use a hex color like #334217.`);
    return `#${hex.length === 3 ? [...hex].map(c => c + c).join("") : hex}`.toLowerCase();
  });
}

export const lightRecipes: LightRecipe[] = [
  { version: 1, id: "aurora", title: "Aurora", mood: "Blue, cyan and green drifting into violet.", brightness: 50, pace: 1, motion: "flow", nativeLightId: 792,
    stops: [ ["#050aff",3], ["#0a32ff",4], ["#0adc32",5], ["#1464ff",6], ["#0aff32",5], ["#1e0aff",6] ].map(([color, seconds]) => ({ color: String(color), seconds: Number(seconds) })) },
  { version: 1, id: "embers", title: "Embers", mood: "A warm room after the fire settles.", brightness: 35, pace: 1, motion: "breathe", stops: [{color:"#ad240e",seconds:7},{color:"#ed641c",seconds:9},{color:"#ffac42",seconds:6}] },
  { version: 1, id: "after-rain", title: "After the Rain", mood: "Quiet forest air, cool and unhurried.", brightness: 40, pace: 1, motion: "flow", stops: [{color:"#26958c",seconds:9},{color:"#6688a4",seconds:12},{color:"#ab96ca",seconds:10}] },
  { version: 1, id: "velvet-dusk", title: "Velvet Dusk", mood: "Plum, dusty rose and the last warm light.", brightness: 30, pace: 1, motion: "flow", stops: [{color:"#704066",seconds:10},{color:"#c47691",seconds:12},{color:"#efa378",seconds:8}] },
  { version: 1, id: "interlude", title: "Interlude", mood: "Cobalt that slowly fills with magenta and tangerine.", brightness: 45, pace: 1, motion: "flow",
    effects: { blend: "vivid", hold: .35, drift: .5, layer: .6, bloom: .15 },
    stops: [{color:"#1b2cc1",seconds:16},{color:"#3a0ca3",seconds:14},{color:"#c2187a",seconds:16},{color:"#ff6b35",seconds:12},{color:"#ffc94d",seconds:14}] },
  { version: 1, id: "blue-suit", title: "Blue Suit", mood: "Almost one blue, changing depth, with the odd pink flare.", brightness: 40, pace: 1, motion: "flow",
    effects: { blend: "vivid", hold: .4, drift: .8, bloom: .3, bloomColor: "#ff3fa4" },
    stops: [{color:"#0b1f8a",seconds:18},{color:"#1237d6",seconds:16},{color:"#2a5cff",seconds:14},{color:"#0a1466",seconds:18}] },
  { version: 1, id: "harmonium", title: "Harmonium", mood: "Amber and rose on a slow, uneven breath.", brightness: 40, pace: 1, motion: "breathe",
    effects: { blend: "vivid", drift: .3, breath: { seconds: 8, depth: .45, inhale: .38 } },
    stops: [{color:"#ffb347",seconds:14},{color:"#ff8a5c",seconds:14},{color:"#e8577e",seconds:14},{color:"#ffd27a",seconds:14}] },
  { version: 1, id: "hawaii-silhouette", title: "Hawaii Silhouette", mood: "Indigo to teal, then a long sunset the far way round.", brightness: 40, pace: 1, motion: "flow",
    effects: { blend: "spectrum", hold: .3, drift: .3 },
    stops: [{color:"#0d3b66",seconds:16},{color:"#1a7f8e",seconds:16},{color:"#ff4f81",seconds:16},{color:"#ff9e2c",seconds:16},{color:"#2b1055",seconds:16}] },
  { version: 1, id: "light-leak", title: "Light Leak", mood: "Violet with frequent pink-white flares.", brightness: 40, pace: 1, motion: "flow",
    effects: { blend: "vivid", drift: .6, bloom: .7, bloomColor: "#ffd1e8" },
    stops: [{color:"#4b1d7a",seconds:12},{color:"#8a2be2",seconds:12},{color:"#ff5fa2",seconds:12},{color:"#ffd1e8",seconds:12}] },
];

export function validEffects(value: unknown): value is LightEffects {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fx = value as LightEffects, within = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  const optional = (n: unknown, min: number, max: number) => n === undefined || within(n, min, max);
  return (fx.blend === undefined || ["rgb","vivid","spectrum"].includes(fx.blend)) && optional(fx.hold, 0, .8) && optional(fx.drift, 0, 1) && optional(fx.layer, 0, 1) && optional(fx.bloom, 0, 1)
    && (fx.bloomColor === undefined || /^#[\da-f]{6}$/i.test(fx.bloomColor))
    && (fx.breath === undefined || (!!fx.breath && within(fx.breath.seconds, 8, 30) && within(fx.breath.depth, .1, .8) && within(fx.breath.inhale, .2, .5)));
}

export function validRecipe(value: unknown): value is LightRecipe {
  if (!value || typeof value !== "object") return false;
  const r = value as LightRecipe;
  return r.version === 1 && typeof r.id === "string" && r.id.length <= 100 && typeof r.title === "string" && !!r.title.trim() && r.title.length <= 80 && typeof r.mood === "string" && r.mood.length <= 280 && Number.isFinite(r.brightness) && r.brightness >= 1 && r.brightness <= 100 && Number.isFinite(r.pace) && r.pace >= .5 && r.pace <= 2 && ["flow","breathe","steady"].includes(r.motion) && Array.isArray(r.stops) && r.stops.length >= 2 && r.stops.length <= maxPaletteColors && r.stops.every(s => s && /^#[\da-f]{6}$/i.test(s.color) && Number.isFinite(s.seconds) && s.seconds >= 1 && s.seconds <= 60) && (r.effects === undefined || validEffects(r.effects));
}

// Mirrors motionFrame in cloud/light-sequence.mjs; the cloud tests check both
// produce identical frames. Without effects a recipe keeps the original RGB
// flow and per-color breathing exactly.
type Channels = number[];
const smooth = (p: number) => p * p * (3 - 2 * p);
const wave = (t: number, terms: number[][]) => terms.reduce((sum, [weight, period, phase]) => sum + weight * Math.sin(2 * Math.PI * t / period + phase), 0);
const linear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const encode = (c: number) => c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055;
// Channels are 0–65535 so the plain RGB path matches earlier integer frames.
function oklch(channels: Channels): Channels {
  const [r, g, b] = channels.map(c => linear(c / 65535));
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b), m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b),
    s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, bb = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)];
}
function linearFromLch(L: number, C: number, h: number): Channels {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
}
// Out-of-gamut colors keep lightness and hue and lose chroma, rather than clipping toward a different hue.
function fromLch([L, C, h]: Channels): Channels {
  L = Math.min(1, Math.max(0, L));
  const fits = (chroma: number) => linearFromLch(L, chroma, h).every(c => c >= -1e-4 && c <= 1 + 1e-4);
  let low = 0, high = Math.max(0, C);
  if (!fits(high)) for (let step = 0; step < 16; step++) { const mid = (low + high) / 2; if (fits(mid)) low = mid; else high = mid; }
  else low = high;
  return linearFromLch(L, low, h).map(c => encode(Math.min(1, Math.max(0, c))) * 65535);
}
function mix(from: Channels, to: Channels, amount: number, blend: LightBlend): Channels {
  if (blend === "rgb") return from.map((c, i) => c + (to[i] - c) * amount);
  const [L1, C1, h1] = oklch(from), [L2, C2, h2] = oklch(to);
  // A gray, black or white stop takes its partner's hue so it cannot swing through unrelated colors.
  const start = C1 < .02 ? h2 : h1, end = C2 < .02 ? h1 : h2;
  let turn = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  if (blend === "spectrum" && C1 >= .02 && C2 >= .02 && turn !== 0) turn -= Math.sign(turn) * 2 * Math.PI;
  return fromLch([L1 + (L2 - L1) * amount, C1 + (C2 - C1) * amount, start + turn * amount]);
}
function seedOf(id: string) { let h = 2166136261; for (const char of id) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return h; }
function random(seed: number, n: number) {
  let x = Math.imul(seed ^ Math.imul(n, 0x9e3779b1), 0x45d9f3b); x ^= x >>> 16; x = Math.imul(x, 0x45d9f3b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const bloomWindow = 12;
// Rare light leaks: up to one per 12-second window, a fast rise and a few seconds of decay.
function bloomAt(recipe: LightRecipe, elapsed: number) {
  const chance = (recipe.effects?.bloom ?? 0) * .5, seed = seedOf(recipe.id), current = Math.floor(elapsed / bloomWindow);
  let envelope = 0;
  for (const window of [current - 1, current]) {
    if (window < 0 || random(seed, window * 2) >= chance) continue;
    const age = elapsed - (window + .7 * random(seed, window * 2 + 1)) * bloomWindow;
    if (age >= 0 && age < 9) envelope = Math.max(envelope, age < 1 ? smooth(age) : Math.exp(-(age - 1) / 2.5));
  }
  return envelope;
}

export function motionFrame(recipe: LightRecipe, elapsedSeconds: number, minimumSeconds: number) {
  const fx = recipe.effects ?? {}, blend = fx.blend ?? "rgb", hold = fx.hold ?? 0, steady = recipe.motion === "steady";
  const durations = recipe.stops.map(stop => Math.max(minimumSeconds, stop.seconds * recipe.pace));
  const total = durations.reduce((sum, seconds) => sum + seconds, 0);
  const channels = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) * 257);
  const at = (position: number) => {
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
  if (fx.layer) color = mix(color, at((total - (elapsed / 1.618034 + total / 2) % total) % total).color, fx.layer * .5, blend === "rgb" ? "rgb" : "vivid");
  if (recipe.motion === "breathe") {
    if (fx.breath) {
      const period = Math.max(8, fx.breath.seconds * recipe.pace), phase = elapsed % period / period, inhale = fx.breath.inhale;
      const rise = phase < inhale ? smooth(phase / inhale) : 1 - smooth((phase - inhale) / (1 - inhale));
      brightness *= 1 - fx.breath.depth + fx.breath.depth * rise;
    } else brightness *= .55 + .45 * (1 - Math.cos(frame.progress * Math.PI * 2)) / 2;
  }
  const bloom = fx.bloom ? bloomAt(recipe, elapsed) : 0;
  if (fx.drift || bloom) {
    const [L, C, h0] = oklch(color);
    let chroma = C, h = h0;
    if (fx.drift) {
      h += fx.drift * .14 * wave(elapsed, [[.5, 23, .7], [.3, 41, 2.6], [.2, 61, 1.9]]);
      chroma *= 1 + fx.drift * .12 * wave(elapsed, [[.6, 31, .2], [.4, 53, 1.1]]);
      brightness *= 1 + fx.drift * .15 * wave(elapsed, [[.5, 17, 1.3], [.3, 29, .4], [.2, 47, 2.1]]);
    }
    color = fromLch([L, chroma, h]);
    if (bloom) {
      const tint = fx.bloomColor ? channels(fx.bloomColor) : fromLch([.93, chroma * .5, h]);
      color = mix(color, tint, .6 * bloom, "vivid");
      brightness *= 1 + .7 * bloom;
    }
  }
  return { index: frame.index, next: frame.next, blend: frame.amount, rgb: color.map(c => Math.round(Math.min(65535, Math.max(0, c)))), brightness: Math.min(100, brightness) };
}

// Preview timing is our interpretation of the catalog, not firmware emulation.
export function previewFrame(recipe: LightRecipe, elapsed: number) {
  const frame = motionFrame(recipe, elapsed, recipe.nativeLightId ? 0 : 4);
  const [r, g, b] = frame.rgb.map(c => Math.round(c / 257));
  return { index: frame.index, next: frame.next, blend: frame.blend, intensity: frame.brightness / 100, channels: [r, g, b] };
}
