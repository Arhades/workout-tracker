// Local-only IndexedDB (no server, no sync). Zero-dependency wrapper — just a
// few promise helpers over the raw IndexedDB API.

import { DEFAULT_PROGRAM, DAY_TYPES, MARTIAL, EXERCISE_LIBRARY } from './program.js'

const DB_NAME = 'workout_tracker'
const DB_VERSION = 6
let _db = null

// Default technique categories — seeded once into the `techCategories` store on
// first run (or DB upgrade). `id` is the STABLE join key that technique records
// reference; never reuse an id for a different meaning. Labels, hints and order
// are all user-editable at runtime (rename / add / delete / reorder).
export const DEFAULT_TECH_CATEGORIES = [
  { id: 'movement', label: 'Movement sets', hint: 'Escapes · Guard Retention · Guard Passing', order: 0 },
  { id: 'position', label: 'Submissions / dominant positions', hint: 'Back control · Triangles · Armbars · Leg locks', order: 1 },
  { id: 'standup', label: 'Stand-up game plans', hint: 'Wrestling · Judo · Clinch', order: 2 },
]

// Seed records for the editable day-type store, derived from the locked program
// defaults (program.js). After seeding, the store is the source of truth for the
// day LIST and each day's kind / weekday / martial config; DEFAULT_PROGRAM stays
// only as the seed + the per-day default exercise list.
function seedDayTypeRecords() {
  return DAY_TYPES.map((name, i) => {
    const def = DEFAULT_PROGRAM[name] || {}
    const kind = def.martial ? 'martial' : def.bouldering ? 'bouldering' : def.cardio ? 'cardio' : 'lifting'
    const m = MARTIAL[name]
    return {
      name, kind, weekday: def.weekday || '', order: i,
      martial: kind === 'martial' ? { unit: (m && m.unit) || 'rounds', kinds: ((m && m.kinds) || []).slice() } : null,
    }
  })
}

// Default sports (non-gym activities) — seeded once into the `sports` store on
// first run / v6 upgrade. `name` is the STABLE join key: sport sessions live in
// the `sessions` store keyed by date + dayType where dayType is the sport name,
// so existing BJJ / Judo / … history keeps resolving after the upgrade.
// kind: 'martial' | 'running' | 'bouldering' | 'stretching' | 'calisthenics'.
// `target` = weekly session target (0 = none). `adjust` = per-week manual +/−
// corrections keyed by Monday ISO date (sessions done elsewhere / not logged).
function seedSportRecords() {
  const m = (name) => ({ unit: MARTIAL[name]?.unit || 'rounds', kinds: [...(MARTIAL[name]?.kinds || [])] })
  return [
    { name: 'BJJ', kind: 'martial', martial: m('BJJ'), skills: [], order: 0, target: 0, adjust: {} },
    { name: 'Judo', kind: 'martial', martial: m('Judo'), skills: [], order: 1, target: 0, adjust: {} },
    { name: 'Muay Thai', kind: 'martial', martial: m('Muay Thai'), skills: [], order: 2, target: 0, adjust: {} },
    { name: 'Running', kind: 'running', martial: null, skills: [], order: 3, target: 0, adjust: {} },
    { name: 'Bouldering', kind: 'bouldering', martial: null, skills: [], order: 4, target: 0, adjust: {} },
    { name: 'Stretching', kind: 'stretching', martial: null, skills: ['Shoulder mobility', 'Front split', 'Middle split', 'Pancake', 'Hamstring'], order: 5, target: 0, adjust: {} },
    { name: 'Calisthenics', kind: 'calisthenics', martial: null, skills: ['Muscle up', 'Handstand', 'Planche'], order: 6, target: 0, adjust: {} },
  ]
}

