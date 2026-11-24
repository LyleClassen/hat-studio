import './errors'
import { BleTransport } from './ble/transport'
import { fromHex, toHex } from './ble/hex'
import { isOtaUuid, LED_WRITE, shortUuid } from './ble/uuids'
import { EFFECT_NAMES, setBrightness, setSpeed, type Effect } from './protocol/commands'
import { parsePacket } from './protocol/packet'
import { HatClient } from './protocol/client'
import { blankFrame, Colour, HEIGHT, WIDTH, type Frame } from './protocol/frame'
import { PixelGrid, PALETTE_CSS, PALETTE_NAMES, countDiff, frameToText } from './ui/grid'
import { encodeGlyphs } from './protocol/text'
import { renderGlyphs } from './render/glyphs'
import type { HatApi } from '../../preload'

declare global {
  interface Window {
    hat: HatApi
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const statusEl = $('status')
const scanBtn = $<HTMLButtonElement>('scan')
const disconnectBtn = $<HTMLButtonElement>('disconnect')
const chooser = $('chooser')
const deviceList = $<HTMLUListElement>('device-list')
const charsBody = $<HTMLTableSectionElement>('chars')
const targetSel = $<HTMLSelectElement>('target')
const hexInput = $<HTMLInputElement>('hex')
const sendBtn = $<HTMLButtonElement>('send')
const withResp = $<HTMLInputElement>('with-response')
const logEl = $('log')

const transport = new BleTransport()

function log(msg: string, cls = ''): void {
  const t = new Date().toISOString().slice(11, 23)
  const line = document.createElement('span')
  if (cls) line.className = cls
  line.textContent = `${t}  ${msg}\n`
  logEl.appendChild(line)
  window.hat.appendLog(`${new Date().toISOString()}  ${msg}`)
  logEl.parentElement!.scrollTop = logEl.parentElement!.scrollHeight
}

// --- Device chooser (fed by main process during requestDevice) ---
window.hat.onDevices((devices) => {
  chooser.hidden = false
  deviceList.replaceChildren(
    ...devices
      .slice()
      .sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0))
      .map((d) => {
        const li = document.createElement('li')
        li.textContent = `${d.name || '(unnamed)'}  ${d.id}`
        li.onclick = () => {
          chooser.hidden = true
          window.hat.selectDevice(d.id)
        }
        return li
      })
  )
})
$('cancel-scan').onclick = () => {
  chooser.hidden = true
  window.hat.cancelSelect()
}

scanBtn.onclick = async () => {
  scanBtn.disabled = true
  statusEl.textContent = 'Scanning…'
  try {
    await transport.requestAndConnect()
  } catch (e) {
    log(`Connect failed: ${(e as Error).message}`)
    statusEl.textContent = 'Disconnected'
    scanBtn.disabled = false
  }
}
disconnectBtn.onclick = () => transport.disconnect()

// --- Transport events ---
transport.on(async (e) => {
  switch (e.type) {
    case 'log':
      log(e.message)
      break
    case 'connected': {
      statusEl.textContent = `Connected: ${e.name}`
      statusEl.className = 'status ok'
      disconnectBtn.disabled = false
      sendBtn.disabled = false
      renderChars()
      for (const c of transport.characteristics) {
        log(`CHAR svc=${shortUuid(c.serviceUuid)} char=${shortUuid(c.uuid)} props=${c.props.join(',')}`)
      }
      for (const c of transport.characteristics) {
        if (c.props.includes('notify') || c.props.includes('indicate')) {
          try {
            await transport.subscribe(c.uuid)
            log(`Subscribed to ${shortUuid(c.uuid)}`)
          } catch (err) {
            log(`Subscribe ${shortUuid(c.uuid)} failed: ${(err as Error).message}`)
          }
        }
      }
      break
    }
    case 'disconnected':
      statusEl.textContent = 'Disconnected'
      statusEl.className = 'status'
      scanBtn.disabled = false
      disconnectBtn.disabled = true
      sendBtn.disabled = true
      log('Disconnected')
      break
    case 'notify':
      log(`RX ${shortUuid(e.uuid)} [${e.data.length}]  ${toHex(e.data)}${describeRx(e.data)}`, 'rx')
      break
  }
})

function describeRx(data: Uint8Array): string {
  try {
    const p = parsePacket(data)
    const hx = (n: number): string => n.toString(16).padStart(2, '0')
    return `   → cmd ${hx(p.cmd)}/${hx(p.sub)} payload [${toHex(p.payload)}]`
  } catch {
    return ''
  }
}

