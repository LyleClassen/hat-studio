import type { BleTransport } from '../ble/transport'
import type { HatClient } from '../protocol/client'
import { EFFECT_NAMES, type Effect } from '../protocol/commands'
import { blankFrame, WIDTH, type Frame } from '../protocol/frame'
import { PALETTE_CSS, PALETTE_NAMES, PixelGrid, renderThumb } from '../ui/grid'
import { DEFAULT_DURATION_MS, deserialize, newAnimation, serialize, type Animation } from './model'
import { diffPixels, estimateLoop, type EraseOrder, type Strategy } from './plan'
import { AnimationPlayer } from './player'
import { floodFill, linePoints, plot, rectPoints, shift, type Point } from './tools'

type Tool = 'pencil' | 'eraser' | 'line' | 'rect' | 'rectfill' | 'fill' | 'pick'

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pencil', label: '✏ Pencil', key: 'b' },
  { id: 'eraser', label: '⌫ Eraser', key: 'e' },
  { id: 'line', label: '╱ Line', key: 'l' },
  { id: 'rect', label: '▭ Rect', key: 'r' },
  { id: 'rectfill', label: '■ Filled', key: 'f' },
  { id: 'fill', label: '🪣 Fill', key: 'g' },
  { id: 'pick', label: '💧 Pick', key: 'i' }
]

const UNDO_LIMIT = 100

export interface StudioDeps {
  transport: BleTransport
  hat: HatClient
  log: (msg: string) => void
}

