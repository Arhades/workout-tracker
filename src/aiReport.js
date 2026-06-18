// Builds a clean Markdown summary of a session to paste into any AI chatbot for
// critique. This is the "smart feedback" path (vs. the offline rule-based
// suggester) — it offloads the reasoning to an LLM you paste into manually, so
// no API key / network / cost lives in the PWA.

import { MARTIAL, KIND_LABEL, PROGRAM } from './program.js'

const OUTCOME_MARK = { good: '✓', bad: '✗', '': '•' }

const PREAMBLE =
  'You are an expert strength & conditioning and martial-arts coach. Critique the ' +
  'session below: exercise/technique selection, volume & intensity balance, and ' +
  'left/right imbalance progress. Then give 2–3 concrete adjustments for next time. ' +
  'Athlete context: hypertrophy focus prioritising side delts & lats; correcting a ' +
  'left/right imbalance (weaker LEFT side trained first to failure, RIGHT capped to ' +
  "the left's rep count so the gap closes)."

function fmtSet(x) {
  const w = x.weight == null ? 'BW' : x.weight
  let s = `${w}×${x.reps}`
  if (x.rir != null && x.rir !== '') s += ` @RIR${x.rir}`
  if (x.isDropSet) s += ' (drop)'
  return s
}

function liftsMarkdown(sets) {
  const order = [], map = {}
  for (const s of sets) {
    if (s.reps == null) continue
    if (!map[s.exerciseKey]) { map[s.exerciseKey] = { name: s.exerciseName, L: [], R: [], B: [] }; order.push(s.exerciseKey) }
    map[s.exerciseKey][s.side || 'B'].push(s)
  }
  if (!order.length) return ''
  const lines = ['## Lifts']
  for (const k of order) {
    const g = map[k]
    const byIdx = (a, b) => a.setIndex - b.setIndex
    if (g.L.length || g.R.length) {
      lines.push(`### ${g.name} (unilateral L/R)`)
      lines.push(`- L: ${g.L.sort(byIdx).map(fmtSet).join(', ') || '—'}`)
      lines.push(`- R: ${g.R.sort(byIdx).map(fmtSet).join(', ') || '—'}`)
    } else {
      lines.push(`### ${g.name}`)
      lines.push(`- ${g.B.sort(byIdx).map(fmtSet).join(', ')}`)
    }
  }
  return lines.join('\n')
}

function martialMarkdown(dayType, m, cfgArg = null) {
  if (!m) return ''
  const cfg = cfgArg || MARTIAL[dayType] || { kinds: [] }
  const lines = [`## ${dayType} session`]
  const head = []
  if (m.rounds) head.push(`Rounds: ${m.rounds}`)
  if (m.minutes) head.push(`Time: ${m.minutes} min`)
  if (head.length) lines.push(head.join(' · '))
  if (m.mainFocus) lines.push(`**Main technique to work on:** ${m.mainFocus}`)
  for (const kind of cfg.kinds) {
    const items = (m[kind] || []).filter((it) => it.text)
    if (!items.length) continue
    lines.push(`\n**${KIND_LABEL[kind] || kind}**`)
    for (const it of items) lines.push(`- ${OUTCOME_MARK[it.outcome] || '•'} ${it.text}`)
  }
  const conf = (m.confidence || []).filter((c) => c.name)
  if (conf.length) {
    lines.push('\n**Technique confidence (1–10)**')
    for (const c of conf) lines.push(`- ${c.name}: ${c.level}/10`)
  }
  if (m.notes) lines.push(`\n_Notes:_ ${m.notes}`)
  return lines.join('\n')
}

function boulderingMarkdown(b) {
  if (!b) return ''
  const lines = ['## Bouldering session']
  if (b.minutes) lines.push(`Time: ${b.minutes} min`)
  if (b.grades) lines.push(`Grades: ${b.grades}`)
  if (b.notes) lines.push(`Notes: ${b.notes}`)
  return lines.join('\n')
}

function cardioMarkdown(c) {
  if (!c) return ''
  const lines = ['## Cardio session']
  if (c.distance) lines.push(`Distance: ${c.distance} km`)
  if (c.minutes) lines.push(`Time: ${c.minutes} min`)
  if (c.notes) lines.push(`Notes: ${c.notes}`)
  return lines.join('\n')
}

// session: the sessions record. sets: its sets. readiness: that date's record or null.
// meta: the day's metadata from db.getProgram() (kind / weekday / martialCfg). When
// omitted, falls back to the static PROGRAM defaults (still works for default days).
export function sessionMarkdown({ session, sets = [], readiness = null, meta = null }) {
  const dm = meta || PROGRAM[session.dayType] || {}
  const wd = dm.weekday ? ` (${dm.weekday})` : ''
  const parts = [`# Coaching request — ${session.dayType}${wd} · ${session.date}`, '', PREAMBLE]

  if (readiness) {
    parts.push(`## Readiness (this date)\nReadiness ${readiness.readiness}/10 · Soreness ${readiness.soreness}/10 · Sleep ${readiness.sleep_hours ?? '—'}h`)
  }

  if (dm.martial) parts.push(martialMarkdown(session.dayType, session.martial, dm.martialCfg))
  else if (dm.bouldering) parts.push(boulderingMarkdown(session.bouldering))
  else if (dm.cardio) parts.push(cardioMarkdown(session.cardio))
  else parts.push(liftsMarkdown(sets))

  if (session.notes) parts.push(`## Notes\n${session.notes}`)
  return parts.filter(Boolean).join('\n\n').trim() + '\n'
}

// All technique-library entries, grouped, as Markdown — for "Copy all for AI".
export function techniquesMarkdown(techniques, categoryLabel) {
  if (!techniques.length) return ''
  const byCat = {}
  for (const t of techniques) (byCat[t.category] ??= []).push(t)
  const out = ['# My technique notes', '', 'Review these notes and suggest drills, common mistakes, and what to focus on.', '']
  for (const cat of Object.keys(byCat)) {
    out.push(`## ${categoryLabel(cat)}`)
    for (const t of byCat[cat]) {
      const tags = [t.area, t.discipline].filter(Boolean).join(' · ')
      out.push(`### ${t.title}${tags ? ` — ${tags}` : ''}`)
      if (t.body) out.push(t.body)
      if (t.source) out.push(`_Source:_ ${t.source}`)
      out.push('')
    }
  }
  return out.join('\n').trim() + '\n'
}
