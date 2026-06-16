import { el, clear } from '../dom.js'
import * as db from '../db.js'
import { chart, legend } from '../components/chart.js'

// ~10-second daily check-in. Its only v1 job is to accumulate labels for the
// future readiness / overtraining model (the later offline ML layer).
export async function ReadinessView(ctx) {
  const root = el('div')
  let date = db.todayISO()

  async function refresh() {
    const all = (await db.all('readiness')).sort((a, b) => (a.date < b.date ? 1 : -1))
    const existing = all.find((r) => r.date === date)
    let readiness = existing?.readiness ?? 7
    let soreness = existing?.soreness ?? 3
    let sleep = existing?.sleep_hours ?? ''
    let note = existing?.note ?? ''

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
    root.append(
      el('h1', 'Daily Readiness'),
      el('p.sub', '~10 seconds. Builds the training data for the future overtraining model.'),
      el('div.card',
        el('label', 'Date'), dateInput,
        el('div', { style: { marginTop: '14px' } },
          el('label', 'Readiness — how ready to train do you feel? ', rOut), rRange),
        el('div', { style: { marginTop: '10px' } },
          el('label', 'Soreness (overall) ', sOut), sRange),
        el('div', { style: { marginTop: '14px' } }, el('label', 'Sleep (hours)'), sleepInput),
        el('div', { style: { marginTop: '12px' } }, el('label', 'Note (optional)'), noteInput),
        el('button.btn.primary.full', { style: { marginTop: '14px' }, onclick: save }, existing ? 'Update check-in' : 'Save check-in')))

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
