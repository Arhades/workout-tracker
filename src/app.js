import { el, clear } from './dom.js'
import { LogView } from './views/log.js'
import { ProgressView } from './views/progress.js'
import { ReadinessView } from './views/readiness.js'
import { TechniquesView } from './views/techniques.js'
import { DataView } from './views/data.js'

const TABS = [
  { id: 'log', label: 'Log', ico: '🏋️', view: LogView },
  { id: 'progress', label: 'Progress', ico: '📈', view: ProgressView },
  { id: 'readiness', label: 'Readiness', ico: '🔋', view: ReadinessView },
  { id: 'techniques', label: 'Techniques', ico: '📚', view: TechniquesView },
  { id: 'data', label: 'Data', ico: '💾', view: DataView },
]

const content = el('div.content')
const timerHost = el('div') // persistent host for the fixed rest-timer pill

let toastTimer = null
function toast(msg) {
  const node = el('div.toast', msg)
  document.body.append(node)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => node.remove(), 2200)
}

const ctx = { toast, timerHost }
let active = 'log'

const tabButtons = TABS.map((t) =>
  el('button', { class: t.id === active ? 'active' : '', onclick: () => select(t.id) },
    el('span.ico', t.ico), t.label))
const tabbar = el('nav.tabbar', tabButtons)

async function select(id) {
  active = id
  tabButtons.forEach((b, i) => b.classList.toggle('active', TABS[i].id === id))
  clear(timerHost) // stop any running rest timer when navigating away
  clear(content)
  content.append(el('div.empty', '…'))
  try {
    const node = await TABS.find((t) => t.id === id).view(ctx)
    clear(content)
    content.append(node)
  } catch (err) {
    clear(content)
    content.append(el('div.card', { style: { color: 'var(--bad)' } },
      el('strong', 'Something broke rendering this tab.'),
      el('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12px', marginTop: '8px' } }, String(err && err.stack || err))))
  }
  window.scrollTo(0, 0)
}

const app = el('div.app', content, timerHost, tabbar)
document.getElementById('root').append(app)
select('log')

// Register service worker for offline support (no-op when opened via file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}
