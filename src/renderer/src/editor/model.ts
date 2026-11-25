import { HEIGHT, WIDTH, blankFrame, type Frame } from '../protocol/frame'

export interface AnimFrame {
  pixels: Frame
  /** How long this frame should stay on screen. */
  durationMs: number
}

export interface Animation {
  name: string
  frames: AnimFrame[]
}

export const DEFAULT_DURATION_MS = 300
const FILE_VERSION = 1

export function newAnimation(name = 'Untitled'): Animation {
  return { name, frames: [{ pixels: blankFrame(), durationMs: DEFAULT_DURATION_MS }] }
}

/** Serialised form: rows of digit strings keep files small and human-readable/diffable. */
interface AnimationFile {
  format: 'hat-studio-animation'
  version: number
  width: number
  height: number
  name: string
  frames: { durationMs: number; rows: string[] }[]
}

export function serialize(anim: Animation): string {
  const file: AnimationFile = {
    format: 'hat-studio-animation',
    version: FILE_VERSION,
    width: WIDTH,
    height: HEIGHT,
    name: anim.name,
    frames: anim.frames.map((f) => ({
      durationMs: f.durationMs,
      rows: Array.from({ length: HEIGHT }, (_, y) =>
        Array.from(f.pixels.subarray(y * WIDTH, (y + 1) * WIDTH), (v) => v.toString(16)).join('')
      )
    }))
  }
  return JSON.stringify(file, null, 1)
}

export function deserialize(text: string): Animation {
  const file = JSON.parse(text) as AnimationFile
  if (file.format !== 'hat-studio-animation') throw new Error('Not a Hat Studio animation file')
  if (file.width !== WIDTH || file.height !== HEIGHT) throw new Error(`Unsupported size ${file.width}×${file.height}`)
  if (!Array.isArray(file.frames) || file.frames.length === 0) throw new Error('Animation has no frames')
  return {
    name: String(file.name ?? 'Untitled'),
    frames: file.frames.map((f, i) => {
      if (f.rows.length !== HEIGHT || f.rows.some((r) => r.length !== WIDTH)) throw new Error(`Frame ${i + 1} has the wrong size`)
      const pixels = blankFrame()
      f.rows.forEach((row, y) => {
        for (let x = 0; x < WIDTH; x++) pixels[y * WIDTH + x] = parseInt(row[x]!, 16) & 7
      })
      return { pixels, durationMs: Math.max(20, Number(f.durationMs) || DEFAULT_DURATION_MS) }
    })
  }
}
