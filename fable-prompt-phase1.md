# Fable build prompt — Workout Tracker, Phase 1

You are working on an **existing** personal workout-tracker PWA. This is a real,
in-use app with real logged data. Your job is to fix two bugs and add a set of
features **without breaking or losing any existing data** and **without changing
the app's architecture**. Read this whole document before writing code.

---

## 0. Hard constraints (do not violate)

- **No new dependencies, no build step.** The app is plain ES-module JavaScript,
  raw IndexedDB, a hand-written service worker, and a tiny DOM helper. Do **not**
  add npm, a bundler, a framework, TypeScript, or any CDN library. Everything
  must keep running by opening `index.html` through the existing `node serve.js`
  static server (no compilation).
- **Offline-first must be preserved.** No feature in this phase may require a
  network call. Everything works with zero signal.
- **Preserve all existing user data.** Migrations must be purely additive.
  Existing `sessions`, `sets`, `readiness`, `program`, `techniques`,
  `techCategories`, and `dayTypes` records must survive an upgrade untouched.
- **Follow the existing code style.** Use the `el()` hyperscript helper from
  `src/dom.js`, the `db` helpers from `src/db.js`, and the same file/module
  layout and naming. Match the CSS variable–based styling in `src/styles.css`.
- **After adding any new `src/` file**, you MUST (a) add it to the `SHELL` array
  in `sw.js` and (b) bump the `CACHE` constant in `sw.js` (`workout-tracker-v6`
  → `workout-tracker-v7`), or it won't be cached offline and updates won't ship.
- **When adding IndexedDB stores/indexes**, bump `DB_VERSION` in `src/db.js`
  (currently `5` → `6`) and create the new stores inside `onupgradeneeded`
  without deleting existing ones.
- **When changing the export shape**, bump `SCHEMA_VERSION` in `src/db.js`
  (currently `5` → `6`) and update both `exportData()` and `importData()`.
- This is a single-device, local-only app for now. Do **not** add any backend,
  Supabase, auth, push notifications, or a calorie/food tab — those are Phase 2.

---

## 1. Architecture orientation (current state)

Root files: `index.html`, `sw.js`, `manifest.webmanifest`, `serve.js`.

`src/` modules:
- `app.js` — shell + tab bar. `TABS` array defines the five tabs
  (`log`, `progress`, `readiness`, `techniques`, `data`).
- `db.js` — IndexedDB layer. `DB_NAME='workout_tracker'`, `DB_VERSION=5`,
  `SCHEMA_VERSION=5`. Object stores: `sessions`, `sets`, `readiness`, `program`,
  `techniques`, `techCategories`, `dayTypes`. Helpers: `all`, `byIndex`, `get`,
  `add`, `put`, `update`, `del`, `clearAll`, `getProgram`, `saveDay`, `resetDay`,
  day-type + category CRUD, `deleteSession`, `exportData`, `importData`,
  `todayISO`, plus `changed()`/`onChange()` for reactivity.
- `dom.js` — `el(tag, props, ...children)` hyperscript, `clear`, `mount`,
  `copyToClipboard`, `mmss`.
- `program.js` — `DEFAULT_PROGRAM`, `DAY_TYPES`, `EXERCISE_LIBRARY`,
  `EXERCISE_INDEX`, `MARTIAL`, `KIND_LABEL`, `WARMUP`.
- `recommend.js` — offline rule-based suggester (not AI).
- `aiReport.js`, `markdown.js` — "Copy for AI" markdown + a tiny markdown renderer.
- `components/chart.js` — tiny SVG line chart: `chart(series, {height, yLabel})`
  and `legend(items)`.
- `components/timer.js` — rest timer.
- `views/log.js`, `views/progress.js`, `views/readiness.js`,
  `views/techniques.js`, `views/data.js` — the five tab views.

Day "kinds" today: `lifting` (default), `bouldering`, `martial`, `cardio`.
A session is keyed by `date + dayType`. Unilateral lifts log Left/Right
separately (`side: 'L'|'R'`), bilateral use `side: null` (stored/read as `'B'`).

