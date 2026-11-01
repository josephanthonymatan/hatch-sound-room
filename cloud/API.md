# Hosted Hatch API contract

The production target is one persistent Node service serving the built frontend in `../web/dist`, the API, public audio files, the MQTT connection, and the alarm scheduler. The browser uses same-origin `/api/hatch/*`; these are aliases of `/v1/*` in the same process. See [Hosting](../docs/HOSTING.md) for deployment and persistence.

Hatch credentials and bearer/session secrets stay on the server. Cloud acceptance and cloud-reported state do not prove physical sound or light behavior. Errors are JSON `{error:string}` with an actionable message; controls must show an error or ambiguous result rather than claim physical success.

## Authentication

| Route | Contract |
| --- | --- |
| `GET /auth/session` | Public. Returns `{authenticated:false}` or `{authenticated:true,displayName:string}` for a valid owner session. |
| `GET /auth/bootstrap` | Public. Returns `{authenticated:false}` without a valid owner cookie; otherwise `{authenticated:true,displayName:string,room:State}`. Includes one fresh, redacted room snapshot so startup needs no second API request. Bearer tokens do not establish a browser session. |
| `POST /auth/login` | JSON `{email,password}` using the configured Hatch account credentials. Requires an `Origin` header exactly matching `PUBLIC_ORIGIN`. Returns `{authenticated:true,displayName:string,room:State}` and the owner cookie. |
| `POST /auth/logout` | Requires the same exact origin. Returns `{authenticated:false}` and expires the browser cookie. |

Owner cookies are signed, HttpOnly, SameSite=Strict, and Secure on HTTPS, with an eight-hour lifetime. Logout removes the browser's cookie; copied stateless cookies remain valid until expiration or signing-secret rotation. Login is limited to ten attempts per socket IP in fifteen minutes.

Auth and API responses use `Cache-Control: no-store`. Fingerprinted frontend assets use a one-year immutable cache; HTML and unversioned files revalidate. Browser device intent is shown separately from reported state, reconciled after acceptance, and never persisted or replayed as an offline command.

Both `/v1/*` and `/api/hatch/*` require either the owner cookie or `Authorization: Bearer API_TOKEN`. Cookie-authenticated mutations also require the exact app `Origin`; bearer-authenticated calls do not require that header. Unauthenticated API calls return HTTP 401. The browser never receives `API_TOKEN`, `SESSION_SECRET`, or Hatch credentials from an API response.

The SPA and its static assets, auth endpoints, `GET /healthz`, and unpredictable audio-capability URLs are publicly reachable. Public app files do not grant control access. `/healthz` returns `{ok:true,ready:boolean}`; HTTP 200 is a process-health result, and `ready` reflects a fresh cloud read plus reported device connectivity.

## Types

Track: `{id,title,kind:"music"|"field-recording"|"generated"|"hatch-sound"|"hatch-favorite"|"saved-sound",durationSeconds,category?,source?,license?,tags:string[],createdAt?,cover?,timing?,removable?,alarmEligible?,stepCount?,volume?,light?,nativeLightId?}`. New uploads and saved sounds require `category` (nonempty, up to 60 characters); names reuse existing spelling without case or whitespace duplicates. A new name creates a category with that sound. Existing uncategorized sounds remain supported. Built-in sounds use these categories: Nature, Water, Color Noise, Household, Camp, Vehicle, or Lullaby. Favorite volume/light describe the first step, not an app override. A native duration can be unknown (`0`); `timing` describes looping, saved timers, or favorite timing. Seed ID `bach-allemanda` retains its recording provenance. Public tracks exclude filenames, media URLs, capabilities, native routine IDs, and private playback references. Any library ID can be used as `trackId`.

Scene: `{id,title,color,brightness,description}`. Presets are `amber` (`#ff8800`), `blue-hour` (`#405cff`), and `rose` (`#ff4080`). Activating a scene changes actual RGB/intensity while preserving sound fields. It does not generate audio.

Alarm: `{id,label,trackId,sourceTitle?,sourceKind?,usesFavoriteSettings?,scheduledAt,localTime,repeatDays,enabled,timeZone,volume,light:{color,from,to,rampSeconds},lastOccurrence?,status:"pending"|"starting"|"ringing"|"dismissed"|"cancelled"|"missed"|"failed",createdAt,reason?}`. Uploaded occurrences have a unique private audio capability. Native sounds retain a private sound reference; favorites retain a private revision fingerprint. A durable claim precedes one playback attempt; ambiguous/failed attempts are not retried. On restart, claimed occurrences fail without replay. Pending occurrences retain their instant and a thirty-second late grace. Observed holds/departures cancel writes inside the MQTT dispatch queue. Favorites keep their playlist/timing with no app ramp. Changed playback settings, removal, failed refresh, or an already selected non-stopped favorite prevent an alarm start; no automatic stop/restart is sent.

