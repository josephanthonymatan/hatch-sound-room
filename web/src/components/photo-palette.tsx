import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { haptic } from "./haptics";
import { selectImagePalette, type PaletteStyle } from "./image-palette";
import { readPhotoPalette, type PhotoPalette } from "./image-palette-loader";

export function PhotoPalettePicker({ onUse }: { onUse: (colors: string[]) => void }) {
  const [photo, setPhoto] = useState<PhotoPalette | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(5);
  const [style, setStyle] = useState<PaletteStyle>("character");
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const colors = photo ? selectImagePalette(photo.colors, count, style) : [];
  async function choose(file: File) {
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError(""); setPhoto(null);
    try {
      const next = await readPhotoPalette(file, request.signal);
      if (!request.signal.aborted) { setPhoto(next); haptic("success"); }
    } catch (error) {
      if (!request.signal.aborted) { setError((error as Error).message); haptic("error"); }
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  function clear() {
    controller.current?.abort(); setPhoto(null); setBusy(false); setError(""); input.current?.focus();
  }
  return <section className="photo-palette" aria-labelledby="photo-palette-title">
    <div className="photo-palette-heading"><h3 id="photo-palette-title">Colors from a Photo</h3>
      {(photo || busy) && <button type="button" className="key photo-clear" aria-label={busy ? "Cancel photo" : "Remove photo"} onClick={clear}><X size={16} aria-hidden="true"/></button>}
    </div>
    <p id="photo-privacy" className="hint">A little of its atmosphere, for your light. Photos stay on this device.</p>
    <label className="key photo-choose"><ImagePlus size={16} aria-hidden="true"/>{photo ? "Choose Another Photo" : busy ? "Choose a Different Photo" : "Choose Photo"}
      <input ref={input} type="file" name="palette-photo" accept="image/*" aria-describedby={`photo-privacy${error ? " photo-error" : ""}`} aria-invalid={Boolean(error)} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (file) void choose(file);
      }}/>
    </label>
    {error && <p id="photo-error" role="alert" className="studio-message">{error}</p>}
    <div role="status" className="hint">{busy ? "Finding the colors…" : photo ? `${colors.length} distinct ${colors.length === 1 ? "color" : "colors"} found${colors.length < count ? "; keeping the palette simple" : ""}.` : ""}</div>
    {photo && <>
      <div className="photo-diptych">
        <figure><div className="photo-mount"><img src={photo.thumbnail} alt="Your selected photo" width={256} height={256}/></div><figcaption>The photograph</figcaption></figure>
        <figure><div className="photo-study" role="img" aria-label={`Color study: ${colors.map(color => color.hex).join(", ")}`} style={{ background: colors[0]?.hex }}>
          {colors.map((color, index) => <span key={color.hex} style={{ background: color.hex, flexGrow: Math.sqrt(color.share), transform: `rotate(${index % 2 ? -.7 : .6}deg)` }}/>)}</div><figcaption>Its color story</figcaption></figure>
      </div>
      <div className="light-mode" role="group" aria-label="Color selection">{([ ["character", "Character"], ["dominant", "Dominant"] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={style === value} onClick={() => setStyle(value)}>{label}</button>)}</div>
      <p className="hint">{style === "character" ? "Keeps distinctive accents alongside the main tones." : "Favors the colors that fill most of the photo."}</p>
      <div className="photo-count"><span id="photo-count-label">Palette size</span><div role="group" aria-labelledby="photo-count-label">{[3, 5, 7].map(value => <button type="button" key={value} className="key" aria-label={`Up to ${value} colors`} aria-pressed={count === value} onClick={() => setCount(value)}>{value}</button>)}</div></div>
      <ol className="photo-swatches" aria-label="Extracted colors">{colors.map(color => <li key={color.hex}><span style={{ background: color.hex }} aria-hidden="true"/><span translate="no">{color.hex.toUpperCase()}</span></li>)}</ol>
      <button type="button" className="key key-ink" onClick={() => { onUse(colors.map(color => color.hex)); setPhoto(null); }}>Use Photo Colors</button>
      <p className="hint">Replaces your palette. You can edit each color before playing.</p>
    </>}
  </section>;
}
