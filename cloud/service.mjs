import { categoryName } from './categories.mjs';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { activePlayback, alarmInput, capability, fail, lightChannels, lightPatch, lightState, percentage, percentRaw, playPatch, rawPercent, rgb, scenes, stopPatch, validateLight } from './core.mjs';
import { mediaPath, publicTrack } from './media.mjs';
import { builtinSounds, captureCandidate, catalogSounds, checkFavoriteStart, nativePatch, normalizeFavorites, publicSound, savedSound } from './sounds.mjs';
import { LightSequence, validateRecipe } from './light-sequence.mjs';
import { nextAlarmInstant } from './alarm-schedule.mjs';

const activeStatus = status => ['starting', 'ringing'].includes(status);
const publicAlarm = alarm => ({ ...Object.fromEntries(['id', 'label', 'trackId', 'sourceTitle', 'sourceKind', 'usesFavoriteSettings', 'scheduledAt', 'localTime', 'timeZone', 'repeatDays', 'enabled', 'volume', 'light', 'status', 'createdAt', 'reason'].filter(key => alarm[key] !== undefined).map(key => [key, alarm[key]])),
  scheduledAt: alarm.enabled ? alarm.nextScheduledAt : alarm.scheduledAt,
  ...(alarm.status !== 'pending' ? { lastOccurrence: { scheduledAt: alarm.scheduledAt, status: alarm.status, ...(alarm.reason ? { reason: alarm.reason } : {}) } } : {}),
});
const owns = (state, owner) => state?.current?.paused !== true && (owner.routineId
  ? state?.current?.playing === 'routine' && state.current.srId === owner.routineId
  : state?.current?.playing === 'remote' && state.current.sound?.url === owner.url && (owner.soundId === undefined || state.current.sound?.id === owner.soundId));
const playbackIdentity = current => JSON.stringify([current?.playing, current?.paused, current?.srId, current?.step, current?.sound?.id, current?.sound?.url]);
const dispatchIdentity = shadow => JSON.stringify(['reported', 'desired'].map(key => playbackIdentity(shadow.state?.[key]?.current)));
const departed = (current, owner) => current && (current.paused === true || (owner.routineId
  ? (current.playing !== undefined && current.playing !== 'routine') || (current.srId !== undefined && current.srId !== owner.routineId)
  : (current.playing !== undefined && current.playing !== 'remote') || (current.sound?.url !== undefined && current.sound.url !== owner.url) || (owner.soundId !== undefined && current.sound?.id !== undefined && current.sound.id !== owner.soundId)));
const lightControlIdentity = shadow => JSON.stringify(['reported', 'desired'].map(key => {
  const state = shadow?.state?.[key], current = state?.current;
  return [playbackIdentity(current), current?.sound?.id, current?.sound?.mute,
    ...['id', 'r', 'g', 'b', 'w', 'i'].map(field => current?.color?.[field]),
    state?.nightlightOn, state?.nightlightIntensity,
    ...['id', 'r', 'g', 'b', 'w'].map(field => state?.nightlightColor?.[field])];
}));

