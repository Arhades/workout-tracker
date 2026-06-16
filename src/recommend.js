// Offline, rule-based exercise suggester. NOT AI — deliberately simple, works at
// the gym with no signal (n is far too small for a real model; honest simple
// heuristics are the right call). For genuinely "smart" critique, use the
// Copy-for-AI export instead.

import { EXERCISE_INDEX, EXERCISE_LIBRARY, DEFAULT_PROGRAM } from './program.js'

// Goal muscles (hypertrophy priority + imbalance protocol).
const PRIORITY_MUSCLES = ['Side Delts', 'Lats', 'Rear Delts']
const STALE_DAYS = 6

function daysSince(iso, today) {
  const a = new Date(iso + 'T12:00:00'), b = new Date(today + 'T12:00:00')
  return Math.round((b - a) / 86400000)
}

function altsFor(muscle, n) {
  return EXERCISE_LIBRARY.filter((e) => e.muscle === muscle).slice(0, n).map((e) => e.name)
}

// Returns [{ text, sub }] suggestions for the given day. Empty array = nothing
// to flag (the common, good case).
export function buildSuggestions({ dayType, exercises, sessions, sets, today }) {
  const out = []
  const dateById = Object.fromEntries(sessions.map((s) => [s.id, s.date]))

  // Muscle lookup: known library/defaults + whatever is in today's list.
  const muscleByKey = {}
  for (const k in EXERCISE_INDEX) muscleByKey[k] = EXERCISE_INDEX[k].muscle
  for (const ex of exercises) muscleByKey[ex.key] = ex.muscle

  // Most recent logged date per muscle, across all history.
  const lastByMuscle = {}
  for (const s of sets) {
    if (s.reps == null) continue
    const m = muscleByKey[s.exerciseKey]; if (!m) continue
    const d = dateById[s.sessionId]; if (!d) continue
    if (!lastByMuscle[m] || d > lastByMuscle[m]) lastByMuscle[m] = d
  }

  // 1) Priority muscles gone stale (or never trained).
  for (const m of PRIORITY_MUSCLES) {
    const last = lastByMuscle[m]
    const dd = last ? daysSince(last, today) : Infinity
    if (dd >= STALE_DAYS) {
      const alts = altsFor(m, 3)
      out.push({
        text: last ? `${m} not trained in ${dd} days — a priority muscle.`
                   : `${m} has no logged sets yet — a priority muscle.`,
        sub: alts.length ? `Options: ${alts.join(', ')}` : '',
      })
    }
  }

  // 2) Coverage gap: a muscle in the DEFAULT day that today's (edited) list drops.
  const def = DEFAULT_PROGRAM[dayType]
  if (def && !def.bouldering && !def.martial) {
    const have = new Set(exercises.map((e) => e.muscle))
    for (const m of [...new Set(def.exercises.map((e) => e.muscle))]) {
      if (!have.has(m)) {
        const alts = altsFor(m, 2)
        out.push({
          text: `${m} is in your default ${dayType} day but missing from today's list.`,
          sub: alts.length ? `Add e.g. ${alts.join(' or ')}` : '',
        })
      }
    }
  }

  return out
}
