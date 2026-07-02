import { el, clear } from '../dom.js'
import * as db from '../db.js'

export async function DataView(ctx) {
  const root = el('div')

  async function doExport(suffix = '') {
    const data = await db.exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = el('a', { href: url, download: `workout-backup-${db.todayISO()}${suffix}.json` })
    a.click()
    URL.revokeObjectURL(url)
    ctx.toast('Backup exported')
  }

  async function doImport(file) {
    try {
      const doc = JSON.parse(await file.text())
      if (!confirm('Import this backup? Sessions/check-ins with matching dates will be replaced. A safety backup of the current data downloads first.')) return
      // Safety net: snapshot the current data before anything is overwritten,
      // so an unexpected import can always be undone.
      await doExport('-pre-import')
      await db.importData(doc)
      ctx.toast('Backup imported'); refresh()
    } catch (err) {
      alert('Import failed: ' + err.message)
    }
  }

  async function clearAllData() {
    if (!confirm('Delete ALL local data? Export a backup first — this cannot be undone.')) return
    if (!confirm('Really delete everything?')) return
    await db.clearAll()
    ctx.toast('All data cleared'); refresh()
  }

  async function refresh() {
    const [sessions, sets, readiness, techniques, program, exerciseLibrary, sports, injuries] = await Promise.all([
      db.all('sessions'), db.all('sets'), db.all('readiness'), db.all('techniques'), db.all('program'),
      db.all('exerciseLibrary'), db.all('sports'), db.all('injuries'),
    ])
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true })
    fileInput.addEventListener('change', (e) => { if (e.target.files[0]) doImport(e.target.files[0]); e.target.value = '' })

    clear(root)
    root.append(
      el('h1', 'Data'),
      el('p.sub', 'Local-only storage. Back up often — a phone wipe loses everything.'),
      el('div.card',
        el('div.kv', el('span', 'Sessions'), el('strong', String(sessions.length))),
        el('div.kv', el('span', 'Logged sets'), el('strong', String(sets.filter((s) => s.reps != null).length))),
        el('div.kv', el('span', 'Readiness check-ins'), el('strong', String(readiness.length))),
        el('div.kv', el('span', 'Technique notes'), el('strong', String(techniques.length))),
        el('div.kv', el('span', 'Customised days'), el('strong', String(program.length))),
        el('div.kv', el('span', 'Library exercises'), el('strong', String(exerciseLibrary.length))),
        el('div.kv', el('span', 'Sports activities'), el('strong', String(sports.length))),
        el('div.kv', el('span', 'Injury entries'), el('strong', String(injuries.length))),
        el('div.kv', el('span', 'Export schema'), el('span.muted', `v${db.SCHEMA_VERSION}`))),
      el('div.card',
        el('h2', { style: { marginTop: 0 } }, 'Backup & restore'),
        el('p.muted', { style: { fontSize: '13px', marginTop: 0 } }, 'Exports clean, versioned JSON — sessions, readiness, your edited program and technique notes. The stable source of truth for the future offline ML layer.'),
        el('button.btn.primary.full', { onclick: () => doExport() }, '⬇ Export JSON backup'),
        el('button.btn.full', { style: { marginTop: '10px' }, onclick: () => fileInput.click() }, '⬆ Import JSON backup'),
        fileInput),
      el('div.card',
        el('h2', { style: { marginTop: 0 } }, 'Install on iPhone'),
        el('ol.muted', { style: { fontSize: '13px', paddingLeft: '18px', margin: 0, lineHeight: '1.7' } },
          el('li', { html: 'Open this page in <strong>Safari</strong>.' }),
          el('li', { html: 'Tap the <strong>Share</strong> button.' }),
          el('li', { html: 'Choose <strong>Add to Home Screen</strong>.' }),
          el('li', 'Launch from the icon — runs full-screen and offline.'))),
      el('div.card',
        el('h2', { style: { marginTop: 0 } }, 'Danger zone'),
        el('button.btn.danger.full', { onclick: clearAllData }, 'Delete all local data')))
  }

  await refresh()
  return root
}