---

## 2. BUG 1 — set inputs erase themselves when moving between boxes

**Symptom:** In the Log tab, entering weight then tapping straight into reps
(without blurring "cleanly") makes the value disappear; the user has to fill one
box, commit, then the next.

**Root cause (confirmed):** In `src/views/log.js`, `setRow()` captures its
`existing` record **once** at render time. `persist()` (fired on input blur) for a
new row calls `db.add('sets', …)` but never stores the returned id back into the
closure. `scheduleRefresh()` deliberately skips re-rendering while an input is
focused (to avoid stealing focus), so the row is not rebuilt against the new DB
record. When the user blurs the next field of the **same** row, `persist()` still
sees `existing == null` and inserts a **second** `sets` record for the same
`(exerciseKey, side, setIndex)`. On the next real refresh,
`saved.find(s => s.setIndex === i)` returns the first record (which lacks the
later-typed field), so the value looks deleted.

**Required fix:**
- Make `persist()` idempotent per `(exerciseKey, side, setIndex)`. Track the
  record id in a mutable closure variable (e.g. `let recId = existing?.id ?? null`).
  On first non-empty save, `db.add(...)` and store the returned id in `recId`;
  on every subsequent save, `db.update('sets', recId, ...)`.
- The empty→delete path must use `recId` too (delete the tracked record, then
  reset `recId = null`).
- Preserve the existing "don't steal focus" behaviour — do not force a refresh
  that blurs the active input.

**Acceptance:** Type weight → tap directly into reps → type reps → tap directly
into RIR-less next field: all values save to **one** `sets` record. After
switching tabs and back, values persist. There is never more than one `sets` row
per `(exerciseKey, side, setIndex)` per session.

---

## 3. BUG 2 — RIR is noise; make it a persistent per-exercise recommendation

**Decision:** Remove the **per-set** RIR input entirely. Keep an **editable
per-exercise recommended RIR** that persists and is shown for reference.

- In `setRow()` / `exerciseCard()` (`src/views/log.js`), remove the third
  per-set RIR input; a logged set is now **weight + reps** only. (Leave the
  `rir` field on the `sets` schema for backward-compat; just stop writing/asking
  it — new sets store `rir: null`.)
- Keep the per-exercise recommended RIR (`ex.rir`, e.g. `"1–2"`), already shown
  in the exercise card meta and editable in the program editor. Add a quick
  **inline edit affordance on the exercise card itself** (in normal Log view, not
  only in "Edit exercises" mode) so the user can set/change the recommended RIR
  and it stays untouched after saving until edited again. Persist via
  `db.saveDay(dayType, exercises)` (the program store) — same mechanism the
  editor already uses.
- Note: `recommend.js` does not use per-set RIR, so removing it breaks no
  progression logic.

**Acceptance:** No per-set RIR box appears. Each exercise shows its recommended
RIR with a tap-to-edit control; the edited value persists across sessions and app
restarts until edited again.

---

## 4. FEATURE 1 — canonical exercise library + autocomplete (kill duplicate names)

**Problem:** Typing "Pull Ups (One arm)" one day and "One arm pull up" another
creates two different `exerciseKey`s, so Progress splits one exercise into two
series.

**Required:**
- Add a **user-managed exercise library** persisted in IndexedDB (new store,
  e.g. `exerciseLibrary`, keyPath `key`). On first upgrade, **seed it from the
  existing `EXERCISE_LIBRARY`** in `program.js` (keys must stay identical so
  existing logs still join). Each entry: `{ key, name, muscle, sets, rir, rest,
  unilateral?, toFailure? }`.
- Let the user add / edit / delete library entries (a small management UI —
  reuse the pattern of the Techniques category manager or the day-type manager).
