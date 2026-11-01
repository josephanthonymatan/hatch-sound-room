# Compatibility and limits

## Device and account

The implemented adapter authenticates to Hatch's cloud and requests devices of product type `restBaby`. It requires exactly one matching device. It does not yet provide a device selector or adapters for Restore, Rest Mini, other product types, or accounts with multiple matching devices.

The development unit reported hardware `11.0.0` and firmware `11.1.645`. Its physical model label was not independently confirmed. Those reports are evidence about one unit, not a compatibility promise for every Hatch marketed under a similar name.

Custom audio uses sound ID `10543`; the bundled native catalog is model-specific. Native favorites, uploaded audio, nightlight control and dismissal must be checked on each new hardware/firmware combination. Premium-library access and firmware modification are outside this implementation.

## Verified versus pending

On the development unit, local trials established custom MP3 playback, one natural loop, independent light control, hold-to-silence and supervised alarm fades. The owner also confirmed one custom light preset played. Unit and integration tests cover scheduling, ownership, dispatch races, storage, auth and fake-device HTTP flows.

Hosted readiness, API acceptance and a reported color are separate from actual speaker/light behavior. Unattended wake-up reliability, arbitrary model support, exact color reproduction and smoothness of cloud-driven sequences remain owner-specific physical checks. Keep an independent wake-up method until your installation passes its own tests.

## Operating limits

- One owner, one selected device and one controller instance per installation.
- Requires Hatch cloud access plus internet at the server and device; not local-only control.
- Custom light sequences are sampled cloud updates, with a two-second cadence and four-second minimum color duration. They are not uploaded firmware animations.
- Presets are stored in the current browser's local storage; Copy Recipe exports one as JSON. There is no cross-browser preset sync or JSON import UI.
- MP3/WAV uploads: up to 50 MiB, one second to thirty minutes; normalized to mono MP3. The library has track, quota and free-space limits.
- Alarm occurrences are claimed before one playback attempt. Ambiguous attempts are not retried; native dismissal and manual changes defeat stale queued writes. A stopped occurrence is not restarted automatically.

To add another model or account selector, start with [device adapters](ARCHITECTURE.md#device-adapter), add recorded fixtures with synthetic identifiers, and report physical results separately from tests. Report model name, product string, hardware/firmware and observed outcomes; remove identifiers, account data and complete media URLs.