function openDb() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true })
        s.createIndex('date', 'date')
      }
      if (!db.objectStoreNames.contains('sets')) {
        const s = db.createObjectStore('sets', { keyPath: 'id', autoIncrement: true })
        s.createIndex('sessionId', 'sessionId')
      }
      if (!db.objectStoreNames.contains('readiness')) {
        const s = db.createObjectStore('readiness', { keyPath: 'id', autoIncrement: true })
        s.createIndex('date', 'date', { unique: true })
      }
      // v2: editable program (one record per edited day) + technique library.
      if (!db.objectStoreNames.contains('program')) {
        db.createObjectStore('program', { keyPath: 'dayType' })
      }
      if (!db.objectStoreNames.contains('techniques')) {
        const s = db.createObjectStore('techniques', { keyPath: 'id', autoIncrement: true })
        s.createIndex('category', 'category')
      }
      // v3: user-editable technique categories. Seed the defaults so existing
      // technique records (which reference these ids) keep resolving after upgrade.
      if (!db.objectStoreNames.contains('techCategories')) {
        const s = db.createObjectStore('techCategories', { keyPath: 'id' })
        for (const c of DEFAULT_TECH_CATEGORIES) s.add(c)
      }
      // v4: user-editable gym-log day types (kind / weekday / order / martial cfg).
      // Seed from the locked defaults so existing sessions (keyed by day name)
      // keep resolving after upgrade.
      if (!db.objectStoreNames.contains('dayTypes')) {
        const s = db.createObjectStore('dayTypes', { keyPath: 'name' })
        for (const d of seedDayTypeRecords()) s.add(d)
      }
      // v5: add newer default day types (Calisthenics, Running) for users
      // upgrading from v4, without clobbering any customised existing days.
      if (event && event.oldVersion < 5 && db.objectStoreNames.contains('dayTypes')) {
        const dt = req.transaction.objectStore('dayTypes')
        for (const d of seedDayTypeRecords()) {
          if (d.name === 'Calisthenics' || d.name === 'Running') dt.put(d)
        }
      }
      // v6: user-managed exercise library, seeded from the coded defaults.
      // Keys stay identical to EXERCISE_LIBRARY so existing logs keep joining.
      if (!db.objectStoreNames.contains('exerciseLibrary')) {
        const s = db.createObjectStore('exerciseLibrary', { keyPath: 'key' })
        for (const e of EXERCISE_LIBRARY) s.add({ ...e })
      }
      // v6: sports (non-gym activities) for the Sports tab + weekly targets.
      // Custom non-lifting day types the user made are adopted lazily (getSports).
      if (!db.objectStoreNames.contains('sports')) {
        const s = db.createObjectStore('sports', { keyPath: 'name' })
        for (const sp of seedSportRecords()) s.add(sp)
      }
      // v6: date-scoped (temporary) exercises — merged into a day's template
      // when logging that date only. id = `${date}|${dayType}`.
      if (!db.objectStoreNames.contains('sessionExercises')) {
        db.createObjectStore('sessionExercises', { keyPath: 'id' })
      }
      // v6: injury / niggle log (feeds the deload flag).
      if (!db.objectStoreNames.contains('injuries')) {
        const s = db.createObjectStore('injuries', { keyPath: 'id', autoIncrement: true })
        s.createIndex('status', 'status')
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
}

// ---- Simple notification so views can re-render on any data change ----------
const listeners = new Set()
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function changed() { listeners.forEach((fn) => fn()) }

// ---- CRUD helpers -----------------------------------------------------------
export async function all(store) {
  const db = await openDb()
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll()
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function byIndex(store, index, value) {
  const db = await openDb()
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function get(store, id) {
  const db = await openDb()
  return new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(id)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function add(store, value) {
  const db = await openDb()
  const id = await new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).add(value)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  changed()
  return id
}

export async function put(store, value) {
  const db = await openDb()
  await new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).put(value)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  changed()
}

export async function update(store, id, patch) {
  const cur = await get(store, id)
  if (!cur) return
  await put(store, { ...cur, ...patch })
}

export async function del(store, id) {
  const db = await openDb()
  await new Promise((res, rej) => {
    const r = db.transaction(store, 'readwrite').objectStore(store).delete(id)
    r.onsuccess = () => res()
    r.onerror = () => rej(r.error)
  })
  changed()
}

export async function clearAll() {
  const db = await openDb()
  await new Promise((res, rej) => {
    const t = db.transaction(['sessions', 'sets', 'readiness', 'program', 'techniques', 'techCategories', 'dayTypes', 'exerciseLibrary', 'sports', 'sessionExercises', 'injuries'], 'readwrite')
    t.objectStore('sessions').clear()
    t.objectStore('sets').clear()
    t.objectStore('readiness').clear()
    t.objectStore('program').clear() // reverts to defaults
    t.objectStore('techniques').clear()
    t.objectStore('techCategories').clear() // defaults re-seed on next read (getCategories)
    t.objectStore('dayTypes').clear() // defaults re-seed on next read (getDayTypes)
    t.objectStore('exerciseLibrary').clear() // defaults re-seed on next read (getExerciseLibrary)
    t.objectStore('sports').clear() // defaults re-seed on next read (getSports)
    t.objectStore('sessionExercises').clear()
    t.objectStore('injuries').clear()
    t.oncomplete = () => res()
    t.onerror = () => rej(t.error)
  })
  changed()
}

// ---- Editable program -------------------------------------------------------
// The day LIST and per-day metadata (kind, weekday, martial config) live in the
// user-editable `dayTypes` store (seeded from program.js defaults). A `program`
// record still holds a day's custom exercise list; absent = the coded default
// for that day. New/renamed days carry their exercises explicitly in `program`.

export async function getDayTypes() {
  let days = await all('dayTypes')
  if (!days.length) { // defensive: re-seed (e.g. after clearAll)
    for (const d of seedDayTypeRecords()) await put('dayTypes', d)
    days = await all('dayTypes')
  }
  return days.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || ''))
}

