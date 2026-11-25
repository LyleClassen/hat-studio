import type { HatClient } from '../protocol/client'
import { Effect } from '../protocol/commands'
import type { Frame } from '../protocol/frame'
import type { Animation } from './model'
import { DEFAULT_COSTS, applyStep, planStep, type CostModel, type HatState, type Step } from './plan'

export interface FrameReport {
  index: number
  step: Step['kind']
  pixels: number
  actualMs: number
  targetMs: number
}

/**
 * Plays an animation on the hat from the PC, choosing per frame between
 * streaming changed pixels and a full drawing upload (see plan.ts).
 * Frames that take longer to transfer than their duration simply run late;
 * the UI shows the achieved timing.
 */
export class AnimationPlayer {
  private stopping = false
  private running: Promise<void> | null = null
  private state: HatState = { showing: 'unknown', liveCanvas: null }
  costs: CostModel = { ...DEFAULT_COSTS }
  onFrame: ((r: FrameReport) => void) | null = null

  constructor(private readonly hat: HatClient) {}

  get isPlaying(): boolean {
    return this.running !== null
  }

  /** Forget everything we know about the hat (reconnects, probe tests that draw live). */
  invalidate(): void {
    this.state = { showing: 'unknown', liveCanvas: null }
  }

  /**
   * A drawing was uploaded by someone else (e.g. "Send as still"): the hat now
   * shows the stored drawing.
   */
  noteDrawingShown(result: 'sent' | 'stored'): void {
    // A real upload wipes the live canvas (probe test 7). If the hat already had
    // the drawing ('stored'), no data was sent and the effect is unverified.
    this.state = { showing: 'drawing', liveCanvas: result === 'sent' ? new Uint8Array(512) : null }
  }

  /** True when the next streamed frame needs a full 512-pixel sync first. */
  get needsSync(): boolean {
    return this.state.liveCanvas === null
  }

  /** Blanks the hat's live canvas with one upload (~0.3 s) and shows it. */
  async clear(): Promise<void> {
    const r = await this.hat.clearScreen()
    this.state = { showing: 'live', liveCanvas: r === 'sent' ? new Uint8Array(512) : null }
  }

  /** Shows a single frame using the cheapest route. */
  async showFrame(frame: Frame, last: Frame | null = null): Promise<Step> {
    // Unknown live canvas: a full sync would stream all 512 pixels (~8 s).
    // Clear it with a blank upload instead, then stream only the lit pixels.
    if (this.state.liveCanvas === null && this.costs.strategy !== 'upload') await this.clear()
    const step = planStep(this.state, frame, last, this.costs)
    switch (step.kind) {
      case 'stream':
        if (step.switchMode) await this.hat.enterDrawMode()
        for (const p of step.pixels) await this.hat.pixel(p.x, p.y, p.colour)
        break
      case 'upload': {
        // Static, or the hat would scroll each uploaded frame.
        const r = await this.hat.sendDrawing(frame, 'column', Effect.Static)
        this.state = applyStep(this.state, step, frame)
        if (r === 'stored') this.state = { ...this.state, liveCanvas: null }
        return step
      }
    }
    this.state = applyStep(this.state, step, frame)
    return step
  }

  play(anim: Animation, loop: boolean): void {
    if (this.running) return
    this.stopping = false
    this.running = (async () => {
      let last: Frame | null = null
      try {
        do {
          for (let i = 0; i < anim.frames.length && !this.stopping; i++) {
            const f = anim.frames[i]!
            const t0 = performance.now()
            const step = await this.showFrame(f.pixels, last)
            last = f.pixels
            const spent = performance.now() - t0
            const wait = f.durationMs - spent
            if (wait > 0 && !this.stopping) await new Promise((r) => setTimeout(r, wait))
            this.onFrame?.({
              index: i,
              step: step.kind,
              pixels: step.kind === 'stream' ? step.pixels.length : step.kind === 'upload' ? 512 : 0,
              actualMs: Math.round(performance.now() - t0),
              targetMs: f.durationMs
            })
          }
        } while (loop && !this.stopping && anim.frames.length > 0)
      } finally {
        this.running = null
      }
    })()
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.running
  }
}
