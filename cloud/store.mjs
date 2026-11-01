import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { alarmLocalTime } from './alarm-schedule.mjs';

export class Store {
  static async open(directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const filename = path.join(directory, 'hatch.sqlite');
    const db = new DatabaseSync(filename);
    try {
      // EXCLUSIVE retains the SQLite lock between commits, enforcing one service writer.
      db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);');
      db.prepare('INSERT OR IGNORE INTO state VALUES (1, ?)').run(JSON.stringify({ version: 1, tracks: [], alarms: [] }));
      await chmod(filename, 0o600);
      return new Store(db);
    } catch (error) { db.close(); throw error; }
  }
  constructor(db) {
    this.db = db;
    this.value = JSON.parse(db.prepare('SELECT json FROM state WHERE id=1').get().json);
    if (this.value.version !== 1 || !Array.isArray(this.value.tracks) || !Array.isArray(this.value.alarms)) throw new Error('Unsupported or corrupt stored data; restore a verified backup.');
    // Additive migration: existing uploads and pending alarm instants are untouched.
    this.value.savedSounds ??= [];
    this.value.alarmMedia ??= [];
    this.value.hatch ??= { favorites: [], sounds: [], syncedAt: null, catalogStatus: 'bundled' };
    if (!Array.isArray(this.value.savedSounds) || !Array.isArray(this.value.hatch.favorites) || !Array.isArray(this.value.hatch.sounds) || !Array.isArray(this.value.alarmMedia)) throw new Error('Invalid stored sound library; restore a verified backup.');
    for (const alarm of this.value.alarms) {
      alarm.repeatDays ??= [];
      alarm.enabled ??= alarm.status === 'pending';
      alarm.nextScheduledAt ??= alarm.enabled ? alarm.scheduledAt : null;
      if (!alarm.localTime && alarm.scheduledAt && alarm.timeZone) alarm.localTime = alarmLocalTime(Date.parse(alarm.scheduledAt), alarm.timeZone);
      for (const token of alarm.audioCapabilities ?? (alarm.audioCapability ? [alarm.audioCapability] : [])) {
        if (!this.value.alarmMedia.some(item => item.token === token)) this.value.alarmMedia.push({ token, trackId: alarm.trackId });
      }
      delete alarm.audioCapabilities;
    }
  }
  snapshot() { return structuredClone(this.value); }
  change(mutator) {
    const next = this.snapshot();
    const result = mutator(next);
    if (result instanceof Promise) throw new Error('Store mutations must be synchronous.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(next));
      this.db.exec('COMMIT');
      this.value = next;
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
