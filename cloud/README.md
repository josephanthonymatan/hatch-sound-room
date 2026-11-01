# Sound Room server

A single Node process hosts the SPA, owner authentication, SQLite/media storage, Hatch MQTT connection, custom light sequences and reusable alarm scheduler.

- **Connect hardware:** follow [Setup](../docs/SETUP.md) before starting this server.
- **Host continuously:** follow [Hosting](../docs/HOSTING.md) for Docker, persistent storage and HTTPS.
- **Change behavior:** read [Architecture](../docs/ARCHITECTURE.md) and the [API contract](API.md).
- **Preview safely:** `npm run preview` from the repository root runs a fake device on loopback with disposable data. It never loads Hatch credentials.

`node cloud/server.mjs` starts a real controller using process environment variables. The root `npm start` additionally loads the local ignored `.env`. Both connect to Hatch and activate enabled stored alarms. Tests use fake devices and temporary storage.
