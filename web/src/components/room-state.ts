import type { Alarm, RoomState, Track } from "./types";

export type UpdateScope = "device" | "library" | "alarms";
export type FormResult = { track?: Track; alarm?: Alarm; deletedAlarmId?: string };
export type DeviceIntent = {
  key: string;
  phase: "sending" | "confirming";
  trackId?: string;
  turnOff?: boolean;
  volume?: number;
  light?: Partial<RoomState["light"]>;
};

export function isRoomState(value: unknown): value is RoomState {
  const room = value as RoomState | null;
  return Boolean(room && Array.isArray(room.library) && Array.isArray(room.scenes)
    && Array.isArray(room.alarms) && room.playback && typeof room.playback.active === "boolean"
    && room.light && room.device);
}

function unchanged<T>(current: T, next: T): T {
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}

/** Reads may overlap writes, but must never undo a newer accepted change. */
export class RoomUpdates {
  private revision = 0;
  private scopes: Record<UpdateScope, { revision: number; pending: number }> = {
    device: { revision: 0, pending: 0 },
    library: { revision: 0, pending: 0 },
    alarms: { revision: 0, pending: 0 },
  };

  read() { return this.revision; }

  begin(scope: UpdateScope) {
    const state = this.scopes[scope];
    state.revision = ++this.revision;
    state.pending++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      state.pending--;
      state.revision = ++this.revision;
    };
  }

  merge(current: RoomState | null, next: RoomState, read: number): RoomState {
    if (!current) return next;
    const protectedScope = (scope: UpdateScope) => this.scopes[scope].pending > 0 || this.scopes[scope].revision > read;
    const device = protectedScope("device") ? current : next;
    const library = protectedScope("library") ? current : next;
    const alarms = protectedScope("alarms") ? current.alarms : next.alarms;
    const merged: RoomState = {
      ...device,
      ready: next.ready,
      connected: next.connected,
      library: unchanged(current.library, library.library),
      hatch: unchanged(current.hatch, library.hatch),
      scenes: unchanged(current.scenes, next.scenes),
      alarms: unchanged(current.alarms, alarms),
      playback: unchanged(current.playback, device.playback),
      light: unchanged(current.light, device.light),
      lightSequence: unchanged(current.lightSequence, device.lightSequence),
      device: unchanged(current.device, device.device),
    };
    return (Object.keys(merged) as (keyof RoomState)[]).every((key) => merged[key] === current[key]) ? current : merged;
  }
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some((current) => current.id === item.id)
    ? items.map((current) => current.id === item.id ? item : current)
    : [...items, item];
}

export function applyFormResult(room: RoomState | null, result: FormResult): RoomState | null {
  if (!room) return room;
  return {
    ...room,
    library: result.track ? upsert(room.library, result.track) : room.library,
    alarms: result.alarm ? upsert(room.alarms, result.alarm)
      : result.deletedAlarmId ? room.alarms.filter((alarm) => alarm.id !== result.deletedAlarmId) : room.alarms,
  };
}

/** Sync owns Hatch's catalog and favorites, never concurrent personal uploads. */
export function mergeSyncedLibrary(current: Track[], synced: Track[]): Track[] {
  return [
    ...current.filter((track) => !["hatch-sound", "hatch-favorite", "saved-sound"].includes(track.kind)),
    ...synced.filter((track) => track.kind === "hatch-favorite"),
    ...current.filter((track) => track.kind === "saved-sound"),
    ...synced.filter((track) => track.kind === "hatch-sound"),
  ];
}
