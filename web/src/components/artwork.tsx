import type { CSSProperties } from "react";
import { duration, type Scene, type Track } from "./types";

/* Flat printed-card colors from the reference stack; text color keeps contrast. */
const cardInks = [
  { paper: "#ffcc2e", ink: "#161616" },
  { paper: "#5b8cff", ink: "#161616" },
  { paper: "#ff3b1f", ink: "#161616" },
  { paper: "#ff9ef0", ink: "#161616" },
  { paper: "#1d6b14", ink: "#f3f1ea" },
  { paper: "#1a1a1a", ink: "#f3f1ea" },
];

export function trackInk(track: Pick<Track, "id" | "cover">) {
  if (track.cover === "bach" || track.id === "bach-allemanda")
    return cardInks[0];
  let hash = 0;
  for (const char of track.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return cardInks[1 + (hash % (cardInks.length - 1))];
}

const kindWord = {
  music: "music",
  "field-recording": "field",
  generated: "study",
  "hatch-sound": "hatch",
  "hatch-favorite": "favorite",
  "saved-sound": "saved",
} as const;

export function TrackArtwork({
  track,
  index,
}: {
  track: Track;
  index: number;
}) {
  const { paper, ink } = trackInk(track);
  return (
    <div
      className="track-art"
      style={{ "--paper": paper, "--ink": ink } as CSSProperties}
      aria-hidden="true"
    >
      <span className="track-art-band">
        <span>{kindWord[track.kind] || "sound"}</span>
        <span className="track-art-index">
          {new Intl.NumberFormat(undefined, { minimumIntegerDigits: 2 }).format(
            index + 1,
          )}
        </span>
      </span>
      <span className="track-art-title">{track.title}</span>
      <span className="track-art-number">
        {track.durationSeconds > 0
          ? duration(track.durationSeconds)
          : track.kind === "hatch-favorite"
            ? `${track.stepCount ?? 1}×`
            : "∞"}
      </span>
    </div>
  );
}

/* A scalloped sticker outline; 22 points read as stamped rather than spiky. */
const starPath = (() => {
  const points = 22;
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 ? 41 : 47;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    out.push(
      `${(50 + radius * Math.cos(angle)).toFixed(2)} ${(50 + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${out.join("L")}Z`;
})();

/* Picks ink or paper lettering by WCAG relative luminance of the sticker color. */
function stickerInk(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#161616";
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.0545 >= 1.05 / (luminance + 0.05)
    ? "#161616"
    : "#f6f5f1";
}

export function SceneSticker({ scene }: { scene: Scene }) {
  return (
    <span
      className="scene-sticker"
      style={
        {
          "--scene-color": scene.color,
          "--sticker-ink": stickerInk(scene.color),
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" className="scene-sticker-shape">
        <path d={starPath} />
      </svg>
      <span className="scene-sticker-ring" />
      <span className="scene-sticker-title">{scene.title}</span>
    </span>
  );
}

export function HatchDevice({
  on,
  color,
  brightness,
  size = "large",
}: {
  on: boolean;
  color: string;
  brightness: number;
  size?: "large" | "small";
}) {
  const level = on ? Math.max(0.18, Math.min(1, brightness / 100)) : 0;
  return (
    <div
      className={`hatch-device hatch-${size} ${on ? "is-lit" : ""}`}
      style={{ "--glow": color, "--level": level } as CSSProperties}
      aria-hidden="true"
    >
      <span className="hatch-halo" />
      <span className="hatch-dome">
        <span className="hatch-dome-shine" />
      </span>
      <span className="hatch-base">
        <span className="hatch-grille" />
      </span>
    </div>
  );
}

export function ClockFace({
  hours,
  minutes,
}: {
  hours: number | null;
  minutes: number | null;
}) {
  const hourAngle =
    hours === null ? 0 : ((hours % 12) + (minutes || 0) / 60) * 30;
  const minuteAngle = minutes === null ? 0 : minutes * 6;
  return (
    <svg className="clock-face" viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="96" />
      {Array.from({ length: 12 }, (_, i) => (
        <line
          key={i}
          className="clock-tick"
          x1="100"
          y1="12"
          x2="100"
          y2={i % 3 ? "17" : "22"}
          transform={`rotate(${i * 30} 100 100)`}
        />
      ))}
      <g
        className="clock-hand"
        style={{ transform: `rotate(${hourAngle}deg)` }}
      >
        <line x1="100" y1="104" x2="100" y2="56" />
      </g>
      <g
        className="clock-hand clock-minute"
        style={{ transform: `rotate(${minuteAngle}deg)` }}
      >
        <line x1="100" y1="106" x2="100" y2="30" />
      </g>
    </svg>
  );
}
