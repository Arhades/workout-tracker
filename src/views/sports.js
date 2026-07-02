import { el, clear, mount, copyToClipboard, fmtDate } from '../dom.js'
import * as db from '../db.js'
import { KIND_LABEL } from '../program.js'
import { sessionMarkdown } from '../aiReport.js'
import { TechniquesView } from './techniques.js'

// All non-gym activity lives here: martial arts, running, bouldering,
// stretching and calisthenics — plus the technique wiki. Sessions stay in the
// same `sessions` store (keyed by date + dayType = sport name), so pre-existing
// BJJ / Judo / bouldering / running history is retained and still visible.

const KINDS = ['martial', 'running', 'bouldering', 'stretching', 'calisthenics']
const MARTIAL_KINDS = ['position', 'submission', 'sweep', 'escape', 'throw', 'technique', 'combo', 'defense']

export async function SportsView(ctx) {
  let date = db.todayISO()
  let sportName = null // resolved on each refresh from the sports list
  let managing = false // activity manager panel
  let wikiOpen = false // embedded technique wiki
  let wikiNode = null  // built once, kept across toggles so wiki state survives
  const root = el('div')

  // Lazily create the session only when the first field is entered.
  let creating = null
  async function ensureSession(sport) {
    const existing = (await db.all('sessions')).find((s) => s.date === date && s.dayType === sport.name)
    if (existing) return existing.id
    if (creating) return creating
    creating = add()
    const id = await creating
    creating = null
    return id
    async function add() {
      const again = (await db.all('sessions')).find((s) => s.date === date && s.dayType === sport.name)
      if (again) return again.id
      return db.add('sessions', {
        date, dayType: sport.name, notes: '',
        bouldering: sport.kind === 'bouldering' ? { minutes: '', grades: '', notes: '' } : null,
        martial: sport.kind === 'martial' ? {} : null,
        cardio: sport.kind === 'running' ? { distance: '', minutes: '', notes: '' } : null,
        skills: (sport.kind === 'stretching' || sport.kind === 'calisthenics') ? [] : null,
      })
    }
  }

  // ---- Martial-arts session form (moved from the Log tab) --------------------
  function martialCard(sport, session, techTitles = []) {
    const cfg = sport.martial || { kinds: [] }
    const m = session?.martial || {}
    const data = { rounds: m.rounds ?? '', minutes: m.minutes ?? '', mainFocus: m.mainFocus ?? '', notes: m.notes ?? '' }
    for (const k of cfg.kinds) data[k] = Array.isArray(m[k]) ? m[k].map((it) => ({ ...it })) : []
    const conf = Array.isArray(m.confidence) ? m.confidence.map((c) => ({ ...c })) : []

    const persist = async (patch) => {
      const id = await ensureSession(sport)
      const cur = (await db.get('sessions', id)).martial || {}
      await db.update('sessions', id, { martial: { ...cur, ...patch } })
    }

    const field = (labelText, key, ph, mode, ta) => {
      let val = data[key]
      const input = ta ? el('textarea', { placeholder: ph }) : el('input', { inputmode: mode || 'text', placeholder: ph })
      input.value = val
      input.addEventListener('input', (e) => (val = e.target.value))
      input.addEventListener('blur', () => persist({ [key]: val }))
      return el('div', { style: { marginTop: '10px' } }, el('label', labelText), input)
    }

    const itemRow = (kind, item, i) => {
      let val = item.text
      const input = el('input', { placeholder: `${KIND_LABEL[kind] || kind} — what happened?`, value: val })
      input.addEventListener('input', (e) => (val = e.target.value))
      input.addEventListener('blur', () => { data[kind][i].text = val; persist({ [kind]: data[kind] }) })
      const cycle = async () => {
        const next = { '': 'good', good: 'bad', bad: '' }
        data[kind][i].outcome = next[item.outcome || '']
        await persist({ [kind]: data[kind] }); refresh()
      }
      const mark = item.outcome === 'good' ? '✓' : item.outcome === 'bad' ? '✗' : '•'
      const cls = item.outcome === 'good' ? '.good' : item.outcome === 'bad' ? '.bad' : ''
      return el('div.row', { style: { gap: '6px', marginTop: '6px' } },
        el('button.outcome' + cls, { onclick: cycle, title: 'Tap: right / wrong / neutral' }, mark),
        input,
        el('button.btn.ghost.sm', { onclick: async () => { data[kind].splice(i, 1); await persist({ [kind]: data[kind] }); refresh() } }, '✕'))
    }

    const kindSection = (kind) => el('div', { style: { marginTop: '14px' } },
      el('label', KIND_LABEL[kind] || kind),
      data[kind].map((it, i) => itemRow(kind, it, i)),
      el('button.btn.ghost.sm', {
        style: { marginTop: '8px' },
        onclick: async () => { data[kind].push({ text: '', outcome: '' }); await persist({ [kind]: data[kind] }); refresh() },
      }, '+ add'))

    // Per-technique confidence (1–10), tracked over time in the Progress tab.
    const confEntry = (c, i) => {
      let name = c.name ?? ''
      const nameInput = el('input', { placeholder: 'Technique name', value: name, list: 'tech-conf-list' })
      nameInput.addEventListener('input', (e) => (name = e.target.value))
      nameInput.addEventListener('blur', () => { data.confidence[i].name = name; persist({ confidence: data.confidence }) })
      const lvlOut = el('span.lvl', `${c.level || 5}/10`)
      const range = el('input', { type: 'range', min: '1', max: '10', value: String(c.level || 5) })
      range.addEventListener('input', (e) => { lvlOut.textContent = `${e.target.value}/10` })
      range.addEventListener('change', (e) => { data.confidence[i].level = +e.target.value; persist({ confidence: data.confidence }) })
      return el('div.card.tight', { style: { marginTop: '8px' } },
        el('div.row', { style: { gap: '6px' } },
          nameInput,
          el('button.btn.ghost.sm', { onclick: async () => { data.confidence.splice(i, 1); await persist({ confidence: data.confidence }); refresh() } }, '✕')),
        el('div.row', { style: { gap: '10px', marginTop: '8px' } }, range, lvlOut))
    }
    data.confidence = conf
    const confSection = el('div', { style: { marginTop: '14px' } },
      el('label', 'Technique confidence (tracked in Progress)'),
      el('div.muted', { style: { fontSize: '12px', marginTop: '-2px', marginBottom: '2px' } }, 'Rate how confident you feel in a technique — charts over time in Progress.'),
      conf.map((c, i) => confEntry(c, i)),
      el('datalist#tech-conf-list', techTitles.map((t) => el('option', { value: t }))),
      el('button.btn.ghost.sm', {
        style: { marginTop: '8px' },
        onclick: async () => { data.confidence.push({ name: '', level: 5 }); await persist({ confidence: data.confidence }); refresh() },
      }, '+ rate a technique'))

    return el('div.card',
      el('div.exname', `${sport.name} session`),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Tap the ● to tag each item: ✓ went right · ✗ went wrong'),
      el('div.grid2',
        field('Rounds', 'rounds', 'e.g. 5', 'numeric'),
        field('Time (min)', 'minutes', 'e.g. 60', 'numeric')),
      field('Main technique to work on', 'mainFocus', 'e.g. knee-cut passing', 'text'),
      cfg.kinds.map((k) => kindSection(k)),
      confSection,
      field('Session notes', 'notes', 'Partners, rolls, how it felt…', 'text', true))
  }

  function boulderingCard(sport, session) {
    const b = session?.bouldering || { minutes: '', grades: '', notes: '' }
    const save = async (patch) => {
      const id = await ensureSession(sport)
      const cur = (await db.get('sessions', id)).bouldering || {}
      await db.update('sessions', id, { bouldering: { ...cur, ...patch } })
    }
    const fieldB = (labelText, key, ph, ta) => {
      let val = b[key] ?? ''
      const input = (ta ? el('textarea', { placeholder: ph }) : el('input', { inputmode: key === 'minutes' ? 'numeric' : 'text', placeholder: ph }))
      input.value = val
      input.addEventListener('input', (e) => (val = e.target.value))
      input.addEventListener('blur', () => save({ [key]: val }))
      return el('div', { style: { marginTop: '10px' } }, el('label', labelText), input)
    }
    return el('div.card',
      el('div.exname', `${sport.name} session`),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Logged as a back / grip day'),
      fieldB('Session time (minutes)', 'minutes', ''),
      fieldB('Grades climbed', 'grades', 'e.g. V3, V4, V4, V5 flash'),
      fieldB('Notes', 'notes', 'Projects, skin, grip fatigue…', true))
  }

  function cardioCard(sport, session) {
    const c = session?.cardio || { distance: '', minutes: '', notes: '' }
    const save = async (patch) => {
      const id = await ensureSession(sport)
      const cur = (await db.get('sessions', id)).cardio || {}
      await db.update('sessions', id, { cardio: { ...cur, ...patch } })
    }
    const fieldC = (labelText, key, ph, mode, ta) => {
      let val = c[key] ?? ''
      const input = (ta ? el('textarea', { placeholder: ph }) : el('input', { inputmode: mode || 'text', placeholder: ph }))
      input.value = val
      input.addEventListener('input', (e) => (val = e.target.value))
      input.addEventListener('blur', () => save({ [key]: val }))
      return el('div', { style: { marginTop: '10px' } }, el('label', labelText), input)
    }
    return el('div.card',
      el('div.exname', `${sport.name} session`),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Cardio — distance, time, notes'),
      fieldC('Distance (km)', 'distance', 'e.g. 5.0', 'decimal'),
      fieldC('Time (minutes)', 'minutes', 'e.g. 28', 'numeric'),
      fieldC('Notes', 'notes', 'Route, RPE, how it felt…', 'text', true))
  }

  // ---- Skill session form (stretching / calisthenics) ------------------------
  // Per session: tick the named skills you worked + an optional numeric metric
  // (hold seconds / reps / depth or 1–10 rating). Stored on the session record
  // as `skills: [{ name, value }]` — charted over time in Progress.
  function skillsCard(sport, session) {
    const logged = Array.isArray(session?.skills) ? session.skills.map((s) => ({ ...s })) : []
    const byName = {}
    for (const s of logged) byName[s.name] = s
    const names = [...(sport.skills || [])]
    for (const s of logged) if (!names.includes(s.name)) names.push(s.name) // historical extras

    const persist = async () => {
      const id = await ensureSession(sport)
      await db.update('sessions', id, { skills: logged.map((s) => ({ ...s })) })
    }

    const hint = sport.kind === 'stretching' ? 'sec / depth' : 'reps / sec'
    const row = (name) => {
      const entry = byName[name]
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!entry
      const val = el('input', { inputmode: 'decimal', placeholder: hint, value: entry?.value ?? '', disabled: !entry })
      cb.addEventListener('change', async () => {
        if (cb.checked) {
          const e = { name, value: val.value === '' ? null : Number(val.value) }
          byName[name] = e; logged.push(e); val.disabled = false
        } else {
          const i = logged.indexOf(byName[name])
          if (i >= 0) logged.splice(i, 1)
          delete byName[name]; val.value = ''; val.disabled = true
        }
        await persist()
      })
      val.addEventListener('blur', async () => {
        const e = byName[name]
        if (!e) return
        e.value = val.value === '' ? null : Number(val.value)
        await persist()
      })
      return el('div.row', { style: { gap: '8px', marginTop: '8px' } },
        el('label.chk', { style: { flex: '1 1 auto' } }, cb, el('span', name)),
        el('div', { style: { flex: '0 0 120px' } }, val))
    }

    return el('div.card',
      el('div.exname', `${sport.name} session`),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Tick the skills you worked · optional metric — charted in Progress'),
      names.length ? names.map(row)
        : el('div.muted', { style: { fontSize: '13px', marginTop: '8px' } }, 'No skills defined yet — add some via “Manage activities”.'))
  }

  function notesCard(sport, session) {
    let val = session?.notes || ''
    const ta = el('textarea', { placeholder: 'How it felt, partners, conditions…' })
    ta.value = val
    ta.addEventListener('input', (e) => (val = e.target.value))
    ta.addEventListener('blur', async () => { const id = await ensureSession(sport); await db.update('sessions', id, { notes: val }) })
    return el('div.card', el('label', 'Session notes'), ta)
  }

  // ---- Recent sessions for the selected sport ---------------------------------
  function sessionSummary(s, kind) {
    if (kind === 'martial') { const m = s.martial || {}; return [m.rounds && `${m.rounds} rounds`, m.minutes && `${m.minutes} min`].filter(Boolean).join(' · ') }
    if (kind === 'bouldering') { const b = s.bouldering || {}; return [b.minutes && `${b.minutes} min`, b.grades].filter(Boolean).join(' · ') }
    if (kind === 'running') { const c = s.cardio || {}; return [c.distance && `${c.distance} km`, c.minutes && `${c.minutes} min`].filter(Boolean).join(' · ') }
    return (s.skills || []).map((x) => x.name).filter(Boolean).join(', ')
  }

  function recentCard(sport, sessions) {
    const past = sessions
      .filter((s) => s.dayType === sport.name && s.date !== date)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 8)
    if (!past.length) return null
    return el('div.card',
      el('h2', { style: { marginTop: 0 } }, 'Recent sessions'),
      past.map((s) => el('div.kv', { style: { cursor: 'pointer' }, onclick: () => { date = s.date; refresh() } },
        el('span', fmtDate(s.date)),
        el('span.muted', sessionSummary(s, sport.kind) || '—'))))
  }

  // ---- Activity manager (add / rename / reorder / configure / delete) --------
  async function moveSport(names, idx, dir) {
    const j = idx + dir
    if (j < 0 || j >= names.length) return
    const arr = [...names]
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    await db.saveSportOrder(arr); refresh()
  }

  function sportRow(sport, idx, sports) {
    const names = sports.map((s) => s.name)

    const nameInput = el('input', { value: sport.name })
    nameInput.addEventListener('change', async () => {
      const nn = nameInput.value.trim()
      if (!nn || nn === sport.name) { nameInput.value = sport.name; return }
      const ok = await db.renameSport(sport.name, nn)
      if (!ok) { ctx.toast('Name taken or invalid'); nameInput.value = sport.name; return }
      if (sportName === sport.name) sportName = nn
      ctx.toast('Renamed'); refresh()
    })

    const kindSel = el('select', KINDS.map((k) => el('option', { value: k, selected: sport.kind === k }, k)))
    kindSel.addEventListener('change', async () => {
      const k = kindSel.value
      await db.updateSport(sport.name, { kind: k, martial: k === 'martial' ? (sport.martial || { unit: 'rounds', kinds: [] }) : null })
      ctx.toast('Updated'); refresh()
    })

    const remove = async () => {
      const ok = await db.deleteSport(sport.name)
      if (!ok) { ctx.toast('Has logged sessions — rename it instead'); return }
      if (sportName === sport.name) sportName = null
      ctx.toast('Activity deleted'); refresh()
    }

    let extra = null
    if (sport.kind === 'martial') {
      let kinds = [...((sport.martial && sport.martial.kinds) || [])]
      const boxes = MARTIAL_KINDS.map((k) => {
        const cb = el('input', { type: 'checkbox' }); cb.checked = kinds.includes(k)
        cb.addEventListener('change', async () => {
          const s = new Set(kinds); cb.checked ? s.add(k) : s.delete(k)
          kinds = MARTIAL_KINDS.filter((x) => s.has(x))
          await db.updateSport(sport.name, { martial: { unit: (sport.martial && sport.martial.unit) || 'rounds', kinds } })
        })
        return el('label.chk', cb, el('span', KIND_LABEL[k] || k))
      })
      extra = el('div', { style: { marginTop: '8px' } },
        el('div.muted', { style: { fontSize: '12px', marginBottom: '4px' } }, 'Tagged lists this session shows:'),
        el('div.spread', boxes))
    } else if (sport.kind === 'stretching' || sport.kind === 'calisthenics') {
      const skillsInput = el('input', { value: (sport.skills || []).join(', '), placeholder: 'Skills — comma separated' })
      skillsInput.addEventListener('change', async () => {
        const skills = skillsInput.value.split(',').map((s) => s.trim()).filter(Boolean)
        await db.updateSport(sport.name, { skills })
        ctx.toast('Skills updated')
      })
      extra = el('div', { style: { marginTop: '8px' } },
        el('label', 'Tracked skills'), skillsInput)
    }

    return el('div.card',
      el('div.row.between',
        el('div', { style: { flex: '1 1 auto' } }, nameInput),
        el('div.spread',
          el('button.btn.ghost.sm', { onclick: () => moveSport(names, idx, -1), disabled: idx === 0 }, '↑'),
          el('button.btn.ghost.sm', { onclick: () => moveSport(names, idx, 1), disabled: idx === sports.length - 1 }, '↓'),
          el('button.btn.danger.sm', { onclick: remove }, '✕'))),
      el('div', { style: { marginTop: '8px' } },
        el('label', 'Kind'), kindSel),
      extra)
  }

  function manageView(sports) {
    const addName = el('input', { placeholder: 'New activity — e.g. Wrestling' })
    const addKind = el('select', KINDS.map((k) => el('option', { value: k }, k)))
    const add = async () => {
      const nm = addName.value.trim()
      if (!nm) { ctx.toast('Name the activity'); return }
      const created = await db.addSport({ name: nm, kind: addKind.value })
      if (!created) { ctx.toast('Name already exists'); return }
      ctx.toast('Activity added'); refresh()
    }
    return el('div',
      el('div.row.between', { style: { marginBottom: '6px' } },
        el('h1', { style: { margin: 0 } }, 'Manage activities'),
        el('button.btn.ghost.sm', { onclick: () => { managing = false; refresh() } }, 'Done')),
      el('p.sub', 'Add, rename, reorder or configure your sports. Renaming carries over your logged history. Weekly targets are set on the Readiness tab.'),
      ...sports.map((s, i) => sportRow(s, i, sports)),
      el('div.card', { style: { marginTop: '12px' } },
        el('div.exname', { style: { marginBottom: '8px' } }, 'Add an activity'),
        addName,
        el('div', { style: { marginTop: '8px' } },
          el('label', 'Kind'), addKind),
        el('div', { style: { marginTop: '10px' } },
          el('button.btn.primary', { onclick: add }, '+ Add activity'))))
  }

  async function copyForAI(sport, session) {
    if (!session) { ctx.toast('Nothing logged yet'); return }
    const readiness = (await db.all('readiness')).find((r) => r.date === date) || null
    const meta = {
      martial: sport.kind === 'martial' ? sport.name : undefined,
      martialCfg: sport.kind === 'martial' ? sport.martial : null,
      bouldering: sport.kind === 'bouldering' ? true : undefined,
      cardio: sport.kind === 'running' ? true : undefined,
    }
    const md = sessionMarkdown({ session, sets: [], readiness, meta })
    ctx.toast((await copyToClipboard(md)) ? 'Copied — paste into any AI' : 'Copy failed')
  }

  // ---- Render ----------------------------------------------------------------
  async function refresh() {
    const sports = await db.getSports()
    if (!sportName || !sports.some((s) => s.name === sportName)) sportName = sports[0]?.name || null

    if (managing) { clear(root); mount(root, manageView(sports)); window.scrollTo(0, 0); return }

    const sport = sports.find((s) => s.name === sportName) || null
    const sessions = await db.all('sessions')
    const session = sport ? sessions.find((s) => s.date === date && s.dayType === sport.name) : null
    const techTitles = sport?.kind === 'martial' ? (await db.all('techniques')).map((t) => t.title).filter(Boolean) : []

    const dateInput = el('input', { type: 'date', value: date })
    dateInput.addEventListener('change', (e) => { date = e.target.value; refresh() })
    const sportSelect = el('select', sports.map((s) => el('option', { value: s.name, selected: s.name === sportName }, s.name)))
    sportSelect.addEventListener('change', (e) => { sportName = e.target.value; refresh() })

    let body = null
    if (sport) {
      body = sport.kind === 'martial' ? martialCard(sport, session, techTitles)
        : sport.kind === 'bouldering' ? boulderingCard(sport, session)
        : sport.kind === 'running' ? cardioCard(sport, session)
        : skillsCard(sport, session)
    }

    if (wikiOpen && !wikiNode) wikiNode = await TechniquesView(ctx)

    clear(root)
    mount(root,
      el('h1', 'Sports'),
      el('p.sub', 'Martial arts, running, bouldering, stretching & calisthenics — everything that isn’t the gym.'),
      el('div.card',
        el('div.grid2',
          el('div', el('label', 'Date'), dateInput),
          el('div', el('label', 'Activity'), sportSelect)),
        el('div.spread', { style: { marginTop: '12px' } },
          el('button.btn.ghost.sm', { onclick: () => copyForAI(sport, session) }, '📋 Copy for AI'),
          el('button.btn.ghost.sm', { onclick: () => { managing = true; refresh() } }, '⚙ Manage activities'),
          el('button.btn.ghost.sm', { onclick: () => { wikiOpen = !wikiOpen; refresh() } }, wikiOpen ? '📚 Hide wiki' : '📚 Technique wiki'),
          session && el('button.btn.danger.sm', {
            onclick: async () => { if (confirm('Delete this session and everything logged in it?')) { await db.deleteSession(session.id); ctx.toast('Session deleted'); refresh() } },
          }, '🗑 Delete session'))),
      body,
      sport && notesCard(sport, session),
      sport && recentCard(sport, sessions),
      wikiOpen && el('div', { style: { marginTop: '18px', borderTop: '1px solid var(--border)', paddingTop: '14px' } }, wikiNode),
    )
  }

  await refresh()
  return root
}
