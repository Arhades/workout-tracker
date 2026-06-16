// Tiny Markdown-subset renderer -> safe HTML string. Deliberately small (no deps).
// Supports:  # H1  ## H2  ### H3,  **bold**,  *italic*,  `code`,  - lists,
// [text](url) external links, and [[Wiki Links]] to other technique pages
// (rendered as <a class="wikilink" data-link="Title"> — the Techniques view
// delegates clicks on these to navigate between pages).

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Inline formatting. Input is escaped FIRST, so captured groups are already safe
// and must not be re-escaped (that would double-encode).
function inline(s) {
  let t = esc(s)
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_, title) => {
    const name = title.trim()
    return `<a class="wikilink" data-link="${name}">${name}</a>`
  })
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  return t
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let para = [], list = null
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = [] } }
  const flushList = () => { if (list) { out.push('<ul>' + list.map((li) => '<li>' + inline(li) + '</li>').join('') + '</ul>'); list = null } }

  for (const ln of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(ln)
    const li = /^[-*]\s+(.*)$/.exec(ln)
    if (h) { flushPara(); flushList(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`) }
    else if (li) { flushPara(); (list ??= []).push(li[1]) }
    else if (ln.trim() === '') { flushPara(); flushList() }
    else { flushList(); para.push(ln) }
  }
  flushPara(); flushList()
  return out.join('\n')
}
