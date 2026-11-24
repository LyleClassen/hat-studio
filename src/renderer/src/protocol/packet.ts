/**
 * Mini LedShow LED-channel framing (characteristic A951 → hat, A953 → app).
 * Confirmed against 596 packets captured from the official app (docs/PROTOCOL.md):
 *
 *   [cmd] [sub] [len_hi] [len_lo] [payload × len] [crc_hi] [crc_lo]
 *
 * crc = CRC-16/MODBUS over every preceding byte, transmitted big-endian.
 */

export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff
  for (const b of data) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
  }
  return crc
}

export function buildPacket(cmd: number, sub: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (payload.length > 0xffff) throw new Error(`payload too long: ${payload.length}`)
  const out = new Uint8Array(4 + payload.length + 2)
  out[0] = cmd & 0xff
  out[1] = sub & 0xff
  out[2] = (payload.length >>> 8) & 0xff
  out[3] = payload.length & 0xff
  out.set(payload, 4)
  const crc = crc16Modbus(out.subarray(0, 4 + payload.length))
  out[out.length - 2] = crc >>> 8
  out[out.length - 1] = crc & 0xff
  return out
}

export interface Packet {
  cmd: number
  sub: number
  payload: Uint8Array
}

/** Parses one complete packet; throws on bad length or CRC. */
export function parsePacket(data: Uint8Array): Packet {
  if (data.length < 6) throw new Error(`packet too short: ${data.length}`)
  const len = (data[2]! << 8) | data[3]!
  if (data.length !== len + 6) throw new Error(`length field ${len} does not match packet size ${data.length}`)
  const expected = crc16Modbus(data.subarray(0, data.length - 2))
  const got = (data[data.length - 2]! << 8) | data[data.length - 1]!
  if (expected !== got) throw new Error(`CRC mismatch: expected ${expected.toString(16)}, got ${got.toString(16)}`)
  return { cmd: data[0]!, sub: data[1]!, payload: data.slice(4, 4 + len) }
}
