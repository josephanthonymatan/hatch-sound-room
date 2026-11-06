import { extractPalette, MmcqQuantizer, rgbToOklch, validateOptions } from "colorthief/internals";

export type PaletteColor = { hex: string; share: number; lab: [number, number, number] };
export type PaletteStyle = "character" | "dominant";
const distance = (a: PaletteColor, b: PaletteColor) => Math.hypot(...a.lab.map((v, i) => v - b.lab[i]));
const chroma = (color: PaletteColor) => Math.hypot(color.lab[1], color.lab[2]);

function lab(r: number, g: number, b: number): PaletteColor["lab"] {
  const { l, c, h } = rgbToOklch(r, g, b);
  return [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
}

/** Bounded sRGB samples only. Runs in a worker; the same function is testable without a browser. */
export function analyzeImage(data: Uint8ClampedArray, width: number, height: number): PaletteColor[] {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 256 * 256 || data.length !== width * height * 4) {
    throw new Error("This image could not be sampled. Try another photo.");
  }
  const visible: number[] = [], accents: number[] = [];
  const pixels: PaletteColor["lab"][] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const point = lab(rgb[0], rgb[1], rgb[2]);
    pixels.push(point);
    visible.push(...rgb, 255);
    if (Math.hypot(point[1], point[2]) >= .07) accents.push(...rgb, 255);
  }
  if (!pixels.length) throw new Error("This image is transparent. Choose a photo with visible colors.");
  const quantizer = new MmcqQuantizer();
  const extract = (values: number[], count: number) => extractPalette(new Uint8ClampedArray(values), values.length / 4, 1,
    validateOptions({ colorCount: count, quality: 1, colorSpace: "oklch", ignoreWhite: false }), quantizer) ?? [];
  // A separate chromatic pass gives a small red coat a candidate even in a mostly beige photograph.
  const raw = [...extract(visible, 20), ...(accents.length ? extract(accents, 8) : [])];
  const candidates: PaletteColor[] = [];
  for (const color of raw.sort((a, b) => b.proportion - a.proportion)) {
    const next: PaletteColor = { hex: color.hex(), share: 0, lab: lab(...color.array()) };
    if (candidates.every(other => distance(next, other) >= .045)) candidates.push(next);
  }
  // Recount against the original sample so accent-pass populations never masquerade as image coverage.
  for (const point of pixels) {
    let nearest = 0, best = Infinity;
    candidates.forEach((color, index) => {
      const d = point.reduce((sum, v, i) => sum + (v - color.lab[i]) ** 2, 0);
      if (d < best) { best = d; nearest = index; }
    });
    candidates[nearest].share += 1 / pixels.length;
  }
  return candidates.filter(color => color.share >= .005).sort((a, b) => b.share - a.share);
}

export function selectImagePalette(candidates: PaletteColor[], count = 5, style: PaletteStyle = "character"): PaletteColor[] {
  count = Math.max(1, Math.min(7, Math.round(count) || 5));
  const available = [...candidates].sort((a, b) => b.share - a.share);
  const selected = available.splice(0, 1);
  if (!selected.length) return [];
  if (style === "character" && count > 1) {
    // Reserve a distinct color family, not another saturated shade of the dominant sky or foliage.
    const common = candidates.filter(color => color.share >= .04);
    if (!common.length) common.push(selected[0]);
    const isolation = (color: PaletteColor) => Math.min(1, ...common.filter(other => other !== color).map(other =>
      Math.hypot(color.lab[1] - other.lab[1], color.lab[2] - other.lab[2])));
    const accent = available.filter(color => color.share >= .005 && chroma(color) >= .07 && isolation(color) >= .075)
      .sort((a, b) => (chroma(b) * isolation(b) * b.share ** .25) - (chroma(a) * isolation(a) * a.share ** .25))[0];
    if (accent) selected.push(...available.splice(available.indexOf(accent), 1));
  }
  while (selected.length < count && available.length) {
    let bestIndex = -1, bestScore = -1;
    available.forEach((color, index) => {
      const separation = Math.min(...selected.map(other => distance(color, other)));
      if (separation < .065) return;
      const score = style === "dominant" ? color.share :
        Math.sqrt(color.share) * separation * (1 + Math.min(chroma(color), .25) * 3);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    });
    if (bestIndex < 0) break;
    selected.push(...available.splice(bestIndex, 1));
  }
  // A calm loop starts on the anchor color and follows nearby tones, with the closing transition included.
  // At most 7 colors: exhaustive ordering is small and deterministic, unlike hue sorting around gray.
  if (selected.length < 3) return selected;
  let best = selected, bestLength = Infinity;
  const visit = (path: PaletteColor[], rest: PaletteColor[], length: number) => {
    if (length >= bestLength) return;
    if (!rest.length) {
      const total = length + distance(path[path.length - 1], path[0]);
      if (total < bestLength) { best = path; bestLength = total; }
      return;
    }
    rest.forEach((color, index) => visit([...path, color], rest.filter((_, i) => i !== index), length + distance(path[path.length - 1], color)));
  };
  visit([selected[0]], selected.slice(1), 0);
  return best;
}