export async function getProgram() {
  const days = await getDayTypes()
  const custom = Object.fromEntries((await all('program')).map((r) => [r.dayType, r.exercises]))
  const out = {}
  for (const d of days) {
    const seedEx = DEFAULT_PROGRAM[d.name]?.exercises ?? []
    out[d.name] = {
      weekday: d.weekday || undefined,
      kind: d.kind,
      bouldering: d.kind === 'bouldering' ? true : undefined,
      cardio: d.kind === 'cardio' ? true : undefined,
      martial: d.kind === 'martial' ? d.name : undefined,
      martialCfg: d.kind === 'martial' ? (d.martial || { unit: 'rounds', kinds: [] }) : null,
      exercises: custom[d.name] ?? seedEx,
      customised: d.name in custom,
      hasDefault: d.name in DEFAULT_PROGRAM,
    }
  }
  return out
}

export async function getExercisesFor(dayType) {
  return (await getProgram())[dayType]?.exercises ?? []
}

export async function saveDay(dayType, exercises) {
  await put('program', { dayType, exercises })
}

export async function resetDay(dayType) {
  await del('program', dayType) // delete custom record -> default returns live
}

// ---- Editable day types (add / rename / reorder / configure / delete) -------
export async function addDayType({ name, kind = 'lifting', weekday = '', martial = null } = {}) {
  const days = await all('dayTypes')
  const nm = (name || '').trim()
  if (!nm || days.some((d) => d.name === nm)) return null // require a unique, non-empty name
  const order = days.reduce((m, d) => Math.max(m, d.order ?? 0), -1) + 1
  await put('dayTypes', {
    name: nm, kind, weekday: weekday || '', order,
    martial: kind === 'martial' ? (martial || { unit: 'rounds', kinds: [] }) : null,
  })
  return nm
}

// Edit a day's kind / weekday / martial config. Name changes go via renameDayType.
export async function updateDayType(name, patch) {
  const { name: _ignore, ...rest } = patch || {}
  await update('dayTypes', name, rest)
}

// Rename a day type: re-key the record, preserve its (effective) exercises, and
// cascade the new name to every logged session so history stays attached.
export async function renameDayType(oldName, newName) {
  newName = (newName || '').trim()
  if (!newName) return false
  const days = await all('dayTypes')
  const rec = days.find((d) => d.name === oldName)
  if (!rec) return false
  if (newName === oldName) return true
  if (days.some((d) => d.name === newName)) return false
  const effectiveEx = (await getProgram())[oldName]?.exercises ?? []
  await put('dayTypes', { ...rec, name: newName })
  await del('dayTypes', oldName)
  await put('program', { dayType: newName, exercises: effectiveEx })
  if ((await all('program')).some((p) => p.dayType === oldName)) await del('program', oldName)
  for (const s of await all('sessions')) if (s.dayType === oldName) await put('sessions', { ...s, dayType: newName })
  changed()
  return true
}

export async function saveDayTypeOrder(orderedNames) {
  const byName = Object.fromEntries((await all('dayTypes')).map((d) => [d.name, d]))
  let i = 0
  for (const n of orderedNames) { const d = byName[n]; if (d) await put('dayTypes', { ...d, order: i++ }) }
}