- **Autocomplete when adding/naming an exercise** on a day (in `addControls()`
  and the name field of `editorCard()` in `src/views/log.js`): as the user types,
  show a filtered list of matching library entries. Selecting one **reuses that
  library entry's stable `key`** so logs join correctly. A vanilla approach is
  fine (filtered dropdown built with `el()`, or a `<datalist>`), but selecting a
  suggestion MUST set the canonical `key`, not a fresh slug.
- If the user confirms a genuinely new name, add it to the library with a new
  stable key and reuse it thereafter.
- **Never change an existing exercise's `key` when its display name is edited**
  (keeps history joined). Only the ADD path resolves to a canonical key.

**Acceptance:** With "Single-Arm Pull-Up" in the library, typing "one arm pull
up" surfaces it as a suggestion; picking it logs under the same key; Progress
shows a single series. Newly created names are added to the library and reused on
later days.

---

## 5. FEATURE 2 — weight charts: y-axis gridlines every 5 kg

**Current:** `components/chart.js` draws 4 evenly-spaced ticks between padded
min/max, labelled with decimals like `11.4`.

**Required:**
- Extend `chart(series, opts)` with an optional `yStep` (and/or `niceAxis`)
  option. When set, snap `yMin` **down** and `yMax` **up** to multiples of the
  step, and draw a gridline + label at **every multiple of the step** across the
  range. Cap total lines (~8); if the range would exceed the cap, use the next
  sensible multiple (5 → 10 → 20 …). Labels are integers.
- In `src/views/progress.js`, pass `yStep: 5` to the **kg weight** charts
  (the "Top-set weight — L vs R" and "Top-set weight over time" charts).
- Leave non-weight charts (readiness 1–10, reps, L−R gap, confidence) on the
  current behaviour, or give them clean integer ticks — but do **not** force a
  5-unit step on them.

**Acceptance:** A weight chart shows gridlines at …40, 45, 50, 55… (not 11.4),
bounded just below the min and just above the max.

---

## 6. FEATURE 5 — replace the "Techniques" tab with a "Sports" tab

Consolidate all **non-gym** activity into one tab, and make the **Log tab pure
lifting**.

**Tab changes (`app.js`):**
- Rename the `techniques` tab to **"Sports"** (label "Sports", pick a fitting
  icon, e.g. 🥋). Keep the same view module slot (rework `views/techniques.js`
  into the Sports view, or add `views/sports.js` and update the import).
- **Remove non-gym day types from the Log tab's day dropdown.** The Log/gym tab
  shows only lifting days: Push, Pull, Legs, Chest & Back, Arms & Shoulders.
  BJJ, Judo, Muay Thai, Running, Bouldering, and Calisthenics no longer appear
  there. (Do not delete their existing logged sessions — see migration below.)

**Sports tab contents:** a list of activities the user can add / rename / remove
(reuse the existing category-manager pattern). Seed defaults: **BJJ, Judo,
Muay Thai, Running, Bouldering, Stretching, Calisthenics.** Each activity has a
`kind` that decides how a session is logged:
- **martial** (BJJ / Judo / Muay Thai): rounds, minutes, tagged drill/technique
  lists with the "went right / went wrong" toggle, per-technique confidence
  (1–10), notes. **Reuse the existing `martialCard` logic** — move it from
  `views/log.js` into the Sports view.
- **running** (cardio): distance, minutes, notes (reuse `cardioCard`).
- **bouldering**: minutes, grades, notes (reuse `boulderingCard`).
- **stretching**: named mobility skills — **Shoulder mobility, Front split,
  Middle split, Pancake, Hamstring**. Per session, log which skills you worked +
  an optional numeric metric (e.g. seconds held / a depth or 1–10 rating) + notes.
- **calisthenics**: named skills — **Muscle up, Handstand, Planche**. Per
  session, log which skills you worked + an optional numeric metric
  (reps or hold seconds) + notes.
- Preserve the existing **technique wiki** (markdown pages, `[[wiki links]]`,
  categories, "Copy for AI") — keep it available within the Sports tab so no
  existing technique notes are lost.

**Progress:** stretching/calisthenics per-skill numeric metrics should be
chartable over time in the Progress tab (same style as technique confidence).

