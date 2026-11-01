# Contributing

Start with the [README demo](README.md#try-it-without-a-hatch). For the specific branch you're changing, use the table in [Architecture](docs/ARCHITECTURE.md#choose-the-branch-youre-changing).

## Development loop

1. Install with `npm ci --ignore-scripts` and `npm run setup`.
2. Run `npm test`, then `npm run build`. Completion means all tests and the strict TypeScript build pass.
3. For browser changes, run `npm run preview` in one terminal and verify against `http://127.0.0.1:4183`. The preview prints synthetic credentials and uses disposable data.
4. Run `npm exec --prefix web -- playwright install chromium webkit`, then the relevant `node web/scripts/*-check.mjs` script. Run scripts sequentially; they share the fake controller. Repeated sign-ins can exhaust the preview's rate limit; restart only that disposable preview when necessary.
5. Review your diff for account details, media URLs and runtime files before opening a pull request. Include what changed, why, test results and any physical observations separately.

For live UI iteration, Vite runs on port 4173 and proxies to a backend on 3001. A real backend using that browser origin needs `PUBLIC_ORIGIN=http://127.0.0.1:4173`; build-and-preview is the simpler no-hardware path. Starting `cloud/server.mjs` is a live device/scheduler action.

## Browser changes

Preserve the existing visual language and URL-based navigation. Check widths 320, 393 and desktop, light/dark schemes, reduced motion, keyboard focus, paste and readable editable text. Use at least 44 px touch targets and keep software-keyboard space available. Browser emulation does not establish actual iPhone keyboard, haptics or VoiceOver behavior; label those checks explicitly.

## Device or scheduler changes

Preserve the cancellation, ownership and one-attempt rules in [Architecture](docs/ARCHITECTURE.md). Add synthetic fixtures for the behavior you change. Keep host credentials out of tests. Coordinate physical actions with the device owner; use a separate test installation and restore its state after the trial.

## Release hygiene

This repository starts from a curated source snapshot with fresh history. Maintain it directly; avoid merging private deployment history or copying personal operational notes into it. Record reusable setup facts in the setup/hosting guides, and implementation contracts beside the code. Keep reports containing raw account/device data local.

Before pushing, run a secret scanner against the complete staged tree and Git history, plus `npm run check:public`. Scanner success supplements review; it is not proof that every kind of personal data is absent. Preserve MIT notices, media provenance and third-party licenses.
