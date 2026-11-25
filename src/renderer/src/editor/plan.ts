import { HEIGHT, WIDTH, type Frame } from '../protocol/frame'

/**
 * Per-frame transfer planning for animations played from the PC.
 *
 * The hat can't store custom animations, so each frame is either
 *  - streamed: only the changed pixels (including "off" pixels, which overwrite
 *    with black) as live 03/02 commands on the LiveDraw canvas, ~16 ms each, or
 *  - uploaded: the whole frame via a drawing upload (~0.26 s, any content, but
 *    the hat redraws the whole screen → visible flicker).
 *
 * The LiveDraw canvas and the stored drawing are separate displays. Streaming
 * diffs against what the live canvas holds; confirmed on the hat (2026-11-24)
 * that the live canvas keeps its pixels across plain mode switches, but a
 * drawing upload wipes it to blank (probe test 7).
 */

export type Strategy = 'smooth' | 'auto' | 'upload'

/**
 * Order of streamed pixels within a frame.
 * first:      erase old pixels, then draw new ones (trails vanish fastest)
 * interleave: alternate erase/draw so both progress together
 * last:       draw new pixels, then erase (object never shrinks, but leaves a trail)
 */
export type EraseOrder = 'first' | 'interleave' | 'last'

export interface CostModel {
  /** Time per streamed pixel (write gap + overhead). */
  pixelMs: number
  /** Time for a full drawing upload (header, data, apply round trips). */
  uploadMs: number
  /** Time for one 03/01 mode switch round trip. */
  modeSwitchMs: number
  /** Whether entering LiveDraw keeps previously streamed pixels. Confirmed 'persists'. */
  liveOnEnter: 'persists' | 'clears'
  /**
   * smooth: stream only (no flicker; big changes are slow)
   * auto:   cheapest per frame (uploads flicker)
   * upload: whole frames only
   */
  strategy: Strategy
  /** When "off" pixels are written relative to lit ones. */
  eraseOrder: EraseOrder
}

/** Measured on the hat 2026-11-24: 64 px in ~1.05 s; upload ≈ 0.29 s incl. mode switch. */
export const DEFAULT_COSTS: CostModel = {
  pixelMs: 16.5,
  uploadMs: 260,
  modeSwitchMs: 30,
  liveOnEnter: 'persists',
  strategy: 'smooth',
  eraseOrder: 'first'
}

export type Showing = 'live' | 'drawing' | 'unknown'

export interface HatState {
  showing: Showing
  /** What we believe the LiveDraw canvas holds, or null if unknown. */
  liveCanvas: Frame | null
}

export type Pixel = { x: number; y: number; colour: number }

export type Step =
  | { kind: 'stream'; pixels: Pixel[]; estMs: number; switchMode: boolean }
  | { kind: 'upload'; estMs: number }
  | { kind: 'none'; estMs: 0 }

/**
 * Pixels that differ between two frames. `from = null` means unknown: every
 * pixel is returned. `order` decides whether "off" pixels (erasures) go
 * before, between or after lit ones. On the hat each pixel takes ~16 ms, so
 * with 'last' the old position lingers until the whole new one is drawn
 * (reported as slow clearing, 2026-11-24); 'first' is the default.
 */
export function diffPixels(from: Frame | null, to: Frame, order: EraseOrder = 'first'): Pixel[] {
  const on: Pixel[] = []
  const off: Pixel[] = []
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = y * WIDTH + x
      if (from && from[i] === to[i]) continue
      ;(to[i] ? on : off).push({ x, y, colour: to[i]! })
    }
  if (order === 'first') return off.concat(on)
  if (order === 'last') return on.concat(off)
  const out: Pixel[] = []
  for (let i = 0; i < Math.max(on.length, off.length); i++) {
    if (i < off.length) out.push(off[i]!)
    if (i < on.length) out.push(on[i]!)
  }
  return out
}

/** Decide how to get `target` on screen from the current state. */
export function planStep(state: HatState, target: Frame, shownLast: Frame | null, costs = DEFAULT_COSTS): Step {
  const known = costs.strategy === 'smooth' ? state.showing === 'live' : state.showing !== 'unknown'
  if (known && shownLast && diffPixels(shownLast, target).length === 0) return { kind: 'none', estMs: 0 }

  const switchMode = state.showing !== 'live'
  const base = switchMode && costs.liveOnEnter === 'clears' ? new Uint8Array(target.length) : state.liveCanvas
  const pixels = diffPixels(base, target, costs.eraseOrder)
  const stream: Step = {
    kind: 'stream',
    pixels,
    switchMode,
    estMs: pixels.length * costs.pixelMs + (switchMode ? costs.modeSwitchMs : 0)
  }
  const upload: Step = { kind: 'upload', estMs: costs.uploadMs + (state.showing === 'drawing' ? 0 : costs.modeSwitchMs) }

  switch (costs.strategy) {
    case 'smooth':
      return stream
    case 'upload':
      return upload
    case 'auto':
      return base && stream.estMs <= upload.estMs ? stream : upload
  }
}

/** Applies a step to the state model. */
export function applyStep(state: HatState, step: Step, target: Frame): HatState {
  switch (step.kind) {
    case 'stream':
      return { showing: 'live', liveCanvas: target.slice() }
    case 'upload':
      // Probe test 7 (2026-11-24): a drawing upload wipes the live canvas to blank.
      return { showing: 'drawing', liveCanvas: new Uint8Array(target.length) }
    case 'none':
      return state
  }
}

/** Estimated time to play one loop of the animation (for the UI), starting from the end of the previous loop. */
export function estimateLoop(
  frames: Frame[],
  start: HatState,
  costs = DEFAULT_COSTS
): { totalMs: number; steps: Step['kind'][]; worstFrameMs: number } {
  let state = start
  let last: Frame | null = start.showing === 'live' ? start.liveCanvas : null
  let totalMs = 0
  let worstFrameMs = 0
  const steps: Step['kind'][] = []
  for (const f of frames) {
    const s = planStep(state, f, last, costs)
    totalMs += s.estMs
    worstFrameMs = Math.max(worstFrameMs, s.estMs)
    steps.push(s.kind)
    state = applyStep(state, s, f)
    last = f
  }
  return { totalMs, steps, worstFrameMs }
}
