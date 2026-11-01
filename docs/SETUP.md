# Connect your Hatch

Use the [README demo](../README.md#try-it-without-a-hatch) first. The instructions below start a real controller: it connects to the configured account and runs enabled alarms stored in its data directory.

## 1. Configure a local instance

Run commands from the repository root. Install and build using the README, then:

```sh
cp .env.example .env
chmod 600 .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edit `.env` locally. Put your own Hatch account email and password in `HATCH_EMAIL` and `HATCH_PASSWORD`, and the generated value in `API_TOKEN`. Quote dotenv values containing `#` or whitespace. Passwords remain on this server; the frontend sign-in uses the same owner credentials.

Keep `.env` on your machine; `.gitignore` excludes it. Treat anyone who can administer this server as having access to the Hatch account. Hosted credentials belong in that host's secret settings.

| Setting | Choose |
| --- | --- |
| `PUBLIC_ORIGIN` | The exact browser origin. For the built local app, use `http://127.0.0.1:3001`. Hosted sign-in requires HTTPS. No path or trailing query. |
| `AUDIO_ORIGIN` | The server origin reachable **from the Hatch**, such as your computer's LAN address and port 3001. Omit it when the device can use `PUBLIC_ORIGIN`. Loopback addresses point at the Hatch itself, so they do not work for device media. |
| `DATA_DIR` | A dedicated writable directory; the example uses `./data`. Keep its SQLite database, media and temporary files together. |
| `API_TOKEN` | A fresh random secret of at least 32 characters per installation. |
| `SESSION_SECRET` | Optional independent random cookie-signing secret, at least 32 characters. Generate another value if using it. |
| `OWNER_NAME` | Your display name, or `Owner`. |
| `PORT` | `3001` matches the example browser origin. |

**Configuration is complete when:** required settings are filled, the browser and media origins describe your server, and `.env` is ignored (`git check-ignore .env`). Credentials and bearer secrets must never use a `VITE_` prefix: Vite exposes those variables to the browser bundle.

## 2. Start intentionally

Close other Sound Room controllers for this account. Run exactly one instance:

```sh
npm start
```

The built app is at **http://127.0.0.1:3001**. The server binds `0.0.0.0`, so it also listens on your machine's network interfaces; loopback in `PUBLIC_ORIGIN` does not change that binding. Use your firewall and HTTPS reverse proxy deliberately. Plain HTTP owner sign-in is limited to loopback development origins.

Sign in with the account configured in `.env`. `GET /healthz` should return `{"ok":true,"ready":true}` once the device connection is fresh. If `ready` stays false, check account credentials, device internet connectivity, and [supported accounts](COMPATIBILITY.md). Logs intentionally omit raw shadows and credential values.

**Connection is complete when:** authenticated state loads and the device's reported state is fresh. This does not yet prove physical playback.

## 3. Check the device

Choose a moment when sound or light changes are welcome. Begin with one solid light color at low brightness, observe it on the device, and turn it off. Then try one familiar native sound at low volume; stop it explicitly. Test uploads only after `AUDIO_ORIGIN` is reachable from the Hatch.

On the tested unit, a short top tap selects a native favorite and a roughly three-second hold silences playback. Check this behavior on yours. Native favorites preserve their own saved light, volume, steps and timing. Starting the same already-active favorite requires an explicit stop first.

**Basic control is complete when:** you have seen the requested light, heard the requested sound, and verified physical dismissal. Test an alarm separately while present before trying unattended operation.

## 4. Keep it available

The server runs alarm timing and custom light sequences. Keep that process, its persistent data and internet connection available. Your browser may close; your self-hosted server may not. Custom light sequences stop rather than automatically resume after reconnect/restart. Pending alarms retain their instant with a short late grace; already claimed or ambiguous starts are not retried.

For a host that stays on when your laptop is off, continue to [Hosting](HOSTING.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Node rejects `node:sqlite` or TypeScript test imports | Use Node 24.5 or newer. |
| Audio preparation fails | `ffmpeg` and `ffprobe` are on the server PATH; the input is MP3/WAV. |
| The app opens but reports offline | Account has exactly one `restBaby`, Hatch is online, and credentials are current. |
| Light works but an upload is silent | Hatch can reach `AUDIO_ORIGIN`; test firewall, LAN routing, media format and device HTTPS compatibility. A successful HTTP request alone is not speaker verification. |
| Login fails on a LAN HTTP URL | Use loopback for local sign-in or set up HTTPS for that browser origin. |
| A second process cannot open SQLite | Keep one process per data directory. Stop the first cleanly; preserve the disk. |
| Login is rate-limited during development | The limit is ten attempts per socket IP in fifteen minutes. Wait; isolated browser tests can restart their disposable preview. |
| A command has an uncertain result | Refresh and observe before acting again. The app does not automatically retry ambiguous writes. |
