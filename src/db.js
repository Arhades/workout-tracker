// Local-only IndexedDB (no server, no sync). Zero-dependency wrapper — just a
// few promise helpers over the raw IndexedDB API.

import { DEFAULT_PROGRAM, DAY_TYPES } from './program.js'

const DB_NAME = 'workout_tracker'
const DB_VERSION = 2
let _db = null

function openDb() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
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
    const t = db.transaction(['sessions', 'sets', 'readiness', 'program', 'techniques'], 'readwrite')
    t.objectStore('sessions').clear()
    t.objectStore('sets').clear()
    t.objectStore('readiness').clear()
    t.objectStore('program').clear() // reverts to defaults
    t.objectStore('techniques').clear()
    t.oncomplete = () => res()
    t.onerror = () => rej(t.error)
  })
  changed()
}

// ---- Editable program -------------------------------------------------------
// Defaults live in program.js. A `program` record only exists for days the user
// has customised; its `exercises` array overrides that day's default list.
// Day metadata (weekday, bouldering/martial flags) always comes from defaults.

export async function getProgram() {
  const custom = await all('program')
  const byDay = Object.fromEntries(custom.map((r) => [r.dayType, r.exercises]))
  const out = {}
  for (const dt of DAY_TYPES) {
    const def = DEFAULT_PROGRAM[dt] || { exercises: [] }
    out[dt] = { ...def, exercises: byDay[dt] ?? def.exercises, customised: dt in byDay }
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
export const SCHEMA_VERSION = 2

export async function exportData() {
  const [sessions, sets, readiness, program, techniques] = await Promise.all([
    all('sessions'), all('sets'), all('readiness'), all('program'), all('techniques'),
  ])
  const setsBySession = {}
  for (const s of sets) (setsBySession[s.sessionId] ??= []).push(s)

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    app: 'workout-tracker',
    program: program.map((p) => ({ day_type: p.dayType, exercises: p.exercises })),
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

  // Custom program (only the days the user edited). Replace each by dayType.
  for (const p of doc.program || []) {
    if (p.day_type) await put('program', { dayType: p.day_type, exercises: p.exercises || [] })
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
      bouldering: s.bouldering || null, martial: s.martial || null,
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