LightRecipe: `{version:1,id:string,title:string,mood:string,brightness:number,pace:number,motion:"flow"|"breathe"|"steady",stops:{color:string,seconds:number}[]}`. IDs are at most 100 characters, titles nonempty and at most 80, mood at most 280. Brightness is 1–100, pace .5–2, and there are 2–32 `#RRGGBB` stops with durations 1–60 seconds. Provider effect IDs and other extra fields are ignored. Optional `effects:{blend?:"rgb"|"vivid"|"spectrum",hold?:0–.8,drift?:0–1,layer?:0–1,bloom?:0–1,bloomColor?:"#RRGGBB",breath?:{seconds:8–30,depth:.1–.8,inhale:.2–.5}}` shape flow/breathe motion; unknown effect keys are dropped. Without `effects`, a recipe plays exactly as before.

LightSequence: `null | {id:string,title:string,status:"starting"|"running"|"stopped"|"failed",startedAt:string,cadenceSeconds:2,reason?:string}`. `starting` records cloud acceptance; `running` requires a matching reported frame, which still does not establish physical light behavior. It is null before the first request and after service restart.

State: `{ready:boolean,connected:boolean,device:{product,firmware,hardware},playback:{status:"none"|"routine"|"remote",active:boolean,trackId:string|null,title:string,volume:number,brightness:number,color:string,updatedAt:string,captureKey:string|null},light:{on:boolean,color:string,brightness:number,effectId?:number,effectName?:string},lightSequence:LightSequence,hatch:{syncedAt:string|null,catalogStatus:"bundled"|"refreshed"},library:Track[],scenes:Scene[],alarms:Alarm[]}`. Percentages are 0–100. `captureKey` is an opaque selection digest, not a credential or audio URL; submit it when saving the current sound. It is null for stale, stopped, paused, muted, uploaded, or unsupported audio. `playback.active` distinguishes audio from silent lighting. `light` reports effective lighting. Reported cloud state does not prove audible output. Device identifiers and raw shadows are excluded.

## Control and data routes

Every `/v1` route below also exists at the corresponding `/api/hatch` path.

| Method and route | Input | Response |
| --- | --- | --- |
| `GET /v1/state` | — | State |
| `GET /v1/library` | — | `{tracks:Track[]}` |
| `POST /v1/hatch/sync` | JSON `{}` | `{tracks:Track[],hatch:{syncedAt,catalogStatus}}`. Provider GETs only, no playback. Catalog failures use 42 bundled sounds. Failed favorite reads preserve cached favorites and return an error. |
| `POST /v1/sounds/save-current` | JSON `{title,category,captureKey}` | HTTP 201 `{track:Track,existing:boolean}`. Reads fresh state, saves a private reference without device writes. Duplicate references return the existing sound and update its category. Changed/unsupported selections return 409. |
| `POST /v1/play` | JSON `{trackId,volume?}` | `{ok:true}` after cloud acceptance. Favorites refresh first and reject volume overrides. Changed controls before dispatch or reselecting an already active favorite return 409. |
| `POST /v1/stop` | JSON `{}` | `{ok:true}` |
| `PATCH /v1/volume` | JSON `{volume}` | `{ok:true}` |
| `PATCH /v1/light` | JSON `{color?,brightness?}`; at least one | `{ok:true}`; HTTP 409 if native controls change before dispatch. |
| `POST /v1/light-sequence` | JSON LightRecipe directly | `{ok:true,lightSequence:LightSequence}` after one cloud write; HTTP 409 if cancelled or controls change before dispatch. |
| `DELETE /v1/light-sequence` | — | `{ok:true,lightSequence:LightSequence}`; immediately cancels pending starts/frames and leaves the last light frame in place without a device write. |
| `POST /v1/scenes/:id/play` | JSON `{}` | `{ok:true}` |
| `POST /v1/library` | Multipart upload described below | HTTP 201 `{track:Track}` |
| `DELETE /v1/library/:id` | — | `{ok:true}`; removes uploads or saved references. Seeded, built-in, favorite, or in-use tracks return 409. Desired and paused playback also protect deletion. Edit native favorites in Hatch. |
| `GET /v1/alarms` | — | `{alarms:Alarm[]}` |
| `POST /v1/alarms` | JSON `{label?,trackId,localTime,timeZone,repeatDays?,enabled?,volume?,light?:{color,from,to,rampSeconds}}` (or legacy `scheduledAt`) | HTTP 201 `{alarm:Alarm}`. Volume/light required for individual sounds; favorites use saved settings and ignore overrides. Light-only favorites cannot be sound alarms. |
| `PATCH /v1/alarms/:id` | Partial alarm settings, including `enabled` | `{alarm:Alarm}`; editing or disabling cancels queued starts and remaining fades without stopping accepted audio. |
| `DELETE /v1/alarms/:id` | — | `{ok:true}`; removes the alarm and stops active audio only while this occurrence still owns playback. |

JSON bodies must be objects, use `Content-Type: application/json`, and fit within 16 KiB. `localTime` is `HH:MM` in the IANA `timeZone`; `repeatDays` uses 0 for Sunday through 6 for Saturday, or an empty array for one occurrence. Re-enabling chooses the next matching local time. A spring-forward nonexistent time is skipped; a repeated fall-back time runs once at the earlier instant. Legacy `scheduledAt` accepts an ISO instant with seconds and an explicit offset, five seconds through 366 days ahead. `scheduledAt` in a response is the next occurrence when enabled; `lastOccurrence` describes the latest completed or active attempt. Ramps last 0–1800 seconds and cannot end below their starting brightness. There may be at most 100 saved alarms.

