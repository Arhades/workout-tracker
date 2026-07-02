import { el, clear, mount } from '../dom.js'
import * as db from '../db.js'
import { EXERCISE_INDEX } from '../program.js'
import { chart, legend } from '../components/chart.js'
import { weeklyLoad, kindByDayMap } from '../load.js'

export async function ProgressView() {
  const root = el('div')
  let exKey = ''
  let confName = ''
  let skillKey = ''

  async function refresh() {
    const sessions = await db.all('sessions')
    const sets = await db.all('sets')
    const dateById = Object.fromEntries(sessions.map((s) => [s.id, s.date]))

    // ---- Exercise series ----------------------------------------------------
    // Derive names + unilateral flag from the logged sets themselves so custom /
    // edited exercises (not in the default index) still chart correctly.
    const logged = sets.filter((s) => s.reps != null)
    const nameByKey = {}, uniByKey = {}
    for (const s of logged) {
      nameByKey[s.exerciseKey] = s.exerciseName || EXERCISE_INDEX[s.exerciseKey]?.name || s.exerciseKey
      if (s.side === 'L' || s.side === 'R') uniByKey[s.exerciseKey] = true
    }
    const options = [...new Set(logged.map((s) => s.exerciseKey))]
      .map((k) => ({ key: k, name: nameByKey[k], uni: !!uniByKey[k] }))
      .sort((a, b) => a.name.localeCompare(b.name))

    // ---- Technique-confidence series (from martial sessions) ----------------
    const confByName = {}
    for (const s of sessions) {
      const c = s.martial?.confidence
      if (!Array.isArray(c)) continue
      for (const e of c) {
        if (!e.name || e.level == null) continue
        ;(confByName[e.name] ??= []).push({ date: s.date, level: e.level })
      }
    }
    const confNames = Object.keys(confByName).sort((a, b) => a.localeCompare(b))
    for (const n of confNames) confByName[n].sort((a, b) => (a.date < b.date ? -1 : 1))

    // ---- Sport-skill series (stretching / calisthenics session metrics) -----
    const skillByKey = {}
    for (const s of sessions) {
      if (!Array.isArray(s.skills)) continue
      for (const e of s.skills) {
        if (!e.name || e.value == null) continue
        ;(skillByKey[`${e.name} (${s.dayType})`] ??= []).push({ date: s.date, value: e.value })
      }
    }
    const skillNames = Object.keys(skillByKey).sort((a, b) => a.localeCompare(b))
    for (const n of skillNames) skillByKey[n].sort((a, b) => (a.date < b.date ? -1 : 1))

    clear(root)
    mount(root, el('h1', 'Progress'), el('p.sub', 'Weight & rep trends per exercise, skill metrics, technique confidence and weekly load.'))

    if (!options.length && !confNames.length && !skillNames.length && !sessions.length) {
      root.append(el('div.empty', 'Nothing to chart yet. Log some workouts or a sports session first.'))
      return
    }

    // ---- Exercise section ---------------------------------------------------
    if (options.length) {
      const active = exKey && options.some((o) => o.key === exKey) ? exKey : options[0].key
      const isUni = !!uniByKey[active]

      const bySession = {}
      for (const s of sets) {
        if (s.exerciseKey !== active || s.reps == null) continue
        const d = dateById[s.sessionId]; if (!d) continue
        const o = (bySession[s.sessionId] ??= { date: d, L: [], R: [], B: [] })
        o[s.side || 'B'].push(s)
      }
      const topW = (arr) => arr.reduce((m, x) => Math.max(m, x.weight ?? 0), 0)
      const sumR = (arr) => arr.reduce((m, x) => m + (x.reps || 0), 0)
      const perSession = Object.values(bySession).map((o) => ({
        date: o.date,
        leftW: topW(o.L), rightW: topW(o.R), topW: topW(o.B),
        totalReps: sumR(o.B) + sumR(o.L) + sumR(o.R),
        gapReps: sumR(o.L) - sumR(o.R),
      })).sort((a, b) => (a.date < b.date ? -1 : 1))

      const select = el('select', options.map((o) => el('option', { value: o.key, selected: o.key === active }, o.name + (o.uni ? ' (L/R)' : ''))))
      select.addEventListener('change', (e) => { exKey = e.target.value; refresh() })
      root.append(el('div.card', el('label', 'Exercise'), select))

      if (isUni) {
        const last = perSession[perSession.length - 1]
        const first = perSession[0]
        root.append(
          el('div.card',
            el('h2', { style: { marginTop: 0 } }, 'Top-set weight — L vs R'),
            chart([
              { label: 'Left', color: '#f59e0b', points: perSession.filter((p) => p.leftW > 0).map((p) => ({ x: p.date, y: p.leftW })) },
              { label: 'Right', color: '#38bdf8', points: perSession.filter((p) => p.rightW > 0).map((p) => ({ x: p.date, y: p.rightW })) },
            ], { yLabel: 'kg (heaviest set per side)', yStep: 5 }),
            legend([{ label: 'Left (weaker)', color: '#f59e0b' }, { label: 'Right', color: '#38bdf8' }])),
          el('div.card',
            el('h2', { style: { marginTop: 0 } }, 'Left − Right gap (reps)'),
            chart([{ label: 'Gap', color: '#7aa2ff', points: perSession.map((p) => ({ x: p.date, y: p.gapReps })) }],
              { yLabel: 'L total reps − R total reps (→ 0 is parity)' }),
            last && el('div.muted', { style: { fontSize: '13px', marginTop: '8px' } },
              'Latest gap: ', el('strong', { style: { color: 'var(--text)' } }, `${last.gapReps > 0 ? '+' : ''}${last.gapReps} reps`),
              first && perSession.length > 1 ? ` (started at ${first.gapReps > 0 ? '+' : ''}${first.gapReps}). ` : '. ',
              'Goal is a shrinking gap toward 0.')))
      } else {
        root.append(el('div.card',
          el('h2', { style: { marginTop: 0 } }, 'Top-set weight over time'),
          chart([{ label: 'Top set', color: '#7aa2ff', points: perSession.filter((p) => p.topW > 0).map((p) => ({ x: p.date, y: p.topW })) }],
            { yLabel: 'kg (heaviest set per session)', yStep: 5 }),
          el('h2', 'Total reps per session'),
          chart([{ label: 'Reps', color: '#4ade80', points: perSession.map((p) => ({ x: p.date, y: p.totalReps })) }],
            { yLabel: 'sum of reps (volume proxy)' })))
      }
    }

    // ---- Technique-confidence section ---------------------------------------
    if (confNames.length) {
      const activeC = confName && confNames.includes(confName) ? confName : confNames[0]
      const series = confByName[activeC]
      const sel = el('select', confNames.map((n) => el('option', { value: n, selected: n === activeC }, n)))
      sel.addEventListener('change', (e) => { confName = e.target.value; refresh() })
      const latest = series[series.length - 1]
      root.append(
        el('h2', { style: { marginTop: '22px' } }, 'Technique confidence'),
        el('div.card', el('label', 'Technique'), sel),
        el('div.card',
          el('h2', { style: { marginTop: 0 } }, `“${activeC}” confidence`),
          chart([{ label: 'Confidence', color: '#4ade80', points: series.map((p) => ({ x: p.date, y: p.level })) }],
            { yLabel: 'self-rated confidence (1–10)' }),
          latest && el('div.muted', { style: { fontSize: '13px', marginTop: '8px' } },
            'Latest: ', el('strong', { style: { color: 'var(--text)' } }, `${latest.level}/10`),
            series.length > 1 ? ` (was ${series[0].level}/10 at first rating).` : '.')))
    }

    // ---- Sport skills (stretching / calisthenics metrics over time) ---------
    if (skillNames.length) {
      const activeS = skillKey && skillNames.includes(skillKey) ? skillKey : skillNames[0]
      const series = skillByKey[activeS]
      const sel = el('select', skillNames.map((n) => el('option', { value: n, selected: n === activeS }, n)))
      sel.addEventListener('change', (e) => { skillKey = e.target.value; refresh() })
      const latest = series[series.length - 1]
      root.append(
        el('h2', { style: { marginTop: '22px' } }, 'Sport skills'),
        el('div.card', el('label', 'Skill'), sel),
        el('div.card',
          el('h2', { style: { marginTop: 0 } }, `“${activeS}”`),
          chart([{ label: 'Metric', color: '#38bdf8', points: series.map((p) => ({ x: p.date, y: p.value })) }],
            { yLabel: 'logged metric (hold sec / reps / rating)' }),
          latest && el('div.muted', { style: { fontSize: '13px', marginTop: '8px' } },
            'Latest: ', el('strong', { style: { color: 'var(--text)' } }, String(latest.value)),
            series.length > 1 ? ` (was ${series[0].value} at first log).` : '.')))
    }

    // ---- Weekly load dashboard (combined, Mon–Sun) ---------------------------
    const [dayTypes, sports] = await Promise.all([db.getDayTypes(), db.getSports()])
    const weekly = weeklyLoad({ sessions, sets, kindByDay: kindByDayMap(dayTypes, sports), weeks: 10, today: db.todayISO() })
    if (weekly.some((w) => w.sessions > 0)) {
      const kindLine = (w) => Object.entries(w.byKind).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'
      root.append(
        el('h2', { style: { marginTop: '22px' } }, 'Weekly load (Mon–Sun)'),
        el('div.card',
          el('h2', { style: { marginTop: 0 } }, 'Working sets per week'),
          chart([{ label: 'Sets', color: '#7aa2ff', points: weekly.map((w) => ({ x: w.week, y: w.sets })) }],
            { yLabel: 'total working sets logged' }),
          el('h2', 'Sessions per week'),
          chart([
            { label: 'All', color: '#4ade80', points: weekly.map((w) => ({ x: w.week, y: w.sessions })) },
            { label: 'Hard', color: '#f87171', points: weekly.map((w) => ({ x: w.week, y: w.hard })) },
          ], { yLabel: 'sessions (hard = martial / heavy lifting day / long bouldering)' }),
          legend([{ label: 'All sessions', color: '#4ade80' }, { label: 'Hard sessions', color: '#f87171' }]),
          el('div', { style: { marginTop: '12px' } },
            weekly.slice(-4).map((w) => el('div.kv',
              el('span', `wk of ${w.week}`),
              el('span.muted', kindLine(w)))))))
    }
  }

  await refresh()
  return root
}