**Data / migration:**
- Keep logging sport sessions in the existing `sessions` store (keyed by
  `date + dayType`, where `dayType` is the activity name) so **existing BJJ /
  Judo / Muay Thai / Bouldering / Running / Calisthenics sessions are retained
  and still visible**.
- Add a `sports` store (or reuse `dayTypes`/config) describing each activity:
  `{ name, kind, skills: [..], order }`. Seed defaults on upgrade; keep any
  existing custom day types the user made.
- Store stretching/calisthenics per-skill entries on the session record (mirror
  how martial `confidence`/tagged lists are stored on `session.martial`).

**Acceptance:** Log tab lists only the five lifting days. Sports tab lets you log
each sport with the right form, track the named stretching/calisthenics skills,
and still browse existing technique notes and past martial/bouldering/running
sessions.

---

## 7. FEATURE 6 — weekly sport-frequency targets with 1-week carryover (Readiness tab)

Add to the **Readiness** tab (the daily check-in tab).

- Let the user set a **weekly target count per sport**, e.g. Running 1×,
  Muay Thai 3×, BJJ 3×. Store targets (new store `sportTargets`, or a `target`
  field on the `sports` records).
- **Week = Monday–Sunday** (the program starts Monday).
- **Completions auto-count** from sport sessions logged in the Sports tab for the
  current week, with a **manual +/− override** per sport for sessions done
  elsewhere.
- **Carryover (max one week, non-compounding):** the effective goal for the
  current week is
  `goal = base + max(0, base − completedLastWeek)`
  where `completedLastWeek` is that sport's session count in the immediately
  previous Mon–Sun week. Because carryover only ever looks back exactly one week
  and never includes its own carried amount, an unmet target rolls over **once**
  and then drops — it never accumulates.
- Show, per sport: `this week: completed / goal` with the base and any
  carried-in amount broken out, plus a simple progress indicator.

**Acceptance:** Set targets; log/check sessions; an unfinished week adds its
shortfall to next week's goal exactly once; the week after, the old shortfall is
gone.

---

## 8. FEATURE 7 — permanent vs temporary exercises per day (checkbox)

**Today:** any edit to a day's exercise list via `db.saveDay()` is permanent.

**Required:** when adding/setting an exercise on a day, a **"Permanent" checkbox**:
- **Permanent (checked):** the exercise lives in the day's template (program
  store) and appears as a default every time that day is opened, on any date.
