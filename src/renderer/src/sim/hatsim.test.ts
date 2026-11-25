import { describe, expect, it } from 'vitest'
import { LED_DATA, LED_WRITE } from '../ble/uuids'
import { Colour, DisplayMode, blankFrame, enterMode, livePixel, packFrame, WIDTH } from '../protocol/frame'
import { applyUpload, dataPacket, drawingHeader, UploadType } from '../protocol/upload'
import { HatSim, unpackColumnMajor } from './hatsim'

function upload(sim: HatSim, frame: Uint8Array): void {
  const packed = packFrame(frame, 'column')
  sim.feed(LED_WRITE, enterMode(DisplayMode.Drawing))
  sim.feed(LED_WRITE, drawingHeader(packed, 0))
  sim.feed(LED_DATA, dataPacket(UploadType.Drawing, packed))
  sim.feed(LED_WRITE, applyUpload())
}

describe('HatSim', () => {
  it('unpacks what packFrame packs', () => {
    const f = blankFrame()
    f[3 * WIDTH + 7] = Colour.Cyan
    f[15 * WIDTH + 31] = Colour.White
    expect(unpackColumnMajor(packFrame(f, 'column'))).toEqual(f)
  })

  it('tracks live pixels and mode switches; the live canvas persists across a switch', () => {
    const sim = new HatSim()
    sim.feed(LED_WRITE, enterMode(DisplayMode.LiveDraw))
    sim.feed(LED_WRITE, livePixel(2, 1, Colour.Red))
    expect(sim.visible![1 * WIDTH + 2]).toBe(Colour.Red)
    sim.feed(LED_WRITE, enterMode(DisplayMode.Drawing))
    expect(sim.mode).toBe('drawing')
    sim.feed(LED_WRITE, enterMode(DisplayMode.LiveDraw))
    expect(sim.visible![1 * WIDTH + 2]).toBe(Colour.Red)
  })

  it('an upload shows the drawing and wipes the live canvas (probe test 7)', () => {
    const sim = new HatSim()
    sim.feed(LED_WRITE, enterMode(DisplayMode.LiveDraw))
    sim.feed(LED_WRITE, livePixel(0, 0, Colour.Red))
    const blue = blankFrame()
    blue[5] = Colour.Blue
    upload(sim, blue)
    expect(sim.visible).toEqual(blue)
    sim.feed(LED_WRITE, enterMode(DisplayMode.LiveDraw))
    expect(sim.visible).toEqual(blankFrame())
  })
})
