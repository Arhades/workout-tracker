// Zero-dependency static server (Node built-ins only). Serves this folder over
// your LAN so you can open it on your phone. Run: node serve.js [port]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'
import { networkInterfaces } from 'node:os'

const ROOT = process.cwd()
const PORT = Number(process.argv[2]) || 5173

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (pathname === '/') pathname = '/index.html'
    // Prevent path traversal outside ROOT.
    const filePath = normalize(join(ROOT, pathname))
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden') }

    const info = await stat(filePath).catch(() => null)
    if (!info || !info.isFile()) { res.writeHead(404); return res.end('Not found') }

    const body = await readFile(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(body)
  } catch (err) {
    res.writeHead(500); res.end('Server error')
  }
}).listen(PORT, '0.0.0.0', () => {
  // Collect every external IPv4 address with its adapter name. On Windows a WSL /
  // Hyper-V / VPN virtual adapter often shows up too (e.g. 172.x) and is NOT
  // reachable from your phone — so we list them all and flag the likely Wi-Fi one.
  const addrs = []
  for (const [name, ifaces] of Object.entries(networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) addrs.push({ name, address: i.address })
    }
  }
  // 192.168.* and 10.* are the usual home Wi-Fi ranges; show those first.
  const score = (a) => (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : 2)
  addrs.sort((a, b) => score(a) - score(b))

  console.log(`\n  Workout Tracker serving (port ${PORT})`)
  console.log(`    Local:   http://localhost:${PORT}`)
  console.log(`\n  On your phone (same Wi-Fi), try one of these — usually the 192.168.* one:`)
  for (const a of addrs) {
    const hint = score(a) === 0 ? '   ← try this first' : score(a) === 2 ? '   (virtual/VPN? may not work)' : ''
    console.log(`    http://${a.address}:${PORT}   [${a.name}]${hint}`)
  }
  console.log(`\n  If none connect, allow Node through Windows Firewall (Private networks).\n`)
})