function renderChars(): void {
  charsBody.replaceChildren()
  targetSel.replaceChildren()
  for (const c of transport.characteristics) {
    const ota = isOtaUuid(c.uuid)
    const tr = document.createElement('tr')
    const readBtn = document.createElement('button')
    readBtn.className = 'secondary small'
    readBtn.textContent = 'Read'
    readBtn.hidden = !c.props.includes('read')
    readBtn.onclick = async () => {
      try {
        const v = await transport.read(c.uuid)
        log(`READ ${shortUuid(c.uuid)} [${v.length}]  ${toHex(v)}`, 'rx')
      } catch (err) {
        log(`Read failed: ${(err as Error).message}`)
      }
    }
    const cells = [
      shortUuid(c.serviceUuid),
      shortUuid(c.uuid) + (ota ? ' (OTA)' : ''),
      c.props.join(', ')
    ]
    for (const text of cells) {
      const td = document.createElement('td')
      td.textContent = text
      if (ota) td.className = 'ota'
      tr.appendChild(td)
    }
    const td = document.createElement('td')
    td.appendChild(readBtn)
    tr.appendChild(td)
    charsBody.appendChild(tr)

    // Never offer the firmware-update channel as a raw write target.
    if (!ota && (c.props.includes('write') || c.props.includes('writeWithoutResponse'))) {
      const opt = document.createElement('option')
      opt.value = c.uuid
      opt.textContent = `${shortUuid(c.uuid)} (${c.props.filter((p) => p.startsWith('write')).join('/')})`
      targetSel.appendChild(opt)
    }
  }
}

sendBtn.onclick = async () => {
  try {
    const bytes = fromHex(hexInput.value)
    if (bytes.length === 0) {
      log('Nothing to send: enter some hex bytes first.')
      return
    }
    await transport.write(targetSel.value, bytes, withResp.checked)
    log(`TX ${shortUuid(targetSel.value)} [${bytes.length}]  ${toHex(bytes)}`, 'tx')
  } catch (err) {
    log(`Send failed: ${(err as Error).message}`)
  }
}
hexInput.onkeydown = (e) => {
  if (e.key === 'Enter') sendBtn.click()
}

// --- Quick controls (confirmed commands) ---
// Sliders fire continuously while dragging; send at most one packet per 60 ms
// and always send the final value.
function bindSlider(id: string, encode: (v: number) => Uint8Array, label: string): HTMLInputElement {
  const input = $<HTMLInputElement>(id)
  const out = $<HTMLOutputElement>(`${id}-val`)
  let timer: ReturnType<typeof setTimeout> | null = null
  const send = async (): Promise<void> => {
    timer = null
    const bytes = encode(Number(input.value))
    try {
      await transport.write(LED_WRITE, bytes, false)
      log(`TX ${label} ${input.value}  ${toHex(bytes)}`, 'tx')
    } catch (err) {
      log(`${label} failed: ${(err as Error).message}`)
    }
  }
  input.oninput = () => {
    out.textContent = input.value
    timer ??= setTimeout(() => void send(), 60)
  }
  return input
}
const brightnessInput = bindSlider('brightness', setBrightness, 'brightness')
const speedInput = bindSlider('speed', setSpeed, 'speed')
transport.on((e) => {
  const enabled = e.type === 'connected'
  if (e.type === 'connected' || e.type === 'disconnected') {
    brightnessInput.disabled = !enabled
    speedInput.disabled = !enabled
  }
})

// --- Hat tests: resolve the remaining protocol unknowns on real hardware ---
const hat = new HatClient(transport)
transport.on((e) => {
  if (e.type === 'connected' || e.type === 'disconnected') {
    document.querySelectorAll<HTMLButtonElement>('.needs-conn').forEach((b) => (b.disabled = e.type !== 'connected'))
  }
})

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  log(`▶ ${name}`)
  try {
    await fn()
    log(`✔ ${name} done`)
  } catch (err) {
    log(`✖ ${name} failed: ${(err as Error).message}`)
  }
}

// --- Display effect (00/04) ---
const effectSel = $<HTMLSelectElement>('effect')
EFFECT_NAMES.forEach((name, i) => {
  const o = document.createElement('option')
  o.value = String(i)
  o.textContent = `${i} ${name}`
  effectSel.appendChild(o)
})
effectSel.value = '1'
effectSel.onchange = () =>
  void runTest(`effect ${EFFECT_NAMES[Number(effectSel.value)]}`, () => hat.effect(Number(effectSel.value) as Effect))
transport.on((e) => {
  if (e.type === 'connected' || e.type === 'disconnected') effectSel.disabled = e.type !== 'connected'
})

// --- Expected vs observed comparison ---
const expectedGrid = new PixelGrid(false)
const observedGrid = new PixelGrid(true)
$('expected-grid').appendChild(expectedGrid.canvas)
$('observed-grid').appendChild(observedGrid.canvas)
let currentTest = '(none)'