Light brightness alone preserves RGB/white channels, using remembered nightlight color or amber when all current channels are black. Color alone retains visible brightness, defaulting to 65% when off. Stopped or paused audio uses the independent nightlight; an already enabled nightlight remains that pathway during audio too. Otherwise active playback uses custom color ID 9999 without replacing sound. Brightness zero turns both light pathways off and preserves audio. `/stop` turns off sound and both light pathways but does not cancel pending alarms; disable each alarm with `PATCH /v1/alarms/:id` or delete it. A manual nightlight or color-ID override cancels an alarm's remaining fade.

Custom light sequences run in server memory with no browser timer required. Frames use only the independent nightlight fields, including for black colors and during native favorites: no frame contains audio, playback, mute, or volume fields. Starting a sequence cancels an alarm's remaining light ramp, preserving its audio. Flow uses smooth RGB interpolation; breathe adds a 55–100% brightness pulse per color; steady holds the first color. Effects change this: `vivid` interpolates in OKLCH along the shorter hue arc and `spectrum` the longer one, reducing chroma rather than clipping out-of-gamut colors; `hold` rests on each color for that fraction of its time before an eased transition; `drift` adds slow non-repeating hue (±8°), chroma (±12%) and brightness (±15%) wander with 17–61-second periods; `layer` mixes up to 50% of a reversed golden-ratio-period pass of the palette; `bloom` adds deterministic flares (at most one per 12-second window, chance up to 50%, about 9 seconds each) toward `bloomColor` or a pale version of the current hue, with up to 70% more brightness capped at 100; `breath` replaces the per-color pulse with its own period (scaled by pace, at least 8 seconds), depth and in-breath fraction. Effects and their random flares are derived from the recipe and elapsed time only, so the studio preview and the device sample the same timeline. White stays 0. Each stop lasts `max(4, seconds * pace)` seconds so fast recipes cannot alias to a static phase at the minimum two-second cloud cadence. Latency and report timing can slow or skip sampled frames; this is experimental cloud control, not native firmware animation.

Each frame requires reported acknowledgement before another is sent. Reports are checked at most once every two seconds while waiting; after 15 seconds without acknowledgement the sequence fails with no resend. Native hold, playback/favorite/step changes, manual lighting, app light/scene/stop/play, a firing alarm, disconnect, connection replacement, and shutdown invalidate ownership. Queue-time guards veto stale frames; previous/expected acknowledgements are accepted only while a frame is pending. The sequence never retries an ambiguous write or resumes after reconnect/restart. Stopping a sequence freezes its last light frame; Light Off and Hatch Off remain separate actions. Native changes that leave exactly the same observable playback and lighting identity cannot be distinguished; physical dismissal and audio preservation still require coordinated device testing.

Uploads use multipart fields `file`, `title`, `kind`, `category`, and optional comma-separated `tags` and `license`. Accept MP3/WAV only, at most 50 MiB input and one second through thirty minutes. The library holds at most 100 tracks within a 750 MiB normalized-audio quota; storage checks may reject earlier to preserve 128 MiB of free space for durable state. Only one upload processes at a time. ffmpeg normalizes to mono 44.1 kHz, 128 kbps MP3 with bounded loudness and a short fade-in. Generated storage names and fixed subprocess arguments prevent filename/path or shell interpolation. User-supplied attribution is retained; rights are not independently verified.

## Saved sound references

Saved sounds are capped at 100, separate from the upload quota. Capture accepts only an observed reference on approved Hatch HTTPS asset hosts and space; browser input cannot supply URLs. Supported timing is `indefinite` or a positive `duration` up to 24 hours. Finite timers are preserved for playback and alarms; other content should use a favorite. URLs can change or expire, so replay may require saving the sound again.

Native playback uses stable provider IDs/URLs. A missed stop-and-restart of the exact same selection cannot be distinguished like an upload occurrence's unique URL. No same-source reliability claim is made without physical evaluation.

## Device audio access

`GET` and `HEAD /audio/<64-lowercase-hex-capability>.mp3` are public capability routes. They return `audio/mpeg`, a content length, and byte-range support. Missing capabilities return HTTP 404; unsupported/unsatisfiable ranges return HTTP 416. Treat the complete URL as a secret granting access to that recording.

Media URLs use `AUDIO_ORIGIN`, defaulting to `PUBLIC_ORIGIN`. Production uses the same stable HTTPS origin for app and audio unless a separate host has been physically verified. All media, SQLite state, and upload temporary files must live in persistent `DATA_DIR`; no laptop or open browser should be required. Verify physical playback of normalized MP3s over your chosen media origin.

Known native dynamic lights (Aurora 792, Mangrove Orchid 888) may report zero/null RGBW while active. Their `light` includes effect metadata and a representative color, not a sampled animation frame. `nativeLightId` identifies the first enabled favorite step so the light library can offer its existing favorite playback; this is not a direct arbitrary-effect control API.