- **Temporary (unchecked):** the exercise is scoped to the **current date only**.
  It appears when logging that day on that date, but not when the day is opened
  on a later date ("a new day started" → it's gone from the default list).

**Implementation:**
- Add a `permanent` boolean to exercise entries. The day **template** (program
  store via `saveDay`/`getProgram`) holds only permanent exercises.
- Store temporary exercises **date-scoped** (e.g. a new store
  `sessionExercises` keyed by `date + dayType`, or on the session record). When
  rendering the Log view for a given date, **merge** the day's permanent template
  with that date's temporary exercises.
- Logged sets for a temporary exercise are retained in history regardless (only
  the *default list* for future dates is affected).

**Acceptance:** Add exercise X to Push as temporary today and log it → tomorrow's
Push does not list X, but today's logged sets for X remain. Add Y as permanent →
Y appears on Push every day.

---

## 9. ADD-ON — Weekly load dashboard (Progress tab)

Add a section to the Progress tab showing **combined training load per ISO week
(Mon–Sun)** across all activity, for roughly the last 8–12 weeks:
- Lifting: total working sets logged (and optionally total volume = Σ weight×reps).
- Sports: session counts per kind (martial rounds/min, bouldering, running,
  calisthenics, stretching).
- A per-week "hard sessions" count.

Render with the existing `chart.js` (bar or line per week). Purpose: make
cumulative load and spikes visible. Keep it read-only and offline.

**Acceptance:** A weekly view shows total sets and session counts per week,
updating as new data is logged.

---

## 10. ADD-ON — Deload / overtraining flag

A transparent, **rule-based** warning (not AI — same philosophy as
`recommend.js`) surfaced on the Readiness tab (and optionally a banner atop the
Log tab). Fire when overtraining risk looks elevated, and **always list the
reasons**. Use available signals:
- Readiness/soreness/sleep trend from `readiness` check-ins (e.g. mean readiness
  over the last ~5 days below a threshold, or soreness above one).
- Weekly load from the dashboard (e.g. hard sessions above a threshold for 2+
  consecutive weeks).
- Consecutive training days with no rest day.
- Any **active injury** (see below) raises caution.

Thresholds should be simple constants at the top of the module, easy to tune.

**Acceptance:** When the rules trip, a clear "Consider a deload / rest day"
message appears listing which conditions triggered it; otherwise nothing shows.

---

## 11. ADD-ON — Injury / niggle log

- New store `injuries`: `{ id, date, area, side?('L'|'R'), severity(1–5),
  status('active'|'resolved'), note }`.
- UI (a card on the Readiness tab): add a niggle, edit it, mark resolved. Show
  active niggles prominently; keep resolved ones as history.
- Feed active injuries into the deload flag (§10).

**Acceptance:** Log an elbow niggle (severity 3) → shows as active until resolved;
history is retained; an active niggle contributes to the deload flag.

---

## 12. Cross-cutting requirements

- **IndexedDB migration:** bump `DB_VERSION` 5 → 6. In `onupgradeneeded`, create
  the new stores (`exerciseLibrary`, `sports`, `sportTargets`, `sessionExercises`,
  `injuries` — names illustrative; consolidate where sensible) and seed defaults,
  **without** touching existing stores or data.
- **Export/import:** bump `SCHEMA_VERSION` 5 → 6. Extend `exportData()` and
  `importData()` to include every new store/field, keeping the export clean and
  versioned. Keep import backward-compatible with older backups (absent sections
  leave current data untouched).
- **Import safety net:** in `views/data.js` `doImport()`, **auto-export a backup
  first** (trigger the same JSON download as the Export button) before applying
  any import, so an unexpected overwrite can always be undone.
- **Service worker:** add every new `src/` file to `SHELL` in `sw.js` and bump
  `CACHE` (`v6` → `v7`). Verify the app still loads fully offline after a hard
  reload.
- **Styling:** match existing components and CSS variables; the app must stay
  usable one-handed on a phone.
- **No regressions:** existing Log (lifting), Progress, Readiness, and the
  technique wiki must keep working with existing data.

---

## 13. Verification checklist (do all before declaring done)

1. Run `node serve.js`, open on desktop + a phone-sized viewport.
2. Bug 1: rapid box-to-box entry saves to one set; no duplicate `sets` rows.
3. Bug 2: no per-set RIR box; per-exercise recommended RIR edits and persists.
4. Feature 1: duplicate-name typing resolves to one canonical key; one Progress
   series; library entries manageable.
5. Feature 2: weight charts snap to 5 kg gridlines.
6. Feature 5: Log shows only lifting days; Sports tab logs each sport correctly;
   existing technique notes and past sport sessions are still present.
7. Feature 6: targets, auto-count, manual override, and one-week carryover behave
   per the formula in §7.
8. Feature 7: temporary exercise gone next day; permanent persists; past logs kept.
9. Add-ons: weekly load dashboard renders; deload flag trips with reasons;
   injury log adds/resolves and feeds the flag.
10. Export a backup, `clearAll`, re-import → all data (including new stores)
    round-trips. Auto-backup fires before import.
11. Offline: hard-reload with network off → app loads and works.
12. Confirm `DB_VERSION`, `SCHEMA_VERSION`, and `sw.js` `CACHE` were all bumped
    and every new file is in `SHELL`.

---

## 14. Out of scope (Phase 2 — do NOT build now)
- Supabase / any backend / cloud sync (target design: local-first + background
  sync, IndexedDB stays source of truth).
- Push notifications.
- Calorie / food-photo tracking tab.
