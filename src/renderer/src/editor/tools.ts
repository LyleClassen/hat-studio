import { HEIGHT, WIDTH, type Frame } from '../protocol/frame'

export type Point = { x: number; y: number }

const inBounds = (x: number, y: number): boolean => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT

/** Bresenham line, inclusive of both ends. */
export function linePoints(a: Point, b: Point): Point[] {
  const pts: Point[] = []
  let { x, y } = a
  const dx = Math.abs(b.x - a.x)
  const dy = -Math.abs(b.y - a.y)
  const sx = a.x < b.x ? 1 : -1
  const sy = a.y < b.y ? 1 : -1
  let err = dx + dy
  for (;;) {
    pts.push({ x, y })
    if (x === b.x && y === b.y) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return pts
}

/** Rectangle outline (or filled) between two corners. */
export function rectPoints(a: Point, b: Point, filled: boolean): Point[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
  const pts: Point[] = []
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (filled || x === x0 || x === x1 || y === y0 || y === y1) pts.push({ x, y })
  return pts
}

export function plot(frame: Frame, pts: Point[], colour: number): void {
  for (const p of pts) if (inBounds(p.x, p.y)) frame[p.y * WIDTH + p.x] = colour
}

/** 4-connected flood fill. */
export function floodFill(frame: Frame, start: Point, colour: number): void {
  if (!inBounds(start.x, start.y)) return
  const target = frame[start.y * WIDTH + start.x]!
  if (target === colour) return
  const stack: Point[] = [start]
  while (stack.length) {
    const { x, y } = stack.pop()!
    if (!inBounds(x, y) || frame[y * WIDTH + x] !== target) continue
    frame[y * WIDTH + x] = colour
    stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 })
  }
}

/** Shift a frame by (dx, dy) with wrap-around — handy for making scrolling animations. */
export function shift(frame: Frame, dx: number, dy: number): Frame {
  const out = new Uint8Array(frame.length)
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const nx = (((x + dx) % WIDTH) + WIDTH) % WIDTH
      const ny = (((y + dy) % HEIGHT) + HEIGHT) % HEIGHT
      out[ny * WIDTH + nx] = frame[y * WIDTH + x]!
    }
  return out
}
