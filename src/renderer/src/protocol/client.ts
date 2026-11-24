import type { BleTransport } from '../ble/transport'
import { LED_DATA, LED_NOTIFY, LED_WRITE } from '../ble/uuids'
import { parsePacket, type Packet } from './packet'
import { applyUpload, dataPacket, drawingHeader, STATUS_ALREADY_STORED, STATUS_SEND, textHeader, UploadType } from './upload'
import { DisplayMode, enterMode, livePixel, packFrame, type Frame } from './frame'
import { setBrightness, setSpeed, selectStoredItem, setEffect, type Effect } from './commands'

const TIMEOUT_MS = 3000

/** High-level hat API on top of the raw transport: request/ack handling and upload sequencing. */
export class HatClient {
  private waiters: { match: (p: Packet) => boolean; resolve: (p: Packet) => void }[] = []

  constructor(private readonly t: BleTransport) {
    t.on((e) => {
      if (e.type !== 'notify' || e.uuid !== LED_NOTIFY) return
      let p: Packet
      try {
        p = parsePacket(e.data)
      } catch {
        // The 9-byte data ack (01 01 00 00 00 01 01 00 00) is not standard-framed.
        p = { cmd: e.data[0] ?? -1, sub: e.data[1] ?? -1, payload: e.data.slice(2) }
      }
      const i = this.waiters.findIndex((w) => w.match(p))
      if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(p)
    })
  }

  private waitFor(cmd: number, sub: number): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const waiter = { match: (p: Packet) => p.cmd === cmd && p.sub === sub, resolve }
      this.waiters.push(waiter)
      setTimeout(() => {
        const i = this.waiters.indexOf(waiter)
        if (i >= 0) {
          this.waiters.splice(i, 1)
          reject(new Error(`timeout waiting for reply ${cmd.toString(16)}/${sub.toString(16)}`))
        }
      }, TIMEOUT_MS)
    })
  }

  /** Writes to A951 and waits for the reply with the same cmd/sub. */
  private async request(bytes: Uint8Array): Promise<Packet> {
    const reply = this.waitFor(bytes[0]!, bytes[1]!)
    await this.t.write(LED_WRITE, bytes, false)
    return reply
  }

  brightness(percent: number): Promise<void> {
    return this.t.write(LED_WRITE, setBrightness(percent), false)
  }

  speed(percent: number): Promise<void> {
    return this.t.write(LED_WRITE, setSpeed(percent), false)
  }

  async effect(effect: Effect): Promise<void> {
    const reply = await this.request(setEffect(effect))
    if (reply.payload[0] !== 0x01) throw new Error(`hat rejected effect ${effect} (status ${reply.payload[0]})`)
  }

  async selectStored(index: number): Promise<void> {
    await this.request(selectStoredItem(index))
  }

  /** Live canvas for 03/02 pixels. Hides stored content until another mode is shown. */
  async enterDrawMode(): Promise<void> {
    await this.request(enterMode(DisplayMode.LiveDraw))
  }

  /** Live pixel (no reply is sent by the hat). Call enterDrawMode() first. */
  pixel(x: number, y: number, colour: number): Promise<void> {
    return this.t.write(LED_WRITE, livePixel(x, y, colour), false)
  }

  /**
   * Experimental: several 03/02 pixel packets concatenated into one BLE write.
   * Only useful if the hat parses a byte stream rather than one packet per write.
   */
  async pixelsBatched(pixels: { x: number; y: number; colour: number }[], perWrite: number): Promise<number> {
    let writes = 0
    for (let i = 0; i < pixels.length; i += perWrite) {
      const chunk = pixels.slice(i, i + perWrite).map((p) => livePixel(p.x, p.y, p.colour))
      const buf = new Uint8Array(chunk.reduce((n, c) => n + c.length, 0))
      let o = 0
      for (const c of chunk) {
        buf.set(c, o)
        o += c.length
      }
      await this.t.write(LED_WRITE, buf, false)
      writes++
    }
    return writes
  }

  /** Full header → data → apply sequence. Returns 'stored' if the hat already had this content. */
  private async upload(type: UploadType, header: Uint8Array, data: Uint8Array): Promise<'sent' | 'stored'> {
    const status = (await this.request(header)).payload[0]
    if (status === STATUS_ALREADY_STORED) return 'stored'
    if (status !== STATUS_SEND) throw new Error(`hat rejected upload header (status ${status})`)
    const ack = this.waitFor(0x01, 0x01)
    await this.t.write(LED_DATA, dataPacket(type, data), false)
    await ack
    await this.request(applyUpload())
    return 'sent'
  }

  /** Switches what the hat displays (cmd 03/01). */
  async showMode(mode: DisplayMode): Promise<void> {
    await this.request(enterMode(mode))
  }

  /**
   * Uploads a full frame and shows it. Mirrors the app: switch to Drawing mode
   * (03/01 03) first, then upload. Entering LiveDraw afterwards would hide it.
   */
  async sendDrawing(
    frame: Frame,
    order: 'row' | 'column' = 'column',
    effect = 0x01
  ): Promise<'sent' | 'stored'> {
    const packed = packFrame(frame, order)
    await this.showMode(DisplayMode.Drawing)
    return this.upload(UploadType.Drawing, drawingHeader(packed, effect), packed)
  }

  /** Uploads text and shows it. Mirrors the app: switch to Text mode (03/01 04) first. */
  async sendText(glyphData: Uint8Array, effect = 0x01): Promise<'sent' | 'stored'> {
    await this.showMode(DisplayMode.Text)
    return this.upload(UploadType.Text, textHeader(glyphData, effect), glyphData)
  }
}
