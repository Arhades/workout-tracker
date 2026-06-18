// The DEFAULT program (PPL × Arnold hybrid). This file holds the *defaults* only.
//
// The program is editable: the user's custom per-day exercise lists are persisted
// in IndexedDB (see db.js getProgram / saveDay). When a day has no custom record,
// these defaults are used live, so editing the defaults here still flows through.
// The day LIST + per-day metadata (kind / weekday / martial cfg) are seeded from
// here into the editable `dayTypes` store (db.js).
//
// `key` is a STABLE slug — it is the join key for the export schema and all
// history/progression lookups. Never rename a key; the data is keyed on it.
//
// Exercise fields:
//   key, name, muscle, sets, rir, rest (seconds), unilateral, toFailure, optional, note

const U = true // unilateral — imbalance protocol (log L & R separately)

// Lifting + bouldering days, plus martial-arts session types. A martial day is
// logged like Bouldering (its own form, no sets/RIR) — see `martial` flag.
export const DAY_TYPES = [
  'Push',
  'Pull',
  'Legs',
  'Chest & Back',
  'Arms & Shoulders',
  'Bouldering',
  'BJJ',
  'Judo',
  'Muay Thai',
  'Calisthenics',
  'Running',
]

export const DEFAULT_PROGRAM = {
  Push: {
    weekday: 'Mon',
    exercises: [
      { key: 'overhead_press_db', name: 'Seated Dumbbell Shoulder Press', muscle: 'Shoulders', sets: 3, rir: '1–2', rest: 300, note: 'Top compound — done fresh (shoulder priority)' },
      { key: 'incline_db_press', name: 'Incline Dumbbell Bench Press', muscle: 'Upper Chest', sets: 3, rir: '1–2', rest: 240 },
      { key: 'lateral_raise', name: 'Lateral Raise', muscle: 'Side Delts', sets: 3, rir: '0', rest: 240, unilateral: U, note: 'Imbalance protocol — side delts (left to failure first)' },
      { key: 'rope_pushdown', name: 'Tricep Rope Pushdowns', muscle: 'Triceps', sets: 3, rir: '1', rest: 180 },
    ],
  },
  Pull: {
    weekday: 'Tue',
    exercises: [
      { key: 'single_arm_db_row', name: 'Single-Arm Dumbbell Row', muscle: 'Back', sets: 3, rir: '1–2', rest: 300, unilateral: U, note: 'Left side first (imbalance)' },
      { key: 'rear_delt_pull_sa', name: 'Rear Delt Cable Flys', muscle: 'Rear Delts', sets: 3, rir: '0', rest: 240, unilateral: U, note: 'Imbalance protocol — rear delts (left to failure first)' },
      { key: 'seated_incline_db_curl', name: 'Seated Incline Dumbbell Curls', muscle: 'Biceps', sets: 3, rir: '1–2', rest: 240 },
    ],
  },
  Legs: {
    weekday: 'Wed',
    exercises: [
      { key: 'squat', name: 'Squat', muscle: 'Quads', sets: 3, rir: '1–2', rest: 300, note: 'Heavy — primary lift (wakes up the CNS)' },
      { key: 'rdl', name: 'Romanian Deadlift', muscle: 'Posterior Chain', sets: 3, rir: '1–2', rest: 240, note: 'Hinge — performed second, while core is still fresh' },
      { key: 'bulgarian_split_squat', name: 'Bulgarian Split Squat', muscle: 'Quads/Glutes', sets: 2, rir: '2', rest: 300, unilateral: U, note: 'Unilateral — helps the leg-side imbalance' },
      { key: 'leg_extension', name: 'Leg Extension', muscle: 'Quads', sets: 3, rir: '1–2', rest: 240 },
      { key: 'leg_curl', name: 'Leg Curl', muscle: 'Hamstrings', sets: 3, rir: '1–2', rest: 240 },
      { key: 'lateral_raise', name: 'Lateral Raise', muscle: 'Side Delts', sets: 3, rir: '0', rest: 240, unilateral: U, note: 'Imbalance protocol — side delts' },
    ],
  },
  'Chest & Back': {
    weekday: 'Thu',
    exercises: [
      { key: 'pull_ups', name: 'Weighted Pull-Ups', muscle: 'Lats', sets: 3, rir: '1', rest: 240, note: 'V-taper — add load' },
      { key: 'lat_pulldown', name: 'Lat Pulldown', muscle: 'Lats', sets: 3, rir: '1–2', rest: 240 },
      { key: 'straight_arm_pulldown', name: 'Straight-Arm Lat Pullover', muscle: 'Lats', sets: 3, rir: '0', rest: 240 },
      { key: 'chest_fly', name: 'Pec Deck / Chest Flys', muscle: 'Chest', sets: 3, rir: '1–2', rest: 240, note: 'Spares front delts for Day 5' },
    ],
  },
  'Arms & Shoulders': {
    weekday: 'Fri',
    exercises: [
      { key: 'db_shoulder_press', name: 'Standing Overhead Press (DB)', muscle: 'Shoulders', sets: 3, rir: '1–2', rest: 240, note: 'Front delts recovered since Day 1' },
      { key: 'lateral_raise', name: 'Lateral Raise', muscle: 'Side Delts', sets: 3, rir: '0', rest: 240, unilateral: U, note: 'Imbalance protocol — side delts' },
      { key: 'seated_incline_db_curl', name: 'Seated Incline Dumbbell Curls', muscle: 'Biceps', sets: 3, rir: '1–2', rest: 240 },
      { key: 'reverse_db_curl', name: 'Reverse DB Curls', muscle: 'Forearms/Biceps', sets: 3, rir: '1–2', rest: 240 },
      { key: 'overhead_tricep_ext', name: 'Overhead Tricep Extension', muscle: 'Triceps', sets: 3, rir: '1–2', rest: 240 },
    ],
  },
  Bouldering: {
    weekday: 'Sat',
    bouldering: true, // logged as a back/grip day: time + grades + notes, no sets/RIR
    exercises: [],
  },
  // ---- Martial-arts session types -----------------------------------------
  // Logged like Bouldering: their own structured form, no sets/RIR. Each can be
  // logged on the SAME date as a lifting day (a session is keyed by date+type),
  // so a Pull day and a BJJ session on the same day are two separate sessions.
  BJJ: { martial: 'BJJ', exercises: [] },
  Judo: { martial: 'Judo', exercises: [] },
  'Muay Thai': { martial: 'Muay Thai', exercises: [] },
  // ---- Calisthenics (skill-focused bodyweight; logged like a lifting day) --
  Calisthenics: {
    exercises: [
      { key: 'handstand', name: 'Handstand Hold', muscle: 'Shoulders', sets: 3, rir: '—', rest: 120, note: 'Skill — log seconds held in the reps field' },
      { key: 'l_sit', name: 'L-Sit Hold', muscle: 'Core', sets: 3, rir: '—', rest: 120, note: 'Skill — log seconds held in the reps field' },
      { key: 'tuck_planche', name: 'Tuck Planche Hold', muscle: 'Shoulders', sets: 3, rir: '—', rest: 120, note: 'Skill — log seconds held in the reps field' },
      { key: 'pull_up', name: 'Pull-ups', muscle: 'Lats', sets: 3, rir: '1', rest: 120 },
      { key: 'dips', name: 'Dips', muscle: 'Triceps', sets: 3, rir: '1', rest: 120 },
    ],
  },
  // ---- Running (cardio: distance + time + notes, no sets/RIR) --------------
  Running: { cardio: true, exercises: [] },
}

