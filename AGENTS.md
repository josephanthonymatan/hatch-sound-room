# Working on Sound Room

Read README.md first. Use its demo path for orientation; it never connects to hardware.

- **Architecture:** read docs/ARCHITECTURE.md before changing device transport, effects, scheduling, storage or auth; follow its branch table and completion checks.
- **Hardware:** read docs/SETUP.md before starting a real controller. Coordinate sound, light, alarms and physical tests with the owner. Keep one controller per installation.
- **Hosting:** read docs/HOSTING.md before deployment, configuration, disk or recovery work.
- **API:** read cloud/API.md before changing routes or payloads.
- **Contributions:** read CONTRIBUTING.md for test commands, browser verification and release hygiene.
- **Security:** read SECURITY.md before handling credentials, snapshots, recordings or reports.

Tests and the disposable preview use fake devices. Starting cloud/server.mjs connects to Hatch and activates stored alarms. Preserve dispatch-time cancellation guards, durable claims and one playback attempt per occurrence. Keep real secrets, database/media backups, raw shadows and capability URLs out of source, logs and screenshots. Distinguish app acceptance, device reports and physical observations in results.