export class HatchService {
  constructor({ store, device, origin, audioOrigin = origin, dataDir, now = Date.now }) {
    Object.assign(this, { store, device, origin, audioOrigin, dataDir, now });
    this.active = new Map(); this.alarmGenerations = new Map(); this.chain = Promise.resolve(); this.tickBusy = false;
    this.lightSequence = new LightSequence({ device, now, fresh: () => this.fresh() });
    // Claimed jobs are deliberately abandoned after a crash, including ambiguous starts.
    store.change(state => {
      for (const alarm of state.alarms) if (activeStatus(alarm.status)) Object.assign(alarm, { status: 'failed', reason: 'Service restarted after the playback claim; this occurrence will not replay.' });
    });
    this.onShadow = (update, full) => this.observe(update, full);
    this.onUnavailable = () => {
      this.lightSequence.cancel('Hatch cloud connection interrupted; the sequence will not resume automatically.', 'failed');
      for (const [id] of this.active) this.finish(id, 'failed', 'Cloud connection interrupted; remaining ramp cancelled and playback will not retry.');
    };
    device.on('shadow', this.onShadow); device.on('unavailable', this.onUnavailable);
  }
  start() {
    this.timer = setInterval(() => {
      if (this.tickBusy) return;
      this.tickBusy = true;
      this.run(() => this.tick()).catch(() => {}).finally(() => { this.tickBusy = false; });
    }, 1000);
    this.timer.unref();
  }
  close() { clearInterval(this.timer); this.lightSequence.cancel('Service stopped; the sequence will not resume automatically.'); this.device.removeListener('shadow', this.onShadow); this.device.removeListener('unavailable', this.onUnavailable); }
  run(fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
  sounds() { return [...this.store.value.tracks, ...this.store.value.hatch.favorites, ...this.store.value.savedSounds, ...(this.store.value.hatch.sounds.length ? this.store.value.hatch.sounds.map(track => ({ ...track, category: builtinSounds.find(item => item.id === track.id)?.category ?? track.category })) : builtinSounds)]; }
  track(id) { const track = this.sounds().find(item => item.id === id); if (!track) fail('Sound not found. Sync Hatch or choose another sound.', 404); return track; }
  audioUrl(token) { return `${this.audioOrigin}/audio/${token}.mp3`; }
  recordAlarmMedia(state, token, trackId) {
    if (!token) return;
    if (!state.alarmMedia.some(item => item.token === token)) state.alarmMedia.push({ token, trackId });
    // Bound historical capabilities while retaining both observed playback
    // paths. Editing an alarm never changes what an existing URL serves.
    const currentURLs = ['reported', 'desired'].map(key => this.device.shadow?.state?.[key]?.current?.sound?.url);
    state.alarmMedia = state.alarmMedia.filter((item, index, all) => index >= all.length - 1000 || currentURLs.includes(this.audioUrl(item.token)));
  }
  alarm(id) { return this.store.value.alarms.find(item => item.id === id); }
  updateAlarm(id, fields) { this.store.change(state => Object.assign(state.alarms.find(item => item.id === id), fields)); }
  invalidateAlarm(id) {
    if (!this.alarm(id)) fail('Alarm not found.', 404);
    const generation = (this.alarmGenerations.get(id) ?? 0) + 1;
    this.alarmGenerations.set(id, generation);
    const runtime = this.active.get(id); if (runtime) runtime.invalidated = true;
    return generation;
  }
  consumeOccurrence(id, status, reason) {
    const alarm = this.alarm(id), scheduledAt = alarm.nextScheduledAt;
    const repeating = alarm.repeatDays.length > 0;
    const fields = { scheduledAt, status, reason, enabled: repeating,
      nextScheduledAt: repeating ? nextAlarmInstant(alarm, Math.max(this.now(), Date.parse(scheduledAt)) + 1) : null };
    if (status === 'starting') {
      fields.attemptedAt = new Date(this.now()).toISOString();
      if (alarm.audioCapability) {
        fields.audioCapability = capability();
      }
    }
    this.store.change(state => {
      Object.assign(state.alarms.find(item => item.id === id), fields);
      this.recordAlarmMedia(state, fields.audioCapability, alarm.trackId);
    });
    if (status !== 'starting') this.active.delete(id);
    return this.alarm(id);
  }
  finish(id, status, reason) {
    const alarm = this.alarm(id);
    if (!alarm || !activeStatus(alarm.status)) { this.active.delete(id); return; }
    this.updateAlarm(id, { status, reason }); this.active.delete(id);
  }
  async fresh() {
    let shadow;
    try { shadow = await this.device.read(); }
    catch { fail('Hatch cloud is unavailable. No command was queued; check the device connection and retry explicitly.', 503); }
    if (!this.device.ready || shadow.state?.reported?.connected !== true) fail('Hatch is not currently reported connected. No command was sent.', 503);
    return shadow;
  }
  observe(update, full) {
    this.lightSequence.observe(update, full);
    for (const [id, runtime] of this.active) {
      const alarm = this.alarm(id);
      if (!alarm || !activeStatus(alarm.status)) { this.active.delete(id); continue; }
      const reported = update.state?.reported?.current, desired = update.state?.desired?.current;
      if (runtime.seenReported && departed(reported, runtime) || runtime.seenDesired && departed(desired, runtime)) {
        this.finish(id, 'dismissed', 'Device controls changed the playback; remaining ramp cancelled.'); continue;
      }
      if (owns(full.state?.reported, runtime)) runtime.seenReported = true;
      if (owns(full.state?.desired, runtime)) runtime.seenDesired = true;
      if (!runtime.seenReported || runtime.rampCancelled) continue;
      if ([update.state?.reported, update.state?.desired].some(state => state?.nightlightOn === true)) {
        runtime.rampCancelled = true;
        this.updateAlarm(id, { reason: 'Manual nightlight change cancelled the remaining light ramp; audio remains under device control.' });
        continue;
      }
      for (const c of [reported?.color, desired?.color]) {
        if (!c) continue;
        const changedId = c.id !== undefined && c.id !== 9999;
        const changedRGB = Object.entries(runtime.rgb).some(([key, expected]) => c[key] !== undefined && c[key] !== expected);
        const changedIntensity = c.i !== undefined && c.i !== runtime.lastIntensity && c.i !== runtime.previousIntensity;
        if (changedId || changedRGB || changedIntensity) {
          runtime.rampCancelled = true;
          this.updateAlarm(id, { reason: 'Manual light change cancelled the remaining light ramp; audio remains under device control.' });
          break;
        }
      }
    }
  }
  library() { return { tracks: this.sounds().map(track => track.reference || track.routineId ? publicSound(track) : { ...publicTrack(track), removable: !track.seeded }) }; }
  async refreshFavorites() {
    let routines;
    try { routines = await this.device.fetchFavorites(); }
    catch { fail('Hatch favorites could not be refreshed. Try Sync Hatch again when the connection is ready.', 503); }
    const favorites = normalizeFavorites(routines, this.store.value.hatch.favorites);
    this.store.change(state => { state.hatch.favorites = favorites; state.hatch.syncedAt = new Date(this.now()).toISOString(); });
    return favorites;
  }
  async syncHatch() {
    // These are account reads only. A catalog failure must not erase favorites.
    const [favorites, sounds] = await Promise.allSettled([this.refreshFavorites(), this.device.fetchSounds()]);
    if (favorites.status === 'rejected') throw favorites.reason;
    const items = sounds.status === 'fulfilled' && Array.isArray(sounds.value) ? sounds.value : [];
    const matched = items.some(item => item?.tier === 'free' && builtinSounds.some(track => track.reference.id === item.id));
    this.store.change(state => { state.hatch.sounds = catalogSounds(items); state.hatch.catalogStatus = matched ? 'refreshed' : 'bundled'; });
    return { ...this.library(), hatch: this.hatchStatus() };
  }
  hatchStatus() { return { syncedAt: this.store.value.hatch.syncedAt, catalogStatus: this.store.value.hatch.catalogStatus }; }
  async saveCurrent(input) {
    const shadow = await this.fresh();
    const track = { ...savedSound(shadow.state.reported.current, input, this.now()), category: categoryName(input.category, this.store.value) };
    const existing = this.store.value.savedSounds.find(item => JSON.stringify(item.reference) === JSON.stringify(track.reference));
    if (existing) {
      this.store.change(state => { state.savedSounds.find(item => item.id === existing.id).category = track.category; });
      return { track: publicSound({ ...existing, category: track.category }), existing: true };
    }
    if (this.store.value.savedSounds.length >= 100) fail('You can save up to 100 Hatch sounds. Remove a saved sound first.', 409);
    this.store.change(state => state.savedSounds.push(track));
    return { track: publicSound(track), existing: false };
  }
  alarms() { return { alarms: this.store.value.alarms.map(publicAlarm) }; }
  async state() {
    if (this.device.online) await this.device.read().catch(() => { this.device.lastReadAt = 0; });
    const reported = this.device.shadow?.state?.reported ?? {}, current = reported.current ?? {};
    const status = ['none', 'routine', 'remote'].includes(current.playing) ? current.playing : 'none';
    const light = lightState(reported);
    const audioActive = activePlayback(current) && current.sound?.id !== 19998 && current.sound?.mute !== true;
    const ringing = [...this.active].find(([, runtime]) => owns(reported, runtime));
    const track = (ringing && this.sounds().find(item => item.id === this.alarm(ringing[0])?.trackId)) ?? (status === 'routine'
      ? this.store.value.hatch.favorites.find(item => item.routineId === current.srId)
      : this.sounds().find(item => item.reference && item.reference.url === current.sound?.url && item.reference.id === current.sound?.id)
        ?? this.store.value.tracks.find(item => this.audioUrl(item.audioCapability) === current.sound?.url)
        ?? this.store.value.tracks.find(item => this.store.value.alarmMedia.some(media => media.trackId === item.id && this.audioUrl(media.token) === current.sound?.url)));
    const candidate = this.device.ready && captureCandidate(current);
    return {
      ready: this.device.ready, connected: this.device.ready && reported.connected === true,
      device: { product: this.device.device?.product ?? 'restBaby', firmware: reported.deviceInfo?.f ?? '', hardware: reported.deviceInfo?.hwVersion ?? this.device.device?.hardwareVersion ?? '' },
      playback: { status, active: audioActive, trackId: audioActive ? track?.id ?? null : null, title: !audioActive ? 'Stopped' : track?.title ?? (status === 'routine' ? 'Hatch favorite' : 'Device audio'), volume: rawPercent(current.sound?.v), brightness: light.brightness, color: light.color, updatedAt: this.device.lastReadAt ? new Date(this.device.lastReadAt).toISOString() : '', captureKey: candidate ? candidate.key : null },
      light, lightSequence: this.lightSequence.state(),
      hatch: this.hatchStatus(),
      library: this.library().tracks, scenes, alarms: this.alarms().alarms,
    };
  }
  cancelRamps(reason) {
    for (const [, runtime] of this.active) runtime.rampCancelled = true;
    if (reason) for (const [id] of this.active) this.updateAlarm(id, { reason });
  }
  prepareLightSequence(input) { return { recipe: validateRecipe(input), ticket: this.lightSequence.reserve() }; }
  async startLightSequence(input, ticket) {
    const recipe = validateRecipe(input);
    ticket ??= this.lightSequence.reserve();
    const shadow = await this.fresh();
    if (ticket !== this.lightSequence.generation) fail('This sequence request was cancelled before it started.', 409);
    this.cancelRamps('A custom light sequence replaced the remaining light ramp; audio remains under device control.');
    return this.lightSequence.start(recipe, shadow, ticket);
  }
  stopLightSequence() { return this.lightSequence.cancel('Sequence stopped from the web controls; its last light frame remains.'); }
  async play(input) {
    let track = this.track(input.trackId);
    const shadow = await this.fresh();
    if (track.kind === 'hatch-favorite') {
      await this.refreshFavorites();
      track = this.track(input.trackId);
    }
    checkFavoriteStart(track, shadow.state.reported.current);
    if (track.kind === 'hatch-favorite' && input.volume !== undefined) fail('Favorites use their saved Hatch volume. Edit the favorite in Hatch first.');
    const volume = input.volume === undefined ? rawPercent(shadow.state.reported.current?.sound?.v) : percentage(input.volume, 'Volume');
    this.lightSequence.cancel('Playback replaced from the web controls.');
    for (const [id] of this.active) this.finish(id, 'dismissed', 'Playback replaced from the web controls.');
    const patch = track.reference || track.routineId ? nativePatch(track, volume) : playPatch(this.audioUrl(track.audioCapability), volume);
    if (!track.routineId && shadow.state.reported.nightlightOn === true) {
      patch.nightlightOn = false;
      patch.current.color = { ...lightChannels(shadow.state.reported), id: 9999, until: 'indefinite', duration: 0 };
    }
    const baseline = dispatchIdentity(shadow);
    const result = await this.device.write(patch, { guard: latest => dispatchIdentity(latest) === baseline });
    if (result?.skipped) fail('The Hatch controls changed before playback started. Refresh the room and try again.', 409);
  }
  async stop() {
    this.lightSequence.cancel('Hatch stopped from the web controls.');
    await this.fresh();
    for (const [id] of this.active) this.finish(id, 'dismissed', 'Stopped from the web controls.');
    await this.device.write(stopPatch());
  }
  async volume(input) {
    const value = percentage(input.volume, 'Volume'); await this.fresh();
    await this.device.write({ current: { sound: { v: percentRaw(value) } } });
  }
  async light(input) {
    // Validate before reading or altering any active ramp.
    validateLight(input);
    this.lightSequence.cancel('Manual light controls replaced the sequence.');
    const shadow = await this.fresh();
    this.cancelRamps('Manual light change cancelled the remaining ramp.');
    const baseline = lightControlIdentity(shadow);
    const result = await this.device.write(lightPatch(input, shadow.state.reported), {
      guard: latest => lightControlIdentity(latest) === baseline,
    });
    if (result?.skipped) fail('The Hatch controls changed before the light command was sent. Check its current state and try again.', 409);
  }
  async scene(id) {
    const scene = scenes.find(item => item.id === id); if (!scene) fail('Scene not found.', 404);
    await this.light(scene);
  }
  createAlarm(input) {
    const track = this.track(input.trackId), favorite = track.kind === 'hatch-favorite';
    if (track.alarmEligible === false) fail('This favorite has no audible sound. Choose a sound for this alarm.');
    const validated = alarmInput(favorite ? { ...input, volume: track.volume, light: track.light } : input, this.now());
    if (this.store.value.alarms.length >= 100) fail('At most 100 saved alarms are supported. Remove an alarm first.', 409);
    const alarm = { ...validated, nextScheduledAt: validated.enabled ? validated.scheduledAt : null, id: randomUUID(), status: validated.enabled ? 'pending' : 'cancelled', createdAt: new Date(this.now()).toISOString(), sourceTitle: track.title, sourceKind: track.kind, usesFavoriteSettings: favorite,
      ...(favorite ? { favoriteSignature: track.signature } : track.reference ? { soundReference: structuredClone(track.reference) } : { audioCapability: capability() }) };
    this.store.change(state => { state.alarms.push(alarm); this.recordAlarmMedia(state, alarm.audioCapability, alarm.trackId); });
    return { alarm: publicAlarm(alarm) };
  }
  prepareAlarmUpdate(id, input) {
    const alarm = this.alarm(id); if (!alarm) fail('Alarm not found.', 404);
    // Turning a schedule off must remain possible after its source disappears.
    if (input.enabled === false && Object.keys(input).length === 1) return {
      fields: { enabled: false, nextScheduledAt: null, status: 'cancelled', reason: undefined }, generation: this.invalidateAlarm(id),
    };
    const track = this.track(input.trackId ?? alarm.trackId), favorite = track.kind === 'hatch-favorite';
    if (track.alarmEligible === false) fail('This favorite has no audible sound. Choose a sound for this alarm.');
    const merged = { ...alarm, ...input, scheduledAt: input.scheduledAt, localTime: input.localTime ?? (input.scheduledAt === undefined ? alarm.localTime : undefined) };
    const validated = alarmInput(favorite ? { ...merged, volume: track.volume, light: track.light } : merged, this.now());
    const reschedule = validated.localTime !== alarm.localTime || validated.timeZone !== alarm.timeZone
      || JSON.stringify(validated.repeatDays) !== JSON.stringify(alarm.repeatDays)
      || input.scheduledAt !== undefined && Date.parse(input.scheduledAt) !== Date.parse(alarm.nextScheduledAt ?? alarm.scheduledAt)
      || input.enabled === true && !alarm.enabled;
    if (!reschedule && alarm.enabled) validated.scheduledAt = alarm.nextScheduledAt;
    const fields = { ...validated, scheduledAt: validated.enabled ? validated.scheduledAt : alarm.scheduledAt,
      nextScheduledAt: validated.enabled ? validated.scheduledAt : null,
      sourceTitle: track.title, sourceKind: track.kind, usesFavoriteSettings: favorite,
      favoriteSignature: favorite ? track.signature : undefined,
      soundReference: !favorite && track.reference ? structuredClone(track.reference) : undefined,
      audioCapability: !favorite && !track.reference ? track.id === alarm.trackId ? alarm.audioCapability ?? capability() : capability() : undefined,
      status: validated.enabled ? 'pending' : 'cancelled', reason: undefined };
    return { fields, generation: this.invalidateAlarm(id) };
  }
  updateAlarmSettings(id, input, prepared = this.prepareAlarmUpdate(id, input)) {
    if (prepared.generation !== this.alarmGenerations.get(id)) fail('A newer alarm change replaced this request. Refresh the alarm.', 409);
    // Editing/disabling abandons the old occurrence's ramp. Already accepted
    // audio remains under the explicit Stop and physical Hatch controls.
    this.active.delete(id);
    this.store.change(state => {
      Object.assign(state.alarms.find(item => item.id === id), prepared.fields);
      this.recordAlarmMedia(state, prepared.fields.audioCapability, prepared.fields.trackId);
    });
    return { alarm: publicAlarm(this.alarm(id)) };
  }
  async cancelAlarm(id) {
    const alarm = this.alarm(id); if (!alarm) fail('Alarm not found.', 404);
    this.invalidateAlarm(id);
    if (!['pending', 'starting', 'ringing'].includes(alarm.status) && !alarm.enabled) return;
    const priorStatus = alarm.status;
    const runtime = this.active.get(id);
    // Persist cancellation before checking or attempting a stop.
    this.updateAlarm(id, { status: 'cancelled', enabled: false, nextScheduledAt: null, reason: 'Cancelled from the web controls.' }); this.active.delete(id);
    if (!runtime) return;
    let shadow;
    try { shadow = await this.fresh(); } catch { return; }
    // A different routine or a physical hold always wins over this cancellation.
    const baselinePlayback = playbackIdentity(shadow.state.reported?.current);
    const mayStop = latest => {
      const { reported, desired } = latest?.state ?? {};
      const ownsPendingStart = priorStatus === 'starting' && owns(desired, runtime) && playbackIdentity(reported?.current) === baselinePlayback;
      return (owns(reported, runtime) || ownsPendingStart) && !departed(desired?.current, runtime);
    };
    if (mayStop(shadow)) { this.lightSequence.cancel('An active alarm was cancelled from the web controls.'); await this.device.write(stopPatch(), { guard: mayStop }); }
  }
  async deleteAlarm(id) {
    await this.cancelAlarm(id);
    this.store.change(state => { state.alarms = state.alarms.filter(alarm => alarm.id !== id); });
    this.alarmGenerations.delete(id);
  }
  async deleteTrack(id) {
    const track = this.track(id);
    if (track.seeded || ['hatch-sound', 'hatch-favorite'].includes(track.kind)) fail('Built-in sounds and Hatch favorites cannot be removed here. Edit favorites in the Hatch app.', 409);
    const shadow = await this.fresh();
    const trackURLs = new Set([track.reference?.url ?? this.audioUrl(track.audioCapability), ...this.store.value.alarmMedia.filter(media => media.trackId === id).map(media => this.audioUrl(media.token))]);
    const inUse = [shadow.state.reported, shadow.state.desired].some(state => ['remote', 'routine'].includes(state?.current?.playing) && trackURLs.has(state.current.sound?.url));
    if (inUse || this.store.value.alarms.some(alarm => alarm.trackId === id && (alarm.enabled || activeStatus(alarm.status)))) fail('This track is playing, pending playback, or used by an unfinished alarm. Stop playback and cancel its alarms first.', 409);
    this.store.change(state => { state.tracks = state.tracks.filter(item => item.id !== id); state.savedSounds = state.savedSounds.filter(item => item.id !== id); state.alarmMedia = state.alarmMedia.filter(item => item.trackId !== id); });
    if (track.filename) await unlink(mediaPath(this.dataDir, track.filename)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  audioFile(token) {
    const track = this.store.value.tracks.find(item => item.audioCapability === token) ?? this.store.value.tracks.find(item => this.store.value.alarmMedia.some(media => media.token === token && media.trackId === item.id));
    return track?.filename;
  }
  async tick() {
    const now = this.now();
    for (const saved of [...this.store.value.alarms]) {
      if (!saved.enabled || !saved.nextScheduledAt || Date.parse(saved.nextScheduledAt) > now) continue;
      const generation = this.alarmGenerations.get(saved.id) ?? 0, due = saved.nextScheduledAt;
      const unchanged = () => (this.alarmGenerations.get(saved.id) ?? 0) === generation && this.alarm(saved.id)?.enabled && this.alarm(saved.id)?.nextScheduledAt === due;
      if (now - Date.parse(due) > 30000) { this.consumeOccurrence(saved.id, 'missed', 'Service was more than 30 seconds late; no playback attempt.'); continue; }
      if (!this.device.ready) continue; // Only wait inside the bounded 30-second grace.
      let claimed = false;
      try {
        const shadow = await this.fresh();
        if (!unchanged()) continue;
        if (saved.usesFavoriteSettings) {
          await this.refreshFavorites();
          if (!unchanged()) continue;
          const favorite = this.sounds().find(track => track.id === saved.trackId);
          if (!favorite || favorite.signature !== saved.favoriteSignature) {
            this.consumeOccurrence(saved.id, 'failed', 'This Hatch favorite changed or was removed. Sync Hatch and edit the alarm before enabling again.');
            continue;
          }
        }
        if (this.now() - Date.parse(due) > 30000) { this.consumeOccurrence(saved.id, 'missed', 'Live device check finished after the 30-second grace.'); continue; }
        const track = this.track(saved.trackId);
        if (saved.usesFavoriteSettings && shadow.state.reported.current?.playing !== 'none' && shadow.state.reported.current?.srId === track.routineId) {
          this.consumeOccurrence(saved.id, 'failed', 'This favorite was already selected on Hatch. No automatic stop/restart was sent. Turn off Hatch first, or schedule its individual sound instead.');
          continue;
        }
        // Replace the prior runtime before claiming this occurrence, including
        // yesterday's still-ringing occurrence of this same repeating alarm.
        for (const [id] of this.active) this.finish(id, 'dismissed', 'A later alarm replaced this playback.');
        this.lightSequence.cancel('An alarm replaced the light sequence.');
        // Advancing the schedule and claiming playback commit together. A crash
        // cannot replay this instant or lose a later repeat.
        const alarm = this.consumeOccurrence(saved.id, 'starting'); claimed = true;
        const native = alarm.usesFavoriteSettings || alarm.soundReference;
        const patch = native ? nativePatch(alarm.soundReference ? { reference: alarm.soundReference } : track, alarm.volume) : playPatch(this.audioUrl(alarm.audioCapability), alarm.volume);
        const intensity = percentRaw(alarm.light.rampSeconds === 0 ? alarm.light.to : alarm.light.from);
        const runtime = { url: patch.current.sound?.url, soundId: alarm.soundReference?.id, routineId: alarm.usesFavoriteSettings ? track.routineId : undefined,
          rgb: rgb(alarm.light.color), lastIntensity: intensity, previousIntensity: intensity, attemptedAt: this.now(), seenReported: false, seenDesired: false, rampCancelled: alarm.usesFavoriteSettings || alarm.light.rampSeconds === 0 };
        this.active.set(alarm.id, runtime);
        if (!alarm.usesFavoriteSettings) {
          patch.nightlightOn = false;
          patch.current.color = { id: 9999, ...runtime.rgb, i: intensity, until: 'indefinite', duration: 0 };
        }
        const baseline = dispatchIdentity(shadow);
        const result = await this.device.write(patch, { guard: latest => this.active.get(alarm.id) === runtime && !runtime.invalidated && (this.alarmGenerations.get(alarm.id) ?? 0) === generation && dispatchIdentity(latest) === baseline });
        if (result?.skipped) this.finish(alarm.id, 'dismissed', 'The alarm or Hatch controls changed before playback could start; no playback sent.');
      } catch {
        if ((this.alarmGenerations.get(saved.id) ?? 0) !== generation || !this.alarm(saved.id)) continue;
        const reason = 'The sound could not be started or its result is unknown; this occurrence will not retry. Sync Hatch and check the sound before scheduling again.';
        if (claimed) this.updateAlarm(saved.id, { status: 'failed', reason });
        else if (unchanged()) this.consumeOccurrence(saved.id, 'failed', reason);
        this.active.delete(saved.id);
      }
    }
    for (const [id, runtime] of this.active) {
      const alarm = this.alarm(id);
      if (alarm.status === 'starting') {
        if (runtime.seenReported) {
          runtime.rampStartedAt = this.now(); runtime.nextLightAt = this.now() + 4000;
          this.updateAlarm(id, { status: 'ringing' });
        } else if (this.now() - runtime.attemptedAt > 15000) this.finish(id, 'failed', 'Playback was not reported within 15 seconds; no retry.');
        continue;
      }
      if (alarm.status !== 'ringing' || runtime.rampCancelled || this.now() < runtime.nextLightAt) continue;
      try {
        const shadow = await this.fresh();
        if (!this.active.has(id) || runtime.invalidated || runtime.rampCancelled || !owns(shadow.state.reported, runtime)) continue;
        const progress = alarm.light.rampSeconds === 0 ? 1 : Math.min(1, (this.now() - runtime.rampStartedAt) / (alarm.light.rampSeconds * 1000));
        runtime.previousIntensity = runtime.lastIntensity;
        runtime.lastIntensity = percentRaw(alarm.light.from + (alarm.light.to - alarm.light.from) * progress);
        // Subsequent ramp writes never contain playback, sound, volume, or RGB.
        const result = await this.device.write({ current: { color: { i: runtime.lastIntensity } } }, {
          guard: latest => this.active.get(id) === runtime && this.alarm(id)?.status === 'ringing' && !runtime.invalidated && !runtime.rampCancelled && owns(latest?.state?.reported, runtime) && !departed(latest?.state?.desired?.current, runtime),
        });
        if (result?.skipped) continue;
        runtime.nextLightAt = this.now() + 4000; if (progress === 1) runtime.rampCancelled = true;
      } catch { this.finish(id, 'failed', 'Light ramp interrupted; no further writes or playback retries.'); }
    }
    await this.lightSequence.tick();
  }
}
