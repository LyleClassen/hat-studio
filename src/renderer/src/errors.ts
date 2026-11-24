/**
 * Surfaces renderer errors in the on-screen log and logs/probe.log.
 * Imported first by main.ts so it is active even if main.ts itself fails to
 * initialise (otherwise a startup error silently leaves controls disabled).
 */
function report(kind: string, message: string): void {
  const line = `⚠ ${kind}: ${message}`
  try {
    window.hat?.appendLog(`${new Date().toISOString()}  ${line}`)
  } catch {
    /* logging must never throw */
  }
  const el = document.getElementById('log')
  if (el) {
    const span = document.createElement('span')
    span.style.color = '#ff6b6b'
    span.textContent = `${new Date().toISOString().slice(11, 23)}  ${line}\n`
    el.appendChild(span)
  }
}

window.addEventListener('error', (e) => report('error', `${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`))
window.addEventListener('unhandledrejection', (e) => report('unhandled rejection', String(e.reason)))

export {}
