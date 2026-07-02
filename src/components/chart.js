import { el } from '../dom.js'

// Tiny SVG line chart. series = [{ label, color, points:[{x,y}] }] sharing an x-domain.
// `yStep`: snap the y-axis to multiples of the step (min down, max up) and draw a
// gridline + integer label at every multiple — e.g. yStep 5 for kg charts gives
// …40, 45, 50… If that would exceed ~8 lines, the step doubles (5 → 10 → 20 …).
export function chart(series, { height = 170, yLabel, yStep } = {}) {
  const all = series.flatMap((s) => s.points)
  if (all.length === 0) return el('div.empty', 'No data yet.')

  const W = 320, H = height, padL = 34, padR = 10, padT = 12, padB = 22
  const MAX_GRIDLINES = 8
  const xs = all.map((p) => +new Date(p.x))
  const ys = all.map((p) => p.y)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  let yMin = Math.min(...ys), yMax = Math.max(...ys)
  let yTicks
  if (yStep) {
    let step = yStep
    while (Math.ceil(yMax / step) - Math.floor(yMin / step) > MAX_GRIDLINES) step *= 2
    yMin = Math.floor(yMin / step) * step
    yMax = Math.ceil(yMax / step) * step
    if (yMin === yMax) yMax += step
    yTicks = []
    for (let t = yMin; t <= yMax + step / 1000; t += step) yTicks.push(t)
  } else {
    if (yMin === yMax) { yMin -= 1; yMax += 1 }
    const yPad = (yMax - yMin) * 0.1
    yMin -= yPad; yMax += yPad
    yTicks = Array.from({ length: 4 }, (_, i) => yMin + (i / 3) * (yMax - yMin))
  }

  const sx = (x) => padL + (xMax === xMin ? 0.5 : (+new Date(x) - xMin) / (xMax - xMin)) * (W - padL - padR)
  const sy = (y) => padT + (1 - (y - yMin) / (yMax - yMin)) * (H - padT - padB)

  const round = (n) => (yStep || Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10)

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`
  for (const t of yTicks) {
    svg += `<line x1="${padL}" x2="${W - padR}" y1="${sy(t)}" y2="${sy(t)}" stroke="#2a2f3a" stroke-width="1"/>`
    svg += `<text x="4" y="${sy(t) + 3}" fill="#8b93a3" font-size="9">${round(t)}</text>`
  }
  for (const s of series) {
    const pts = [...s.points].sort((a, b) => +new Date(a.x) - +new Date(b.x))
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    for (const p of pts) svg += `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.6" fill="${s.color}"/>`
  }
  svg += '</svg>'

  return el('div', { html: svg + (yLabel ? `<div class="muted" style="font-size:11px;margin-top:2px">${yLabel}</div>` : '') })
}

export function legend(items) {
  return el('div.legend', items.map((i) =>
    el('span', el('span.dot', { style: { background: i.color } }), i.label)))
}
