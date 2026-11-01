"use client";
import { PreciseValue } from "./data-entry";
/* Portable React: native anchors intentionally support the Vite and Next wrappers. */
/* eslint-disable @next/next/no-html-link-for-pages */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  AlarmClock,
  BookmarkPlus,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  Disc3,
  Ellipsis,
  House,
  LayoutGrid,
  List,
  LogOut,
  Plus,
  Power,
  RefreshCw,
  Search,
  Sun,
  Upload,
  Volume2,
  Vibrate,
  X,
} from "lucide-react";
import { haptic, HapticSettings } from "./haptics";
import { BusyIcon, RefreshIcon } from "./busy-icon";
import {
  ClockFace,
  HatchDevice,
  TrackArtwork,
  trackInk,
} from "./artwork";
import { LightStudio } from "./light-studio";
import { RecordPlayer } from "./record-player";
import { Sheet, AlarmForm, SaveSoundForm, UploadForm } from "./forms";
import { applyFormResult, isRoomState, mergeSyncedLibrary, RoomUpdates, type DeviceIntent, type FormResult, type UpdateScope } from "./room-state";
import {
  alarmEnabled,
  alarmTime,
  api,
  ApiError,
  collectionOf,
  collections,
  fromNow,
  jsonRequest,
  kindLabel,
  number,
  percentage,
  repeatLabel,
  shortDate,
  categoriesFor,
  timeParts,
  trackTiming,
  type Alarm,
  type RoomQuery,
  type RoomState,
  type Scene,
  type Tab,
  type Track,
} from "./types";

const initialQuery: RoomQuery = {
  tab: "all",
  view: "grid",
  q: "",
  panel: null,
  collection: "all",
  alarmId: null,
};
const emptyTracks: Track[] = [];
const emptyScenes: Scene[] = [];
const emptyAlarms: Alarm[] = [];
const tabs: { id: Tab; label: string; title: string; icon: typeof House }[] = [
  { id: "all", label: "Room", title: "Sound Room", icon: House },
  { id: "sounds", label: "Sounds", title: "Sounds", icon: Disc3 },
  { id: "lights", label: "Light", title: "Light", icon: Sun },
  { id: "alarms", label: "Alarms", title: "Alarms", icon: AlarmClock },
];

function readQuery(search = window.location.search): RoomQuery {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const panel = params.get("panel");
  const collection = params.get("collection");
  return {
    tab: tabs.some((item) => item.id === tab) ? (tab as Tab) : "all",
    view: params.get("view") === "table" ? "table" : "grid",
    q: params.get("q") || "",
    panel:
      panel === "upload" || panel === "alarm" || panel === "save-sound" || panel === "feedback"
        ? panel
        : null,
    collection: collections.find((item) => item.id === collection)?.id ?? "all",
    alarmId: panel === "alarm" ? params.get("alarm") : null,
  };
}

function queryHref(query: RoomQuery) {
  const params = new URLSearchParams();
  if (query.tab !== "all") params.set("tab", query.tab);
  if (query.view !== "grid") params.set("view", query.view);
  if (query.q) params.set("q", query.q);
  if (query.panel) params.set("panel", query.panel);
  if (query.collection !== "all") params.set("collection", query.collection);
  if (query.panel === "alarm" && query.alarmId) params.set("alarm", query.alarmId);
  const suffix = params.toString();
  return suffix ? `/?${suffix}` : "/";
}

function plainClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function focusPanelTrigger(panel: RoomQuery["panel"], alarmId?: string | null) {
  window.requestAnimationFrame(() => {
    const alarmTrigger = alarmId ? [...document.querySelectorAll<HTMLElement>("[data-alarm-id]")]
      .find((element) => element.dataset.alarmId === alarmId && element.getClientRects().length > 0) : null;
    const trigger = [
      ...document.querySelectorAll<HTMLElement>(
        `[data-panel-trigger="${panel}"]`,
      ),
    ].find((element) => element.getClientRects().length > 0);
    (alarmTrigger || trigger || document.querySelector<HTMLElement>("#page-title"))?.focus({
      preventScroll: true,
    });
  });
}

function DeviceStatus({ label, tone }: { label: string; tone: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.current?.contains(event.target as Node)) {
        if (details.current) details.current.open = false;
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);
  return (
    <details className={`device-status tone-${tone}`} ref={details}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") event.currentTarget.open = true;
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") event.currentTarget.open = false;
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
      }}>
      <summary aria-label={`Device Status: ${label}`}>
        <span className="led" aria-hidden="true" />
      </summary>
      <span className="status-message">{label}</span>
    </details>
  );
}