// Delete a day type only when nothing is logged under it (rename a used day
// instead). Returns false if any session still references it.
export async function deleteDayType(name) {
  if ((await all('sessions')).some((s) => s.dayType === name)) return false
  await del('dayTypes', name)
  if ((await all('program')).some((x) => x.dayType === name)) await del('program', name)
  changed()
  return true
}

// ---- Exercise library (user-managed, canonical keys) -------------------------
// The single source of truth for exercise identity: `key` is the stable join key
// for logged sets and Progress series. Adding an exercise to a day resolves to a
// library key (autocomplete) so duplicate names never split history.

const slugKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise'

// Always returns at least the coded defaults — re-seeds if the store was
// emptied (e.g. after clearAll), same pattern as getCategories/getDayTypes.
export async function getExerciseLibrary() {
  let lib = await all('exerciseLibrary')
  if (!lib.length) {
    for (const e of EXERCISE_LIBRARY) await put('exerciseLibrary', { ...e })
    lib = await all('exerciseLibrary')
  }
  return lib.sort((a, b) => (a.muscle || '').localeCompare(b.muscle || '') || (a.name || '').localeCompare(b.name || ''))
}

// Create a library entry with a fresh stable key derived from the name.
// Returns the stored entry (reuse its `key` when adding to a day).
export async function addLibraryEntry({ name, muscle = '', sets = 3, rir = '1–2', rest = 240, unilateral, toFailure } = {}) {
  const nm = (name || '').trim()
  if (!nm) return null
  const taken = new Set((await all('exerciseLibrary')).map((e) => e.key))
  let key = slugKey(nm), n = 2
  while (taken.has(key)) key = `${slugKey(nm)}_${n++}`
  const entry = { key, name: nm, muscle, sets, rir, rest }
  if (unilateral) entry.unilateral = true
  if (toFailure) entry.toFailure = true
  await put('exerciseLibrary', entry)
  return entry
}

export async function updateLibraryEntry(key, patch) {
  const { key: _ignore, ...rest } = patch || {} // key is the join key — never re-key
  await update('exerciseLibrary', key, rest)
}

// Deleting a library entry never touches logged sets or day templates — it only
// stops the entry being offered when adding exercises.
export async function deleteLibraryEntry(key) { await del('exerciseLibrary', key) }

// ---- Sports (non-gym activities: Sports tab + weekly targets) ----------------
// Sport sessions stay in the `sessions` store keyed by date + dayType (= sport
// name), so pre-v6 BJJ / Bouldering / … history is retained untouched.

export async function getSports() {
  let sports = await all('sports')
  if (!sports.length) { // defensive: re-seed (e.g. after clearAll)
    for (const s of seedSportRecords()) await put('sports', s)
    sports = await all('sports')
  }
  // One-time adoption: custom non-lifting day types the user created pre-v6
  // become sports so their sessions stay loggable from the Sports tab.
  const names = new Set(sports.map((s) => s.name))
  let nextOrder = sports.reduce((m, s) => Math.max(m, s.order ?? 0), -1) + 1
  let adopted = false
  for (const d of await all('dayTypes')) {
    if (d.kind === 'lifting' || names.has(d.name)) continue
    await put('sports', {
      name: d.name, kind: d.kind === 'cardio' ? 'running' : d.kind,
      martial: d.kind === 'martial' ? (d.martial || { unit: 'rounds', kinds: [] }) : null,
      skills: [], order: nextOrder++, target: 0, adjust: {},
    })
    adopted = true
  }
  if (adopted) sports = await all('sports')
  return sports.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || ''))
}

export async function addSport({ name, kind = 'martial', skills = [], martial = null } = {}) {
  const sports = await all('sports')
  const nm = (name || '').trim()
  if (!nm || sports.some((s) => s.name === nm)) return null // unique, non-empty
  const order = sports.reduce((m, s) => Math.max(m, s.order ?? 0), -1) + 1
  await put('sports', {
    name: nm, kind, skills,
    martial: kind === 'martial' ? (martial || { unit: 'rounds', kinds: [] }) : null,
    order, target: 0, adjust: {},
  })
  return nm
}

export async function updateSport(name, patch) {
  const { name: _ignore, ...rest } = patch || {} // renames go via renameSport
  await update('sports', name, rest)
}

