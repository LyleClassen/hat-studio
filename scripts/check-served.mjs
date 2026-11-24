// Verifies the Vite dev server is serving the current renderer sources.
// For every renderer .ts file, each named import on disk must also appear in
// the served module. Catches the "stale module" failure seen on this machine.
// usage: node scripts/check-served.mjs [baseUrl]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const base = process.argv[2] ?? 'http://localhost:5173'
const root = 'src/renderer/src'

const files = []
;(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p)
  }
})(root)

let stale = 0
for (const file of files) {
  const disk = readFileSync(file, 'utf8')
  const names = [...disk.matchAll(/^import\s*\{([^}]*)\}/gm)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('type '))
  const url = `${base}/src/${relative(root, file).replace(/\\/g, '/')}`
  const res = await fetch(url)
  if (!res.ok) {
    console.log(`?? ${url} -> HTTP ${res.status}`)
    stale++
    continue
  }
  const served = await res.text()
  const missing = names.filter((n) => !served.includes(n))
  if (missing.length) {
    stale++
    console.log(`STALE ${file}: served module lacks ${missing.join(', ')}`)
  }
}
console.log(stale ? `${stale} stale file(s) — restart the dev server` : `OK: ${files.length} files served current`)
process.exit(stale ? 1 : 0)
