import { el, clear, mount, copyToClipboard } from '../dom.js'
import * as db from '../db.js'
import { WARMUP } from '../program.js'
import { createRestTimer } from '../components/timer.js'
import { buildSuggestions } from '../recommend.js'
import { sessionMarkdown } from '../aiReport.js'
import { weeklyLoad, kindByDayMap } from '../load.js'
import { deloadStatus } from '../deload.js'

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WD_OPTS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// Auto-pick the day whose configured weekday matches the date; else the first day.
const defaultDayFor = (dateStr, days) => {
  const wd = WEEKDAY_NAMES[new Date(dateStr + 'T12:00:00').getDay()]
  return (days.find((d) => d.weekday === wd) || days[0])?.name || ''
}

// ---- Library autocomplete matching -------------------------------------------
// Loose token match so "one arm pull up" finds "Single-Arm Pull-Up": every query
// token must prefix-match some name/muscle token (after a small synonym map).
const SYNONYM = { one: 'single', 1: 'single', db: 'dumbbell', bb: 'barbell', ohp: 'overhead' }
const normTokens = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(Boolean).map((t) => SYNONYM[t] || t)
function libMatches(query, lib, max = 6) {
  const q = normTokens(query)
  if (!q.length) return []
  const out = []
  for (const e of lib) {
    const hay = normTokens(e.name + ' ' + (e.muscle || ''))
    if (q.every((t) => hay.some((h) => h.startsWith(t) || t.startsWith(h)))) out.push(e)
    if (out.length >= max) break
  }
  return out
}

