import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { TrackArtwork } from "./artwork";
import { kindLabel, trackTiming, type Track } from "./types";

export function RecordPlayer({ track, title, playing, index, statusLabel }: {
  track?: Track; title: string; playing: boolean; index: number; statusLabel?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const player = useRef<HTMLDivElement>(null);
  const expanded = hovered || pinned;
  useEffect(() => {
    const visibility = () => setPageVisible(!document.hidden);
    const dismiss = (event: PointerEvent) => {
      if (!player.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, []);
  const artwork = track ?? {
    id: "room-record", title: playing ? title : "Sound Room", kind: "music",
    durationSeconds: 0, tags: [],
  } satisfies Track;
  return (
    <div ref={player} className={`record-player ${expanded ? "is-expanded" : ""} ${playing && !motionPaused && pageVisible ? "is-spinning" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setPinned(false); setHovered(false); }
      }}>
      <div className="record-stage"
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") setHovered(false); }}>
        <div className="record-disc" aria-hidden="true">
          <div className="record-disc-spin">
            <TrackArtwork track={artwork} index={Math.max(0, index)} />
          </div>
          <span className="record-sheen" />
          <span className="record-hub" />
        </div>
        <div className="record-caption">
          <span className="record-meter" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <p className="sleeve-kicker" role="status">{statusLabel || (playing ? track ? kindLabel(track.kind) : "Reported by Your Hatch" : "Now Playing")}</p>
          <h2 id="now-title" className="sleeve-title">{title}</h2>
          <p className="sleeve-meta">{statusLabel ? "Waiting for Hatch confirmation." : playing ? track ? trackTiming(track) : "Playing" : "Choose a sound below."}</p>
        </div>
        <div className="record-cover" aria-hidden="true">
          <TrackArtwork track={artwork} index={Math.max(0, index)} />
        </div>
        <button type="button" className="record-art-toggle"
          aria-label={`Show cover artwork: ${artwork.title}`}
          aria-pressed={expanded}
          onClick={() => setPinned(!pinned)}
          onBlur={() => setPinned(false)} />
      </div>
      {playing && <button type="button" className="record-motion-toggle"
        aria-label={motionPaused ? "Resume artwork animation" : "Pause artwork animation"}
        title={motionPaused ? "Resume artwork animation" : "Pause artwork animation"}
        aria-pressed={motionPaused} onClick={() => setMotionPaused(!motionPaused)}>
        {motionPaused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
      </button>}
    </div>
  );
}
