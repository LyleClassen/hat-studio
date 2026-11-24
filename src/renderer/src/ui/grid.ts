import { HEIGHT, WIDTH, type Frame } from '../protocol/frame'

/** Display colours for the hat palette indices 0–7 (confirmed order). */
export const PALETTE_CSS = ['#20232b', '#ff3030', '#30e040', '#3060ff', '#ffe030', '#ff40ff', '#30f0f0', '#ffffff']
export const PALETTE_NAMES = ['off', 'red', 'green', 'blue', 'yellow', 'magenta', 'cyan', 'white']

const CELL = 14
const GAP = 1

/**
 * A 32×16 pixel grid drawn on a canvas. Optionally editable: click/drag paints
 * the selected colour; right-click erases.
 */
export class PixelGrid {
  readonly canvas: HTMLCanvasElement
  frame: Frame = new Uint8Array(WIDTH * HEIGHT)
  paintColour = 1
  onChange: (() => void) | null = null

  constructor(editable: boolean) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH * (CELL + GAP) + GAP
    this.canvas.height = HEIGHT * (CELL + GAP) + GAP
    this.canvas.className = editable ? 'grid editable' : 'grid'
    if (editable) this.bindPainting()
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
    ctx.fillStyle = '#0b0c10'
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        ctx.fillStyle = PALETTE_CSS[this.frame[y * WIDTH + x]! & 7]!
        ctx.fillRect(GAP + x * (CELL + GAP), GAP + y * (CELL + GAP), CELL, CELL)
      }
    }
    // Quadrant guides every 8 columns / rows, to help counting.
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    for (let x = 8; x < WIDTH; x += 8) ctx.fillRect(x * (CELL + GAP), 0, GAP, this.canvas.height)
    ctx.fillRect(0, 8 * (CELL + GAP), this.canvas.width, GAP)
  }

  private cellAt(ev: MouseEvent): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect()
    const x = Math.floor(((ev.clientX - r.left) * (this.canvas.width / r.width)) / (CELL + GAP))
    const y = Math.floor(((ev.clientY - r.top) * (this.canvas.height / r.height)) / (CELL + GAP))
    return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT ? { x, y } : null
  }

  private bindPainting(): void {
    let painting: number | null = null
    const paint = (ev: MouseEvent): void => {
      const c = this.cellAt(ev)
      if (!c || painting === null) return
      const i = c.y * WIDTH + c.x
      if (this.frame[i] === painting) return
      this.frame[i] = painting
      this.draw()
      this.onChange?.()
    }
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.canvas.addEventListener('mousedown', (e) => {
      painting = e.button === 2 ? 0 : this.paintColour
      paint(e)
    })
    this.canvas.addEventListener('mousemove', paint)
    window.addEventListener('mouseup', () => (painting = null))
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