function HatchMark() {
  return (
    <svg
      viewBox="0 0 36 30"
      width="26"
      height="22"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 24V17C4 9.3 10.3 3 18 3S32 9.3 32 17V24M11 24V17a7 7 0 0 1 14 0v7M4 24h28"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path d="M18 24v-7" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

function LiveRange({
  id,
  label,
  icon,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const [sending, setSending] = useState(false);
  const editing = useRef(false);
  const committing = useRef(false);
  const reportedValue = useRef(value);
  reportedValue.current = value;
  useEffect(() => {
    if (committing.current) return;
    if (disabled) editing.current = false;
    if (!editing.current) setDraft(value);
  }, [value, disabled]);
  async function commit(next: number) {
    if (!editing.current || committing.current) return;
    editing.current = false;
    if (disabled || next === value) { setDraft(value); return; }
    committing.current = true;
    setSending(true);
    try { await onCommit(next); }
    finally {
      committing.current = false;
      setSending(false);
      setDraft(reportedValue.current);
    }
  }
  return (
    <div className="fader">
      <div className="fader-label">
        <label htmlFor={id}>{icon}<span>{label}</span></label>
        <PreciseValue label={label} value={draft} display={sending ? "Updating…" : percentage(draft)} disabled={disabled || sending}
          onCommit={next=>{editing.current=true;setDraft(next);void commit(next);}}/>
      </div>
      <input
        id={id}
        name={id}
        type="range"
        autoComplete="off"
        min="0"
        max="100"
        value={draft}
        style={{ "--fill": `${draft}%` } as CSSProperties}
        aria-valuetext={percentage(draft)}
        disabled={disabled || sending}
        onPointerDown={() => {
          editing.current = true;
        }}
        onChange={(event) => {
          editing.current = true;
          setDraft(Number(event.target.value));
        }}
        onPointerUp={(event) => void commit(Number(event.currentTarget.value))}
        onPointerCancel={() => {
          editing.current = false;
          setDraft(value);
        }}
        onKeyUp={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(event.key)
          )
            void commit(Number(event.currentTarget.value));
        }}
        onBlur={(event) => void commit(Number(event.currentTarget.value))}
      />
    </div>
  );
}

function DockMenu({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(event: PointerEvent) {
      if (
        details.current?.open &&
        !details.current.contains(event.target as Node)
      )
        details.current.open = false;
    }
    function activate(event: Event) {
      const target = event.target;
      if (
        target instanceof Element &&
        details.current?.open &&
        details.current.contains(target) &&
        target.closest(".dock-menu-panel a, .dock-menu-panel button")
      ) {
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("click", activate);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("click", activate);
    };
  }, []);
  return (
    <details
      className="dock-menu"
      ref={details}
      onKeyDown={(event) => {
        if (event.key === "Escape" && details.current?.open) {
          details.current.open = false;
          details.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="dock-item" aria-label="More Room Actions">
        <ChevronsUpDown size={20} aria-hidden="true" />
      </summary>
      <div className="dock-menu-panel">{children}</div>
    </details>
  );
}

export function SoundRoom({
  name,
  onLogout,
  signingOut = false,
  initialRoom,
}: {
  name: string;
  onLogout?: () => void;
  signingOut?: boolean;
  initialRoom?: RoomState;
}) {
  const [room, setRoom] = useState<RoomState | null>(initialRoom ?? null);
  const [loading, setLoading] = useState(!initialRoom);
  const [fetchError, setFetchError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState("");
  const [deviceIntent, setDeviceIntent] = useState<DeviceIntent | null>(null);
  const [alarmIntents, setAlarmIntents] = useState<Record<string, boolean>>({});
  const [alarmErrors, setAlarmErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [dirty, setDirty] = useState(false);
  const [studioDirty, setStudioDirty] = useState(false);
  const pendingRef = useRef(false);
  const deviceRequest = useRef(0);
  const alarmPendingRef = useRef(new Set<string>());
  const updates = useRef(new RoomUpdates());
  const fetchRef = useRef<Promise<boolean> | null>(null);
  const readSequence = useRef(0);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const subscribeLocation = useCallback(
    (onChange: () => void) => {
      let previousSearch = window.location.search;
      const pop = () => {
        const previousQuery = readQuery(previousSearch);
        const nextQuery = readQuery();
        const previousPanel = previousQuery.panel;
        const nextPanel = nextQuery.panel;
        if ((dirty && (previousPanel !== nextPanel || previousQuery.alarmId !== nextQuery.alarmId)) || (studioDirty && previousQuery.tab !== nextQuery.tab)) {
          if (
            !window.confirm(
              "Discard unsaved changes?",
            )
          ) {
            window.history.pushState({}, "", `/${previousSearch}`);
            return;
          }
          setDirty(false);
        }
        previousSearch = window.location.search;
        onChange();
        if (previousPanel && !nextPanel) focusPanelTrigger(previousPanel, previousQuery.alarmId);
      };
      const update = () => {
        previousSearch = window.location.search;
        onChange();
      };
      window.addEventListener("popstate", pop);
      window.addEventListener("sound-room-navigation", update);
      return () => {
        window.removeEventListener("popstate", pop);
        window.removeEventListener("sound-room-navigation", update);
      };
    },
    [dirty, studioDirty],
  );
  const locationSearch = useSyncExternalStore(
    subscribeLocation,
    () => window.location.search,
    () => "",
  );
  const query = useMemo(
    () => (locationSearch ? readQuery(locationSearch) : initialQuery),
    [locationSearch],
  );
  const refresh = useCallback((force = false): Promise<boolean> => {
    if (fetchRef.current && !force) return fetchRef.current;
    const sequence = ++readSequence.current;
    const revision = updates.current.read();
    setRefreshing(true);
    const request = api<RoomState>("/state")
      .then((next) => {
        if (!isRoomState(next))
          throw new Error(
            "The room returned incomplete information. Refresh to try again.",
          );
        if (sequence !== readSequence.current) return false;
        setRoom((current) => updates.current.merge(current, next, revision));
        setFetchError("");
        return true;
      })
      .catch((cause) => {
        if (sequence !== readSequence.current) return false;
        setFetchError(
          cause instanceof Error
            ? cause.message
            : "The room could not be loaded. Try refreshing.",
        );
        return false;
      })
      .finally(() => {
        if (sequence !== readSequence.current) return;
        setLoading(false);
        setRefreshing(false);
        fetchRef.current = null;
      });
    fetchRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    // A cancellable task avoids opening a request during Strict Mode's rehearsal.
    const initialRequest = initialRoom ? undefined : window.setTimeout(() => void refresh(), 0);
    const onFocus = () => {
      if (document.visibilityState === "visible")
        void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = setInterval(onFocus, 15_000);
    return () => {
      window.clearTimeout(initialRequest);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, initialRoom]);

  useEffect(() => {
    if (!dirty && !studioDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, studioDirty]);

  // The alarm screen is printed on blue; keep the browser chrome matched to it.
  useEffect(() => {
    document.documentElement.dataset.screen = query.tab;
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
  }, [query.tab]);

  const previousTab = useRef(query.tab);
  useEffect(() => {
    if (previousTab.current === query.tab) return;
    previousTab.current = query.tab;
    window.scrollTo({ top: 0 });
    pageHeading.current?.focus({ preventScroll: true });
  }, [query.tab]);

  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function navigate(patch: Partial<RoomQuery>, replace = false) {
    const next = { ...query, ...patch };
    if (patch.panel !== undefined && patch.alarmId === undefined) next.alarmId = null;
    if (
      ((dirty && (next.panel !== query.panel || next.alarmId !== query.alarmId)) || (studioDirty && next.tab !== query.tab)) &&
      !window.confirm(
        "Discard unsaved changes?",
      )
    )
      return false;
    if (next.panel !== query.panel || next.alarmId !== query.alarmId || next.tab !== query.tab) setDirty(false);
    window.history[replace ? "replaceState" : "pushState"](
      {},
      "",
      queryHref(next),
    );
    window.dispatchEvent(new Event("sound-room-navigation"));
    return true;
  }

  function navLink(patch: Partial<RoomQuery>) {
    return {
      href: queryHref({ ...query, ...(patch.panel !== undefined ? { alarmId: null } : {}), ...patch }),
      onClick: (event: MouseEvent<HTMLAnchorElement>) => {
        if (plainClick(event)) {
          event.preventDefault();
          navigate(patch);
        }
      },
    };
  }

  async function command(
    key: string,
    path: string,
    body: unknown,
    message: string,
    method: "POST" | "PATCH" | "DELETE" = "POST",
  ): Promise<"accepted" | "rejected" | "unknown"> {
    if (pendingRef.current) return "rejected";
    pendingRef.current = true;
    const scope = key === "sync-hatch" || key.startsWith("remove-") ? "library" : "device";
    const request = scope === "device" ? ++deviceRequest.current : 0;
    if (scope === "device") {
      const input = body as { trackId?: string; volume?: number; color?: string; brightness?: number };
      setDeviceIntent({ key, phase: "sending",
        ...(key.startsWith("play-") ? { trackId: input.trackId } : {}),
        ...(key === "volume" ? { volume: input.volume } : {}),
        ...(key === "stop" ? { turnOff: true, light: { on: false, brightness: 0 } } : {}),
        ...(path === "/light" ? { light: { ...(input.color ? { color: input.color } : {}), ...(input.brightness !== undefined ? { brightness: input.brightness, on: input.brightness > 0 } : {}) } } : {}),
      });
    }
    const finish = updates.current.begin(scope);
    setPending(key);
    setNotice(null);
    let uncertain = false;
    try {
      const result = await api<{ tracks?: Track[]; hatch?: RoomState["hatch"] }>(path, jsonRequest(method, body));
      if (scope === "device") setDeviceIntent((current) => request === deviceRequest.current && current ? { ...current, phase: "confirming" } : current);
      if (scope === "library") setRoom((current) => current ? {
        ...current,
        library: result.tracks ? mergeSyncedLibrary(current.library, result.tracks) : key.startsWith("remove-") ? current.library.filter((track) => track.id !== key.slice(7)) : current.library,
        hatch: result.hatch ?? current.hatch,
      } : current);
      haptic("success");
      setNotice({ text: message, error: false });
      return "accepted";
    } catch (cause) {
      uncertain = scope === "device" && !(cause instanceof ApiError && cause.definitiveRejection);
      if (scope === "device" && request === deviceRequest.current)
        setDeviceIntent((current) => uncertain && current ? { ...current, phase: "confirming" } : null);
      haptic("error");
      setNotice({
        text:
          cause instanceof Error
            ? cause.message
            : "The request failed. Try again.",
        error: true,
      });
      return uncertain ? "unknown" : "rejected";
    } finally {
      finish();
      pendingRef.current = false;
      setPending("");
      // Read reported device state in the background; acceptance releases controls.
      if (scope === "device") void refresh(true).then((reported) => {
        if (request !== deviceRequest.current) return;
        setDeviceIntent(null);
        if (uncertain) setNotice({
          text: reported
            ? "The command’s result was uncertain. The latest Hatch report is shown; check the device before trying again."
            : "The command’s result is unknown, and its status could not be refreshed. Check your connection and refresh the room before trying again.",
          error: true,
        });
      });
    }
  }

  const beginFormMutation = useCallback((scope: UpdateScope) => updates.current.begin(scope), []);

  async function formSuccess(message: string, result: FormResult) {
    setRoom((current) => applyFormResult(current, result));
    haptic("success");
    setDirty(false);
    const next = {
      ...query,
      panel: null,
      alarmId: null,
      q: "",
      tab: studioDirty && query.tab === "lights" ? "lights" as Tab : query.panel === "alarm" ? "alarms" as Tab : "sounds" as Tab,
      collection:
        query.panel === "save-sound"
          ? ("saved" as const)
          : query.panel === "upload"
            ? ("uploads" as const)
            : query.collection,
    };
    window.history.pushState({}, "", queryHref(next));
    window.dispatchEvent(new Event("sound-room-navigation"));
    setNotice({ text: message, error: false });
    window.requestAnimationFrame(() =>
      pageHeading.current?.focus({ preventScroll: true }),
    );
    if (result.deletedAlarmId) void refresh(true);
  }

  const canControl = Boolean(room?.ready && room.connected && !fetchError);
  const disabled = !canControl || Boolean(pending);
  const tracks = room?.library || emptyTracks;
  const scenes = room?.scenes || emptyScenes;
  const alarms = room?.alarms || emptyAlarms;
  const search = query.q.trim().toLocaleLowerCase();
  const collectionTracks = useMemo(
    () =>
      tracks.filter(
        (track) =>
          query.collection === "all" ||
          collectionOf(track) === query.collection,
      ),
    [tracks, query.collection],
  );
  const filteredTracks = useMemo(
    () =>
      collectionTracks.filter((track) =>
        [
          track.title,
          kindLabel(track.kind),
          track.category,
          track.source,
          track.license,
          ...(track.tags || []),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
      ),
    [collectionTracks, search],
  );
  const categories = useMemo(() => categoriesFor(tracks), [tracks]);
  const soundGroups = useMemo(() => {
    const grouped = new Map<string, Track[]>();
    for (const track of filteredTracks) {
      const key = track.category ? `category:${track.category}` : `collection:${collectionOf(track)}`;
      const group = grouped.get(key);
      if (group) group.push(track); else grouped.set(key, [track]);
    }
    return [
      ...categories.map((title) => ({ key: `category:${title}`, title })),
      ...collections.filter((group) => !["all", "hatch"].includes(group.id)).map((group) => ({ key: `collection:${group.id}`, title: group.title })),
    ].map((group) => ({ ...group, tracks: grouped.get(group.key) ?? emptyTracks })).filter((group) => group.tracks.length > 0);
  }, [categories, filteredTracks]);
  const sortedAlarms = useMemo(
    () =>
      [...alarms].sort((a, b) => {
        const timeA = a.localTime || new Date(a.scheduledAt).toISOString().slice(11, 16);
        const timeB = b.localTime || new Date(b.scheduledAt).toISOString().slice(11, 16);
        return timeA.localeCompare(timeB) || a.createdAt.localeCompare(b.createdAt);
      }),
    [alarms],
  );
  const nextAlarm = [...alarms].filter((alarm) => alarmEnabled(alarm) || ["starting", "ringing"].includes(alarm.status))
    .sort((a, b) => Number(["starting", "ringing"].includes(b.status)) - Number(["starting", "ringing"].includes(a.status)) || Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  const isPlaying = Boolean(room?.playback.active);
  const playingTrack = isPlaying
    ? tracks.find((track) => track.id === room?.playback.trackId)
    : undefined;
  const canTurnOffHatch = Boolean(
    room && (room.playback.status !== "none" || room.light.on || deviceIntent?.trackId || deviceIntent?.light?.on),
  );
  const currentTitle = isPlaying
    ? room?.playback.title || "Hatch Routine"
    : "Nothing Playing";
  const playerIntent = Boolean(deviceIntent?.trackId || deviceIntent?.turnOff);
  const playerTrack = deviceIntent?.trackId ? tracks.find((track) => track.id === deviceIntent.trackId) : playingTrack;
  const pendingKey = deviceIntent?.key ?? pending;
  const pendingLabel = deviceIntent?.phase === "confirming" ? "Confirming…" : "Sending…";
  const statusLabel = loading
    ? "Connecting…"
    : fetchError
      ? "Status Unavailable"
      : !room?.ready
        ? "Not Ready"
        : room.connected
          ? "Connected"
          : "Offline";
  const statusTone = loading ? "waiting" : canControl ? "ok" : "fault";
  const activeTab = tabs.find((tab) => tab.id === query.tab) || tabs[0];

  function play(track: Track) {
    void command(
      `play-${track.id}`,
      "/play",
      { trackId: track.id },
      `Playback request accepted for “${track.title}”. Check your Hatch to confirm the sound.`,
    );
  }
  function remove(track: Track) {
    if (
      window.confirm(
        `Remove “${track.title}” from your collection? This cannot be undone.`,
      )
    )
      void command(
        `remove-${track.id}`,
        `/library/${encodeURIComponent(track.id)}`,
        {},
        "The sound was removed from your collection.",
        "DELETE",
      );
  }
  async function toggleAlarm(alarm: Alarm) {
    if (alarmPendingRef.current.has(alarm.id)) return;
    alarmPendingRef.current.add(alarm.id);
    const enabled = !alarmEnabled(alarm);
    const finish = updates.current.begin("alarms");
    setAlarmIntents((current) => ({ ...current, [alarm.id]: enabled }));
    setAlarmErrors((current) => ({ ...current, [alarm.id]: "" }));
    setNotice(null);
    let failed = false;
    try {
      const result = await api<{ alarm: Alarm }>(`/alarms/${encodeURIComponent(alarm.id)}`, jsonRequest("PATCH", { enabled }));
      setRoom((current) => applyFormResult(current, result));
      haptic("success");
      setNotice({ text: enabled ? "Alarm turned on." : "Alarm turned off.", error: false });
    } catch (cause) {
      failed = true;
      haptic("error");
      const text = cause instanceof Error ? cause.message : "The alarm could not be changed. Refresh the room to check its status.";
      setAlarmErrors((current) => ({ ...current, [alarm.id]: text }));
      setNotice({ text, error: true });
    } finally {
      finish();
      alarmPendingRef.current.delete(alarm.id);
      // Remove only this request's overlay. Other alarms keep their own intent.
      setAlarmIntents((current) => {
        const next = { ...current };
        delete next[alarm.id];
        return next;
      });
      // A timeout can be ambiguous. Reconcile after releasing the write guard.
      if (failed) void refresh(true);
    }
  }
  function turnOff() {
    void command(
      "stop",
      "/stop",
      {},
      "Turn-off request accepted. Check your Hatch to confirm the sound and light are off.",
    );
  }
  const closePanel = () => {
    if (navigate({ panel: null })) focusPanelTrigger(query.panel, query.alarmId);
  };

  const pageAction =
    query.tab === "sounds" ? (
      <a
        className="round-key"
        aria-label="Upload a Sound"
        data-panel-trigger="upload"
        {...navLink({ panel: "upload" })}
      >
        <Plus size={22} aria-hidden="true" />
      </a>
    ) : query.tab === "alarms" ? (
      <a
        className="round-key"
        aria-label="New Alarm"
        data-panel-trigger="alarm"
        {...navLink({ panel: "alarm" })}
      >
        <Plus size={22} aria-hidden="true" />
      </a>
    ) : null;

  let screen: ReactNode;
  if (loading)
    screen = (
      <div className="screen-state" role="status">
        <BusyIcon size={22} />
        <p>Opening Your Sound Room…</p>
      </div>
    );
  else if (!room)
    screen = (
      <div className="empty-sleeve">
        <HatchMark />
        <h2>Your Room Will Appear Here</h2>
        <p>Refresh when your connection is ready.</p>
        <button
          className="key"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshIcon size={16} busy={refreshing} />
          {refreshing ? "Refreshing…" : "Refresh Room"}
        </button>
      </div>
    );
  else if (query.tab === "all")
    screen = (
      <div className="room-grid">
        <section className="device-card" aria-labelledby="device-title">
          <HatchDevice
            on={deviceIntent?.light?.on ?? room.light.on}
            color={deviceIntent?.light?.color ?? room.light.color}
            brightness={deviceIntent?.light?.brightness ?? room.light.brightness}
          />
          <div className="device-caption">
            <h2 id="device-title" translate="no">
              {room.device.product || "Hatch"}
            </h2>
            <p>
              {isPlaying ? "Sound On" : "Sound Off"}
              <span aria-hidden="true"> · </span>
              {room.light.on
                ? `Light ${percentage(room.light.brightness)}`
                : "Light Off"}
            </p>
            {deviceIntent?.light && <p role="status">{pendingLabel}</p>}
          </div>
          <a className="pill-link" {...navLink({ tab: "lights" })}>
            Adjust Light
            <ChevronRight size={16} aria-hidden="true" />
          </a>
        </section>

        <section className="sleeve" aria-labelledby="now-title">
          <RecordPlayer key={playerTrack?.id ?? "idle"} track={playerTrack} title={playerTrack?.title || currentTitle} playing={playerIntent ? false : isPlaying}
            statusLabel={playerIntent ? deviceIntent?.turnOff ? deviceIntent.phase === "sending" ? "Turning Off…" : "Confirming Off…" : pendingLabel : undefined}
            index={playerTrack ? tracks.indexOf(playerTrack) : 0} />
          <div className="sleeve-body">
            <LiveRange
              id="room-volume"
              label="Volume"
              icon={<Volume2 size={16} aria-hidden="true" />}
              value={room.playback.volume || 0}
              disabled={disabled}
              onCommit={async (volume) => {
                const outcome = await command(
                  "volume",
                  "/volume",
                  { volume },
                  "Volume request accepted. The latest device report appears above.",
                  "PATCH",
                );
                // Only this fader waits for the fresh report; other controls unlock.
                if (outcome !== "rejected" && fetchRef.current) await fetchRef.current;
                return outcome === "accepted";
              }}
            />
            <button
              className="key key-ink power-key"
              disabled={disabled || !canTurnOffHatch}
              aria-describedby="hatch-off-help"
              onClick={turnOff}
            >
              {pendingKey === "stop" ? (
                <BusyIcon size={16} />
              ) : (
                <Power size={16} aria-hidden="true" />
              )}
              <span>
                {pendingKey === "stop" ? (
                  deviceIntent?.phase === "confirming" ? "Confirming Off…" : "Turning Off…"
                ) : (
                  <>
                    Turn Off <span translate="no">Hatch</span>
                  </>
                )}
              </span>
            </button>
            <p className="hint" id="hatch-off-help">
              Stops sound and light.
            </p>
            {room.playback.captureKey && (
              <a
                className="pill-link"
                data-panel-trigger="save-sound"
                {...navLink({ panel: "save-sound" })}
              >
                <BookmarkPlus size={16} aria-hidden="true" /> Save Current Sound
              </a>
            )}
          </div>
        </section>

        <NextAlarmCard
          alarm={nextAlarm}
          tracks={tracks}
          alarmsLink={navLink({ tab: "alarms" })}
          newLink={navLink({ panel: "alarm" })}
        />

        <section className="deck-section" aria-labelledby="deck-title">
          <div className="section-head">
            <h2 id="deck-title">Your Sounds</h2>
            <a className="pill-link" {...navLink({ tab: "sounds" })}>
              See All {tracks.length ? number(tracks.length) : ""}
              <ChevronRight size={16} aria-hidden="true" />
            </a>
          </div>
          {tracks.length ? (
            <ul className="deck" aria-label="Play a Sound">
              {tracks.slice(0, 12).map((track, index) => {
                const active = isPlaying && room.playback.trackId === track.id;
                return (
                  <li key={track.id} className="deck-item">
                    <button
                      className={`deck-card ${active ? "is-playing" : ""}`}
                      disabled={disabled}
                      onClick={() => play(track)}
                      aria-label={`Play ${track.title} on Hatch`}
                    >
                      <TrackArtwork track={track} index={index} />
                      {(active || pendingKey === `play-${track.id}`) && (
                        <span className="card-sticker" aria-hidden="true">
                          {pendingKey === `play-${track.id}`
                            ? pendingLabel
                            : "Playing"}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty-sleeve">
              <h3>Your Collection Starts Here</h3>
              <p>Add an MP3 or WAV to make the room your own.</p>
              <a
                className="key"
                data-panel-trigger="upload"
                {...navLink({ panel: "upload" })}
              >
                <Upload size={16} aria-hidden="true" />
                Upload a Sound
              </a>
            </div>
          )}
        </section>

        <footer className="about-note" id="about-room">
          <h2 tabIndex={-1}>On Your Hatch</h2>
          <p>
            Hold the top for about 3&nbsp;seconds to stop. A short tap switches
            to a saved favorite.
          </p>
        </footer>
      </div>
    );
  else if (query.tab === "lights")
    screen = (
      <LightStudio light={room.light} sequence={room.lightSequence} pending={pending} intent={deviceIntent}
        onSequence={recipe => void command("studio-play", "/light-sequence", recipe, "Sequence sent to Hatch.")}
        onStopSequence={() => void command("studio-stop", "/light-sequence", {}, "Motion stopped.", "DELETE")}
        onOff={() => void command("light-off", "/light", { brightness: 0 }, "Light-off request sent.", "PATCH")}
        onDirty={setStudioDirty} scenes={scenes} disabled={disabled}
        onSolid={scene => void command("studio-solid", "/light", { color: scene.color, brightness: scene.brightness }, "Color sent to Hatch.", "PATCH")}
      />
    );
  else if (query.tab === "sounds")
    screen = (
      <div className="sounds-screen">
        <nav className="collection-tabs" aria-label="Sound Collection">
          {collections.map((group) => (
            <a
              key={group.id}
              {...navLink({ collection: group.id })}
              aria-current={query.collection === group.id ? "page" : undefined}
            >
              {group.title}
            </a>
          ))}
        </nav>
        <div className="library-actions">
          <button
            className="key key-compact"
            disabled={Boolean(pending)}
            onClick={() =>
              void command(
                "sync-hatch",
                "/hatch/sync",
                {},
                "Hatch favorites were refreshed. Your built-in sounds are ready to select.",
              )
            }
          >
            <RefreshIcon size={16} busy={pending === "sync-hatch"} />
            {pending === "sync-hatch" ? "Syncing…" : "Sync Hatch"}
          </button>
          <a
            className="key key-compact"
            data-panel-trigger="save-sound"
            {...navLink({ panel: "save-sound" })}
          >
            <BookmarkPlus size={16} aria-hidden="true" /> Save Current Sound
          </a>
        </div>
        <p className="collection-note">
          {query.collection === "favorites"
            ? "Save favorites in the Hatch app, then sync them here. Each uses its saved light, volume, and timing. Turn Hatch off before restarting an already selected favorite."
            : query.collection === "saved"
              ? "Keep a sound you discover in the Hatch app. Saved sounds keep their original timer and may need to be saved again if Hatch changes them."
              : query.collection === "hatch"
                ? "Built-in sounds for your Hatch. Check playback on your device before using a new sound for an alarm."
                : "Your recordings, Hatch sounds, and favorites in one collection."}
          {room.hatch?.syncedAt && (
            <span>
              {" "}
              Favorites synced{" "}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(room.hatch.syncedAt))}
              .
            </span>
          )}
        </p>
        <div className="toolbar">
          <div className="search-well">
            <Search size={18} aria-hidden="true" />
            <label className="sr-only" htmlFor="room-search">
              Search Sounds
            </label>
            <input
              id="room-search"
              name="q"
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.blur();}}}
              placeholder="Search titles or tags…"
              value={query.q}
              onChange={(event) => navigate({ q: event.target.value }, true)}
            />
            {query.q && (
              <button
                className="well-clear"
                aria-label="Clear Search"
                onClick={() => navigate({ q: "" }, true)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <nav className="segmented" aria-label="Sound View">
            <a
              {...navLink({ view: "grid" })}
              aria-label="Cards"
              aria-current={query.view === "grid" ? "page" : undefined}
            >
              <LayoutGrid size={18} aria-hidden="true" />
            </a>
            <a
              {...navLink({ view: "table" })}
              aria-label="List"
              aria-current={query.view === "table" ? "page" : undefined}
            >
              <List size={18} aria-hidden="true" />
            </a>
          </nav>
        </div>
        <p className="result-count" aria-live="polite">
          {search
            ? `${number(filteredTracks.length)} of ${number(collectionTracks.length)} ${collectionTracks.length === 1 ? "sound" : "sounds"} match “${query.q.trim()}”`
            : `${number(filteredTracks.length)} ${filteredTracks.length === 1 ? "sound" : "sounds"}`}
        </p>
        {!filteredTracks.length ? (
          <div className="empty-sleeve">
            <h2>
              {search
                ? "No Matching Sounds"
                : query.collection === "favorites"
                  ? "Bring Your Favorites In"
                  : query.collection === "saved"
                    ? "Keep a Sound You Love"
                    : "Your Collection Starts Here"}
            </h2>
            <p>
              {search
                ? "Try another title or tag, or clear your search."
                : query.collection === "favorites"
                  ? "Add a favorite in the Hatch app, then choose Sync Hatch above."
                  : query.collection === "saved"
                    ? "Play a sound in the Hatch app, refresh the room, then choose Save Current Sound."
                    : "Add an MP3 or WAV to make the room your own."}
            </p>
            {search ? (
              <button className="key" onClick={() => navigate({ q: "" }, true)}>
                Clear Search
              </button>
            ) : query.collection !== "favorites" &&
              query.collection !== "saved" ? (
              <a
                className="key"
                data-panel-trigger="upload"
                {...navLink({ panel: "upload" })}
              >
                <Upload size={16} aria-hidden="true" />
                Upload a Sound
              </a>
            ) : null}
          </div>
        ) : (
          <div className="sound-categories">
            {soundGroups.map((group) => (
              <section className="sound-category" key={group.key} aria-label={group.title}>
                <h2 className="category-label">{group.title}</h2>
                {query.view === "grid" ? (
                  <ul className="card-grid">
                    {group.tracks.map((track) => (
                      <li key={track.id}>
                        <SoundCard
                          track={track}
                          index={tracks.indexOf(track)}
                          active={isPlaying && room.playback.trackId === track.id}
                          pending={pendingKey}
                          pendingLabel={pendingLabel}
                          disabled={disabled}
                          onPlay={() => play(track)}
                          onRemove={() => remove(track)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="sound-list">
                    {group.tracks.map((track) => {
                      const active = isPlaying && room.playback.trackId === track.id;
                      return (
                        <li key={track.id} className="sound-row">
                          <span
                            className="row-chip"
                            style={
                              { "--paper": trackInk(track).paper } as CSSProperties
                            }
                            aria-hidden="true"
                          />
                          <div className="row-text">
                            <h3>{track.title}</h3>
                            <p>
                              {kindLabel(track.kind)}
                              <span aria-hidden="true"> · </span>
                              <span className="tabular">{trackTiming(track)}</span>
                              {active && <span className="row-live">Playing</span>}
                            </p>
                          </div>
                          <button
                            className="key key-compact"
                            disabled={disabled}
                            onClick={() => play(track)}
                            aria-label={`Play ${track.title} on Hatch`}
                          >
                            {pendingKey === `play-${track.id}` ? pendingLabel : "Play"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    );
  else
    screen = (
      <AlarmList
        alarms={sortedAlarms}
        tracks={tracks}
        intents={alarmIntents}
        errors={alarmErrors}
        onToggle={toggleAlarm}
        editLink={(alarm) => navLink({ panel: "alarm", alarmId: alarm.id })}
        alarmLink={navLink({ panel: "alarm" })}
      />
    );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to Content
      </a>
      <header className="top-bar">
        <a
          className="brand"
          aria-label="Hatch Sound Room"
          translate="no"
          {...navLink({ tab: "all", panel: null })}
        >
          <HatchMark />
        </a>
        <DeviceStatus label={statusLabel} tone={statusTone} />
      </header>

      <main id="main-content" className="screen">
        <div className="page-head">
          <div>
            <p className="eyebrow" translate="no">
              {name}’s Hatch
            </p>
            <h1 id="page-title" ref={pageHeading} tabIndex={-1}>
              {activeTab.title}
            </h1>
          </div>
          {pageAction}
        </div>

        {fetchError && (
          <div className="fault-card" role="status">
            <p>
              <strong>
                {room
                  ? "Device Status Could Not Be Refreshed"
                  : "Your Room Is Unavailable"}
              </strong>
              <span>{fetchError}</span>
              {room && <small>Showing the last successful refresh.</small>}
            </p>
            <button
              className="key key-compact"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshIcon size={15} busy={refreshing} />
              {refreshing ? "Retrying…" : "Try Again"}
            </button>
          </div>
        )}

        <div aria-busy={loading}>{screen}</div>
      </main>

      {query.panel === "feedback" && (
        <Sheet titleId="feedback-title" onClose={closePanel} busy={false}>
          <div className="touch-feedback-header">
            <h2 id="feedback-title" tabIndex={-1}>Touch Feedback</h2>
            <button className="key key-compact" onClick={closePanel}>Done</button>
          </div>
          <HapticSettings />
        </Sheet>
      )}
      {query.panel === "upload" && (
        <UploadForm
          categories={categories}
          tagSuggestions={[...new Set(tracks.flatMap(track=>track.tags))]}
          onClose={closePanel}
          onDirty={setDirty}
          onMutationStart={beginFormMutation}
          onSuccess={formSuccess}
        />
      )}
      {query.panel === "alarm" && room && (
        query.alarmId && !alarms.some((alarm) => alarm.id === query.alarmId) ? (
          <Sheet titleId="missing-alarm-heading" onClose={closePanel} busy={false}>
            <h2 id="missing-alarm-heading" tabIndex={-1}>Alarm Unavailable</h2>
            <p>This alarm may have been deleted. Close this sheet and refresh the room.</p>
            <button className="key key-blue" onClick={closePanel}>Close</button>
          </Sheet>
        ) : <AlarmForm
          key={query.alarmId || "new"}
          tracks={tracks}
          alarm={alarms.find((alarm) => alarm.id === query.alarmId)}
          onClose={closePanel}
          onDirty={setDirty}
          onMutationStart={beginFormMutation}
          onSuccess={formSuccess}
        />
      )}
      {query.panel === "save-sound" && room && (
        <SaveSoundForm
          categories={categories}
          captureKey={room.playback.captureKey ?? null}
          title={
            playingTrack?.kind === "hatch-favorite"
              ? "Hatch Sound"
              : currentTitle
          }
          onClose={closePanel}
          onDirty={setDirty}
          onMutationStart={beginFormMutation}
          onSuccess={formSuccess}
        />
      )}

      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {notice && (
          <div className={`toast ${notice.error ? "toast-error" : ""}`}>
            {notice.error ? (
              <CircleHelp size={18} aria-hidden="true" />
            ) : (
              <Check size={18} aria-hidden="true" />
            )}
            <span>{notice.text}</span>
            <button
              className="toast-close"
              aria-label="Dismiss Message"
              onClick={() => setNotice(null)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <nav className="dock" aria-label="Sound Room">
        <ul>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <li key={tab.id}>
                <a
                  className="dock-item"
                  aria-current={query.tab === tab.id ? "page" : undefined}
                  data-label={tab.label}
                  {...navLink({ tab: tab.id, panel: null })}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="sr-only">{tab.label}</span>
                </a>
              </li>
            );
          })}
          <li>
            <DockMenu>
              <a data-panel-trigger="feedback" {...navLink({ panel: "feedback" })}>
                <Vibrate size={18} aria-hidden="true" /> Touch Feedback
              </a>
              <a data-panel-trigger="upload" {...navLink({ panel: "upload" })}>
                <Upload size={18} aria-hidden="true" /> Upload a Sound
              </a>
              <a data-panel-trigger="alarm" {...navLink({ panel: "alarm" })}>
                <AlarmClock size={18} aria-hidden="true" /> New Alarm
              </a>
              <button onClick={() => void refresh()} disabled={refreshing}>
                <RefreshIcon size={18} busy={refreshing} />
                {refreshing ? "Refreshing…" : "Refresh Device Status"}
              </button>
              <a
                href="/#about-room"
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  if (!navigate({ tab: "all", panel: null })) return;
                  window.requestAnimationFrame(() => {
                    const about = document.getElementById("about-room");
                    about?.scrollIntoView({ block: "center" });
                    about?.querySelector<HTMLElement>("h2")?.focus({
                      preventScroll: true,
                    });
                  });
                }}
              >
                <CircleHelp size={18} aria-hidden="true" /> Using Your Hatch
              </a>
              {onLogout && (
                <button
                  disabled={signingOut}
                  onClick={() => {
                    if (
                      (!dirty && !studioDirty) ||
                      window.confirm(
                        "Discard your unsaved changes and sign out?",
                      )
                    )
                      onLogout();
                  }}
                >
                  <LogOut size={18} aria-hidden="true" />
                  {signingOut ? "Signing Out…" : "Sign Out"}
                </button>
              )}
            </DockMenu>
          </li>
        </ul>
      </nav>
    </>
  );
}

function SoundCard({
  track,
  index,
  active,
  pending,
  pendingLabel,
  disabled,
  onPlay,
  onRemove,
}: {
  track: Track;
  index: number;
  active: boolean;
  pending: string;
  pendingLabel: string;
  disabled: boolean;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const sending = pending === `play-${track.id}`;
  return (
    <article className={`sound-card ${active ? "is-playing" : ""}`}>
      <button
        className="card-trigger"
        disabled={disabled}
        onClick={onPlay}
        aria-label={`Play ${track.title} on Hatch`}
      >
        <TrackArtwork track={track} index={index} />
        {(active || sending) && (
          <span className="card-sticker" aria-hidden="true">
            {sending ? pendingLabel : "Playing"}
          </span>
        )}
      </button>
      <div className="card-caption">
        <h3>{track.title}</h3>
        <p>
          {kindLabel(track.kind)}
          <span aria-hidden="true"> · </span>
          <span className="tabular">{trackTiming(track)}</span>
        </p>
      </div>
      <details className="card-details">
        <summary aria-label={`Details for ${track.title}`}>
          <Ellipsis size={18} aria-hidden="true" />
        </summary>
        <div>
          {track.source && (
            <p>
              <span>Source</span>
              {track.source}
            </p>
          )}
          {track.license && (
            <p>
              <span>Rights</span>
              {track.license}
            </p>
          )}
          {Boolean(track.tags?.length) && (
            <p>
              <span>Tags</span>
              {track.tags.join(", ")}
            </p>
          )}
          {!track.source && !track.license && !track.tags?.length && (
            <p>No source notes or tags were added.</p>
          )}
          {track.removable !== false && track.id !== "bach-allemanda" && (
            <button
              className="text-button danger"
              disabled={Boolean(pending) || active}
              onClick={onRemove}
            >
              Remove Sound
              {active && <small>Stop this sound first.</small>}
            </button>
          )}
        </div>
      </details>
    </article>
  );
}

function clockHands(at: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(at);
    const read = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);
    return { hours: read("hour"), minutes: read("minute") };
  } catch {
    return { hours: null, minutes: null };
  }
}

type LinkProps = {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

function NextAlarmCard({
  alarm,
  tracks,
  alarmsLink,
  newLink,
}: {
  alarm: Alarm | undefined;
  tracks: Track[];
  alarmsLink: LinkProps;
  newLink: LinkProps;
}) {
  if (!alarm)
    return (
      <section className="blue-card" aria-labelledby="next-alarm-title">
        <ClockFace hours={7} minutes={0} />
        <div className="blue-card-text">
          <h2 id="next-alarm-title">No Alarm Set</h2>
          <p>Give a morning a time, a sound, and a little light.</p>
          <a
            className="pill-link on-blue"
            data-panel-trigger="alarm"
            {...newLink}
          >
            New Alarm
            <Plus size={16} aria-hidden="true" />
          </a>
        </div>
      </section>
    );
  const ringing = ["starting", "ringing"].includes(alarm.status);
  const instant = ringing ? alarm.lastOccurrence?.scheduledAt || alarm.scheduledAt : alarm.scheduledAt;
  const at = new Date(instant);
  const zoned = timeParts(at, alarm.timeZone);
  const hands = clockHands(at, alarm.timeZone);
  return (
    <section className="blue-card" aria-labelledby="next-alarm-title">
      <ClockFace hours={hands.hours} minutes={hands.minutes} />
      <div className="blue-card-text">
        <p className="blue-kicker">
          {ringing ? "Alarm Ringing" : "Next Alarm"}
        </p>
        <h2 id="next-alarm-title" className="big-time">
          <time dateTime={instant}>
            {zoned.time}
            {zoned.period && <small>{zoned.period}</small>}
          </time>
          <span className="sr-only">, {alarm.label}</span>
        </h2>
        <p>
          {alarm.label || "Alarm"} · {shortDate(at, alarm.timeZone)}
          {!ringing && <> · {fromNow(at.getTime())}</>}
        </p>
        <p className="blue-meta">
          {alarm.sourceTitle ||
            tracks.find((track) => track.id === alarm.trackId)?.title ||
            "Sound Unavailable"}
        </p>
        <a className="pill-link on-blue" {...alarmsLink}>
          All Alarms
          <ChevronRight size={16} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

function AlarmList({
  alarms,
  tracks,
  intents,
  errors,
  onToggle,
  alarmLink,
  editLink,
}: {
  alarms: Alarm[];
  tracks: Track[];
  intents: Record<string, boolean>;
  errors: Record<string, string>;
  onToggle: (alarm: Alarm) => void;
  alarmLink: LinkProps;
  editLink: (alarm: Alarm) => LinkProps;
}) {
  if (!alarms.length) return (
    <div className="alarm-empty">
      <ClockFace hours={7} minutes={0} />
      <h2>No Alarms</h2>
      <p>Give your next morning a time, a sound, and a little light.</p>
      <a className="key key-paper" data-panel-trigger="alarm" {...alarmLink}>
        <Plus size={16} aria-hidden="true" /> New Alarm
      </a>
    </div>
  );
  const firstActive = [...alarms].filter(alarmEnabled).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  return <>
    <ul className="alarm-list">
      {alarms.map((alarm) => {
        const saving = Object.hasOwn(intents, alarm.id);
        const enabled = saving ? intents[alarm.id] : alarmEnabled(alarm);
        const ringing = ["starting", "ringing"].includes(alarm.status);
        const { time, period } = alarmTime(alarm);
        const trackTitle = alarm.sourceTitle || tracks.find((track) => track.id === alarm.trackId)?.title || "Sound Unavailable";
        const name = alarm.label || "Alarm";
        const edit = editLink(alarm);
        return <li key={alarm.id} className={`alarm-row ${alarm === firstActive ? "is-next" : ""} ${enabled || ringing ? "" : "is-past"}`} aria-busy={saving}>
          <a className="alarm-edit" data-panel-trigger="alarm" data-alarm-id={alarm.id} {...edit} aria-disabled={saving || undefined}
            onClick={(event) => { if (saving) event.preventDefault(); else edit.onClick(event); }} aria-label={`Edit ${name}, ${time} ${period}`}>
            <time className="big-time" dateTime={alarm.localTime || alarm.scheduledAt}>{time}{period && <small>{period}</small>}</time>
            <span className="alarm-row-label">{name}<span aria-hidden="true"> · </span>{alarm.repeatDays?.length ? repeatLabel(alarm.repeatDays) : "Once"}</span>
            <span className="alarm-row-sound">{trackTitle}</span>
          </a>
          <label className="alarm-switch">
            <input type="checkbox" role="switch" checked={enabled} disabled={saving}
              aria-describedby={saving ? `alarm-saving-${alarm.id}` : undefined}
              aria-label={`${name}, ${time} ${period}`} onChange={() => onToggle(alarm)} />
            <span className="alarm-switch-track" aria-hidden="true"><span className="alarm-switch-thumb">
              {saving && <BusyIcon size={15} />}
            </span></span>
          </label>
          <span className="sr-only" id={`alarm-saving-${alarm.id}`} role="status">{saving ? "Saving alarm…" : ""}</span>
          {ringing && <p className="alarm-row-notice">{alarm.status === "starting" ? "Starting…" : "Ringing"} · Hold Hatch to stop.</p>}
          {!ringing && enabled && <p className="sr-only">Next: {shortDate(new Date(alarm.scheduledAt), alarm.timeZone)}</p>}
          {alarm.reason && <p className="alarm-reason">{alarm.reason}</p>}
          {errors[alarm.id] && <p className="alarm-reason" role="status">{errors[alarm.id]}</p>}
        </li>;
      })}
    </ul>
    <p className="alarm-footnote">Alarms run with this page closed. Hold the top of your <span translate="no">Hatch</span> for about 3&nbsp;seconds to stop.</p>
  </>;
}