// Rename a sport: re-key the record and cascade the new name to every logged
// session (and any matching legacy dayTypes record) so history stays attached.
export async function renameSport(oldName, newName) {
  newName = (newName || '').trim()
  if (!newName) return false
  const sports = await all('sports')
  const rec = sports.find((s) => s.name === oldName)
  if (!rec) return false
  if (newName === oldName) return true
  if (sports.some((s) => s.name === newName)) return false
  await put('sports', { ...rec, name: newName })
  await del('sports', oldName)
  for (const s of await all('sessions')) if (s.dayType === oldName) await put('sessions', { ...s, dayType: newName })
  const dt = (await all('dayTypes')).find((d) => d.name === oldName)
  if (dt) { await put('dayTypes', { ...dt, name: newName }); await del('dayTypes', oldName) }
  changed()
  return true
}

export async function saveSportOrder(orderedNames) {
  const byName = Object.fromEntries((await all('sports')).map((s) => [s.name, s]))
  let i = 0
  for (const n of orderedNames) { const s = byName[n]; if (s) await put('sports', { ...s, order: i++ }) }
}

// Delete a sport only when nothing is logged under it (rename a used one
// instead). Returns false if any session still references it.
export async function deleteSport(name) {
  if ((await all('sessions')).some((s) => s.dayType === name)) return false
  await del('sports', name)
  changed()
  return true
}

// ---- Temporary (date-scoped) exercises ---------------------------------------
// A day's template (program store) holds only PERMANENT exercises. Exercises
// added with "Permanent" unchecked live here, scoped to one date + dayType, and
// are merged into the template when that date is rendered. Logged sets are kept
// in history regardless — only future default lists are unaffected.

const sessionExId = (date, dayType) => `${date}|${dayType}`

export async function getSessionExercises(date, dayType) {
  const rec = await get('sessionExercises', sessionExId(date, dayType))
  return rec?.exercises ?? []
}

export async function saveSessionExercises(date, dayType, exercises) {
  if (exercises.length) await put('sessionExercises', { id: sessionExId(date, dayType), date, dayType, exercises })
  else await del('sessionExercises', sessionExId(date, dayType))
}

// ---- Technique categories (user-editable: rename / add / delete / reorder) ---
function genCategoryId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Always returns at least the defaults — re-seeds if the store was emptied
// (e.g. after clearAll) so the Techniques view never has zero categories.
export async function getCategories() {
  let cats = await all('techCategories')
  if (!cats.length) {
    for (const c of DEFAULT_TECH_CATEGORIES) await put('techCategories', c)
    cats = await all('techCategories')
  }
  return cats.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.label || '').localeCompare(b.label || ''))
}

export async function addCategory({ label, hint } = {}) {
  const cats = await all('techCategories')
  const order = cats.reduce((m, c) => Math.max(m, c.order ?? 0), -1) + 1
  const id = genCategoryId()
  await put('techCategories', { id, label: (label || '').trim() || 'New category', hint: (hint || '').trim(), order })
  return id
}

export async function updateCategory(id, patch) {
  await update('techCategories', id, patch)
}

// Persist a new ordering given the full list of ids in display order.
export async function saveCategoryOrder(orderedIds) {
  const byId = Object.fromEntries((await all('techCategories')).map((c) => [c.id, c]))
  let i = 0
  for (const id of orderedIds) { const c = byId[id]; if (c) await put('techCategories', { ...c, order: i++ }) }
}

// Delete a category. Any techniques filed under it are moved to fallbackId first
// so none are orphaned.
export async function deleteCategory(id, fallbackId) {
  if (fallbackId) {
    for (const t of await byIndex('techniques', 'category', id)) {
      await put('techniques', { ...t, category: fallbackId })
    }
  }
  await del('techCategories', id)
}

export async function deleteSession(id) {
  const sets = await byIndex('sets', 'sessionId', id)
  const db = await openDb()
  await new Promise((res, rej) => {
    const t = db.transaction(['sessions', 'sets'], 'readwrite')
    for (const s of sets) t.objectStore('sets').delete(s.id)
    t.objectStore('sessions').delete(id)
    t.oncomplete = () => res()
    t.onerror = () => rej(t.error)
  })
  changed()
}

