import { OPTIONAL_SERVICES } from './uuids'

export interface CharInfo {
  serviceUuid: string
  uuid: string
  props: string[]
  char: BluetoothRemoteGATTCharacteristic
}

export type TransportEvent =
  | { type: 'connected'; name: string }
  | { type: 'disconnected' }
  | { type: 'notify'; uuid: string; data: Uint8Array }
  | { type: 'log'; message: string }
  /** A write that actually went out (after pacing), for the hat mirror. */
  | { type: 'tx'; uuid: string; data: Uint8Array }

type Listener = (e: TransportEvent) => void

function propsOf(p: BluetoothCharacteristicProperties): string[] {
  const names: (keyof BluetoothCharacteristicProperties)[] = [
    'read',
    'write',
    'writeWithoutResponse',
    'notify',
    'indicate',
    'broadcast',
    'authenticatedSignedWrites',
    'reliableWrite',
    'writableAuxiliaries'
  ]
  return names.filter((n) => p[n])
}

/**
 * Thin, protocol-agnostic BLE transport over Web Bluetooth.
 * All writes go through one serialized queue: GATT allows only one
 * outstanding operation at a time.
 */
export class BleTransport {
  private device: BluetoothDevice | null = null
  private chars = new Map<string, CharInfo>()
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<Listener>()
  /**
   * Minimum gap after each write-without-response. The hat silently drops
   * commands that arrive back-to-back (observed: ~130 unpaced pixel writes
   * lost a random subset), so writes are paced through the queue.
   */
  writeGapMs = 15

  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private emit(e: TransportEvent): void {
    for (const l of this.listeners) l(e)
  }

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false
  }

  get characteristics(): CharInfo[] {
    return [...this.chars.values()]
  }

  /** Must be called from a user gesture (click). */
  async requestAndConnect(): Promise<void> {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: OPTIONAL_SERVICES
    })
    await this.connect(device)
  }

  async connect(device: BluetoothDevice): Promise<void> {
    this.device = device
    device.addEventListener('gattserverdisconnected', this.onDisconnected)
    const server = await device.gatt!.connect()
    this.emit({ type: 'log', message: `GATT connected to ${device.name ?? device.id}` })

    this.chars.clear()
    const services = await server.getPrimaryServices()
    for (const svc of services) {
      for (const c of await svc.getCharacteristics()) {
        this.chars.set(c.uuid, {
          serviceUuid: svc.uuid,
          uuid: c.uuid,
          props: propsOf(c.properties),
          char: c
        })
      }
    }
    this.emit({ type: 'connected', name: device.name ?? device.id })
  }

  async subscribe(uuid: string): Promise<void> {
    const info = this.require(uuid)
    info.char.addEventListener('characteristicvaluechanged', (ev) => {
      const v = (ev.target as BluetoothRemoteGATTCharacteristic).value
      if (!v) return
      this.emit({
        type: 'notify',
        uuid,
        data: new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
      })
    })
    await info.char.startNotifications()
  }

  async read(uuid: string): Promise<Uint8Array> {
    const info = this.require(uuid)
    return this.enqueue(async () => {
      const v = await info.char.readValue()
      return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))
    })
  }

  write(uuid: string, data: Uint8Array, withResponse: boolean): Promise<void> {
    const info = this.require(uuid)
    // Copy into a fresh ArrayBuffer so callers can reuse their buffer.
    const buf = data.slice().buffer
    return this.enqueue(async () => {
      if (withResponse) await info.char.writeValueWithResponse(buf)
      else await info.char.writeValueWithoutResponse(buf)
      this.emit({ type: 'tx', uuid: uuid.toLowerCase(), data: new Uint8Array(buf) })
      if (withResponse) return
      if (this.writeGapMs > 0) await new Promise((r) => setTimeout(r, this.writeGapMs))
    })
  }

  disconnect(): void {
    this.device?.gatt?.disconnect()
  }

  private require(uuid: string): CharInfo {
    const info = this.chars.get(uuid.toLowerCase())
    if (!info) throw new Error(`Characteristic ${uuid} not found`)
    return info
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op)
    this.queue = next.catch(() => undefined)
    return next
  }

  private onDisconnected = (): void => {
    this.emit({ type: 'disconnected' })
  }
}
