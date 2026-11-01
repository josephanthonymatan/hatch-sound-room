# Security

Sound Room controls a physical device and stores private audio. Run one instance for your own account on infrastructure you trust. Expose it through HTTPS with the exact configured browser origin.

## Secrets and private data

- Store Hatch credentials, API bearer tokens and signing secrets in an ignored `.env` or host secret configuration. Each installation generates independent random API/session secrets.
- The server administrator can access the configured Hatch account. The app is single-owner; it is not a hosted login portal for other people's accounts.
- Keep runtime directories and backups private. SQLite holds alarms, native references, library metadata and recording capability tokens.
- A complete `/audio/<capability>.mp3` URL grants access to that recording. Share logs and screenshots only after removing those URLs, identifiers, credentials, cookies and raw shadows.
- Credential/session rotation must use the actual server environment. Rotating `SESSION_SECRET` invalidates existing owner cookies; rotating `API_TOKEN` revokes bearer access and also invalidates cookies when no independent signing secret is configured.

## Defaults and limits

Owner cookies are signed, HttpOnly and SameSite=Strict, with Secure on HTTPS. Cookie-authenticated writes require the exact Origin. Bearer tokens authorize the complete owner API and intentionally do not require browser Origin. Login has an in-process rate limit; it is not a replacement for network protection.

Audio capabilities, health and static app assets are public routes. `/healthz` reveals process/cloud readiness. The server listens on all interfaces. Put it behind your firewall/reverse proxy deliberately; the local browser URL does not limit the listener.

## Report a vulnerability

Use this repository's **Security → Report a vulnerability** flow when available. If unavailable, open a public issue asking for a private reporting channel without including sensitive details. Send a redacted reproduction with affected versions and expected/actual behavior; include no live credentials, raw device snapshots or personal audio.

If credentials are exposed, stop the affected controller, rotate the affected account/token/signing secrets privately, and verify the device's state separately. Removing a file from the latest commit does not remove its history. The public repository's initial history contains only the curated release snapshot.

## Known dependency advisory

At the initial public release audit (November 1, 2026), `npm audit --prefix cloud` reports five moderate entries for the legacy `aws-iot-device-sdk` → `mqtt` → `help-me` → `glob` → `minimatch` chain, arising from [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). This app imports the MQTT client; the `help-me` globbing code belongs to its command-line help tooling. No app route accepts glob patterns. This source inspection is not a general exploitability guarantee. Migrating the legacy SDK/CLI dependency chain is an open maintenance task. The suggested forced audit fix downgrades the device SDK; this release retains the tested transport instead of silently applying a breaking dependency change.