/** Wires up the Studio tab: pixel editor, frame strip, preview and on-hat playback. */
export function initStudio({ transport, hat, log }: StudioDeps): { player: AnimationPlayer } {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

  let anim: Animation = newAnimation()
  let current = 0
  let tool: Tool = 'pencil'
  let colour = 1
  let onionOn = true
  const undo: { frames: Animation['frames']; current: number }[] = []
  const redo: typeof undo = []

  const grid = new PixelGrid(true, 24)
  $('studio-canvas').appendChild(grid.canvas)
  const player = new AnimationPlayer(hat)

  // ---------- helpers ----------
  const frame = (): Frame => anim.frames[current]!.pixels
  const snapshot = (): { frames: Animation['frames']; current: number } => ({
    frames: anim.frames.map((f) => ({ pixels: f.pixels.slice(), durationMs: f.durationMs })),
    current
  })
  const pushUndo = (): void => {
    undo.push(snapshot())
    if (undo.length > UNDO_LIMIT) undo.shift()
    redo.length = 0
  }
  const restore = (s: ReturnType<typeof snapshot>): void => {
    anim.frames = s.frames
    current = Math.min(s.current, anim.frames.length - 1)
    refresh()
  }
  const status = (msg: string): void => {
    $('studio-status').textContent = msg
  }

  function refresh(): void {
    grid.frame = frame()
    grid.onion = onionOn && current > 0 ? anim.frames[current - 1]!.pixels : null
    grid.preview = null
    grid.draw()
    renderStrip()
    $<HTMLInputElement>('frame-duration').value = String(anim.frames[current]!.durationMs)
    $<HTMLInputElement>('anim-name').value = anim.name
    updateEstimate()
  }

  function renderStrip(): void {
    const strip = $('frame-strip')
    strip.replaceChildren(
      ...anim.frames.map((f, i) => {
        const item = document.createElement('div')
        item.className = 'frame-item' + (i === current ? ' current' : '')
        item.appendChild(renderThumb(f.pixels, 3))
        const label = document.createElement('div')
        label.className = 'frame-label'
        label.textContent = `${i + 1} · ${f.durationMs}ms`
        item.appendChild(label)
        item.onclick = () => {
          current = i
          refresh()
        }
        return item
      })
    )
  }

  function updateEstimate(): void {
    const est = estimateLoop(
      anim.frames.map((f) => f.pixels),
      // Steady state while looping: the live canvas holds the last frame.
      { showing: 'live', liveCanvas: anim.frames[anim.frames.length - 1]!.pixels },
      player.costs
    )
    const wanted = anim.frames.reduce((n, f) => n + f.durationMs, 0)
    const transfer = Math.round(est.totalMs)
    const counts = est.steps.reduce<Record<string, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {})
    const loopMs = Math.max(wanted, transfer)
    $('anim-estimate').textContent =
      `${anim.frames.length} frame(s) · loop ≈ ${(loopMs / 1000).toFixed(2)} s (designed ${(wanted / 1000).toFixed(2)} s)` +
      ` · transfer ≈ ${(transfer / 1000).toFixed(2)} s/loop` +
      ` · ${counts['stream'] ?? 0} streamed, ${counts['upload'] ?? 0} uploaded, ${counts['none'] ?? 0} unchanged`
    // Frames whose changes take longer than their duration will run late.
    const slow = anim.frames.filter((f, i) => {
      const prev = anim.frames[(i - 1 + anim.frames.length) % anim.frames.length]!.pixels
      return anim.frames.length > 1 && player.costs.strategy !== 'upload' && diffPixels(prev, f.pixels).length * player.costs.pixelMs > f.durationMs
    }).length
    $('anim-estimate').textContent += slow ? ` · ⚠ ${slow} frame(s) change too many pixels for their duration and will run late` : ''
  }

  // ---------- tools ----------
  const toolBar = $('tool-bar')
  for (const t of TOOLS) {
    const b = document.createElement('button')
    b.className = 'tool' + (t.id === tool ? ' selected' : '')
    b.textContent = t.label
    b.title = `${t.label} (${t.key.toUpperCase()})`
    b.dataset['tool'] = t.id
    b.onclick = () => selectTool(t.id)
    toolBar.appendChild(b)
  }
  function selectTool(t: Tool): void {
    tool = t
    toolBar.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.classList.toggle('selected', b.dataset['tool'] === t))
  }

  const pal = $('studio-palette')
  PALETTE_CSS.forEach((css, i) => {
    const b = document.createElement('button')
    b.className = 'swatch' + (i === colour ? ' selected' : '')
    b.style.background = css
    b.title = `${i} ${PALETTE_NAMES[i]} (key ${i})`
    b.textContent = String(i)
    b.onclick = () => selectColour(i)
    pal.appendChild(b)
  })
  function selectColour(i: number): void {
    colour = i
    pal.querySelectorAll('.swatch').forEach((s, j) => s.classList.toggle('selected', j === i))
  }

  let anchor: Point | null = null
  let stroking = false
  grid.onStroke = (phase, x, y, button) => {
    const c = button === 2 || tool === 'eraser' ? 0 : colour
    const p = { x, y }
    switch (tool) {
      case 'pencil':
      case 'eraser': {
        if (phase === 'down') {
          pushUndo()
          stroking = true
          anchor = p
          plot(frame(), [p], c)
        } else if (phase === 'move' && stroking && anchor) {
          plot(frame(), linePoints(anchor, p), c) // connect fast mouse moves
          anchor = p
        } else if (phase === 'up') {
          stroking = false
          anchor = null
          renderStrip()
          updateEstimate()
        }
        grid.draw()
        break
      }
      case 'line':
      case 'rect':
      case 'rectfill': {
        if (phase === 'down') anchor = p
        if (!anchor) break
        const pts = tool === 'line' ? linePoints(anchor, p) : rectPoints(anchor, p, tool === 'rectfill')
        if (phase === 'up') {
          pushUndo()
          plot(frame(), pts, c)
          grid.preview = null
          anchor = null
          renderStrip()
          updateEstimate()
        } else {
          const prev = new Uint8Array(frame().length).fill(255)
          plot(prev, pts, c)
          grid.preview = prev
        }
        grid.draw()
        break
      }
      case 'fill':
        if (phase === 'down') {
          pushUndo()
          floodFill(frame(), p, c)
          grid.draw()
          renderStrip()
          updateEstimate()
        }
        break
      case 'pick':
        if (phase === 'down') {
          selectColour(frame()[y * WIDTH + x]!)
          selectTool('pencil')
        }
        break
    }
  }

  // ---------- frame operations ----------
  $('frame-add').onclick = () => {
    pushUndo()
    anim.frames.splice(current + 1, 0, { pixels: blankFrame(), durationMs: anim.frames[current]!.durationMs })
    current++
    refresh()
  }
  $('frame-dup').onclick = () => {
    pushUndo()
    const f = anim.frames[current]!
    anim.frames.splice(current + 1, 0, { pixels: f.pixels.slice(), durationMs: f.durationMs })
    current++
    refresh()
  }
  $('frame-del').onclick = () => {
    pushUndo()
    if (anim.frames.length === 1) anim.frames[0] = { pixels: blankFrame(), durationMs: DEFAULT_DURATION_MS }
    else anim.frames.splice(current, 1)
    current = Math.min(current, anim.frames.length - 1)
    refresh()
  }
  const move = (d: number): void => {
    const j = current + d
    if (j < 0 || j >= anim.frames.length) return
    pushUndo()
    ;[anim.frames[current], anim.frames[j]] = [anim.frames[j]!, anim.frames[current]!]
    current = j
    refresh()
  }
  $('frame-left').onclick = () => move(-1)
  $('frame-right').onclick = () => move(1)
  $('frame-clear').onclick = () => {
    pushUndo()
    frame().fill(0)
    refresh()
  }
  const shiftBy = (dx: number, dy: number): void => {
    pushUndo()
    anim.frames[current]!.pixels = shift(frame(), dx, dy)
    refresh()
  }
  $('shift-left').onclick = () => shiftBy(-1, 0)
  $('shift-right').onclick = () => shiftBy(1, 0)
  $('shift-up').onclick = () => shiftBy(0, -1)
  $('shift-down').onclick = () => shiftBy(0, 1)
  $<HTMLInputElement>('frame-duration').onchange = (e) => {
    pushUndo()
    anim.frames[current]!.durationMs = Math.max(20, Number((e.target as HTMLInputElement).value) || DEFAULT_DURATION_MS)
    refresh()
  }
  $('duration-all').onclick = () => {
    pushUndo()
    const d = anim.frames[current]!.durationMs
    anim.frames.forEach((f) => (f.durationMs = d))
    refresh()
  }
  $<HTMLInputElement>('onion').onchange = (e) => {
    onionOn = (e.target as HTMLInputElement).checked
    refresh()
  }
  $<HTMLInputElement>('anim-name').onchange = (e) => {
    anim.name = (e.target as HTMLInputElement).value || 'Untitled'
  }

  // ---------- undo / keyboard ----------
  const doUndo = (): void => {
    const s = undo.pop()
    if (!s) return
    redo.push(snapshot())
    restore(s)
  }
  const doRedo = (): void => {
    const s = redo.pop()
    if (!s) return
    undo.push(snapshot())
    restore(s)
  }
  $('undo').onclick = doUndo
  $('redo').onclick = doRedo
  window.addEventListener('keydown', (e) => {
    if ($('studio-view').hidden) return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    if (e.ctrlKey && e.key.toLowerCase() === 'z') return void (e.preventDefault(), e.shiftKey ? doRedo() : doUndo())
    if (e.ctrlKey && e.key.toLowerCase() === 'y') return void (e.preventDefault(), doRedo())
    if (e.key >= '0' && e.key <= '7') return selectColour(Number(e.key))
    if (e.key === 'ArrowLeft' && current > 0) return void ((current -= 1), refresh())
    if (e.key === 'ArrowRight' && current < anim.frames.length - 1) return void ((current += 1), refresh())
    const t = TOOLS.find((t) => t.key === e.key.toLowerCase())
    if (t) selectTool(t.id)
  })

  // ---------- preview (on screen only) ----------
  let previewTimer: ReturnType<typeof setTimeout> | null = null
  const previewBtn = $<HTMLButtonElement>('preview-play')
  previewBtn.onclick = () => {
    if (previewTimer) {
      clearTimeout(previewTimer)
      previewTimer = null
      previewBtn.textContent = '▶ Preview'
      refresh()
      return
    }
    previewBtn.textContent = '■ Stop preview'
    let i = 0
    const tick = (): void => {
      const f = anim.frames[i % anim.frames.length]!
      grid.frame = f.pixels
      grid.onion = null
      grid.draw()
      i++
      previewTimer = setTimeout(tick, f.durationMs)
    }
    tick()
  }

  // ---------- hat ----------
  const studioEffect = $<HTMLSelectElement>('studio-effect')
  EFFECT_NAMES.forEach((name, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = name
    studioEffect.appendChild(o)
  })
  studioEffect.value = '0'

  const hatButtons = ['send-still', 'play-hat', 'clear-hat'].map((id) => $<HTMLButtonElement>(id))
  transport.on((e) => {
    if (e.type === 'connected' || e.type === 'disconnected') {
      hatButtons.forEach((b) => (b.disabled = e.type !== 'connected'))
      player.invalidate()
      if (e.type === 'disconnected') setPlaying(false)
    }
  })

  $('clear-hat').onclick = async () => {
    try {
      await player.stop()
      setPlaying(false)
      await player.clear()
      status('Hat cleared.')
      log('Studio: cleared hat (blank upload)')
    } catch (err) {
      status(`Clear failed: ${(err as Error).message}`)
      log(`Studio: clear failed: ${(err as Error).message}`)
    }
  }

  $('send-still').onclick = async () => {
    try {
      await player.stop()
      const effect = Number(studioEffect.value) as Effect
      const r = await hat.sendDrawing(frame(), 'column', effect)
      player.noteDrawingShown(r)
      status(`Frame ${current + 1} sent as still (${EFFECT_NAMES[effect]}) — ${r}. It stays on the hat after disconnecting.`)
      log(`Studio: sent frame ${current + 1} as still, effect ${EFFECT_NAMES[effect]} (${r})`)
    } catch (err) {
      status(`Send failed: ${(err as Error).message}`)
      log(`Studio: send failed: ${(err as Error).message}`)
    }
  }

  const strategySel = $<HTMLSelectElement>('strategy')
  strategySel.value = player.costs.strategy
  strategySel.onchange = () => {
    player.costs.strategy = strategySel.value as Strategy
    updateEstimate()
  }

  const eraseSel = $<HTMLSelectElement>('erase-order')
  eraseSel.value = player.costs.eraseOrder
  eraseSel.onchange = () => {
    player.costs.eraseOrder = eraseSel.value as EraseOrder
    log(`Studio: erase order ${player.costs.eraseOrder}`)
  }

  // Pixel gap is shared with the probe's write-gap; ~1.5 ms of overhead per write on top.
  const gapInput = $<HTMLInputElement>('studio-gap')
  const syncGap = (): void => {
    gapInput.value = String(transport.writeGapMs)
    player.costs.pixelMs = transport.writeGapMs + 1.5
    updateEstimate()
  }
  gapInput.onchange = () => {
    transport.writeGapMs = Math.max(0, Math.min(100, Number(gapInput.value) || 0))
    log(`Studio: pixel gap ${transport.writeGapMs} ms`)
    syncGap()
  }
  gapInput.addEventListener('focus', syncGap)
  syncGap()

  const playBtn = $<HTMLButtonElement>('play-hat')
  function setPlaying(on: boolean): void {
    playBtn.textContent = on ? '■ Stop on hat' : '▶ Play on hat'
    playBtn.classList.toggle('danger', on)
  }
  let reports: { step: string; pixels: number; actualMs: number; targetMs: number }[] = []
  player.onFrame = (r) => {
    reports.push(r)
    if (r.index === anim.frames.length - 1) {
      const late = reports.filter((x) => x.actualMs > x.targetMs + 20).length
      log(
        `Studio loop: ${reports.length} frames, ${reports.map((x) => (x.step === 'stream' ? `s${x.pixels}` : x.step[0])).join(' ')}` +
          ` · total ${reports.reduce((n, x) => n + x.actualMs, 0)} ms (designed ${reports.reduce((n, x) => n + x.targetMs, 0)} ms), ${late} late`
      )
      reports = []
    }
    const late = r.actualMs > r.targetMs + 20
    status(
      `Playing frame ${r.index + 1}/${anim.frames.length}: ${r.step}` +
        (r.step === 'stream' ? ` ${r.pixels} px` : '') +
        ` · ${r.actualMs} ms (target ${r.targetMs})${late ? ' — running late' : ''}`
    )
  }
  playBtn.onclick = async () => {
    if (player.isPlaying) {
      await player.stop()
      setPlaying(false)
      status('Stopped.')
      return
    }
    setPlaying(true)
    reports = []
    if (player.needsSync && player.costs.strategy !== 'upload')
      status('First play since connecting: clearing the hat first (~0.3 s)…')
    log(`Studio: playing "${anim.name}" on hat (${anim.frames.length} frames, loop=${$<HTMLInputElement>('loop').checked})`)
    player.play(anim, $<HTMLInputElement>('loop').checked)
    // Reflect natural end of a non-looping run.
    const poll = setInterval(() => {
      if (!player.isPlaying) {
        clearInterval(poll)
        setPlaying(false)
      }
    }, 200)
  }

  // ---------- files ----------
  $('anim-new').onclick = () => {
    pushUndo()
    anim = newAnimation()
    current = 0
    refresh()
  }
  $('anim-save').onclick = async () => {
    const path = await window.hat.saveFile(anim.name, serialize(anim))
    if (path) status(`Saved to ${path}`)
  }
  $('anim-open').onclick = async () => {
    const f = await window.hat.openFile()
    if (!f) return
    try {
      pushUndo()
      anim = deserialize(f.content)
      current = 0
      refresh()
      status(`Opened ${f.path}`)
    } catch (err) {
      status(`Could not open: ${(err as Error).message}`)
    }
  }

  refresh()
  return { player }
}
