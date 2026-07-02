// Shared Monday-week (Mon–Sun) helpers + weekly training-load aggregation.
// Used by the Progress weekly dashboard, the Readiness sport targets and the
// deload rules. Pure functions — callers pass in the loaded records.

// What counts as a "hard" session — simple, transparent constants (tune here).
export const HARD_LIFT_SETS = 12   // a lifting session with this many working sets
export const HARD_BOULDER_MIN = 90 // a bouldering session at least this long
// (any martial session always counts as hard — sparring load.)

export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d - tz).toISOString().slice(0, 10)
}

// Monday of the week containing the given date (the program starts Monday).
export function weekStartISO(dateISO) {
  const d = new Date(dateISO + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const tz = d.getTimezoneOffset() * 60000
  return new Date(d - tz).toISOString().slice(0, 10)
}

// dayType -> kind map ('lifting' | 'martial' | 'running' | 'bouldering' |
// 'stretching' | 'calisthenics'), built from the editable day types + sports.
export function kindByDayMap(dayTypes = [], sports = []) {
  const map = {}
  for (const d of dayTypes) map[d.name] = d.kind === 'cardio' ? 'running' : d.kind
  for (const s of sports) map[s.name] = s.kind
  return map
}

// Combined load per Mon–Sun week for the last `weeks` weeks (oldest first):
// [{ week, sets, volume, sessions, hard, byKind: { lifting: n, martial: n, … } }]
export function weeklyLoad({ sessions = [], sets = [], kindByDay = {}, weeks = 10, today }) {
  const thisWeek = weekStartISO(today)
  const starts = []
  for (let i = weeks - 1; i >= 0; i--) starts.push(addDaysISO(thisWeek, -7 * i))
  const byWeek = Object.fromEntries(starts.map((w) => [w, { week: w, sets: 0, volume: 0, sessions: 0, hard: 0, byKind: {} }]))

  const setsBySession = {}
  for (const x of sets) if (x.reps != null) (setsBySession[x.sessionId] ??= []).push(x)

  for (const s of sessions) {
    const w = byWeek[weekStartISO(s.date)]
    if (!w) continue
    const kind = kindByDay[s.dayType]
      || (s.martial ? 'martial' : s.bouldering ? 'bouldering' : s.cardio ? 'running' : 'lifting')
    const logged = setsBySession[s.id] || []
    w.sessions++
    w.byKind[kind] = (w.byKind[kind] || 0) + 1
    w.sets += logged.length
    w.volume += logged.reduce((m, x) => m + (x.weight || 0) * (x.reps || 0), 0)
    const hardLift = logged.length >= HARD_LIFT_SETS
    const hardBoulder = kind === 'bouldering' && Number(s.bouldering?.minutes || 0) >= HARD_BOULDER_MIN
    if (kind === 'martial' || hardLift || hardBoulder) w.hard++
  }
  return starts.map((w) => byWeek[w])
}
