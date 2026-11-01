"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { WebHaptics } from "web-haptics";

type Feedback = "selection" | "success" | "error";
type Preference = "auto" | "on" | "off";
const key = "hatch-lab-haptics";
const signal = "hatch-lab:haptic";
const Settings = createContext({
  preference: "auto" as Preference,
  setPreference: (_: Preference) => {},
});

// Explicit outcomes only. Never call from polling, rendering, or agent activity.
export function haptic(kind: Feedback) {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(signal, { detail: kind }));
}

export function Haptics({ children }: { children: React.ReactNode }) {
  const [preference, update] = useState<Preference>("auto");
  useEffect(() => {
    const read = () => {
      try {
        const value = localStorage.getItem(key);
        update(value === "on" || value === "off" ? value : "auto");
      } catch {}
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  useEffect(() => {
    const engine = new WebHaptics({ debug: false, showSwitch: false });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let lastTap = -Infinity;
    let lastError = -Infinity;
    const play = (kind: Feedback, gesture = false) => {
      if (
        document.visibilityState !== "visible" ||
        preference === "off" ||
        (preference === "auto" && reduced.matches)
      )
        return;
      // Safari's workaround needs a live gesture. Don't simulate delayed
      // completion patterns there or interpret isSupported as iOS detection.
      if (!gesture && !WebHaptics.isSupported) return;
      const now = performance.now();
      if (kind === "selection") {
        if (now - lastTap < 80) return;
        lastTap = now;
      } else if (kind === "error") {
        // A form may raise several native invalid events in one submission.
        if (now - lastError < 150) return;
        lastError = now;
      }
      void engine.trigger(kind).catch(() => {});
    };
    const click = (event: MouseEvent) => {
      if (
        !event.isTrusted ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const element =
        event.target instanceof Element
          ? event.target.closest(
              "button, a[href], summary, [role=button], input[type=submit], input[type=button], input[type=checkbox], input[type=radio]",
            )
          : null;
      if (
        !element ||
        element.closest(
          '[data-haptics-off], [inert], [aria-disabled="true"]',
        ) ||
        element.matches(":disabled")
      )
        return;
      // One click path handles touch, mouse, keyboard and assistive activation;
      // no pointerdown buzz during a scroll or synthetic switch-click recursion.
      play("selection", true);
    };
    const change = (event: Event) => {
      const target = event.target;
      if (event.isTrusted && target instanceof Element && target.matches("select, input[type=range], input[type=color]") && !target.closest('[data-haptics-off], [inert], [aria-disabled="true"]') && !target.matches(":disabled")) play("selection", true);
    };
    const outcome = (event: Event) => {
      const kind = (event as CustomEvent<Feedback>).detail;
      if (kind === "success" || kind === "error" || kind === "selection")
        play(kind, navigator.userActivation?.isActive === true);
    };
    const invalid = (event: Event) => {
      if (event.isTrusted) play("error", true);
    };
    const stop = () => {
      if (
        document.hidden ||
        preference === "off" ||
        (preference === "auto" && reduced.matches)
      )
        engine.cancel();
    };
    document.addEventListener("click", click, true);
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("change", change, true);
    document.addEventListener("visibilitychange", stop);
    reduced.addEventListener("change", stop);
    window.addEventListener(signal, outcome);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("visibilitychange", stop);
      reduced.removeEventListener("change", stop);
      window.removeEventListener(signal, outcome);
      engine.cancel();
      engine.destroy();
    };
  }, [preference]);

  const setPreference = (value: Preference) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
    update(value);
  };
  return (
    <Settings.Provider value={{ preference, setPreference }}>
      {children}
    </Settings.Provider>
  );
}

export function HapticSettings() {
  const { preference, setPreference } = useContext(Settings);
  return <section className="touch-feedback" aria-label="Touch Feedback Preferences">
    <div className="touch-feedback-choices" role="group" aria-label="Touch Feedback" aria-describedby="haptic-hint" data-haptics-off>
      {([["auto", "Automatic"], ["on", "On"], ["off", "Off"]] as const).map(([value, title]) =>
        <button key={value} className="key" type="button" aria-pressed={preference === value} onClick={() => setPreference(value)}>{title}</button>
      )}
    </div>
    <p className="hint" id="haptic-hint">Gentle vibration on this phone where supported. Automatic follows your reduced-motion setting. Some iPhones and browsers may not vibrate.</p>
    <button className="key" type="button" data-haptics-off disabled={preference === "off"} onClick={() => haptic("selection")}>Test Touch Feedback</button>
  </section>;
}
