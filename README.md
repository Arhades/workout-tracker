# Workout Tracker

A personal, offline-first **PWA** for logging a PPL × Arnold hybrid hypertrophy program.
Local-only (IndexedDB) — no backend, no sync. Built to be installed on an iPhone home
screen and used at the gym with no signal.

**Zero dependencies. No npm, no `node_modules`, no build step.** Plain ES-module JavaScript,
a hand-written service worker, and raw IndexedDB.

## Features
- **Day templates** — pick a session (Push / Pull / Legs / Chest & Back / Arms & Shoulders /
  Bouldering, plus BJJ / Judo / Muay Thai); it auto-suggests by weekday and pre-fills exercises.
- **Editable program** — customise any day's exercise list; defaults restore on reset.
- **Set logging** — weight / reps / RIR per set, saved instantly to IndexedDB.
- **Imbalance protocol** — unilateral lifts log **Left and Right separately**, with the
  "left-first, drop-set to failure, right capped to left's reps" workflow and a live cap hint.
- **Rest timer** — per-exercise, wall-clock accurate, buzzes when done.
- **Progress** — top-set weight trends; for unilateral lifts a **L/R gap chart** tracking the
  shrinking imbalance.
- **Daily Readiness** — ~10-second check-in (readiness / soreness / sleep) for later analysis.
- **JSON export / import** — clean, versioned (`schema_version`) backup. Local storage means
  **back up often** — a phone wipe loses everything.

## Run locally
You only need Node (used purely as a static file server — no packages):
```bash
node serve.js          # prints a localhost URL + your LAN IPs
```
Open the printed **192.168.x.x** URL on your phone (same Wi-Fi).

## Deploy (GitHub Pages)
This repo is a static site — push it and enable Pages (Settings → Pages → Deploy from a
branch → `main` / root). Your app will be live at `https://<user>.github.io/<repo>/`.
Open that in Safari → Share → **Add to Home Screen**: it then launches full-screen and works
fully offline via the service worker.

## Layout
```
index.html              app shell
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline app-shell cache)
serve.js                zero-dep static server (Node built-ins only)
src/
  app.js                tab router + shell
  program.js            default program, exercise library, martial-arts config
  db.js                 IndexedDB wrapper + versioned export/import schema
  dom.js                tiny hyperscript helper
  components/           chart.js (SVG), timer.js (rest timer)
  views/                log, history, progress, readiness, data
icons/                  app icons
scripts/generate-icons.js   dependency-free PNG/SVG icon generator
```

## Notes on the data
All data lives in the browser's IndexedDB on the device. There is no server. The JSON export
is the stable, versioned source of truth — back it up regularly. Any heavier analysis (trend
forecasting, imbalance ETA, readiness modelling) is intended to run **offline in Python** over
the exported JSON, not inside the app.
