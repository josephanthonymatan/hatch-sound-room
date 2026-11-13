import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { PreciseValue } from "./data-entry";
import { haptic } from "./haptics";

const THUMB = 32;
const commitKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];

// A physical fader: round step keys, a graduated groove, detent ticks, and a knob
// that touch moves relative to its current level (no jumps) while vertical swipes
// still scroll. onInput follows every movement; onCommit marks where it settles.
export function Fader({ id, label, icon, value, min = 0, max = 100, step = 5, disabled = false, syncing = false, onInput, onCommit }: {
  id: string; label: string; icon?: ReactNode; value: number; min?: number; max?: number; step?: number;
  disabled?: boolean; syncing?: boolean; onInput: (value: number) => void; onCommit?: (value: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Pointer moves can outrun renders; the level ref is always current.
  const level = useRef(value);
  level.current = value;
  const stepTimer = useRef(0);
  const drag = useRef<{ pointer: number; x: number; y: number; from: number; start: number; mode: "pending" | "absolute" | "relative" } | null>(null);
  const span = max - min;

  useEffect(() => () => window.clearTimeout(stepTimer.current), []);
  useEffect(() => {
    if (!disabled) return;
    drag.current = null;
    setDragging(false);
  }, [disabled]);

  function move(next: number) {
    const clamped = Math.max(min, Math.min(max, Math.round(next)));
    const current = level.current;
    const notch = (n: number) => Math.floor(((n - min) / span) * 10);
    // Detents: a tick every tenth of travel and at each end.
    if (clamped !== current && (notch(clamped) !== notch(current) || clamped === min || clamped === max)) haptic("selection");
    level.current = clamped;
    onInput(clamped);
    return clamped;
  }
  function settle(next: number) { onCommit?.(next); }
  function fromPointer(clientX: number) {
    const box = input.current!.getBoundingClientRect();
    return min + ((clientX - box.left - THUMB / 2) / Math.max(1, box.width - THUMB)) * span;
  }
  function nudge(direction: 1 | -1) {
    const current = level.current;
    const next = move(direction > 0 ? Math.floor(current / step) * step + step : Math.ceil(current / step) * step - step);
    window.clearTimeout(stepTimer.current);
    // Rapid taps settle into one commit.
    stepTimer.current = window.setTimeout(() => settle(next), 350);
  }
  function release(engaged: boolean) {
    drag.current = null;
    setDragging(false);
    if (engaged) settle(level.current);
  }

  return (
    <div className="fader" data-syncing={syncing || undefined} data-dragging={dragging || undefined}>
      <div className="fader-label">
        <label htmlFor={id}>{icon}<span>{label}</span><span className="fader-sync" aria-hidden="true" /></label>
        <PreciseValue label={label} value={value} display={`${value}%`} min={min} max={max} disabled={disabled}
          onCommit={next => { move(next); settle(next); }} />
      </div>
      <div className="fader-row">
        <button type="button" className="fader-step" aria-label={`Lower ${label}`} disabled={disabled || value <= min} onClick={() => nudge(-1)}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <div
          className="fader-track"
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            const mouse = event.pointerType === "mouse";
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, from: level.current, start: level.current, mode: mouse ? "absolute" : "pending" };
            if (!mouse) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            input.current?.focus({ preventScroll: true });
            setDragging(true);
            move(fromPointer(event.clientX));
          }}
          onPointerMove={(event) => {
            const state = drag.current;
            if (!state || state.pointer !== event.pointerId) return;
            if (state.mode === "pending") {
              const dx = event.clientX - state.x, dy = event.clientY - state.y;
              if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
              if (Math.abs(dx) < 6) return;
              Object.assign(state, { mode: "relative", x: event.clientX, from: level.current });
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
              return;
            }
            if (state.mode === "absolute") { move(fromPointer(event.clientX)); return; }
            const width = Math.max(1, (input.current?.getBoundingClientRect().width ?? 1) - THUMB);
            move(state.from + ((event.clientX - state.x) / width) * span);
          }}
          onPointerUp={(event) => {
            const state = drag.current;
            if (state && state.pointer === event.pointerId) release(state.mode !== "pending");
          }}
          onPointerCancel={() => {
            const state = drag.current;
            if (!state) return;
            // An interrupted drag returns to where it began.
            if (state.mode !== "pending") move(state.start);
            release(state.mode !== "pending");
          }}
        >
          <input
            ref={input}
            id={id}
            name={id}
            type="range"
            autoComplete="off"
            min={min}
            max={max}
            value={value}
            style={{ "--fill": `${((value - min) / span) * 100}%` } as CSSProperties}
            aria-valuetext={`${value}%`}
            disabled={disabled}
            data-haptics-off
            onChange={(event) => move(Number(event.target.value))}
            onKeyUp={(event) => { if (commitKeys.includes(event.key)) settle(Number(event.currentTarget.value)); }}
            onBlur={(event) => { if (!drag.current) settle(Number(event.currentTarget.value)); }}
          />
        </div>
        <button type="button" className="fader-step" aria-label={`Raise ${label}`} disabled={disabled || value >= max} onClick={() => nudge(1)}>
          <Plus size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