export async function LogView(ctx) {
  let date = db.todayISO()
  let dayType = null // resolved on each refresh from the (editable) day list
  const extraRows = {} // `${key}|${side}` -> extra count
  let editing = false // program-edit mode for the current day
  let managingDays = false // day-type manager panel
  let managingLibrary = false // exercise-library manager panel
  let showSuggestions = true
  let library = [] // exercise library snapshot (refreshed each render)
  let templateExercises = [] // the day's PERMANENT exercises (program store)
  let tempExercises = [] // this date's TEMPORARY exercises (sessionExercises store)
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
      return db.add('sessions', { date, dayType, notes: '', bouldering: null, martial: null, cardio: null })
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

  // ---- Persisting the day's exercise lists -----------------------------------
  const stripTemp = (list) => list.map(({ temp, ...e }) => e)
  async function savePermanent() { await db.saveDay(dayType, templateExercises) }
  async function saveTemporary() { await db.saveSessionExercises(date, dayType, stripTemp(tempExercises)) }
  async function saveListFor(ex) { ex.temp ? await saveTemporary() : await savePermanent() }

  // ---- Set logging ------------------------------------------------------------
  // A logged set is weight + reps only (the per-set RIR input is gone; each
  // exercise shows an editable recommended RIR instead — see rirControl).
  function setRow({ existing, exerciseKey, exerciseName, setIndex, side, isDropSet }) {
    const num = (v) => (v === '' || v == null ? null : Number(v))
    let weight = existing?.weight ?? ''
    let reps = existing?.reps ?? ''
    // Track the record id in the closure so rapid box-to-box entry keeps writing
    // the SAME record: the first non-empty blur inserts, every later blur updates.
    let recId = existing?.id ?? null
    let saving = Promise.resolve() // serialise persists so a second blur can't race the first insert
    const dot = el('span.done-dot' + (num(reps) != null ? '.on' : ''))

    const persist = () => (saving = saving.then(async () => {
      const empty = weight === '' && reps === ''
      if (recId != null) {
        if (empty) { const id = recId; recId = null; await db.del('sets', id); scheduleRefresh(); return }
        await db.update('sets', recId, { weight: num(weight), reps: num(reps) })
      } else {
        if (empty) return
        const sessionId = await ensureSession()
        recId = await db.add('sets', {
          sessionId, exerciseKey, exerciseName, setIndex, side: side ?? null,
          isDropSet: !!isDropSet, weight: num(weight), reps: num(reps), rir: null, order: Date.now(),
        })
        scheduleRefresh() // new row -> reveal next empty slot + update hints
      }
    }))

    const mk = (ph, mode, get, set) => el('input', {
      inputmode: mode, placeholder: ph, value: get(),
      oninput: (e) => { set(e.target.value); dot.classList.toggle('on', num(reps) != null) },
      onblur: persist,
    })
    const grid = el('div.grid2', { style: { flex: 1 } },
      mk('kg', 'decimal', () => weight, (v) => (weight = v)),
      mk('reps', 'numeric', () => reps, (v) => (reps = v)),
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
        isDropSet: drop && i >= planned,
      }))
    return el('div',
      el('div.side-tag.side-' + side, { style: { width: 'auto', fontSize: '12px', marginBottom: '4px' } }, side === 'L' ? 'LEFT' : 'RIGHT'),
      rows,
      el('button.btn.ghost.sm', { style: { marginTop: '6px' }, onclick: () => { extraRows[k] = (extraRows[k] || 0) + 1; refresh() } }, drop ? '+ drop' : '+ set'),
    )
  }

  // Editable recommended RIR shown on every exercise card (persists in the day's
  // template / this date's temp list until edited again).
  function rirControl(ex) {
    const wrap = el('span')
    const show = () => {
      clear(wrap)
      wrap.append(el('button.rir', { title: 'Tap to edit the recommended RIR', onclick: edit }, `RIR ${ex.rir || '—'} ✎`))
    }
    const edit = () => {
      clear(wrap)
      const input = el('input', {
        value: ex.rir === '—' ? '' : (ex.rir ?? ''), placeholder: '1–2',
        style: { width: '72px', padding: '4px 8px', fontSize: '13px', display: 'inline-block' },
      })
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur() })
      input.addEventListener('blur', async () => {
        ex.rir = input.value.trim() || '—'
        await saveListFor(ex)
        show()
      })
      wrap.append(input)
      input.focus()
    }
    show()
    return wrap
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
          isDropSet: false,
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
          el('div.exmeta', `${ex.muscle} · ${ex.sets} sets · `, rirControl(ex))),
        el('div.spread', { style: { justifyContent: 'flex-end' } },
          ex.temp && el('span.pill', '📅 today only'),
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

  function editorCard(ex, idx, list) {
    const commit = async () => { await saveListFor(ex) } // field edits: save, no re-render
    const move = async (delta) => {
      const j = idx + delta
      if (j < 0 || j >= list.length) return
      ;[list[idx], list[j]] = [list[j], list[idx]]
      await saveListFor(ex); refresh()
    }
    const remove = async () => { list.splice(idx, 1); await (ex.temp ? saveTemporary() : savePermanent()); refresh() }

    const text = (ph, get, set) => el('input', { placeholder: ph, value: get(), oninput: (e) => set(e.target.value), onblur: commit })
    const numField = (ph, mode, get, set) => el('input', { inputmode: mode, placeholder: ph, value: get(), oninput: (e) => set(e.target.value), onblur: commit })
    const check = (labelText, get, set) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!get()
      cb.addEventListener('change', async (e) => { set(e.target.checked); await commit() })
      return el('label.chk', cb, el('span', labelText))
    }

    // Name edits change the display name ONLY — the key is never re-keyed, so
    // logged history stays joined. Suggestions just help keep names canonical.
    const nameSug = el('div.ac-list')
    const nameInput = el('input', {
      placeholder: 'Exercise name', value: ex.name,
      oninput: (e) => {
        ex.name = e.target.value
        clear(nameSug)
        for (const m of libMatches(ex.name, library, 3)) {
          if (m.name === ex.name) continue
          nameSug.append(el('button', {
            onclick: async () => { ex.name = m.name; nameInput.value = m.name; clear(nameSug); await commit() },
          }, m.name))
        }
      },
      onblur: commit,
    })

    // Permanent (template) vs temporary (this date only) — moves the exercise
    // between the program store and the date-scoped sessionExercises store.
    const permCb = el('input', { type: 'checkbox' }); permCb.checked = !ex.temp
    permCb.addEventListener('change', async () => {
      const from = ex.temp ? tempExercises : templateExercises
      const i = from.indexOf(ex)
      if (i >= 0) from.splice(i, 1)
      if (permCb.checked) { delete ex.temp; templateExercises.push(ex) }
      else { ex.temp = true; tempExercises.push(ex) }
      await savePermanent(); await saveTemporary()
      refresh()
    })

    return el('div.card.tight',
      el('div.row.between',
        el('div', { style: { flex: '1 1 auto' } }, nameInput, nameSug),
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
        el('label.chk', permCb, el('span', 'Permanent')),
        check('Unilateral L/R', () => ex.unilateral, (v) => (ex.unilateral = v || undefined)),
        check('To failure', () => ex.toFailure, (v) => (ex.toFailure = v || undefined)),
        check('Optional', () => ex.optional, (v) => (ex.optional = v || undefined))),
      ex.temp && el('div.muted', { style: { fontSize: '12px', marginTop: '6px' } }, `📅 Today only (${date}) — won’t appear on future ${dayType} days.`),
    )
  }

  // Autocomplete add: typing filters the canonical library; picking a match
  // reuses its stable key so Progress history stays joined. A genuinely new
  // name is added to the library (fresh key) and reused thereafter.
  function addControls() {
    let q = ''
    const permCb = el('input', { type: 'checkbox', checked: true })
    const listBox = el('div.ac-list')
    const input = el('input', { placeholder: 'Type to search — e.g. “one arm pull up”' })

    const addEntry = async (entry) => {
      const item = { ...entry, key: uniqueKey(entry.key, [...templateExercises, ...tempExercises]) }
      if (permCb.checked) { templateExercises.push(item); await savePermanent() }
      else { tempExercises.push({ ...item, temp: true }); await saveTemporary() }
      ctx.toast(permCb.checked ? 'Added to the day template' : 'Added for today only')
      refresh()
    }

    const render = () => {
      clear(listBox)
      const matches = libMatches(q, library)
      for (const e of matches) {
        listBox.append(el('button', { onclick: () => addEntry(e) },
          el('div', e.name),
          el('div.muted', `${e.muscle || '—'} · ${e.sets} sets · RIR ${e.rir || '—'}`)))
      }
      const qt = q.trim()
      if (qt && !matches.some((m) => m.name.toLowerCase() === qt.toLowerCase())) {
        listBox.append(el('button', {
          onclick: async () => {
            const entry = await db.addLibraryEntry({ name: qt })
            if (entry) await addEntry(entry)
          },
        }, el('div', `+ New exercise “${qt}”`), el('div.muted', 'Added to your library for reuse')))
      }
    }
    input.addEventListener('input', (e) => { q = e.target.value; render() })

    return el('div.card',
      el('label', 'Add exercise'),
      input,
      listBox,
      el('div.row.between', { style: { marginTop: '10px' } },
        el('label.chk', permCb, el('span', 'Permanent (stays in this day’s template)')),
        el('button.btn.ghost.sm', { onclick: () => { managingLibrary = true; refresh() } }, '📚 Library')))
  }

  // ---- Exercise-library manager (add / edit / delete canonical entries) ------
  function libraryRow(e) {
    const patch = (p) => db.updateLibraryEntry(e.key, p)
    const bind = (input, key, numeric) => {
      input.addEventListener('change', () => {
        const v = input.value.trim()
        patch({ [key]: numeric ? (v === '' ? '' : Number(v)) : v })
      })
      return input
    }
    const check = (labelText, key) => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = !!e[key]
      cb.addEventListener('change', () => patch({ [key]: cb.checked || undefined }))
      return el('label.chk', cb, el('span', labelText))
    }
    const remove = async () => {
      if (!confirm(`Remove “${e.name}” from the library? Logged history and day templates are not affected.`)) return
      await db.deleteLibraryEntry(e.key)
      ctx.toast('Removed from library'); refresh()
    }
    return el('div.card.tight',
      el('div.row.between',
        // Renaming changes the display name only; the key stays the stable join key.
        el('div', { style: { flex: '1 1 auto' } }, bind(el('input', { value: e.name || '', placeholder: 'Name' }), 'name')),
        el('button.btn.danger.sm', { style: { marginLeft: '8px' }, onclick: remove }, '✕')),
      el('div', { style: { marginTop: '8px' } }, bind(el('input', { value: e.muscle || '', placeholder: 'Muscle' }), 'muscle')),
      el('div.grid3', { style: { marginTop: '8px' } },
        el('div', el('label', 'Sets'), bind(el('input', { inputmode: 'numeric', value: e.sets ?? '' }), 'sets', true)),
        el('div', el('label', 'RIR'), bind(el('input', { value: e.rir ?? '' }), 'rir')),
        el('div', el('label', 'Rest (s)'), bind(el('input', { inputmode: 'numeric', value: e.rest ?? '' }), 'rest', true))),
      el('div.spread', { style: { marginTop: '8px' } },
        check('Unilateral L/R', 'unilateral'),
        check('To failure', 'toFailure')),
      el('div.muted', { style: { fontSize: '11px', marginTop: '6px' } }, `key: ${e.key}`))
  }

  function manageLibraryView() {
    const newName = el('input', { placeholder: 'New exercise name' })
    const newMuscle = el('input', { placeholder: 'Muscle (optional)' })
    const add = async () => {
      if (!newName.value.trim()) { ctx.toast('Name the exercise'); return }
      await db.addLibraryEntry({ name: newName.value, muscle: newMuscle.value.trim() })
      ctx.toast('Added to library'); refresh()
    }
    return el('div',
      el('div.row.between', { style: { marginBottom: '6px' } },
        el('h1', { style: { margin: 0 } }, 'Exercise library'),
        el('button.btn.ghost.sm', { onclick: () => { managingLibrary = false; refresh() } }, 'Done')),
      el('p.sub', 'The canonical exercise list. Adding an exercise to a day picks from here, so the same movement always logs under one key and Progress shows a single series.'),
      ...library.map((e) => libraryRow(e)),
      el('div.card', { style: { marginTop: '12px' } },
        el('div.exname', { style: { marginBottom: '8px' } }, 'Add an exercise'),
        newName,
        el('div', { style: { marginTop: '8px' } }, newMuscle),
        el('div', { style: { marginTop: '10px' } },
          el('button.btn.primary', { onclick: add }, '+ Add to library'))))
  }

  // ---- Day-type manager (lifting days only — sports live in the Sports tab) --
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

    const wdSel = el('select', WD_OPTS.map((w) => el('option', { value: w, selected: (meta.weekday || '') === w }, w || '— weekday —')))
    wdSel.addEventListener('change', async () => { await db.updateDayType(name, { weekday: wdSel.value }); ctx.toast('Updated') })

    return el('div.card',
      el('div.row.between',
        el('div', { style: { flex: '1 1 auto' } }, nameInput),
        el('div.spread',
          el('button.btn.ghost.sm', { onclick: () => moveDay(dayNames, idx, -1), disabled: idx === 0 }, '↑'),
          el('button.btn.ghost.sm', { onclick: () => moveDay(dayNames, idx, 1), disabled: idx === dayNames.length - 1 }, '↓'),
          el('button.btn.danger.sm', { onclick: () => removeDay(name) }, '✕'))),
      el('div', { style: { marginTop: '8px' } },
        el('label', 'Weekday'), wdSel))
  }

  function manageDaysView(program, dayNames) {
    const addName = el('input', { placeholder: 'New day name — e.g. Upper' })
    const addWd = el('select', WD_OPTS.map((w) => el('option', { value: w }, w || '— weekday —')))
    const add = async () => {
      const nm = addName.value.trim()
      if (!nm) { ctx.toast('Name the day'); return }
      const created = await db.addDayType({ name: nm, weekday: addWd.value })
      if (!created) { ctx.toast('Name already exists'); return }
      ctx.toast('Day added'); refresh()
    }
    return el('div',
      el('div.row.between', { style: { marginBottom: '6px' } },
        el('h1', { style: { margin: 0 } }, 'Manage days'),
        el('button.btn.ghost.sm', { onclick: () => { managingDays = false; refresh() } }, 'Done')),
      el('p.sub', 'Your lifting days. Renaming carries over your logged history; a day’s exercises are edited from its Log screen (“Edit exercises”). Non-gym activities live in the Sports tab.'),
      ...dayNames.map((n) => dayRow(program, dayNames, n)),
      el('div.card', { style: { marginTop: '12px' } },
        el('div.exname', { style: { marginBottom: '8px' } }, 'Add a lifting day'),
        addName,
        el('div', { style: { marginTop: '8px' } },
          el('label', 'Weekday'), addWd),
        el('div', { style: { marginTop: '10px' } },
          el('button.btn.primary', { onclick: add }, '+ Add day'))))
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

  function deloadBanner(status) {
    if (!status.warn) return null
    return el('div.card.warn',
      el('strong', { style: { fontSize: '14px' } }, '⚠️ Consider a deload / rest day'),
      el('div.muted', { style: { fontSize: '12px', marginTop: '4px' } }, status.reasons.join(' · ')),
      el('div.muted', { style: { fontSize: '11px', marginTop: '4px' } }, 'Rule-based, not AI — details on the Readiness tab.'))
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
    const [program, sports, dayTypes, allSessions, allSets, allReadiness, injuries] = await Promise.all([
      db.getProgram(), db.getSports(), db.getDayTypes(), db.all('sessions'), db.all('sets'), db.all('readiness'), db.all('injuries'),
    ])
    library = await db.getExerciseLibrary()

    // The Log tab is pure lifting: sports (martial / bouldering / running /
    // calisthenics / stretching) are logged from the Sports tab.
    const sportNames = new Set(sports.map((s) => s.name))
    const dayNames = Object.keys(program).filter((n) => program[n].kind === 'lifting' && !sportNames.has(n))
    const days = dayNames.map((n) => ({ name: n, weekday: program[n].weekday }))
    if (!dayType || !dayNames.includes(dayType)) dayType = defaultDayFor(date, days)

    if (managingLibrary) { clear(root); mount(root, manageLibraryView()); window.scrollTo(0, 0); return }
    if (managingDays) { clear(root); mount(root, manageDaysView(program, dayNames)); window.scrollTo(0, 0); return }

    const dayMeta = program[dayType] || {}
    templateExercises = dayMeta.exercises || []
    tempExercises = (await db.getSessionExercises(date, dayType)).map((e) => ({ ...e, temp: true }))
    const exercises = [...templateExercises, ...tempExercises]

    const session = allSessions.find((s) => s.date === date && s.dayType === dayType)
    const sets = session ? allSets.filter((s) => s.sessionId === session.id) : []
    const isRestDay = new Date(date + 'T12:00:00').getDay() === 0
    const loggedCount = sets.filter((s) => s.reps != null).length

    const today = db.todayISO()
    const weekly = weeklyLoad({ sessions: allSessions, sets: allSets, kindByDay: kindByDayMap(dayTypes, sports), weeks: 4, today })
    const deload = deloadStatus({ readiness: allReadiness, sessions: allSessions, weekly, injuries, today })

    let suggestions = []
    if (showSuggestions && !editing) {
      suggestions = buildSuggestions({ dayType, exercises, sessions: allSessions, sets: allSets, today: date })
    }

    const dateInput = el('input', { type: 'date', value: date })
    dateInput.addEventListener('change', (e) => { date = e.target.value; dayType = null; editing = false; showSuggestions = true; for (const k in extraRows) delete extraRows[k]; refresh() })
    const daySelect = el('select', dayNames.map((d) => el('option', { value: d, selected: d === dayType }, d)))
    daySelect.addEventListener('change', (e) => { dayType = e.target.value; editing = false; showSuggestions = true; for (const k in extraRows) delete extraRows[k]; refresh() })

    clear(root)
    mount(root,
      el('h1', 'Log Workout'),
      el('p.sub', loggedCount > 0 ? `${loggedCount} sets logged` : 'Pick a day and start logging. Sports (BJJ, bouldering, running…) are logged in the Sports tab.'),
      deloadBanner(deload),
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
          el('button.btn.ghost.sm', { onclick: () => { editing = !editing; refresh() } }, editing ? '✓ Done editing' : '✎ Edit exercises'),
          dayMeta.customised && dayMeta.hasDefault && el('button.btn.ghost.sm', {
            onclick: async () => { if (confirm(`Reset ${dayType} to the default exercises? Your logged sets are kept.`)) { await db.resetDay(dayType); editing = false; refresh() } },
          }, '↺ Reset day'),
          session && el('button.btn.danger.sm', {
            onclick: async () => { if (confirm('Delete this session and everything logged in it?')) { await db.deleteSession(session.id); ctx.toast('Session deleted'); editing = false; refresh() } },
          }, '🗑 Delete session'))),

      suggestionsCard(suggestions),

      !editing && el('div.card.tight',
        el('strong', { style: { fontSize: '13px' } }, 'Warm-up'),
        el('div.muted', { style: { fontSize: '13px', marginTop: '2px' } }, WARMUP)),

      // Body: editor / exercise cards
      editing
        ? [el('p.sub', { style: { marginTop: '4px' } }, 'Add, remove, reorder or tweak this day’s exercises. Permanent = saved to the day template; unticked = today only.'),
           templateExercises.map((ex, i) => editorCard(ex, i, templateExercises)),
           tempExercises.map((ex, i) => editorCard(ex, i, tempExercises)),
           addControls()]
        : [exercises.length
            ? exercises.map((ex) => exerciseCard(ex, sets.filter((s) => s.exerciseKey === ex.key)))
            : el('div.empty', 'No exercises for this day. Tap “Edit exercises” to add some.'),
           addControls()],

      !editing && notesCard(session),
    )
  }

  await refresh()
  return root
}
