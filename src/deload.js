// Transparent, rule-based deload / overtraining flag. NOT AI — same philosophy
// as recommend.js: simple tunable thresholds, and every trigger is listed so the
// warning is always explainable. Surfaced on the Readiness tab + a Log banner.

import { addDaysISO } from './load.js'

// Thresholds — deliberately simple constants, easy to tune.
export const RULES = {
  READINESS_LOW: 5.5,  // mean readiness below this over the lookback window
  SORENESS_HIGH: 6,    // mean soreness above this over the lookback window
  LOOKBACK_DAYS: 5,    // window for the readiness / soreness means
  MIN_CHECKINS: 2,     // need at least this many check-ins in the window to judge
  HARD_PER_WEEK: 6,    // hard sessions per week…
  HARD_WEEKS: 2,       // …sustained for this many consecutive weeks
  CONSEC_DAYS: 6,      // training days in a row with no rest day
}

// readiness: check-in records. sessions: all sessions. weekly: weeklyLoad()
// output (oldest first). injuries: injury records. Returns { warn, reasons }.
export function deloadStatus({ readiness = [], sessions = [], weekly = [], injuries = [], today }) {
  const reasons = []

  // 1) Readiness / soreness trend from the daily check-ins.
  const cutoff = addDaysISO(today, -(RULES.LOOKBACK_DAYS - 1))
  const recent = readiness.filter((r) => r.date >= cutoff && r.date <= today)
  if (recent.length >= RULES.MIN_CHECKINS) {
    const mean = (k) => recent.reduce((m, r) => m + (r[k] || 0), 0) / recent.length
    const mr = mean('readiness'), ms = mean('soreness')
    if (mr < RULES.READINESS_LOW)
      reasons.push(`Mean readiness ${mr.toFixed(1)}/10 over the last ${recent.length} check-ins (below ${RULES.READINESS_LOW})`)
    if (ms > RULES.SORENESS_HIGH)
      reasons.push(`Mean soreness ${ms.toFixed(1)}/10 over the last ${recent.length} check-ins (above ${RULES.SORENESS_HIGH})`)
  }

  // 2) Sustained weekly load (hard sessions per week, consecutive weeks).
  const lastWeeks = weekly.slice(-RULES.HARD_WEEKS)
  if (lastWeeks.length === RULES.HARD_WEEKS && lastWeeks.every((w) => w.hard >= RULES.HARD_PER_WEEK))
    reasons.push(`${RULES.HARD_PER_WEEK}+ hard sessions in each of the last ${RULES.HARD_WEEKS} weeks`)

  // 3) Consecutive training days with no rest day.
  const trained = new Set(sessions.map((s) => s.date))
  let d = trained.has(today) ? today : addDaysISO(today, -1)
  let streak = 0
  while (trained.has(d)) { streak++; d = addDaysISO(d, -1) }
  if (streak >= RULES.CONSEC_DAYS)
    reasons.push(`${streak} training days in a row without a rest day`)

  // 4) Any active injury raises caution.
  for (const i of injuries.filter((x) => x.status === 'active'))
    reasons.push(`Active niggle: ${i.area || 'unspecified'}${i.side ? ` (${i.side})` : ''} — severity ${i.severity ?? '?'}/5`)

  return { warn: reasons.length > 0, reasons }
}
