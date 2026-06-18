import { el, clear, mount, copyToClipboard } from '../dom.js'
import * as db from '../db.js'
import { techniquesMarkdown } from '../aiReport.js'
import { renderMarkdown } from '../markdown.js'

export async function TechniquesView(ctx) {
  const root = el('div')
  let techniques = []        // latest snapshot, for wiki-link resolution
  let categories = []        // latest snapshot of user-editable categories
  let openId = null          // a technique page is open (rendered view)
  let formOpen = false
  let editingId = null
  let prefillTitle = ''      // when creating a page from an unresolved [[link]]
  let manageOpen = false     // category manager panel

  const labelFor = (id) => categories.find((c) => c.id === id)?.label || id

  // Navigate between pages via [[Wiki Links]]. Unknown title -> start a new page.
  function openByTitle(title) {
    const t = techniques.find((x) => (x.title || '').toLowerCase() === title.toLowerCase())
    if (t) { openId = t.id; formOpen = false }
    else { formOpen = true; editingId = null; prefillTitle = title; openId = null }
    refresh()
  }
  function attachWiki(node) {
    node.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a.wikilink')
      if (!a) return
      e.preventDefault(); openByTitle(a.dataset.link)
    })
  }

  // ---- Markdown editor helpers ----------------------------------------------
  function insertLinePrefix(ta, prefix) {
    const v = ta.value, pos = ta.selectionStart ?? v.length
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1
    ta.value = v.slice(0, lineStart) + prefix + v.slice(lineStart)
    ta.focus(); ta.selectionStart = ta.selectionEnd = pos + prefix.length
    ta.dispatchEvent(new Event('input'))
  }
  function wrapSelection(ta, before, after) {
    const v = ta.value, s = ta.selectionStart ?? v.length, e = ta.selectionEnd ?? v.length
    const sel = v.slice(s, e)
    ta.value = v.slice(0, s) + before + sel + after + v.slice(e)
    ta.focus(); ta.selectionStart = ta.selectionEnd = s + before.length + sel.length + (sel ? after.length : 0)
    ta.dispatchEvent(new Event('input'))
  }

  function form(existing) {
    const title = el('input', { placeholder: 'Page title — e.g. Knee-cut pass', value: existing?.title || prefillTitle || '' })
    const cat = el('select', categories.map((c) => el('option', { value: c.id, selected: existing?.category === c.id }, c.label)))
    const area = el('input', { placeholder: 'Area — e.g. Guard Passing', value: existing?.area || '' })
    const discipline = el('input', { placeholder: 'Discipline — e.g. BJJ', value: existing?.discipline || '' })
    const source = el('input', { placeholder: 'Source link — Notion / YouTube (optional)', value: existing?.source || '' })
    const body = el('textarea', { placeholder: 'Notes. Use # H1, ## H2, ### H3, - lists, and [[Other Page]] to link.', style: { minHeight: '160px' } })
    body.value = existing?.body || ''

    const preview = el('div.md', { html: renderMarkdown(body.value) })
    body.addEventListener('input', () => { preview.innerHTML = renderMarkdown(body.value) })

    const tbtn = (label, fn) => el('button.btn.ghost.sm', { onclick: () => fn(body) }, label)
    const linkOptions = [el('option', { value: '' }, '🔗 Link to…')]
    for (const t of techniques) if (t.id !== editingId) linkOptions.push(el('option', { value: t.title }, t.title))
    const linkSel = el('select', { style: { width: 'auto', flex: '1 1 120px' } }, linkOptions)
    linkSel.addEventListener('change', (e) => { if (e.target.value) { wrapSelection(body, `[[${e.target.value}]]`, ''); e.target.value = '' } })

    const save = async () => {
      const rec = {
        category: cat.value, title: title.value.trim(), area: area.value.trim(),
        discipline: discipline.value.trim(), source: source.value.trim(),
        body: body.value, updated: db.todayISO(),
      }
      if (!rec.title) { ctx.toast('Give it a title'); return }
      let id = editingId
      if (id) await db.update('techniques', id, rec)
      else id = await db.add('techniques', rec)
      editingId = null; formOpen = false; prefillTitle = ''
      openId = id // jump straight to the saved page
      ctx.toast('Saved'); refresh()
    }

    return el('div.card',
      el('h2', { style: { marginTop: 0 } }, editingId ? 'Edit technique' : 'New technique'),
      el('label', 'Title (main header)'), title,
      el('div.grid2', { style: { marginTop: '10px' } },
        el('div', el('label', 'Category'), cat),
        el('div', el('label', 'Area'), area)),
      el('div', { style: { marginTop: '10px' } }, el('label', 'Discipline'), discipline),
      el('div', { style: { marginTop: '12px' } }, el('label', 'Notes')),
      el('div.toolbar', { style: { marginBottom: '6px' } },
        tbtn('H1', (ta) => insertLinePrefix(ta, '# ')),
        tbtn('H2', (ta) => insertLinePrefix(ta, '## ')),
        tbtn('H3', (ta) => insertLinePrefix(ta, '### ')),
        tbtn('B', (ta) => wrapSelection(ta, '**', '**')),
        tbtn('• List', (ta) => insertLinePrefix(ta, '- ')),
        linkSel),
      body,
      el('label', { style: { marginTop: '12px' } }, 'Preview'),
      el('div.card.tight', preview),
      el('div', { style: { marginTop: '10px' } }, el('label', 'Source'), source),
      el('div.spread', { style: { marginTop: '12px' } },
        el('button.btn.primary', { onclick: save }, editingId ? 'Update' : 'Save technique'),
        el('button.btn.ghost', { onclick: () => { editingId = null; formOpen = false; prefillTitle = ''; refresh() } }, 'Cancel')))
  }

  // ---- Category manager (rename / add / delete / reorder) -------------------
  async function moveCategory(idx, dir) {
    const ids = categories.map((c) => c.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    await db.saveCategoryOrder(ids)
    refresh()
  }

  async function removeCategory(c) {
    if (categories.length <= 1) { ctx.toast('Keep at least one category'); return }
    const fallback = categories.find((x) => x.id !== c.id)
    const count = techniques.filter((t) => t.category === c.id).length
    const msg = count
      ? `Delete “${c.label}”? Its ${count} technique${count === 1 ? '' : 's'} will move to “${fallback.label}”.`
      : `Delete “${c.label}”?`
    if (!confirm(msg)) return
    await db.deleteCategory(c.id, fallback.id)
    ctx.toast('Category deleted'); refresh()
  }

  function categoryRow(c, idx) {
    const label = el('input', { value: c.label || '', placeholder: 'Category name' })
    label.addEventListener('change', async () => {
      const v = label.value.trim()
      if (!v) { ctx.toast('Name can’t be empty'); refresh(); return }
      await db.updateCategory(c.id, { label: v }); ctx.toast('Renamed'); refresh()
    })
    const hint = el('input', { value: c.hint || '', placeholder: 'Subtitle / examples (optional)' })
    hint.addEventListener('change', async () => { await db.updateCategory(c.id, { hint: hint.value.trim() }) })
    const count = techniques.filter((t) => t.category === c.id).length

    return el('div.card',
      el('div.row.between',
        el('div', { style: { flex: '1 1 auto' } }, label),
        el('div.spread',
          el('button.btn.ghost.sm', { onclick: () => moveCategory(idx, -1), disabled: idx === 0 }, '↑'),
          el('button.btn.ghost.sm', { onclick: () => moveCategory(idx, 1), disabled: idx === categories.length - 1 }, '↓'),
          el('button.btn.danger.sm', { onclick: () => removeCategory(c) }, '✕'))),
      el('div', { style: { marginTop: '8px' } }, hint),
      el('div.muted', { style: { fontSize: '12px', marginTop: '6px' } }, `${count} technique${count === 1 ? '' : 's'}`))
  }

  function manageView() {
    const newLabel = el('input', { placeholder: 'New category name' })
    const newHint = el('input', { placeholder: 'Subtitle / examples (optional)' })
    const add = async () => {
      if (!newLabel.value.trim()) { ctx.toast('Name the category'); return }
      await db.addCategory({ label: newLabel.value, hint: newHint.value })
      ctx.toast('Category added'); refresh()
    }
    return el('div',
      el('div.row.between', { style: { marginBottom: '6px' } },
        el('h1', { style: { margin: 0 } }, 'Categories'),
        el('button.btn.ghost.sm', { onclick: () => { manageOpen = false; refresh() } }, 'Done')),
      el('p.sub', 'Rename, reorder, add or remove. Renaming updates everywhere; deleting moves its techniques into another category.'),
      ...categories.map((c, i) => categoryRow(c, i)),
      el('div.card', { style: { marginTop: '12px' } },
        el('div.exname', { style: { marginBottom: '8px' } }, 'Add category'),
        newLabel,
        el('div', { style: { marginTop: '8px' } }, newHint),
        el('div', { style: { marginTop: '10px' } },
          el('button.btn.primary', { onclick: add }, '+ Add category'))))
  }

  function pageView(t) {
    const bodyNode = el('div.md', { html: renderMarkdown(t.body || '') })
    attachWiki(bodyNode)
    return el('div',
      el('button.btn.ghost.sm', { onclick: () => { openId = null; refresh() } }, '← All techniques'),
      el('div.card', { style: { marginTop: '10px' } },
        el('div.row.between',
          el('h1', { style: { margin: '4px 0' } }, t.title),
          el('div.spread',
            el('button.btn.ghost.sm', { onclick: () => { editingId = t.id; formOpen = true; openId = null; refresh() } }, '✎ Edit'),
            el('button.btn.danger.sm', { onclick: async () => { if (confirm('Delete this technique page?')) { await db.del('techniques', t.id); openId = null; ctx.toast('Deleted'); refresh() } } }, '✕'))),
        (t.area || t.discipline) && el('div.spread', { style: { marginBottom: '6px' } },
          t.area && el('span.pill', t.area), t.discipline && el('span.pill', t.discipline)),
        el('div', { style: { borderTop: '1px solid var(--border)', marginTop: '8px', paddingTop: '8px' } }, bodyNode),
        t.source && el('div', { style: { marginTop: '10px', fontSize: '13px' } }, el('a', { href: t.source, target: '_blank', rel: 'noopener' }, '↗ source'))))
  }

  function previewLine(t) {
    const ln = (t.body || '').split('\n').map((l) => l.replace(/^[#\-*\s]+/, '').trim()).find(Boolean) || ''
    return ln.length > 80 ? ln.slice(0, 80) + '…' : ln
  }
  function listRow(t) {
    return el('div.card', { onclick: () => { openId = t.id; refresh() }, style: { cursor: 'pointer' } },
      el('div.row.between',
        el('div.exname', t.title),
        t.area && el('span.pill', t.area)),
      previewLine(t) && el('div.muted', { style: { fontSize: '13px', marginTop: '4px' } }, previewLine(t)))
  }

  async function copyAll() {
    if (!techniques.length) { ctx.toast('No techniques yet'); return }
    const md = techniquesMarkdown(techniques, labelFor)
    ctx.toast((await copyToClipboard(md)) ? 'Copied — paste into any AI' : 'Copy failed')
  }

  async function refresh() {
    ;[techniques, categories] = await Promise.all([
      db.all('techniques').then((x) => x.sort((a, b) => (a.updated < b.updated ? 1 : -1))),
      db.getCategories(),
    ])

    clear(root)
    if (manageOpen) { mount(root, manageView()); window.scrollTo(0, 0); return }
    if (formOpen) { mount(root, el('h1', 'Techniques'), form(editingId ? techniques.find((t) => t.id === editingId) : null)); window.scrollTo(0, 0); return }
    if (openId != null) {
      const t = techniques.find((x) => x.id === openId)
      if (t) { mount(root, pageView(t)); return }
      openId = null
    }

    const knownIds = new Set(categories.map((c) => c.id))
    const orphans = techniques.filter((t) => !knownIds.has(t.category))

    mount(root,
      el('h1', 'Techniques'),
      el('p.sub', 'Your instructional notes as linked pages. Feeds “Copy for AI”.'),
      el('div.spread',
        el('button.btn.primary', { onclick: () => { editingId = null; prefillTitle = ''; formOpen = true; refresh() } }, '+ New technique'),
        el('button.btn.ghost', { onclick: () => { manageOpen = true; refresh() } }, '⚙ Categories'),
        el('button.btn.ghost', { onclick: copyAll }, '📋 Copy all for AI')),
      ...categories.map((c) => {
        const items = techniques.filter((t) => t.category === c.id)
        return el('div', { style: { marginTop: '18px' } },
          el('h2', { style: { marginBottom: '2px' } }, c.label),
          c.hint && el('div.muted', { style: { fontSize: '12px', marginBottom: '8px' } }, c.hint),
          items.length ? items.map(listRow) : el('div.muted', { style: { fontSize: '13px' } }, 'Nothing here yet.'))
      }),
      orphans.length ? el('div', { style: { marginTop: '18px' } },
        el('h2', { style: { marginBottom: '2px' } }, 'Uncategorized'),
        el('div.muted', { style: { fontSize: '12px', marginBottom: '8px' } }, 'Their category was removed — open one and pick a new category to re-file it.'),
        orphans.map(listRow)) : null,
    )
  }

  await refresh()
  return root
}
