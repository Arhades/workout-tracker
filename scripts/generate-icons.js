// Generates app icons with zero dependencies (Node's built-in zlib only).
// Draws a simple dumbbell on a dark background. Run: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons')
mkdirSync(PUBLIC, { recursive: true })

const BG = [15, 17, 21, 255]      // #0f1115
const FG = [122, 162, 255, 255]   // accent blue

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makePng(size) {
  const px = (x, y, c) => {
    const i = y * (size * 4 + 1) + 1 + x * 4
    raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = c[3]
  }
  // raw scanlines: each row prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px(x, y, BG)

  // Dumbbell geometry (scaled to canvas)
  const s = size
  const cy = s / 2
  const barH = s * 0.10, barY0 = cy - barH / 2, barY1 = cy + barH / 2
  const barX0 = s * 0.30, barX1 = s * 0.70
  const plateW = s * 0.10, plateH = s * 0.40
  const innerH = s * 0.28
  const rect = (x0, x1, y0, y1) => {
    for (let y = Math.max(0, y0 | 0); y < Math.min(s, y1 | 0); y++)
      for (let x = Math.max(0, x0 | 0); x < Math.min(s, x1 | 0); x++) px(x, y, FG)
  }
  // bar
  rect(barX0, barX1, barY0, barY1)
  // left plates
  rect(s * 0.18, s * 0.18 + plateW, cy - plateH / 2, cy + plateH / 2)
  rect(s * 0.30 - plateW, s * 0.30, cy - innerH / 2, cy + innerH / 2)
  // right plates
  rect(s * 0.82 - plateW, s * 0.82, cy - plateH / 2, cy + plateH / 2)
  rect(s * 0.70, s * 0.70 + plateW, cy - innerH / 2, cy + innerH / 2)

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return png
}

writeFileSync(join(PUBLIC, 'pwa-192.png'), makePng(192))
writeFileSync(join(PUBLIC, 'pwa-512.png'), makePng(512))
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), makePng(180))

// favicon.svg (crisp, scales everywhere)
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#0f1115"/>
<g fill="#7aa2ff">
<rect x="30" y="45" width="40" height="10" rx="2"/>
<rect x="18" y="30" width="10" height="40" rx="3"/>
<rect x="22" y="36" width="8" height="28" rx="2"/>
<rect x="72" y="30" width="10" height="40" rx="3"/>
<rect x="70" y="36" width="8" height="28" rx="2"/>
</g></svg>`
writeFileSync(join(PUBLIC, 'favicon.svg'), favicon)

console.log('Icons written to icons/')
