export type Track = {
  id: string;
  title: string;
  kind:
    | "music"
    | "field-recording"
    | "generated"
    | "hatch-sound"
    | "hatch-favorite"
    | "saved-sound";
  category?: string;
  durationSeconds: number;
  source?: string;
  license?: string;
  tags: string[];
  createdAt?: string;
  timing?: string;
  removable?: boolean;
  alarmEligible?: boolean;
  stepCount?: number;
  nativeLightId?: number;
  volume?: number;
  light?: { color: string; from: number; to: number; rampSeconds: number };
  cover?: "bach" | "music" | "recording" | "noise";
};

export type Scene = {
  id: string;
  title: string;
  color: string;
  brightness: number;
  description: string;
};

export type Alarm = {
  id: string;
  label: string;
  enabled: boolean;
  localTime: string;
  repeatDays: number[];
  trackId: string;
  sourceTitle?: string;
  sourceKind?: Track["kind"];
  usesFavoriteSettings?: boolean;
  scheduledAt: string;
  timeZone: string;
  volume: number;
  light: { color: string; from: number; to: number; rampSeconds: number };
  status:
    | "pending"
    | "starting"
    | "ringing"
    | "dismissed"
    | "cancelled"
    | "missed"
    | "failed";
  lastOccurrence?: { scheduledAt: string; status: Alarm["status"]; reason?: string };
  createdAt: string;
  reason?: string;
};

export type RoomState = {
  ready: boolean;
  connected: boolean;
  device: { product: string; firmware: string; hardware: string };
  playback: {
    status: "none" | "routine" | "remote";
    active: boolean;
    trackId: string | null;
    title: string;
    volume: number;
    brightness: number;
    color: string;
    updatedAt: string;
    captureKey?: string | null;
  };
  light: { on: boolean; color: string; brightness: number; effectId?: number; effectName?: string };
  lightSequence?: { id: string; title: string; status: "starting" | "running" | "stopped" | "failed"; reason?: string } | null;
  library: Track[];
  scenes: Scene[];
  alarms: Alarm[];
  hatch?: { syncedAt: string | null; catalogStatus: "bundled" | "refreshed" };
};

export type Tab = "all" | "sounds" | "lights" | "alarms";
export type Panel = "upload" | "alarm" | "save-sound" | "feedback" | null;
export type Collection = "all" | "uploads" | "hatch" | "favorites" | "saved";
export type RoomQuery = {
  tab: Tab;
  view: "grid" | "table";
  q: string;
  panel: Panel;
  collection: Collection;
  alarmId: string | null;
};

export const alarmDays = [1, 2, 3, 4, 5, 6, 0];

export function weekdayName(day: number, style: "long" | "short" | "narrow" = "short") {
  return new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: "UTC" })
    .format(new Date(Date.UTC(2024, 0, 7 + day)));
}

export function repeatLabel(days: number[] = []) {
  if (!days.length) return "Never";
  if (days.length === 7) return "Every Day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return "Weekdays";
  if (days.length === 2 && days.includes(0) && days.includes(6)) return "Weekends";
  return alarmDays.filter((day) => days.includes(day)).map((day) => weekdayName(day)).join(", ");
}

export function alarmEnabled(alarm: Alarm) {
  return alarm.enabled ?? ["pending", "starting", "ringing"].includes(alarm.status);
}

export function alarmTime(alarm: Alarm) {
  if (/^\d{2}:\d{2}$/.test(alarm.localTime || "")) {
    const [hour, minute] = alarm.localTime.split(":").map(Number);
    return timeParts(new Date(2000, 0, 1, hour, minute));
  }
  return timeParts(new Date(alarm.scheduledAt), alarm.timeZone);
}

export const number = (value: number) => new Intl.NumberFormat().format(value);
export const percentage = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value / 100);
export const kindLabel = (kind: Track["kind"]) =>
  ({
    music: "Music",
    "field-recording": "Field Recording",
    generated: "Generated Audio",
    "hatch-sound": "Hatch Sound",
    "hatch-favorite": "Hatch Favorite",
    "saved-sound": "Saved Sound",
  })[kind];

export const soundCategories = [
  "Nature", "Water", "Color Noise", "Household", "Camp", "Vehicle", "Lullaby",
] as const;

export const categoriesFor = (tracks: Track[]): string[] => [
  ...soundCategories,
  ...[...new Set(tracks.map((track) => track.category).filter((category): category is string => Boolean(category) && !soundCategories.includes(category as typeof soundCategories[number])))].sort((a, b) => a.localeCompare(b)),
];

export const collections: { id: Collection; title: string }[] = [
  { id: "all", title: "All" },
  { id: "uploads", title: "Uploads" },
  { id: "hatch", title: "Hatch Sounds" },
  { id: "favorites", title: "Favorites" },
  { id: "saved", title: "Saved" },
];
export const collectionOf = (track: Track): Collection =>
  track.kind === "hatch-sound"
    ? "hatch"
    : track.kind === "hatch-favorite"
      ? "favorites"
      : track.kind === "saved-sound"
        ? "saved"
        : "uploads";
export const trackTiming = (track: Track) =>
  track.timing || duration(track.durationSeconds);

export function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Duration Unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${number(minutes)}:${new Intl.NumberFormat(undefined, { minimumIntegerDigits: 2, useGrouping: false }).format(remainder)}`;
}

export function alarmDate(alarm: Alarm) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: alarm.timeZone,
    }).format(new Date(alarm.scheduledAt));
  } catch {
    return "Date Unavailable";
  }
}

/* Splits a localized time so the day period can be set smaller than the digits. */
export function timeParts(date: Date, timeZone?: string) {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).formatToParts(date);
    return {
      time: parts
        .filter((part) => part.type !== "dayPeriod")
        .map((part) => part.value)
        .join("")
        .trim(),
      period: parts.find((part) => part.type === "dayPeriod")?.value || "",
    };
  } catch {
    return { time: "--:--", period: "" };
  }
}

export function shortDate(date: Date, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone,
    }).format(date);
  } catch {
    return "Date Unavailable";
  }
}

export function fromNow(target: number, now = Date.now()) {
  const minutes = Math.round((target - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 36) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
  get definitiveRejection() {
    return this.status !== undefined && this.status >= 400 && this.status < 500
      && this.status !== 408 && this.status !== 499;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    init?.body instanceof FormData ? 120_000 : 25_000,
  );
  try {
    const response = await fetch(`/api/hatch${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      ({ error?: string } & Record<string, unknown>) | null;
    if (!response.ok) {
      throw new ApiError(
        body?.error ||
          (response.status === 401 || response.status === 403
            ? "Your session could not access the room. Refresh the page and sign in again."
            : `The room could not complete this request (${response.status}). Try again.`),
        response.status,
      );
    }
    if (body === null)
      throw new ApiError(
        "The room returned an unreadable response. Try refreshing.",
      );
    return body as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new ApiError(
        "The request took too long. Refresh the room to check its status before trying again.",
      );
    if (error instanceof TypeError)
      throw new ApiError(
        "The room could not be reached. Check your connection and refresh its status before trying again.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function jsonRequest(
  method: "POST" | "PATCH" | "DELETE",
  body: unknown = {},
) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
