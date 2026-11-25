import { HEIGHT, WIDTH, type Frame } from '../protocol/frame'

/** Display colours for the hat palette indices 0–7 (confirmed order). */
export const PALETTE_CSS = ['#20232b', '#ff3030', '#30e040', '#3060ff', '#ffe030', '#ff40ff', '#30f0f0', '#ffffff']
export const PALETTE_NAMES = ['off', 'red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white']

const GAP = 1

export type StrokePhase = 'down' | 'move' | 'up'
export type StrokeHandler = (phase: StrokePhase, x: number, y: number, button: number) => void

/**
 * A 32×16 pixel grid drawn on a canvas.
 * - editable + no onStroke: click/drag paints `paintColour`, right-click erases.
 * - onStroke set: raw cell events are forwarded (used by the Studio tools).
 */
export class PixelGrid {
  readonly canvas: HTMLCanvasElement
  frame: Frame = new Uint8Array(WIDTH * HEIGHT)
  /** Optional faint overlay (previous frame) drawn under empty cells. */
  onion: Frame | null = null
  /** Optional preview layer (e.g. line/rect being dragged), drawn on top. */
  preview: Frame | null = null
  paintColour = 1
  onChange: (() => void) | null = null
  onStroke: StrokeHandler | null = null

  constructor(
    editable: boolean,
    private readonly cell = 14
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH * (cell + GAP) + GAP
    this.canvas.height = HEIGHT * (cell + GAP) + GAP
    this.canvas.className = editable ? 'grid editable' : 'grid'
    if (editable) this.bindPointer()
    this.draw()
  }

  set(frame: Frame): void {
    this.frame = frame.slice()
    this.draw()
  }

  clear(): void {
    this.frame.fill(0)
    this.draw()
    this.onChange?.()
  }

  draw(): void {
    const ctx = this.canvas.getContext('2d')!
    const c = this.cell
    ctx.fillStyle = '#0b0c10'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = y * WIDTH + x
        const v = this.preview && this.preview[i] !== 255 ? this.preview[i]! : this.frame[i]!
        const px = GAP + x * (c + GAP)
        const py = GAP + y * (c + GAP)
        ctx.fillStyle = PALETTE_CSS[v & 7]!
        ctx.fillRect(px, py, c, c)
        if (v === 0 && this.onion && this.onion[i]) {
          ctx.globalAlpha = 0.22
          ctx.fillStyle = PALETTE_CSS[this.onion[i]! & 7]!
          ctx.fillRect(px, py, c, c)
          ctx.globalAlpha = 1
        }
      }
    }
    // Guides every 8 columns / at the vertical middle, to help counting.
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    for (let x = 8; x < WIDTH; x += 8) ctx.fillRect(x * (c + GAP), 0, GAP, this.canvas.height)
    ctx.fillRect(0, 8 * (c + GAP), this.canvas.width, GAP)
  }

  private cellAt(ev: MouseEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect()
    const x = Math.floor(((ev.clientX - r.left) * (this.canvas.width / r.width)) / (this.cell + GAP))
    const y = Math.floor(((ev.clientY - r.top) * (this.canvas.height / r.height)) / (this.cell + GAP))
    return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? { x, y } : null
  }

  private bindPointer(): void {
    let button: number | null = null
    let last: { x: number; y: number } | null = null
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.canvas.addEventListener('mousedown', (e) => {
      const c = this.cellAt(e)
      if (!c) return
      button = e.button
      last = c
      this.dispatch('down', c.x, c.y, button)
    })
    this.canvas.addEventListener('mousemove', (e) => {
      if (button === null) return
      const c = this.cellAt(e)
      if (!c || (last && c.x === last.x && c.y === last.y)) return
      last = c
      this.dispatch('move', c.x, c.y, button)
    })
    window.addEventListener('mouseup', () => {
      if (button === null) return
      const b = button
      button = null
      if (last) this.dispatch('up', last.x, last.y, b)
      last = null
    })
  }

  private dispatch(phase: StrokePhase, x: number, y: number, button: number): void {
    if (this.onStroke) {
      this.onStroke(phase, x, y, button)
      return
    }
    if (phase === 'up') return
    const v = button === 2 ? 0 : this.paintColour
    const i = y * WIDTH + x
    if (this.frame[i] === v) return
    this.frame[i] = v
    this.draw()
    this.onChange?.()
  }
}

/** Compact text form: one line per row, one digit (0–7) per pixel, '.' for 0. */
export function frameToText(frame: Frame): string {
  const rows: string[] = []
  for (let y = 0; y < HEIGHT; y++) {
    let s = ''
    for (let x = 0; x < WIDTH; x++) {
      const v = frame[y * WIDTH + x]!
      s += v === 0 ? '.' : String(v)
    }
    rows.push(`${String(y).padStart(2, ' ')} ${s}`)
  }
  return rows.join('\n')
}

export function countDiff(a: Frame, b: Frame): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

/** Small thumbnail canvas for the frame strip. */
export function renderThumb(frame: Frame, scale = 3): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = WIDTH * scale
  c.height = HEIGHT * scale
  const ctx = c.getContext('2d')!
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      ctx.fillStyle = PALETTE_CSS[frame[y * WIDTH + x]! & 7]!
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  return c
}
