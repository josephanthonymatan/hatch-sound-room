# Architecture

The browser talks to one authenticated Node service. That service owns a SQLite database, uploaded media, the Hatch cloud connection and the alarm/light schedulers. Each self-hosted installation belongs to one owner.

## Choose the branch you're changing

| Change | Start here | Completion check |
| --- | --- | --- |
| Device/model support | [Device adapter](#device-adapter) | Fake transport tests plus separately recorded physical observations |
| Motion or palette math | [Light effects](#light-effects) | Browser/cloud frame parity and cancellation tests |
| Photo extraction or selection | [Photo palettes](#photo-palettes) | Accent/neutral/transparency fixtures plus WebKit/Chromium import, cancellation and privacy checks |
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

## Photo palettes

`web/src/components/image-palette-loader.ts` decodes the selected image locally and transfers a sample of at most 256 × 256 pixels to `image-palette.worker.ts`. It releases object URLs and workers after completion, failure, replacement or cancellation. The 25 MB file limit and bounded sample keep analysis small. Browser decoding determines format support; unsupported HEIC files offer a JPEG/PNG/WebP fallback. Canvas converts wide-gamut images to sRGB for the existing Hatch hex-color contract.

`image-palette.ts` uses Color Thief 3.5.0's OKLCH quantizer, then merges neighbors and measures distances in OKLab. A separate chromatic pass supplies small accents; coverage is recounted against the original sample. Character reserves a distinct color family before filling the remaining tonal range; Dominant prioritizes coverage. Both remove near-duplicates and order a short closed loop. Palette size is a maximum: simple images produce fewer colors, including a single solid color. This is a color heuristic, not object recognition or a promise of physical lamp fidelity.

`photo-palette.tsx` owns the transient photo and color-study preview. Applying changes the existing recipe through `light-studio.tsx`; it preserves brightness, pace, effects and per-position timing. Only hex colors enter saved presets or the explicit Play action. Images and metadata stay out of storage and HTTP requests.

Validate with `node --test web/test/image-palette.test.mjs`, the web build, and `node web/scripts/photo-palette-check.mjs` against the fake preview. The browser check covers Chromium/WebKit, narrow/light/dark layouts, cancellation, error recovery, local persistence and absence of photo network writes.

## Alarms

`cloud/alarm-schedule.mjs` calculates local-time occurrences in an IANA zone; `cloud/service.mjs` coordinates playback and fades. `cloud/store.mjs` persists claims before dispatch. Repeat schedules retain wall-clock time across DST, skip nonexistent spring-forward times and choose the earlier fall-back instant once.

Each occurrence gets one attempt. Claimed jobs do not replay after restart, and ambiguous starts are not retried. Pending occurrences retain their instant with a 30-second late grace. Turning off an alarm cancels future starts and its remaining fade without stopping accepted sound. Native favorites recheck their fingerprint and preserve saved settings; a changed favorite fails before playback.

## Storage and media

`cloud/store.mjs` uses SQLite FULL synchronous transactions and an exclusive process lock. `cloud/media.mjs` validates multipart fields and normalizes MP3/WAV with ffmpeg without a shell. Keep its database, media and temporary files together under `DATA_DIR`.

Media is served through unguessable capability URLs so the device can fetch audio. Those URLs grant access to the recording. Never publish real database snapshots or request URLs. `cloud/catalog.json` contains public provider references only; see `cloud/NOTICE`.

## Browser

`web/src/components/sound-room-app.tsx` owns login/session startup. `sound-room.tsx` coordinates reported state and user intent. `room-state.ts` excludes late reads that predate accepted edits. `forms.tsx`, `data-entry.tsx` and `form-data-entry.tsx` provide forms and phone-friendly entry; `light-studio.tsx` manages browser-local presets.

Keep the tactile paper/ink surfaces, blue time controls, raised pill keys and inset wells. Use native time/color/file controls, readable text, visible focus and reduced-motion support. All browser verification uses the disposable fake preview, not a second real controller.