// Backward-compatible alias. Prefer db.getProgram() (custom-aware) for the Log
// view; PROGRAM is the default and is fine for static metadata (weekday, flags).
export const PROGRAM = DEFAULT_PROGRAM

// ---- Martial-arts form config ----------------------------------------------
// Which tagged lists each discipline shows. Every list item is { text, outcome }
// where outcome is 'good' | 'bad' | '' — the "went right / went wrong" tag.
export const MARTIAL = {
  BJJ:        { unit: 'rounds', kinds: ['position', 'submission', 'sweep', 'escape'] },
  Judo:       { unit: 'rounds', kinds: ['throw', 'submission', 'position', 'escape'] },
  'Muay Thai': { unit: 'rounds', kinds: ['technique', 'combo', 'defense'] },
}

export const KIND_LABEL = {
  position: 'Positions',
  submission: 'Submissions',
  sweep: 'Sweeps',
  escape: 'Escapes',
  throw: 'Throws / takedowns',
  technique: 'Techniques drilled',
  combo: 'Combos',
  defense: 'Defense / counters',
}

export function isMartial(dayType) { return !!PROGRAM[dayType]?.martial }

// Warm-up reminder shown on every lifting session (the daily pre-workout protocol).
export const WARMUP = 'Rotator cuff: internal + external rotation (2–3 sets each) + 5 min handstand practice.'

export function exercisesFor(dayType) {
  return PROGRAM[dayType]?.exercises ?? []
}

