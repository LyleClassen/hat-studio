import { LED_DATA, LED_WRITE } from '../ble/uuids'
import { HEIGHT, WIDTH, blankFrame, type Frame } from '../protocol/frame'
import { parsePacket } from '../protocol/packet'

export type SimMode = 'unknown' | 'live' | 'drawing' | 'text'

/**
 * Predicts what the hat displays from the exact bytes Hat Studio sends,
 * using only behaviour confirmed in docs/PROTOCOL.md:
 *  - 03/01 [mode] switches the display: 01 live canvas, 03 stored drawing, 04 stored text.
 *  - 03/02 [00][y][x][c] sets one live-canvas pixel.
 *  - Drawing upload: 04/01 header, A952 data (4bpp, column-major), 01/02 apply.
 *    After apply the stored drawing is replaced and the live canvas is wiped (probe test 7).
 *  - Text uploads are not rendered (shown as mode 'text').
 * If the hat shows something different from this model, the hat dropped or
 * misread a command, or the model is wrong — either way worth reporting.
 */
export class HatSim {
  mode: SimMode = 'unknown'
  live: Frame = blankFrame()
  drawing: Frame = blankFrame()
  /** Effect byte of the stored drawing (0 static, 1 left, …). */
  drawingEffect = 0
  /** Number of commands interpreted, for display. */
  commands = 0
  private pending: { type: 'drawing' | 'text'; effect: number; data: Frame | null } | null = null
  onChange: (() => void) | null = null

  reset(): void {
    this.mode = 'unknown'
    this.live = blankFrame()
    this.drawing = blankFrame()
    this.pending = null
    this.commands = 0
    this.onChange?.()
  }

  /** What should be on the panel right now (null: text or unknown). */
  get visible(): Frame | null {
    if (this.mode === 'live') return this.live
    if (this.mode === 'drawing') return this.drawing
    return null
  }

  feed(uuid: string, bytes: Uint8Array): void {
    const u = uuid.toLowerCase()
    if (u === LED_DATA.toLowerCase()) this.onData(bytes)
    else if (u === LED_WRITE.toLowerCase()) this.onCommand(bytes)
    else return
    this.commands++
    this.onChange?.()
  }

  private onCommand(bytes: Uint8Array): void {
    let p
    try {
      p = parsePacket(bytes)
    } catch {
      return
    }
    const key = (p.cmd << 8) | p.sub
    switch (key) {
      case 0x0301: {
        const m = p.payload[0]
        this.mode = m === 0x01 ? 'live' : m === 0x03 ? 'drawing' : m === 0x04 ? 'text' : 'unknown'
        break
      }
      case 0x0302: {
        const [, y, x, c] = p.payload
        if (y !== undefined && x !== undefined && c !== undefined && x < WIDTH && y < HEIGHT) this.live[y * WIDTH + x] = c
        break
      }
      case 0x0401:
        this.pending = { type: 'drawing', effect: p.payload[2] ?? 0, data: null }
        break
      case 0x0201:
        this.pending = { type: 'text', effect: p.payload[2] ?? 0, data: null }
        break
      case 0x0102:
        if (this.pending?.type === 'drawing' && this.pending.data) {
          this.drawing = this.pending.data
          this.drawingEffect = this.pending.effect
        }
        if (this.pending) this.live = blankFrame() // uploads wipe the live canvas
        this.pending = null
        break
    }
  }

  /** A952: [01][type][01][total u32][chunk u32][data][crc16]. */
  private onData(bytes: Uint8Array): void {
    if (!this.pending || bytes[1] !== 0x04 || bytes.length < 11 + 256) return
    this.pending.data = unpackColumnMajor(bytes.subarray(11, 11 + 256))
  }
}

/** Inverse of packFrame(frame, 'column'): 4bpp, high nibble first, x-major. */
export function unpackColumnMajor(packed: Uint8Array): Frame {
  const f = blankFrame()
  let i = 0
  for (let x = 0; x < WIDTH; x++)
    for (let y = 0; y < HEIGHT; y++, i++) {
      const b = packed[i >> 1] ?? 0
      f[y * WIDTH + x] = (i & 1) === 0 ? b >> 4 : b & 0x0f
    }
  return f
}
