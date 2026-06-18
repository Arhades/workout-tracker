import { el, clear, mount, copyToClipboard } from '../dom.js'
import * as db from '../db.js'
import { WARMUP, KIND_LABEL, EXERCISE_LIBRARY } from '../program.js'
import { createRestTimer } from '../components/timer.js'
import { buildSuggestions } from '../recommend.js'
import { sessionMarkdown } from '../aiReport.js'

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WD_OPTS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MARTIAL_KINDS = ['position', 'submission', 'sweep', 'escape', 'throw', 'technique', 'combo', 'defense']
// Auto-pick the day whose configured weekday matches the date; else the first day.
const defaultDayFor = (dateStr, days) => {
  const wd = WEEKDAY_NAMES[new Date(dateStr + 'T12:00:00').getDay()]
  return (days.find((d) => d.weekday === wd) || days[0])?.name || ''
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise'

export async function LogView(ctx) {
  let date = db.todayISO()
  let dayType = null // resolved on each refresh from the (editable) day list
  const extraRows = {} // `${key}|${side}` -> extra count
  let editing = false // program-edit mode for the current day
  let managingDays = false // day-type manager panel
  let showSuggestions = true
  const timer = createRestTimer(ctx.timerHost)
  const root = el('div')

  // Lazily create the session only when the first set/note is entered.
  let creating = null
  async function ensureSession() {
    const existing = (await db.all('sessions')).find((s) => s.date === date && s.dayType === dayType)
    if (existing) return existing.id
    if (creating) return creating
    creating = add()
    const id = await creating
    creating = null
    return id
    async function add() {
      const again = (await db.all('sessions')).find((s) => s.date === date && s.dayType === dayType)
      if (again) return again.id
      const meta = (await db.getProgram())[dayType]
      return db.add('sessions', {
        date, dayType, notes: '',
        bouldering: meta?.bouldering ? { minutes: '', grades: '', notes: '' } : null,
        martial: meta?.martial ? {} : null,
        cardio: meta?.cardio ? { distance: '', minutes: '', notes: '' } : null,
      })
    }
  }

  // Refresh after a structural change, but never steal focus from an active input.
  function scheduleRefresh() {
    setTimeout(() => {
      const a = document.activeElement
      if (root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return
      refresh()
    }, 0)
  }

  // ---- Set logging (unchanged behaviour) ------------------------------------
  function setRow({ existing, exerciseKey, exerciseName, setIndex, side, isDropSet, showRir }) {
    const num = (v) => (v === '' || v == null ? null : Number(v))
    let weight = existing?.weight ?? ''
    let reps = existing?.reps ?? ''
    let rir = existing?.rir ?? ''
    const dot = el('span.done-dot' + (num(reps) != null ? '.on' : ''))

    async function persist() {
      const empty = weight === '' && reps === '' && rir === ''
      if (existing) {
        if (empty) { await db.del('sets', existing.id); scheduleRefresh(); return }
        await db.update('sets', existing.id, { weight: num(weight), reps: num(reps), rir: num(rir) })
      } else {
        if (empty) return
        const sessionId = await ensureSession()
        await db.add('sets', {
          sessionId, exerciseKey, exerciseName, setIndex, side: side ?? null,
          isDropSet: !!isDropSet, weight: num(weight), reps: num(reps), rir: num(rir), order: Date.now(),
        })
        scheduleRefresh() // new row -> reveal next empty slot + update hints
      }
    }

    const mk = (ph, mode, get, set) => el('input', {
      inputmode: mode, placeholder: ph, value: get(),
      oninput: (e) => { set(e.target.value); dot.classList.toggle('on', num(reps) != null) },
      onblur: persist,
    })
    const grid = el('div.' + (showRir ? 'grid3' : 'grid2'), { style: { flex: 1 } },
      mk('kg', 'decimal', () => weight, (v) => (weight = v)),
      mk('reps', 'numeric', () => reps, (v) => (reps = v)),
      showRir && mk('RIR', 'numeric', () => rir, (v) => (rir = v)),
    )
    return el('div.setrow' + (num(reps) != null ? '.logged' : ''),
      dot,
      el('span.idx', isDropSet ? '↓' : String(setIndex + 1)),
      grid,
    )
  }

  function sideColumn(ex, side, savedBySide, drop) {
    const planned = ex.sets
    const k = `${ex.key}|${side}`
    const saved = savedBySide[side] || []
    const maxIdx = saved.reduce((m, s) => Math.max(m, s.setIndex + 1), 0)
    const count = Math.max(planned + (extraRows[k] || 0), maxIdx)
    const rows = Array.from({ length: count }, (_, i) =>
      setRow({
        existing: saved.find((s) => s.setIndex === i) || null,
        exerciseKey: ex.key, exerciseName: ex.name, setIndex: i, side,
        isDropSet: drop && i >= planned, showRir: false,
      }))
    return el('div',
      el('div.side-tag.side-' + side, { style: { width: 'auto', fontSize: '12px', marginBottom: '4px' } }, side === 'L' ? 'LEFT' : 'RIGHT'),
      rows,
      el('button.btn.ghost.sm', { style: { marginTop: '6px' }, onclick: () => { extraRows[k] = (extraRows[k] || 0) + 1; refresh() } }, drop ? '+ drop' : '+ set'),
    )
  }

  function exerciseCard(ex, setsForEx) {
    const bySide = { L: [], R: [], B: [] }
    for (const s of setsForEx) bySide[s.side || 'B'].push(s)

    let body
    if (ex.unilateral) {
      const leftReps = bySide.L.reduce((s, x) => s + (x.reps || 0), 0)
      body = el('div', { style: { marginTop: '6px' } },
        el('div.muted', { style: { fontSize: '12px', marginBottom: '8px' } }, 'Left first → drop set to failure. Right capped to left’s reps.'),
        el('div.grid2', { style: { alignItems: 'start' } },
          sideColumn(ex, 'L', bySide, true),
          sideColumn(ex, 'R', bySide, false),
        ),
        leftReps > 0 && el('div.muted', { style: { fontSize: '12px', marginTop: '8px' } },
          'Left total: ', el('strong', { style: { color: 'var(--left)' } }, String(leftReps)), ' reps — cap the right side here.'),
      )
    } else {
      const planned = ex.sets
      const k = `${ex.key}|`
      const maxIdx = bySide.B.reduce((m, s) => Math.max(m, s.setIndex + 1), 0)
      const count = Math.max(planned + (extraRows[k] || 0), maxIdx)
      const rows = Array.from({ length: count }, (_, i) =>
        setRow({
          existing: bySide.B.find((s) => s.setIndex === i) || null,
          exerciseKey: ex.key, exerciseName: ex.name, setIndex: i, side: null,
          isDropSet: false, showRir: !ex.toFailure && ex.rir !== '—',
        }))
      body = el('div', { style: { marginTop: '4px' } },
        rows,
        el('button.btn.ghost.sm', { style: { marginTop: '8px' }, onclick: () => { extraRows[k] = (extraRows[k] || 0) + 1; refresh() } }, '+ set'))
    }

    const restMin = `${Math.floor(ex.rest / 60)}:${String(ex.rest % 60).padStart(2, '0')}`
    return el('div.card',
      el('div.exhead',
        el('div',
          el('div.exname', ex.name),
          el('div.exmeta', `${ex.muscle} · ${ex.sets} sets · RIR ${ex.rir}`)),
        el('div.spread', { style: { justifyContent: 'flex-end' } },
          ex.unilateral && el('span.pill.uni', 'UNI L/R'),
          ex.toFailure && el('span.pill.fail', 'FAILURE'),
          ex.optional && el('span.pill.opt', 'OPT'))),
      body,
      ex.note && el('div.exnote', ex.note),
      el('div.row', { style: { marginTop: '10px' } },
        el('button.btn.sm', { onclick: () => timer.start(ex.rest, ex.name.split(' ').slice(0, 2).join(' ')) }, `⏱ Rest ${restMin}`)),
    )
  }

  // ---- Program editor (add / remove / reorder / tweak exercises) -------------
  function uniqueKey(base, exercises) {
    let k = base, n = 2
    const taken = new Set(exercises.map((e) => e.key))
    while (taken.has(k)) k = `${base}_${n++}`
    return k
  }

  async function saveProgram(exercises) { await db.saveDay(dayType, exercises) }

  function editorCard(ex, idx, exercises) {
    const commit = async () => { await saveProgram(exercises) } // field edits: save, no re-render
    const move = async (delta) => {
      const j = idx + delta
      if (j < 0 || j >= exercises.length) return
      ;[exercises[idx], exercises[j]] = [exercises[j], exercises[idx]]
      await saveProgram(exercises); refresh()
    }
    const remove = async () => { exercises.splice(idx, 1); await saveProgram(exercises); refresh() }

    const text = (ph, get, set) => el('input', { placeholder: ph, value: get(), oninput: (e) => set(e.target.value), onblur: commit })
    const numField = (ph, mode, get, set) => el('input', { inputmode: mode, placeholder: ph, value: get(), oninput: (e) => set(e.target.value), onblur: commit })
    const check = (labelText, get, set) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!get()
      cb.addEventListener('change', async (e) => { set(e.target.checked); await commit() })
      return el('label.chk', cb, el('span', labelText))
    }

    return el('div.card.tight',
      el('div.row.between',
        text('Exercise name', () => ex.name, (v) => (ex.name = v)),
        el('div.spread', { style: { flex: '0 0 auto', marginLeft: '8px' } },
          el('button.btn.ghost.sm', { onclick: () => move(-1) }, '↑'),
          el('button.btn.ghost.sm', { onclick: () => move(1) }, '↓'),
          el('button.btn.danger.sm', { onclick: remove }, '✕'))),
      el('div', { style: { marginTop: '8px' } }, text('Muscle', () => ex.muscle || '', (v) => (ex.muscle = v))),
      el('div.grid3', { style: { marginTop: '8px' } },
        el('div', el('label', 'Sets'), numField('3', 'numeric', () => ex.sets ?? '', (v) => (ex.sets = v === '' ? '' : Number(v)))),
        el('div', el('label', 'RIR'), text('1–2', () => ex.rir ?? '', (v) => (ex.rir = v))),
        el('div', el('label', 'Rest (s)'), numField('240', 'numeric', () => ex.rest ?? '', (v) => (ex.rest = v === '' ? '' : Number(v))))),
      el('div.spread', { style: { marginTop: '8px' } },
        check('Unilateral L/R', () => ex.unilateral, (v) => (ex.unilateral = v || undefined)),
        check('To failure', () => ex.toFailure, (v) => (ex.toFailure = v || undefined)),
        check('Optional', () => ex.optional, (v) => (ex.optional = v || undefined))),
    )
  }

  function addControls(exercises) {
    // Add from library
    const opts = [el('option', { value: '' }, '+ Add from library…')]
    let lastMuscle = null
    for (const e of EXERCISE_LIBRARY) {
      const label = (e.muscle !== lastMuscle ? `[${e.muscle}] ` : '') + e.name
      lastMuscle = e.muscle
      opts.push(el('option', { value: e.key }, label))
    }
    const sel = el('select', opts)
    sel.addEventListener('change', async (e) => {
      const lib = EXERCISE_LIBRARY.find((x) => x.key === e.target.value)
      if (!lib) return
      exercises.push({ ...lib, key: uniqueKey(lib.key, exercises) })
      await saveProgram(exercises); refresh()
    })

    // Add a blank custom exercise
    const addCustom = async () => {
      const name = 'New exercise'
      exercises.push({ key: uniqueKey(slug(name), exercises), name, muscle: '', sets: 3, rir: '1–2', rest: 240 })
      await saveProgram(exercises); refresh()
    }

    return el('div.card',
      el('label', 'Add exercise'),
      sel,
      el('button.btn.full', { style: { marginTop: '10px' }, onclick: addCustom }, '+ Add a custom exercise'))
  }

  // ---- Day-type manager (add / rename / reorder / configure / delete) --------
  async function moveDay(dayNames, idx, dir) {
    const j = idx + dir
    if (j < 0 || j >= dayNames.length) return
    const arr = [...dayNames]
    ;[arr[idx], arr[j]] = [arr[j], arr[idx]]
    await db.saveDayTypeOrder(arr); refresh()
  }

  async function removeDay(name) {
    const ok = await db.deleteDayType(name)
    if (!ok) { ctx.toast('Has logged sessions — rename it instead'); return }
    if (dayType === name) dayType = null
    ctx.toast('Day deleted'); refresh()
  }

  function dayRow(program, dayNames, name) {
    const meta = program[name]
    const idx = dayNames.indexOf(name)

    const nameInput = el('input', { value: name })
    nameInput.addEventListener('change', async () => {
      const nn = nameInput.value.trim()
      if (!nn || nn === name) { nameInput.value = name; return }
      const ok = await db.renameDayType(name, nn)
      if (!ok) { ctx.toast('Name taken or invalid'); nameInput.value = name; return }
      if (dayType === name) dayType = nn
      ctx.toast('Renamed'); refresh()
    })

    const kindSel = el('select', ['lifting', 'bouldering', 'martial', 'cardio'].map((k) => el('option', { value: k, selected: meta.kind === k }, k)))
    kindSel.addEventListener('change', async () => {
      const k = kindSel.value
      await db.updateDayType(name, { kind: k, martial: k === 'martial' ? (meta.martialCfg || { unit: 'rounds', kinds: [] }) : null })
      ctx.toast('Updated'); refresh()
    })

    const wdSel = el('select', WD_OPTS.map((w) => el('option', { value: w, selected: (meta.weekday || '') === w }, w || '— weekday —')))
    wdSel.addEventListener('change', async () => { await db.updateDayType(name, { weekday: wdSel.value }); ctx.toast('Updated') })

    let kindsBlock = null
    if (meta.kind === 'martial') {
      let kinds = [...((meta.martialCfg && meta.martialCfg.kinds) || [])]
      const boxes = MARTIAL_KINDS.map((k) => {
        const cb = el('input', { type: 'checkbox' }); cb.checked = kinds.includes(k)
        cb.addEventListener('change', async () => {
          const s = new Set(kinds); cb.checked ? s.add(k) : s.delete(k)
          kinds = MARTIAL_KINDS.filter((x) => s.has(x))
          await db.updateDayType(name, { martial: { unit: (meta.martialCfg && meta.martialCfg.unit) || 'rounds', kinds } })
        })
        return el('label.chk', cb, el('span', KIND_LABEL[k] || k))
      })
      kindsBlock = el('div', { style: { marginTop: '8px' } },
        el('div.muted', { style: { fontSize: '12px', marginBottom: '4px' } }, 'Tagged lists this session shows:'),
        el('div.spread', boxes))
    }

    return el('div.card',
      el('div.row.between',
        el('div', { style: { flex: '1 1 auto' } }, nameInput),
        el('div.spread',
          el('button.btn.ghost.sm', { onclick: () => moveDay(dayNames, idx, -1), disabled: idx === 0 }, '↑'),
          el('button.btn.ghost.sm', { onclick: () => moveDay(dayNames, idx, 1), disabled: idx === dayNames.length - 1 }, '↓'),
          el('button.btn.danger.sm', { onclick: () => removeDay(name) }, '✕'))),
      el('div.grid2', { style: { marginTop: '8px' } },
        el('div', el('label', 'Kind'), kindSel),
        el('div', el('label', 'Weekday'), wdSel)),
      kindsBlock)
  }

  function manageDaysView(program, dayNames) {
    const addName = el('input', { placeholder: 'New day name — e.g. Upper' })
    const addKind = el('select', ['lifting', 'bouldering', 'martial', 'cardio'].map((k) => el('option', { value: k }, k)))
    const addWd = el('select', WD_OPTS.map((w) => el('option', { value: w }, w || '— weekday —')))
    const add = async () => {
      const nm = addName.value.trim()
      if (!nm) { ctx.toast('Name the day'); return }
      const k = addKind.value
      const created = await db.addDayType({ name: nm, kind: k, weekday: addWd.value, martial: k === 'martial' ? { unit: 'rounds', kinds: [] } : null })
      if (!created) { ctx.toast('Name already exists'); return }
      ctx.toast('Day added'); refresh()
    }
    return el('div',
      el('div.row.between', { style: { marginBottom: '6px' } },
        el('h1', { style: { margin: 0 } }, 'Manage days'),
        el('button.btn.ghost.sm', { onclick: () => { managingDays = false; refresh() } }, 'Done')),
      el('p.sub', 'Add, rename, reorder or configure your session days. Renaming carries over your logged history. A lifting day’s exercises are edited from its Log screen (“Edit exercises”).'),
      ...dayNames.map((n) => dayRow(program, dayNames, n)),
      el('div.card', { style: { marginTop: '12px' } },
        el('div.exname', { style: { marginBottom: '8px' } }, 'Add a day'),
        addName,
        el('div.grid2', { style: { marginTop: '8px' } },
          el('div', el('label', 'Kind'), addKind),
          el('div', el('label', 'Weekday'), addWd)),
        el('div', { style: { marginTop: '10px' } },
          el('button.btn.primary', { onclick: add }, '+ Add day'))))
  }

  // ---- Martial-arts session form --------------------------------------------
  function martialCard(session, techTitles = [], cfg = { kinds: [] }) {
    const m = session?.martial || {}
    const data = { rounds: m.rounds ?? '', minutes: m.minutes ?? '', mainFocus: m.mainFocus ?? '', notes: m.notes ?? '' }
    for (const k of cfg.kinds) data[k] = Array.isArray(m[k]) ? m[k].map((it) => ({ ...it })) : []
    const conf = Array.isArray(m.confidence) ? m.confidence.map((c) => ({ ...c })) : []

    const persist = async (patch) => {
      const id = await ensureSession()
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
      el('div.exname', `${dayType} session`),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Tap the ● to tag each item: ✓ went right · ✗ went wrong'),
      el('div.grid2',
        field('Rounds', 'rounds', 'e.g. 5', 'numeric'),
        field('Time (min)', 'minutes', 'e.g. 60', 'numeric')),
      field('Main technique to work on', 'mainFocus', 'e.g. knee-cut passing', 'text'),
      cfg.kinds.map((k) => kindSection(k)),
      confSection,
      field('Session notes', 'notes', 'Partners, rolls, how it felt…', 'text', true))
  }

  async function boulderingCard(session) {
    const b = session?.bouldering || { minutes: '', grades: '', notes: '' }
    const save = async (patch) => {
      const id = await ensureSession()
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
      el('div.exname', 'Bouldering session'),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Logged as a back / grip day'),
      fieldB('Session time (minutes)', 'minutes', ''),
      fieldB('Grades climbed', 'grades', 'e.g. V3, V4, V4, V5 flash'),
      fieldB('Notes', 'notes', 'Projects, skin, grip fatigue…', true))
  }

  async function cardioCard(session) {
    const c = session?.cardio || { distance: '', minutes: '', notes: '' }
    const save = async (patch) => {
      const id = await ensureSession()
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
      el('div.exname', `${dayType} session`),
      el('div.exmeta', { style: { marginBottom: '4px' } }, 'Cardio — distance, time, notes'),
      fieldC('Distance (km)', 'distance', 'e.g. 5.0', 'decimal'),
      fieldC('Time (minutes)', 'minutes', 'e.g. 28', 'numeric'),
      fieldC('Notes', 'notes', 'Route, RPE, how it felt…', 'text', true))
  }

  function notesCard(session) {
    let val = session?.notes || ''
    const ta = el('textarea', { placeholder: 'How it felt, pain, swaps…' })
    ta.value = val
    ta.addEventListener('input', (e) => (val = e.target.value))
    ta.addEventListener('blur', async () => { const id = await ensureSession(); await db.update('sessions', id, { notes: val }) })
    return el('div.card', el('label', 'Session notes'), ta)
  }

  function suggestionsCard(items) {
    if (!items.length) return null
    return el('div.card',
      el('div.row.between',
        el('strong', { style: { fontSize: '14px' } }, '💡 Suggestions'),
        el('button.btn.ghost.sm', { onclick: () => { showSuggestions = false; refresh() } }, 'Hide')),
      el('div.muted', { style: { fontSize: '11px', margin: '2px 0 8px' } }, 'Offline rules, not AI — for real critique use “Copy for AI”.'),
      items.map((s) => el('div', { style: { marginTop: '6px' } },
        el('div', { style: { fontSize: '13px' } }, s.text),
        s.sub && el('div.muted', { style: { fontSize: '12px' } }, s.sub))))
  }

  async function copyForAI(session) {
    if (!session) { ctx.toast('Nothing logged yet'); return }
    const sets = await db.byIndex('sets', 'sessionId', session.id)
    const readiness = (await db.all('readiness')).find((r) => r.date === date) || null
    const meta = (await db.getProgram())[session.dayType] || null
    const md = sessionMarkdown({ session, sets, readiness, meta })
    ctx.toast((await copyToClipboard(md)) ? 'Copied — paste into any AI' : 'Copy failed')
  }

  // ---- Render ----------------------------------------------------------------
  async function refresh() {
    const program = await db.getProgram()
    const dayNames = Object.keys(program)
    const days = dayNames.map((n) => ({ name: n, weekday: program[n].weekday }))
    if (!dayType || !dayNames.includes(dayType)) dayType = defaultDayFor(date, days)

    if (managingDays) { clear(root); mount(root, manageDaysView(program, dayNames)); window.scrollTo(0, 0); return }

    const dayMeta = program[dayType] || {}
    const exercises = dayMeta.exercises || []
    const isBouldering = dayMeta.kind === 'bouldering'
    const isMartialDay = dayMeta.kind === 'martial'
    const isCardio = dayMeta.kind === 'cardio'
    const isLifting = !isBouldering && !isMartialDay && !isCardio

    const session = (await db.all('sessions')).find((s) => s.date === date && s.dayType === dayType)
    const sets = session ? await db.byIndex('sets', 'sessionId', session.id) : []
    const isRestDay = new Date(date + 'T12:00:00').getDay() === 0
    const loggedCount = sets.filter((s) => s.reps != null).length
    const techTitles = isMartialDay ? (await db.all('techniques')).map((t) => t.title).filter(Boolean) : []

    let suggestions = []
    if (isLifting && showSuggestions && !editing) {
      const [allSessions, allSets] = await Promise.all([db.all('sessions'), db.all('sets')])
      suggestions = buildSuggestions({ dayType, exercises, sessions: allSessions, sets: allSets, today: date })
    }

    const dateInput = el('input', { type: 'date', value: date })
    dateInput.addEventListener('change', (e) => { date = e.target.value; dayType = null; editing = false; showSuggestions = true; for (const k in extraRows) delete extraRows[k]; refresh() })
    const daySelect = el('select', dayNames.map((d) => el('option', { value: d, selected: d === dayType }, d)))
    daySelect.addEventListener('change', (e) => { dayType = e.target.value; editing = false; showSuggestions = true; for (const k in extraRows) delete extraRows[k]; refresh() })

    clear(root)
    mount(root,
      el('h1', 'Log Workout'),
      el('p.sub', loggedCount > 0 ? `${loggedCount} sets logged` : 'Pick a day and start logging. Lifting + a martial-arts session can share one date.'),
      el('div.card',
        el('div.grid2',
          el('div', el('label', 'Date'), dateInput),
          el('div', el('label', 'Session'), daySelect)),
        el('div.muted', { style: { fontSize: '12px', marginTop: '10px' } },
          dayMeta.weekday && el('span.pill', dayMeta.weekday), ' ',
          isRestDay ? '🛌 Sunday is a rest day — logging anyway is fine.' : ''),
        el('div.spread', { style: { marginTop: '12px' } },
          el('button.btn.ghost.sm', { onclick: () => copyForAI(session) }, '📋 Copy for AI'),
          el('button.btn.ghost.sm', { onclick: () => { managingDays = true; refresh() } }, '🗓 Manage days'),
          isLifting && el('button.btn.ghost.sm', { onclick: () => { editing = !editing; refresh() } }, editing ? '✓ Done editing' : '✎ Edit exercises'),
          isLifting && dayMeta.customised && dayMeta.hasDefault && el('button.btn.ghost.sm', {
            onclick: async () => { if (confirm(`Reset ${dayType} to the default exercises? Your logged sets are kept.`)) { await db.resetDay(dayType); editing = false; refresh() } },
          }, '↺ Reset day'),
          session && el('button.btn.danger.sm', {
            onclick: async () => { if (confirm('Delete this session and everything logged in it?')) { await db.deleteSession(session.id); ctx.toast('Session deleted'); editing = false; refresh() } },
          }, '🗑 Delete session'))),

      suggestionsCard(suggestions),

      isLifting && !editing && el('div.card.tight',
        el('strong', { style: { fontSize: '13px' } }, 'Warm-up'),
        el('div.muted', { style: { fontSize: '13px', marginTop: '2px' } }, WARMUP)),

      // Body: editor / martial / bouldering / exercises
      editing && isLifting
        ? [el('p.sub', { style: { marginTop: '4px' } }, 'Add, remove, reorder or tweak this day’s exercises. Changes are saved to this day only.'),
           exercises.map((ex, i) => editorCard(ex, i, exercises)),
           addControls(exercises)]
        : isMartialDay ? martialCard(session, techTitles, dayMeta.martialCfg)
        : isBouldering ? await boulderingCard(session)
        : isCardio ? await cardioCard(session)
        : exercises.length
          ? exercises.map((ex) => exerciseCard(ex, sets.filter((s) => s.exerciseKey === ex.key)))
          : el('div.empty', 'No exercises for this day. Tap “Edit exercises” to add some.'),

      !editing && notesCard(session),
    )
  }

  await refresh()
  return root
}