// ---- Exercise library -------------------------------------------------------
// Catalog used by (a) the "add exercise" picker and (b) the offline suggester
// for "alternatives for this muscle". Includes every default-program exercise
// plus extra alternatives per muscle. Keys must stay stable (join key).
const LIBRARY_EXTRA = [
  { key: 'db_lateral_raise', name: 'Dumbbell Lateral Raise', muscle: 'Side Delts', sets: 3, rir: '0', rest: 240, unilateral: U },
  { key: 'cable_lateral_raise', name: 'Cable Lateral Raise', muscle: 'Side Delts', sets: 3, rir: '0', rest: 240, unilateral: U },
  { key: 'machine_lateral_raise', name: 'Machine Lateral Raise', muscle: 'Side Delts', sets: 3, rir: '0', rest: 180 },
  { key: 'face_pull', name: 'Face Pull', muscle: 'Rear Delts', sets: 3, rir: '0', rest: 180 },
  { key: 'reverse_pec_deck', name: 'Reverse Pec Deck', muscle: 'Rear Delts', sets: 3, rir: '0', rest: 180 },
  { key: 'single_arm_db_row', name: 'Single-Arm Dumbbell Row', muscle: 'Back', sets: 3, rir: '1–2', rest: 240, unilateral: U },
  { key: 'pull_up', name: 'Pull-up', muscle: 'Lats', sets: 3, rir: '1', rest: 180, toFailure: true },
  { key: 'lat_pulldown', name: 'Lat Pulldown (bilateral)', muscle: 'Lats', sets: 3, rir: '1–2', rest: 240 },
  { key: 'straight_arm_pulldown', name: 'Straight-Arm Pulldown', muscle: 'Lats', sets: 3, rir: '1', rest: 180 },
  { key: 'chest_supported_row', name: 'Chest-Supported Row', muscle: 'Back', sets: 3, rir: '1–2', rest: 240 },
  { key: 'cable_row', name: 'Seated Cable Row', muscle: 'Back', sets: 3, rir: '1–2', rest: 240 },
  { key: 'db_bench_press', name: 'Dumbbell Bench Press', muscle: 'Chest', sets: 3, rir: '1–2', rest: 240 },
  { key: 'incline_machine_press', name: 'Incline Machine Press', muscle: 'Upper Chest', sets: 3, rir: '1', rest: 240 },
  { key: 'overhead_press_db', name: 'Seated DB Overhead Press', muscle: 'Shoulders', sets: 3, rir: '1–2', rest: 240 },
  { key: 'hack_squat', name: 'Hack Squat', muscle: 'Quads', sets: 3, rir: '1–2', rest: 240 },
  { key: 'leg_press', name: 'Leg Press', muscle: 'Quads', sets: 3, rir: '1–2', rest: 240 },
  { key: 'seated_leg_curl', name: 'Seated Leg Curl', muscle: 'Hamstrings', sets: 3, rir: '1–2', rest: 180 },
  { key: 'hip_thrust', name: 'Hip Thrust', muscle: 'Posterior Chain', sets: 3, rir: '1–2', rest: 240 },
  { key: 'cable_curl', name: 'Cable Curl', muscle: 'Biceps', sets: 3, rir: '1–2', rest: 180 },
  { key: 'hammer_curl', name: 'Hammer Curl', muscle: 'Forearms/Biceps', sets: 3, rir: '1–2', rest: 180 },
  { key: 'overhead_tricep_ext', name: 'Overhead Cable Tricep Extension', muscle: 'Triceps', sets: 3, rir: '1–2', rest: 180 },
  { key: 'rope_pushdown', name: 'Rope Pushdown', muscle: 'Triceps', sets: 3, rir: '1–2', rest: 180 },
  { key: 'cable_crunch', name: 'Cable Crunch', muscle: 'Core', sets: 3, rir: '—', rest: 120 },
  { key: 'ab_wheel', name: 'Ab Wheel Rollout', muscle: 'Core', sets: 3, rir: '—', rest: 120 },
]

export const EXERCISE_LIBRARY = (() => {
  const seen = {}
  const out = []
  for (const day of Object.values(DEFAULT_PROGRAM)) {
    for (const ex of day.exercises) if (!seen[ex.key]) { seen[ex.key] = 1; out.push(ex) }
  }
  for (const ex of LIBRARY_EXTRA) if (!seen[ex.key]) { seen[ex.key] = 1; out.push(ex) }
  return out.sort((a, b) => a.muscle.localeCompare(b.muscle) || a.name.localeCompare(b.name))
})()

// Flat lookup of every known exercise by key (defaults + library), for naming /
// muscle lookups in the progression and suggestion code.
export const EXERCISE_INDEX = (() => {
  const idx = {}
  for (const ex of EXERCISE_LIBRARY) idx[ex.key] = ex
  return idx
})()