// ---- Export / Import --------------------------------------------------------
// The export schema is the stable, versioned single source of truth for the
// future offline ML layer. Keep it clean. Bump SCHEMA_VERSION on any change.
export const SCHEMA_VERSION = 6

export async function exportData() {
  const [sessions, sets, readiness, program, techniques, techCategories, dayTypes, exerciseLibrary, sports, sessionExercises, injuries] = await Promise.all([
    all('sessions'), all('sets'), all('readiness'), all('program'), all('techniques'), all('techCategories'), all('dayTypes'),
    all('exerciseLibrary'), all('sports'), all('sessionExercises'), all('injuries'),
  ])
  const setsBySession = {}
  for (const s of sets) (setsBySession[s.sessionId] ??= []).push(s)

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    app: 'workout-tracker',
    day_types: dayTypes
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((d) => ({ name: d.name, kind: d.kind, weekday: d.weekday || '', order: d.order ?? 0, martial: d.martial || null })),
    program: program.map((p) => ({ day_type: p.dayType, exercises: p.exercises })),
    exercise_library: exerciseLibrary
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((e) => ({
        key: e.key, name: e.name || '', muscle: e.muscle || '',
        sets: e.sets ?? null, rir: e.rir ?? '', rest: e.rest ?? null,
        unilateral: !!e.unilateral, to_failure: !!e.toFailure,
      })),
    sports: sports
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => ({
        name: s.name, kind: s.kind, order: s.order ?? 0,
        skills: s.skills || [], martial: s.martial || null,
        target: s.target ?? 0, adjust: s.adjust || {},
      })),
    session_exercises: sessionExercises
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((x) => ({ date: x.date, day_type: x.dayType, exercises: x.exercises || [] })),
    injuries: injuries
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((i) => ({
        date: i.date, area: i.area || '', side: i.side || null,
        severity: i.severity ?? null, status: i.status || 'active',
        note: i.note || '', resolved_date: i.resolvedDate || null,
      })),
    tech_categories: techCategories
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((c) => ({ id: c.id, label: c.label || '', hint: c.hint || '', order: c.order ?? 0 })),
    techniques: techniques
      .sort((a, b) => (a.category < b.category ? -1 : 1))
      .map((t) => ({
        category: t.category, area: t.area || '', discipline: t.discipline || '',
        title: t.title || '', body: t.body || '', source: t.source || '',
        updated: t.updated || null,
      })),
    sessions: sessions
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((s) => ({
        date: s.date,
        day_type: s.dayType,
        notes: s.notes || '',
        bouldering: s.bouldering || null,
        martial: s.martial || null,
        cardio: s.cardio || null,
        skills: (Array.isArray(s.skills) && s.skills.length) ? s.skills : null,
        sets: (setsBySession[s.id] || [])
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((x) => ({
            exercise_key: x.exerciseKey,
            exercise_name: x.exerciseName,
            set_index: x.setIndex,
            side: x.side ?? null,
            is_drop_set: !!x.isDropSet,
            weight: x.weight,
            reps: x.reps,
            rir: x.rir,
          })),
      })),
    readiness: readiness
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((r) => ({
        date: r.date,
        readiness: r.readiness,
        soreness: r.soreness,
        sleep_hours: r.sleep_hours,
        note: r.note || '',
      })),
  }
}

