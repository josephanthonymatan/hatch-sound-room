import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

// Keyboard labels are hints; the matching action is implemented here too.
export function nextField(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  const form = event.currentTarget.form;
  if (!form) return;
  const fields = [...form.elements].filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
    !el.disabled && el.type !== "hidden" && el.getClientRects().length > 0);
  const next = fields[fields.indexOf(event.currentTarget) + 1];
  if (next) { event.preventDefault(); next.focus(); }
}

function bounded(text: string, min: number, max: number, step: number) {
  const raw = text.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Number(Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step)).toFixed(6));
}

export function PreciseValue({ label, value, display = String(value), min = 0, max = 100, step = 1, disabled = false, onCommit }: {
  label: string; value: number; display?: string; min?: number; max?: number; step?: number; disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(""), [error, setError] = useState("");
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (open) { input.current?.focus(); input.current?.select(); } }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function close() { setOpen(false); setError(""); trigger.current?.focus(); }
  function commit() {
    const next = bounded(draft, min, max, step);
    if (next === null) { setError(`Enter a number from ${min} to ${max}.`); input.current?.focus(); return; }
    close(); onCommit(next);
  }
  return <div className="precise-value">
    <button ref={trigger} type="button" className="value-key" disabled={disabled} aria-label={`Set ${label} precisely, ${display}`} aria-expanded={open}
      onClick={() => { setDraft(String(value)); setError(""); setOpen(v => !v); }}>{display}</button>
    {open && <div className="precise-editor" role="group" aria-label={`${label} precise entry`} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <input ref={input} aria-label={`${label} value`} name={`${label.toLowerCase().replace(/\s+/g,"-")}-value`} type="text" maxLength={32} inputMode={step < 1 ? "decimal" : "numeric"}
        enterKeyHint="done" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} value={draft} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onChange={event => { setDraft(event.target.value); setError(""); }} />
      <button type="button" className="key" onClick={commit}>Done</button><button type="button" className="text-key" onClick={close}>Cancel</button>
      {error && <p id={errorId} role="alert" className="field-error">{error}</p>}
    </div>}
  </div>;
}

export function EntryRange({ id, label, value, display = `${value}%`, min = 0, max = 100, step = 1, disabled = false, preciseScale = 1, onChange }: {
  id: string; label: string; value: number; display?: string; min?: number; max?: number; step?: number; disabled?: boolean; preciseScale?: number; onChange: (value: number) => void;
}) {
  return <div className="recipe-field entry-range">
    <div className="recipe-range-label"><label htmlFor={id}>{label}</label><PreciseValue label={label} value={Number((value*preciseScale).toFixed(6))} display={display} min={min*preciseScale} max={max*preciseScale} step={step*preciseScale} disabled={disabled} onCommit={v=>onChange(v/preciseScale)} /></div>
    <input id={id} name={id} type="range" autoComplete="off" min={min} max={max} step={step} value={value} disabled={disabled}
      aria-valuetext={display} style={{"--fill":`${(value-min)/(max-min)*100}%`} as CSSProperties} onChange={event=>onChange(Number(event.target.value))}/>
  </div>;
}

export function DurationEntry({ index, value, onChange }: { index: number; value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  function commit() { const next = bounded(draft, 1, 60, 1) ?? value; setDraft(String(next)); if (next !== value) onChange(next); }
  function nudge(delta: number) { const next = Math.max(1, Math.min(60, (bounded(draft, 1, 60, 1) ?? value) + delta)); setDraft(String(next)); onChange(next); }
  return <div className="recipe-seconds"><label htmlFor={`seconds-${index}`}>Color {index+1} · Seconds</label><div className="duration-entry">
    <button type="button" className="key" aria-label={`Decrease color ${index+1} duration`} disabled={value<=1} onClick={()=>nudge(-1)}>−</button>
    <input id={`seconds-${index}`} name={`seconds-${index}`} type="text" maxLength={32} inputMode="numeric" enterKeyHint="done" autoComplete="off" autoCorrect="off" spellCheck={false}
      value={draft} onFocus={()=>{focused.current=true;}} onChange={event=>setDraft(event.target.value)} onBlur={()=>{focused.current=false;commit();}}
      onKeyDown={event=>{if(event.key==="Enter" && !event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}}/>
    <button type="button" className="key" aria-label={`Increase color ${index+1} duration`} disabled={value>=60} onClick={()=>nudge(1)}>+</button>
  </div></div>;
}

// iOS keeps a separate visual viewport while the software keyboard is open.
export function useKeyboardViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    function update() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        const editing = (active instanceof HTMLInputElement && !["range","color","checkbox","file","hidden"].includes(active.type)) || active instanceof HTMLTextAreaElement;
        const inset = viewport!.scale === 1 ? Math.max(0, window.innerHeight - viewport!.height - viewport!.offsetTop) : 0;
        const open = editing && inset > 100;
        document.documentElement.classList.toggle("keyboard-open", open);
        document.documentElement.style.setProperty("--keyboard-inset", `${open ? inset : 0}px`);
        document.documentElement.style.setProperty("--entry-viewport-height", `${open ? viewport!.height : window.innerHeight}px`);
        if (open && active instanceof HTMLElement) active.scrollIntoView({block:"nearest",behavior:"instant"});
      });
    }
    viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update); document.addEventListener("focusout", update);
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener("resize",update); viewport.removeEventListener("scroll",update); document.removeEventListener("focusin",update); document.removeEventListener("focusout",update); document.documentElement.classList.remove("keyboard-open"); };
  }, []);
}
