# Host your own instance

Use an always-on Node machine or persistent container host. A static-site host or short-lived serverless function cannot run this MQTT connection and in-process scheduler. Configure your own Hatch account and secrets using [Setup](SETUP.md).

## Docker

Build from the repository root:

```sh
docker build -f cloud/Dockerfile -t hatch-sound-room .
docker volume create hatch-sound-room-data
docker run --name hatch-sound-room --restart unless-stopped \
  --env-file .env -e PORT=3000 -e DATA_DIR=/var/data/hatch \
  -p 3001:3000 -v hatch-sound-room-data:/var/data \
  hatch-sound-room
```

The container includes Node and ffmpeg. Your `.env` stays outside the image; the environment file is read by Docker, not copied into the build. Configure `PUBLIC_ORIGIN` for the browser's externally visible address and `AUDIO_ORIGIN` if the device needs a different address. Publishing port 3001 as above exposes it on host interfaces; use a firewall and an HTTPS reverse proxy for access beyond loopback. Native Docker env-file parsing differs from Node dotenv parsing; use raw values without surrounding quotes in a Docker-specific ignored env file if needed.

**Ready to use when:** the mounted data directory is writable, exactly one container is running, HTTPS/login works at your chosen public origin, `/healthz` reports ready, and a supervised physical light/sound test succeeds.

## Render Blueprint

Fork this public repository into your own GitHub account, then create a Render Blueprint from your fork's `render.yaml`. This is a **paid web service and persistent disk**. Review the plan, region and current [compute](https://render.com/docs/compute-plans) / [disk](https://render.com/docs/disks) pricing before applying. Cloning the repository does not create hosting.

The template declares one Docker process, one 1 GB disk at `/var/data`, and `DATA_DIR=/var/data/hatch`. Automatic deploys and preview environments are off. It prompts privately for `HATCH_EMAIL`, `HATCH_PASSWORD` and `PUBLIC_ORIGIN`, and generates independent API/session secrets. Choose a unique service name if you already have a resource with this name in that workspace.

Set `PUBLIC_ORIGIN` to your service's exact HTTPS origin. If the first deployment needs the final hostname, set the actual value in Environment and perform one intentional redeploy. Keep root directory blank; the Dockerfile needs both `web/` and `cloud/`. Environment changes can trigger deployments, so inspect deploy status before starting another.

**Hosted setup is complete when:** the latest deploy is live, authenticated state loads, `/healthz` returns `ready:true`, and files persist on the mounted disk. Device audio over your HTTPS endpoint needs a separate physical check. Render health checks establish process/cloud readiness, not a guaranteed wake-up.

## Persistence and recovery

Keep one server instance. SQLite locks reject concurrent processes using the same database. A disk-backed Render service has brief downtime during deploys and cannot scale horizontally with this layout.

For a simple consistent backup, stop the controller cleanly and copy the entire `DATA_DIR` to protected backup storage. The database, media and temporary files belong together. Treat backups as private: they contain recording capabilities, native references, alarm times and library metadata. Restore to a separate directory with one process; verify data before testing hardware. Avoid filesystem snapshot restores as a substitute for SQLite-consistent backups.

Changing the media origin invalidates URLs already sent to the device; explicitly start the intended playback again after an origin change. Changing a browser origin can end that browser's session and leave local presets under the old origin. Export recipes before migrating domains.