export async function importData(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('Not a valid backup file.')
  if (doc.schema_version > SCHEMA_VERSION)
    throw new Error(`Backup schema v${doc.schema_version} is newer than this app (v${SCHEMA_VERSION}).`)

  // Editable day types — replace wholesale when present. Absent (v2/v3 backup)
  // leaves the current/seeded day types untouched.
  if (Array.isArray(doc.day_types)) {
    for (const d of await all('dayTypes')) await del('dayTypes', d.name)
    let i = 0
    for (const d of doc.day_types) {
      if (d && d.name) await put('dayTypes', { name: d.name, kind: d.kind || 'lifting', weekday: d.weekday || '', order: d.order ?? i++, martial: d.martial || null })
    }
  }

  // Custom program (only the days the user edited). Replace each by dayType.
  for (const p of doc.program || []) {
    if (p.day_type) await put('program', { dayType: p.day_type, exercises: p.exercises || [] })
  }

  // Exercise library — replace wholesale when present. Absent (pre-v6 backup)
  // leaves the current/seeded library untouched.
  if (Array.isArray(doc.exercise_library)) {
    for (const e of await all('exerciseLibrary')) await del('exerciseLibrary', e.key)
    for (const e of doc.exercise_library) {
      if (!e || !e.key) continue
      const rec = { key: e.key, name: e.name || e.key, muscle: e.muscle || '', sets: e.sets ?? 3, rir: e.rir ?? '', rest: e.rest ?? 240 }
      if (e.unilateral) rec.unilateral = true
      if (e.to_failure) rec.toFailure = true
      await put('exerciseLibrary', rec)
    }
  }

  // Sports — replace wholesale when present.
  if (Array.isArray(doc.sports)) {
    for (const s of await all('sports')) await del('sports', s.name)
    let i = 0
    for (const s of doc.sports) {
      if (!s || !s.name) continue
      await put('sports', {
        name: s.name, kind: s.kind || 'martial', order: s.order ?? i++,
        skills: s.skills || [], martial: s.martial || null,
        target: s.target ?? 0, adjust: s.adjust || {},
      })
    }
  }

  // Temporary (date-scoped) exercises — replace wholesale when present.
  if (Array.isArray(doc.session_exercises)) {
    for (const x of await all('sessionExercises')) await del('sessionExercises', x.id)
    for (const x of doc.session_exercises) {
      if (x && x.date && x.day_type) await saveSessionExercises(x.date, x.day_type, x.exercises || [])
    }
  }

  // Injuries — replace wholesale when present (ids are regenerated).
  if (Array.isArray(doc.injuries)) {
    for (const i of await all('injuries')) await del('injuries', i.id)
    for (const i of doc.injuries) {
      if (!i || !i.date) continue
      await add('injuries', {
        date: i.date, area: i.area || '', side: i.side || null,
        severity: i.severity ?? null, status: i.status || 'active',
        note: i.note || '', resolvedDate: i.resolved_date || null,
      })
    }
  }

  // Technique categories — replace wholesale when present. Absent (older v2
  // backup) leaves the current/seeded categories untouched.
  if (Array.isArray(doc.tech_categories)) {
    for (const c of await all('techCategories')) await del('techCategories', c.id)
    let order = 0
    for (const c of doc.tech_categories) {
      if (c && c.id) await put('techCategories', { id: c.id, label: c.label || '', hint: c.hint || '', order: c.order ?? order++ })
    }
  }

  // Technique library — replace wholesale so re-import is idempotent.
  if (Array.isArray(doc.techniques)) {
    for (const t of await all('techniques')) await del('techniques', t.id)
    for (const t of doc.techniques) {
      await add('techniques', {
        category: t.category, area: t.area || '', discipline: t.discipline || '',
        title: t.title || '', body: t.body || '', source: t.source || '', updated: t.updated || null,
      })
    }
  }

  const existingSessions = await all('sessions')
  for (const s of doc.sessions || []) {
    // Replace any existing session with the same date + day type (idempotent restore).
    for (const e of existingSessions.filter((e) => e.date === s.date && e.dayType === s.day_type)) {
      await deleteSession(e.id)
    }
    const sessionId = await add('sessions', {
      date: s.date, dayType: s.day_type, notes: s.notes || '',
      bouldering: s.bouldering || null, martial: s.martial || null, cardio: s.cardio || null,
      skills: (Array.isArray(s.skills) && s.skills.length) ? s.skills : null,
    })
    let order = 0
    for (const x of s.sets || []) {
      await add('sets', {
        sessionId, exerciseKey: x.exercise_key, exerciseName: x.exercise_name,
        setIndex: x.set_index, side: x.side ?? null, isDropSet: !!x.is_drop_set,
        weight: x.weight, reps: x.reps, rir: x.rir, order: order++,
      })
    }
  }
  const existingReadiness = await all('readiness')
  for (const r of doc.readiness || []) {
    const e = existingReadiness.find((x) => x.date === r.date)
    if (e) await del('readiness', e.id)
    await add('readiness', {
      date: r.date, readiness: r.readiness, soreness: r.soreness,
      sleep_hours: r.sleep_hours, note: r.note || '',
    })
  }
  changed()
}

export function todayISO() {
  const d = new Date()
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d - tz).toISOString().slice(0, 10)
}
