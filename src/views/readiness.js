import { el, clear, mount } from '../dom.js'
import * as db from '../db.js'
import { chart, legend } from '../components/chart.js'
import { weeklyLoad, kindByDayMap, weekStartISO, addDaysISO } from '../load.js'
import { deloadStatus } from '../deload.js'

// ~10-second daily check-in. Its only v1 job is to accumulate labels for the
// future readiness / overtraining model (the later offline ML layer). Also home
// to the weekly sport targets, the injury log and the rule-based deload flag.
export async function ReadinessView(ctx) {
  const root = el('div')
  let date = db.todayISO()

  // ---- Deload / overtraining flag (rule-based, reasons always listed) --------
  function deloadCard(status) {
    if (!status.warn) return null
    return el('div.card.warn',
      el('strong', { style: { fontSize: '14px' } }, '⚠️ Consider a deload / rest day'),
      el('ul', { style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '13px', lineHeight: '1.6' } },
        status.reasons.map((r) => el('li', r))),
      el('div.muted', { style: { fontSize: '11px', marginTop: '6px' } },
        'Simple offline rules over your check-ins, weekly load, rest days and active niggles — not AI.'))
  }

  // ---- Weekly sport-frequency targets (Mon–Sun) with 1-week carryover --------
  // goal = base + max(0, base − completedLastWeek): an unmet target rolls over
  // exactly once (never compounding). Completions auto-count from sessions
  // logged in the Sports tab; the +/− buttons correct for sessions done
  // elsewhere (stored per week on the sport record).
  function targetsCard(sports, sessions) {
    const today = db.todayISO()
    const thisWeek = weekStartISO(today)
    const lastWeek = addDaysISO(thisWeek, -7)
    const countIn = (name, start) =>
      sessions.filter((s) => s.dayType === name && s.date >= start && s.date <= addDaysISO(start, 6)).length

    const row = (sp) => {
      const base = sp.target ?? 0
      const adj = sp.adjust || {}
      const manual = adj[thisWeek] || 0
      const doneThis = Math.max(0, countIn(sp.name, thisWeek) + manual)
      const doneLast = Math.max(0, countIn(sp.name, lastWeek) + (adj[lastWeek] || 0))
      const carry = base > 0 ? Math.max(0, base - doneLast) : 0
      const goal = base + carry

      const targetInput = el('input', {
        inputmode: 'numeric', value: base || '', placeholder: '—',
        style: { width: '56px', padding: '6px 8px', textAlign: 'center' },
      })
      targetInput.addEventListener('change', async () => {
        const v = targetInput.value.trim()
        await db.updateSport(sp.name, { target: v === '' ? 0 : Math.max(0, Number(v) || 0) })
        refresh()
      })
      const bump = async (d) => {
        await db.updateSport(sp.name, { adjust: { ...adj, [thisWeek]: manual + d } })
        refresh()
      }

      const pct = goal > 0 ? Math.min(100, (doneThis / goal) * 100) : 0
      return el('div', { style: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border)' } },
        el('div.row.between',
          el('div.exname', { style: { fontSize: '14px' } }, sp.name),
          el('div.row', { style: { gap: '6px' } },
            el('span.muted', { style: { fontSize: '12px' } }, 'target ×/wk'), targetInput)),
        base > 0 && el('div', { style: { marginTop: '6px' } },
          el('div.row.between',
            el('div.muted', { style: { fontSize: '13px' } },
              'This week: ', el('strong', { style: { color: 'var(--text)' } }, `${doneThis} / ${goal}`),
              carry ? ` (${base} base + ${carry} carried)` : '',
              manual ? ` · manual ${manual > 0 ? '+' : ''}${manual}` : ''),
            el('div.spread',
              el('button.btn.ghost.sm', { onclick: () => bump(-1), title: 'Uncount a session' }, '−'),
              el('button.btn.ghost.sm', { onclick: () => bump(1), title: 'Count a session done elsewhere' }, '+'))),
          el('div.bar', el('div.bar-fill' + (doneThis >= goal ? '.done' : ''), { style: { width: `${pct}%` } }))))
    }

    return el('div.card',
      el('h2', { style: { marginTop: 0 } }, 'Weekly sport targets'),
      el('p.muted', { style: { fontSize: '12px', margin: '0' } },
        'Week runs Mon–Sun. Sessions logged in the Sports tab count automatically; use +/− for ones done elsewhere. An unmet week carries into the next week once, then drops.'),
      sports.map(row))
  }

  // ---- Injury / niggle log ----------------------------------------------------
  function injuriesCard(injuries) {
    const active = injuries.filter((i) => i.status === 'active').sort((a, b) => (a.date < b.date ? 1 : -1))
    const resolved = injuries.filter((i) => i.status !== 'active').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10)

    const area = el('input', { placeholder: 'Area — e.g. left elbow' })
    const side = el('select', [
      el('option', { value: '' }, '— side —'),
      el('option', { value: 'L' }, 'Left'),
      el('option', { value: 'R' }, 'Right'),
    ])
    const sevOut = el('strong', { style: { color: 'var(--text)' } }, '3/5')
    const sev = el('input', { type: 'range', min: '1', max: '5', value: '3' })
    sev.addEventListener('input', (e) => { sevOut.textContent = `${e.target.value}/5` })
    const note = el('input', { placeholder: 'Note — what aggravates it? (optional)' })

    const add = async () => {
      if (!area.value.trim()) { ctx.toast('Name the area'); return }
      await db.add('injuries', {
        date: db.todayISO(), area: area.value.trim(), side: side.value || null,
        severity: +sev.value, status: 'active', note: note.value.trim(), resolvedDate: null,
      })
      ctx.toast('Niggle logged'); refresh()
    }

    const activeRow = (i) => el('div.card.tight', { style: { marginTop: '8px' } },
      el('div.row.between',
        el('div',
          el('div.exname', { style: { fontSize: '14px' } },
            `${i.area}${i.side ? ` (${i.side})` : ''} — severity ${i.severity}/5`),
          el('div.muted', { style: { fontSize: '12px' } }, `since ${i.date}${i.note ? ` · ${i.note}` : ''}`)),
        el('div.spread',
          el('button.btn.ghost.sm', {
            onclick: async () => { await db.update('injuries', i.id, { status: 'resolved', resolvedDate: db.todayISO() }); ctx.toast('Marked resolved'); refresh() },
          }, '✓ Resolved'),
          el('button.btn.danger.sm', {
            onclick: async () => { if (confirm('Delete this entry entirely?')) { await db.del('injuries', i.id); refresh() } },
          }, '✕'))))

    return el('div.card',
      el('h2', { style: { marginTop: 0 } }, 'Injuries / niggles'),
      el('p.muted', { style: { fontSize: '12px', margin: '0 0 8px' } },
        'Active niggles feed the deload flag. Mark them resolved when they clear — history is kept.'),
      active.length ? active.map(activeRow) : el('div.muted', { style: { fontSize: '13px' } }, 'Nothing active. 🎉'),
      el('div', { style: { marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border)' } },
        el('div.exname', { style: { fontSize: '14px', marginBottom: '8px' } }, 'Log a niggle'),
        area,
        el('div.grid2', { style: { marginTop: '8px', alignItems: 'center' } },
          el('div', el('label', 'Side'), side),
          el('div', el('label', 'Severity ', sevOut), sev)),
        el('div', { style: { marginTop: '8px' } }, note),
        el('button.btn.full', { style: { marginTop: '10px' }, onclick: add }, '+ Add niggle')),
      resolved.length > 0 && el('div', { style: { marginTop: '14px' } },
        el('label', 'Resolved'),
        resolved.map((i) => el('div.kv',
          el('span.muted', `${i.area}${i.side ? ` (${i.side})` : ''} — sev ${i.severity}/5`),
          el('span.muted', `${i.date} → ${i.resolvedDate || '—'}`)))))
  }

  async function refresh() {
    const [all, sessions, sets, sports, dayTypes, injuries] = await Promise.all([
      db.all('readiness').then((x) => x.sort((a, b) => (a.date < b.date ? 1 : -1))),
      db.all('sessions'), db.all('sets'), db.getSports(), db.getDayTypes(), db.all('injuries'),
    ])
    const existing = all.find((r) => r.date === date)
    let readiness = existing?.readiness ?? 7
    let soreness = existing?.soreness ?? 3
    let sleep = existing?.sleep_hours ?? ''
    let note = existing?.note ?? ''

    const today = db.todayISO()
    const weekly = weeklyLoad({ sessions, sets, kindByDay: kindByDayMap(dayTypes, sports), weeks: 4, today })
    const deload = deloadStatus({ readiness: all, sessions, weekly, injuries, today })

    const dateInput = el('input', { type: 'date', value: date })
    dateInput.addEventListener('change', (e) => { date = e.target.value; refresh() })

    const rOut = el('strong', { style: { color: 'var(--text)' } }, `${readiness}/10`)
    const rRange = el('input', { type: 'range', min: '1', max: '10', value: String(readiness) })
    rRange.addEventListener('input', (e) => { readiness = +e.target.value; rOut.textContent = `${readiness}/10` })

    const sOut = el('strong', { style: { color: 'var(--text)' } }, `${soreness}/10`)
    const sRange = el('input', { type: 'range', min: '1', max: '10', value: String(soreness) })
    sRange.addEventListener('input', (e) => { soreness = +e.target.value; sOut.textContent = `${soreness}/10` })

    const sleepInput = el('input', { inputmode: 'decimal', placeholder: 'e.g. 7.5', value: sleep })
    sleepInput.addEventListener('input', (e) => (sleep = e.target.value))
    const noteInput = el('textarea', { placeholder: 'Stress, illness, travel…' })
    noteInput.value = note
    noteInput.addEventListener('input', (e) => (note = e.target.value))

    async function save() {
      const row = { date, readiness: +readiness, soreness: +soreness, sleep_hours: sleep === '' ? null : +sleep, note }
      if (existing) await db.update('readiness', existing.id, row)
      else await db.add('readiness', row)
      ctx.toast('Readiness saved'); refresh()
    }

    clear(root)
    mount(root,
      el('h1', 'Daily Readiness'),
      el('p.sub', '~10 seconds. Builds the training data for the future overtraining model.'),
      deloadCard(deload),
      el('div.card',
        el('label', 'Date'), dateInput,
        el('div', { style: { marginTop: '14px' } },
          el('label', 'Readiness — how ready to train do you feel? ', rOut), rRange),
        el('div', { style: { marginTop: '10px' } },
          el('label', 'Soreness (overall) ', sOut), sRange),
        el('div', { style: { marginTop: '14px' } }, el('label', 'Sleep (hours)'), sleepInput),
        el('div', { style: { marginTop: '12px' } }, el('label', 'Note (optional)'), noteInput),
        el('button.btn.primary.full', { style: { marginTop: '14px' }, onclick: save }, existing ? 'Update check-in' : 'Save check-in')),
      targetsCard(sports, sessions),
      injuriesCard(injuries))

    const chartData = [...all].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-30)
    if (chartData.length > 1) {
      root.append(el('div.card',
        el('h2', { style: { marginTop: 0 } }, 'Last 30 days'),
        chart([
          { label: 'Readiness', color: '#4ade80', points: chartData.map((r) => ({ x: r.date, y: r.readiness })) },
          { label: 'Soreness', color: '#f87171', points: chartData.map((r) => ({ x: r.date, y: r.soreness })) },
        ], { yLabel: 'readiness vs soreness (1–10)' }),
        legend([{ label: 'Readiness', color: '#4ade80' }, { label: 'Soreness', color: '#f87171' }])))
    }

    if (all.length > 0) {
      root.append(el('div.card',
        el('h2', { style: { marginTop: 0 } }, 'Recent check-ins'),
        all.slice(0, 10).map((r) => el('div.kv',
          el('span', r.date),
          el('span.muted', `R ${r.readiness} · S ${r.soreness} · ${r.sleep_hours ?? '—'}h`)))))
    }
  }

  await refresh()
  return root
}