const swatches = $('swatches')
PALETTE_CSS.forEach((css, i) => {
  const b = document.createElement('button')
  b.className = 'swatch' + (i === 1 ? ' selected' : '')
  b.style.background = css
  b.title = `${i} ${PALETTE_NAMES[i]}`
  b.textContent = String(i)
  b.onclick = () => {
    observedGrid.paintColour = i
    swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'))
    b.classList.add('selected')
  }
  swatches.appendChild(b)
})
const diffEl = $('diff-count')
const updateDiff = (): void => {
  diffEl.textContent = `${countDiff(expectedGrid.frame, observedGrid.frame)} pixels differ`
}
observedGrid.onChange = updateDiff
$('obs-copy').onclick = () => {
  observedGrid.set(expectedGrid.frame)
  updateDiff()
}
$('obs-clear').onclick = () => observedGrid.clear()
$('obs-save').onclick = () => {
  const n = countDiff(expectedGrid.frame, observedGrid.frame)
  log(
    `OBSERVATION for "${currentTest}" (gap ${transport.writeGapMs} ms): ${n} pixels differ\n` +
      `EXPECTED\n${frameToText(expectedGrid.frame)}\nOBSERVED\n${frameToText(observedGrid.frame)}`
  )
}

const gapInput = $<HTMLInputElement>('write-gap')
gapInput.value = String(transport.writeGapMs)
gapInput.onchange = () => {
  transport.writeGapMs = Math.max(0, Number(gapInput.value) || 0)
  log(`Write gap set to ${transport.writeGapMs} ms`)
}

/** Starts a test: shows its expected frame and resets the observed grid. */
function expect(name: string, frame: Frame): void {
  currentTest = name
  expectedGrid.set(frame)
  observedGrid.clear()
  $('compare-title').textContent = name
  updateDiff()
}

/** Sends every pixel of `frame` live (including off pixels), paced by the transport. */
async function drawLive(frame: Frame): Promise<void> {
  await hat.enterDrawMode()
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) await hat.pixel(x, y, frame[y * WIDTH + x]!)
}

$('test-clear').onclick = () =>
  void runTest('clear hat (512 live pixels set to off)', async () => {
    expect('clear', blankFrame())
    await drawLive(blankFrame())
  })

$('test-palette').onclick = () =>
  void runTest(`palette (gap ${transport.writeGapMs} ms)`, async () => {
    const f = blankFrame()
    // 8 blocks of 3×3 across the top-left area, colours 0..7.
    for (let c = 0; c < 8; c++) for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) f[(1 + dy) * WIDTH + c * 4 + dx] = c
    expect(`palette (gap ${transport.writeGapMs} ms)`, f)
    await hat.enterDrawMode()
    // Only send the pixels inside the blocks area, so the test is quick.
    for (let y = 1; y <= 3; y++) for (let x = 0; x < WIDTH; x++) await hat.pixel(x, y, f[y * WIDTH + x]!)
  })

$('test-row').onclick = () =>
  void runTest(`row test (gap ${transport.writeGapMs} ms)`, async () => {
    // One full white row sent pixel-by-pixel, plus a green row sent in reverse order.
    const f = blankFrame()
    for (let x = 0; x < WIDTH; x++) {
      f[6 * WIDTH + x] = Colour.White
      f[10 * WIDTH + x] = Colour.Green
    }
    expect(`row test (gap ${transport.writeGapMs} ms)`, f)
    await hat.enterDrawMode()
    const t0 = performance.now()
    for (let x = 0; x < WIDTH; x++) await hat.pixel(x, 6, Colour.White)
    for (let x = WIDTH - 1; x >= 0; x--) await hat.pixel(x, 10, Colour.Green)
    log(`64 pixels sent in ${Math.round(performance.now() - t0)} ms`)
  })

$('test-batch').onclick = () =>
  void runTest('batched pixels (10 per write)', async () => {
    const f = blankFrame()
    for (let x = 0; x < WIDTH; x++) f[8 * WIDTH + x] = Colour.White
    expect('batched pixels: row 8 white, 10 packets per write', f)
    await hat.enterDrawMode()
    const row = Array.from({ length: WIDTH }, (_, x) => ({ x, y: 8, colour: Colour.White }))
    const writes = await hat.pixelsBatched(row, 10)
    log(`Sent ${row.length} pixels in ${writes} writes.`)
  })

$('test-order').onclick = () =>
  void runTest('drawing upload (row-major)', async () => {
    const f = blankFrame()
    for (let x = 0; x < WIDTH; x++) f[x] = Colour.Red
    for (let y = 0; y < HEIGHT; y++) f[y * WIDTH] = Colour.Green
    f[(HEIGHT - 1) * WIDTH + (WIDTH - 1)] = Colour.Red
    const effect = Number(effectSel.value)
    expect(`drawing upload (effect ${EFFECT_NAMES[effect]})`, f)
    const r = await hat.sendDrawing(f, 'column', effect)
    log(`Upload result: ${r} (effect ${EFFECT_NAMES[effect]}). Disconnect to see the standalone display.`)
  })

$('send-text').onclick = () =>
  void runTest(`send text "${$<HTMLInputElement>('text-input').value}"`, async () => {
    const glyphs = renderGlyphs($<HTMLInputElement>('text-input').value)
    const r = await hat.sendText(encodeGlyphs(glyphs), Number(effectSel.value))
    log(`Upload result: ${r}`)
  })

$('clear-log').onclick = () => logEl.replaceChildren()
$('copy-log').onclick = () => void navigator.clipboard.writeText(logEl.textContent ?? '')

log('Ready. Click "Scan & connect" with the hat powered on.')
