import { useEffect, useRef } from "react";

const rowHeight = 44;
const minuteLabel = (value: number) => {
  const seconds = Math.round(value * 60);
  const format = new Intl.NumberFormat();
  if (!seconds) return "Off";
  const minutes = Math.floor(seconds / 60), remainder = seconds % 60;
  return [minutes ? `${format.format(minutes)} min` : "", remainder ? `${format.format(remainder)} s` : ""].filter(Boolean).join(" ");
};

export function AlarmFadeWheel({ value, disabled, onChange }: {
  value: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changed = useRef(onChange);
  changed.current = onChange;
  const values = [...new Set([...Array.from({ length: 13 }, (_, index) => index / 4), value])].sort((a, b) => a - b);
  const selected = values.indexOf(value);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  useEffect(() => {
    // The enclosing dialog opens in its own effect. Position after it has a
    // layout; scrolling a hidden dialog would silently leave the wheel at Off.
    const frame = requestAnimationFrame(() => {
      if (wheel.current) wheel.current.scrollTop = selected * rowHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

  function choose(index: number) {
    const next = Math.max(0, Math.min(values.length - 1, index));
    if (settle.current) clearTimeout(settle.current);
    changed.current(values[next]);
    wheel.current?.scrollTo({ top: next * rowHeight, behavior: "instant" });
  }

  return (
    <div className="fade-wheel-shell">
      <div className="fade-wheel-selection" aria-hidden="true" />
      <div ref={wheel} id="alarm-fade" className="fade-wheel" role="listbox"
        aria-labelledby="alarm-fade-label" aria-describedby="fade-help" aria-disabled={disabled}
        aria-activedescendant={`fade-option-${selected}`} tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") event.preventDefault();
          const offset = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[event.key];
          if (offset !== undefined || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            choose(event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : selected + (offset ?? 0));
          }
        }}
        onScroll={() => {
          if (settle.current) clearTimeout(settle.current);
          settle.current = setTimeout(() => {
            const index = Math.round((wheel.current?.scrollTop || 0) / rowHeight);
            const next = valuesRef.current[Math.max(0, Math.min(valuesRef.current.length - 1, index))];
            if (next !== undefined && next !== value) changed.current(next);
          }, 100);
        }}>
        {values.map((minutes, index) => (
          <button key={minutes} id={`fade-option-${index}`} type="button" role="option"
            aria-selected={minutes === value} disabled={disabled} tabIndex={-1}
            onClick={() => { choose(index); wheel.current?.focus({ preventScroll: true }); }}>
            {minuteLabel(minutes)}
          </button>
        ))}
      </div>
      <input type="hidden" name="fade" value={value} />
    </div>
  );
}
