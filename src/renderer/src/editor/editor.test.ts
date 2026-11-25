import { describe, expect, it } from 'vitest'
import { blankFrame, Colour, HEIGHT, WIDTH } from '../protocol/frame'
import { deserialize, newAnimation, serialize } from './model'
import { floodFill, linePoints, plot, rectPoints, shift } from './tools'
import { DEFAULT_COSTS, applyStep, diffPixels, estimateLoop, planStep, type HatState } from './plan'

describe('tools', () => {
  it('draws a diagonal line inclusive of endpoints', () => {
    expect(linePoints({ x: 0, y: 0 }, { x: 3, y: 3 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 }
    ])
  })
  it('rect outline vs filled', () => {
    expect(rectPoints({ x: 0, y: 0 }, { x: 2, y: 2 }, false)).toHaveLength(8)
    expect(rectPoints({ x: 2, y: 2 }, { x: 0, y: 0 }, true)).toHaveLength(9)
  })
  it('flood fill stops at boundaries', () => {
    const f = blankFrame()
    plot(f, rectPoints({ x: 0, y: 0 }, { x: 4, y: 4 }, false), Colour.Red)
    floodFill(f, { x: 2, y: 2 }, Colour.Blue)
    expect(f[2 * WIDTH + 2]).toBe(Colour.Blue)
    expect(f[0]).toBe(Colour.Red)
    expect(f[10 * WIDTH + 10]).toBe(Colour.Off)
  })
  it('shift wraps around', () => {
    const f = blankFrame()
    f[0] = Colour.White
    expect(shift(f, -1, 0)[WIDTH - 1]).toBe(Colour.White)
    expect(shift(f, 0, -1)[(HEIGHT - 1) * WIDTH]).toBe(Colour.White)
  })
})

describe('model', () => {
  it('round-trips through the file format', () => {
    const a = newAnimation('test')
    a.frames[0]!.pixels[5] = Colour.Cyan
    a.frames.push({ pixels: blankFrame().fill(Colour.Yellow), durationMs: 120 })
    const b = deserialize(serialize(a))
    expect(b.name).toBe('test')
    expect(b.frames).toHaveLength(2)
    expect(b.frames[0]!.pixels[5]).toBe(Colour.Cyan)
    expect(b.frames[1]!.durationMs).toBe(120)
    expect(b.frames[1]!.pixels.every((v) => v === Colour.Yellow)).toBe(true)
  })
  it('rejects foreign files', () => {
    expect(() => deserialize('{"format":"nope"}')).toThrow()
  })
})

describe('planner', () => {
  const live: HatState = { showing: 'live', liveCanvas: blankFrame() }
  it('streams a small change', () => {
    const t = blankFrame()
    t[0] = Colour.Red
    const s = planStep(live, t, blankFrame())
    expect(s.kind).toBe('stream')
    if (s.kind === 'stream') expect(s.pixels).toEqual([{ x: 0, y: 0, colour: Colour.Red }])
  })
  const auto = { ...DEFAULT_COSTS, strategy: 'auto' as const }
  it('auto uploads a full-screen change', () => {
    const t = blankFrame().fill(Colour.White)
    expect(planStep(live, t, blankFrame(), auto).kind).toBe('upload')
  })
  it('smooth streams even a full-screen change (no flicker)', () => {
    const t = blankFrame().fill(Colour.White)
    const s = planStep(live, t, blankFrame())
    expect(s.kind).toBe('stream')
    if (s.kind === 'stream') expect(s.pixels).toHaveLength(512)
  })
  it('smooth syncs every pixel when the live canvas is unknown', () => {
    const s = planStep({ showing: 'unknown', liveCanvas: null }, blankFrame(), null)
    expect(s.kind).toBe('stream')
    if (s.kind === 'stream') expect(s.pixels).toHaveLength(512)
  })
  it('orders erasures first, last or interleaved', () => {
    const a = blankFrame()
    a[0] = Colour.White
    a[2] = Colour.White
    const b = blankFrame()
    b[1] = Colour.White
    b[3] = Colour.White
    const on1 = { x: 1, y: 0, colour: Colour.White }
    const on3 = { x: 3, y: 0, colour: Colour.White }
    const off0 = { x: 0, y: 0, colour: Colour.Off }
    const off2 = { x: 2, y: 0, colour: Colour.Off }
    expect(diffPixels(a, b)).toEqual([off0, off2, on1, on3])
    expect(diffPixels(a, b, 'last')).toEqual([on1, on3, off0, off2])
    expect(diffPixels(a, b, 'interleave')).toEqual([off0, on1, off2, on3])
  })
  it('does nothing for an identical frame', () => {
    const t = blankFrame()
    expect(planStep(live, t, t).kind).toBe('none')
  })
  it('after an upload, streams against the live canvas, not the shown drawing', () => {
    const full = blankFrame().fill(Colour.White)
    let st = applyStep(live, { kind: 'upload', estMs: 0 }, full)
    expect(st.showing).toBe('drawing')
    // An upload wipes the live canvas → streaming 512 white pixels loses to another upload.
    const next = full.slice()
    next[0] = Colour.Red
    expect(planStep(st, next, full, auto).kind).toBe('upload')
    st = applyStep(st, { kind: 'upload', estMs: 0 }, next)
    expect(st.liveCanvas).toEqual(blankFrame()) // probe test 7: uploads wipe the live canvas
  })
  it('smooth after an upload streams only lit pixels, not a 512-pixel sync', () => {
    const t = blankFrame()
    t[5] = Colour.Red
    t[9] = Colour.Blue
    const st = applyStep(live, { kind: 'upload', estMs: 0 }, blankFrame().fill(Colour.White))
    const s = planStep(st, t, null)
    expect(s.kind).toBe('stream')
    if (s.kind === 'stream') expect(s.pixels).toHaveLength(2)
  })
  it('with a clearing live canvas, diffs against blank on re-entry', () => {
    const st: HatState = { showing: 'drawing', liveCanvas: blankFrame().fill(Colour.Red) }
    const t = blankFrame()
    t[3] = Colour.Green
    const s = planStep(st, t, null, { ...DEFAULT_COSTS, strategy: 'auto', liveOnEnter: 'clears' })
    expect(s.kind).toBe('stream')
    if (s.kind === 'stream') expect(s.pixels).toHaveLength(1)
  })
  it('estimates a moving-dot loop as all streams', () => {
    const frames = Array.from({ length: 4 }, (_, i) => {
      const f = blankFrame()
      f[i] = Colour.White
      return f
    })
    const est = estimateLoop(frames, live)
    expect(est.steps).toEqual(['stream', 'stream', 'stream', 'stream'])
    expect(diffPixels(frames[0]!, frames[1]!)).toHaveLength(2)
  })
})
