// Local-only IndexedDB (no server, no sync). Zero-dependency wrapper — just a
// few promise helpers over the raw IndexedDB API.

import { DEFAULT_PROGRAM, DAY_TYPES, MARTIAL } from './program.js'

const DB_NAME = 'workout_tracker'
const DB_VERSION = 5
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
    const t = db.transaction(['sessions', 'sets', 'readiness', 'program', 'techniques', 'techCategories', 'dayTypes'], 'readwrite')
    t.objectStore('sessions').clear()
    t.objectStore('sets').clear()
    t.objectStore('readiness').clear()
    t.objectStore('program').clear() // reverts to defaults
    t.objectStore('techniques').clear()
    t.objectStore('techCategories').clear() // defaults re-seed on next read (getCategories)
    t.objectStore('dayTypes').clear() // defaults re-seed on next read (getDayTypes)
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
export const SCHEMA_VERSION = 5

export async function exportData() {
  const [sessions, sets, readiness, program, techniques, techCategories, dayTypes] = await Promise.all([
    all('sessions'), all('sets'), all('readiness'), all('program'), all('techniques'), all('techCategories'), all('dayTypes'),
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
