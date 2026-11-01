# Architecture

The browser talks to one authenticated Node service. That service owns a SQLite database, uploaded media, the Hatch cloud connection and the alarm/light schedulers. Each self-hosted installation belongs to one owner.

## Choose the branch you're changing

| Change | Start here | Completion check |
| --- | --- | --- |
| Device/model support | [Device adapter](#device-adapter) | Fake transport tests plus separately recorded physical observations |
| Motion or palette math | [Light effects](#light-effects) | Browser/cloud frame parity and cancellation tests |
| Alarm timing or recurrence | [Alarms](#alarms) | DST, restart, claim and dispatch-race tests |
| Uploads and recordings | [Storage and media](#storage-and-media) | Real ffmpeg normalization and persistence fixtures |
| Browser UI | `web/src/components/` and `web/src/globals.css` | Strict build, fake-preview browser checks, phone widths and both color schemes |
| Auth or routes | `cloud/auth.mjs`, `cloud/core.mjs`, `cloud/server.mjs` | Unauthorized/wrong-Origin rejection and API tests |

## Device adapter

`cloud/device.mjs` handles Hatch login, Cognito temporary credentials, AWS IoT transport, fresh shadows and reconnect generations. `cloud/core.mjs` builds validated sound/light patches. `cloud/sounds.mjs` handles favorites, catalog mappings and private references.

Add synthetic API/shadow fixtures before generalizing another model. Keep physical device selection explicit. Credential renewal ends the old transport before expiry; queued writes from an old connection generation never migrate to a replacement connection. Cloud acceptance does not prove physical playback.

## Light effects

`web/src/components/light-recipes.ts` defines the editor schema and preview math. `cloud/light-sequence.mjs` validates recipes and samples server-owned frames; `cloud/test/light-effects.test.mjs` checks math parity.

The scheduler uses independent nightlight fields, preserving audio and volume. Desired/reported ownership and cancellation guards run inside the MQTT dispatch queue. Holds, favorite switches, manual light edits, alarms and disconnects must defeat stale frames. Preserve RGBW channels and the device's separate stopped/active lighting pathways.

## Alarms

`cloud/alarm-schedule.mjs` calculates local-time occurrences in an IANA zone; `cloud/service.mjs` coordinates playback and fades. `cloud/store.mjs` persists claims before dispatch. Repeat schedules retain wall-clock time across DST, skip nonexistent spring-forward times and choose the earlier fall-back instant once.

Each occurrence gets one attempt. Claimed jobs do not replay after restart, and ambiguous starts are not retried. Pending occurrences retain their instant with a 30-second late grace. Turning off an alarm cancels future starts and its remaining fade without stopping accepted sound. Native favorites recheck their fingerprint and preserve saved settings; a changed favorite fails before playback.

## Storage and media

`cloud/store.mjs` uses SQLite FULL synchronous transactions and an exclusive process lock. `cloud/media.mjs` validates multipart fields and normalizes MP3/WAV with ffmpeg without a shell. Keep its database, media and temporary files together under `DATA_DIR`.

Media is served through unguessable capability URLs so the device can fetch audio. Those URLs grant access to the recording. Never publish real database snapshots or request URLs. `cloud/catalog.json` contains public provider references only; see `cloud/NOTICE`.

## Browser

`web/src/components/sound-room-app.tsx` owns login/session startup. `sound-room.tsx` coordinates reported state and user intent. `room-state.ts` excludes late reads that predate accepted edits. `forms.tsx`, `data-entry.tsx` and `form-data-entry.tsx` provide forms and phone-friendly entry; `light-studio.tsx` manages browser-local presets.

Keep the tactile paper/ink surfaces, blue time controls, raised pill keys and inset wells. Use native time/color/file controls, readable text, visible focus and reduced-motion support. All browser verification uses the disposable fake preview, not a second real controller.
