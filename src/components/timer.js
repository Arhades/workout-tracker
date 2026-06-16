import { el, mmss } from '../dom.js'

// A rest-timer controller that renders a fixed pill into `host`. Wall-clock based
// so it stays accurate if the screen sleeps / tab is backgrounded.
export function createRestTimer(host) {
  let endAt = 0, intervalId = null, label = '', buzzed = false
  let bar = null, text = null, pill = null

  function tick() {
    const left = Math.round((endAt - Date.now()) / 1000)
    const over = left <= 0
    if (text) text.textContent = `${over ? 'Rest done +' : 'Rest'} ${mmss(left)}${label ? ` · ${label}` : ''}`
    if (pill) pill.classList.toggle('over', over)
    if (over && !buzzed) { buzzed = true; navigator.vibrate?.([120, 60, 120]) }
  }

  function stop() {
    if (intervalId) clearInterval(intervalId)
    intervalId = null
    if (bar) { bar.remove(); bar = null }
  }

  function start(seconds, lbl) {
    stop()
    endAt = Date.now() + seconds * 1000
    label = lbl || ''
    buzzed = false
    text = el('span')
    pill = el('div.timer-pill',
      el('button', { onclick: () => { endAt += 30000; tick() } }, '+30'),
      text,
      el('button', { onclick: stop }, '✕'),
    )
    bar = el('div.timer-bar', pill)
    host.append(bar)
    tick()
    intervalId = setInterval(tick, 250)
  }

  return { start, stop }
}
