// Minimal hyperscript helper. el('div.card', {onclick}, child1, child2, ...)
// Tag supports .class and #id shorthand. Props: attributes, style object,
// on* event handlers, dataset via data-*. Children: nodes, strings, arrays, falsy=skip.
export function el(tag, props, ...children) {
  let tagName = 'div', id = null
  const classes = []
  tag.split(/(?=[.#])/).forEach((part, i) => {
    if (part[0] === '.') classes.push(part.slice(1))
    else if (part[0] === '#') id = part.slice(1)
    else if (i === 0) tagName = part
  })
  const node = document.createElement(tagName)
  if (id) node.id = id
  if (classes.length) node.className = classes.join(' ')

  if (props && (props.nodeType || typeof props === 'string' || Array.isArray(props))) {
    children.unshift(props); props = null
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ')
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v)
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'value') node.value = v
    else if (k in node && k !== 'list') { try { node[k] = v } catch { node.setAttribute(k, v) } }
    else node.setAttribute(k, v)
  }
  append(node, children)
  return node
}

function append(node, children) {
  for (const c of children) {
    if (c == null || c === false || c === true || c === '') continue
    if (Array.isArray(c)) append(node, c)
    else node.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
}

// Like el's child handling, but for an existing parent. Native Node.append()
// stringifies arrays and `false`; always go through this when children may be
// arrays or conditional (falsy) values.
export function mount(node, ...children) { append(node, children); return node }

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild) }

export function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function mmss(totalSeconds) {
  const a = Math.abs(totalSeconds)
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
}

// Copy text to the clipboard, with a fallback for non-secure (http://) LAN use
// where navigator.clipboard may be unavailable. Resolves true on success.
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.append(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}
