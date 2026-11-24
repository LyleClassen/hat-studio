import { crc16Modbus, buildPacket } from './packet'
import { crc32c } from './crc32c'

/**
 * Content uploads, reconstructed from captured traffic (docs/PROTOCOL.md):
 *
 *   1. A951  header  (02/01 text, 04/01 drawing) carrying CRC-32C of the data
 *      ← A953 same cmd/sub, status 01 = send it, 03 = already stored (skip data)
 *   2. A952  data packet:
 *        [01] [type] [01] [total u32 BE] [chunk u32 BE] [data …] [crc16 modbus BE]
 *      ← A953 01 01 00 00 00 01 01 00 00
 *   3. A951  01/02 [01]  "apply"            ← A953 echo
 *
 * Only single-chunk transfers have been observed (≤ 256 bytes). Multi-chunk
 * semantics (offset vs. chunk length in the second u32) are unconfirmed.
 */

export const enum UploadType {
  Text = 0x02,
  Drawing = 0x04
}

export const STATUS_SEND = 0x01
export const STATUS_ALREADY_STORED = 0x03

/** Max data in one A952 write at MTU 512 (512 − 3 ATT − 13 framing). */
export const MAX_CHUNK = 496

const u32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]

/**
 * Both headers embed the display effect (same values as cmd 00/04; Effect.Left = 1
 * is the app default). Confirmed 2026-11-24: drawing uploads made while the
 * app's effect was Static carried 00 in that position, earlier ones carried 01.
 * The two 0x64 bytes are unconfirmed (probably speed/brightness at 100).
 */

/** Text upload header (cmd 02/01): [size u16][effect][64][64][crc32c u32][00]. */
export function textHeader(data: Uint8Array, effect = 0x01): Uint8Array {
  if (data.length > 0xffff) throw new Error('text data too long')
  return buildPacket(
    0x02,
    0x01,
    Uint8Array.of(data.length >>> 8, data.length & 0xff, effect & 0xff, 0x64, 0x64, ...u32(crc32c(data)), 0x00)
  )
}

/** Drawing upload header (cmd 04/01): [01][00][effect][64][64][crc32c u32]. */
export function drawingHeader(data: Uint8Array, effect = 0x01): Uint8Array {
  return buildPacket(0x04, 0x01, Uint8Array.of(0x01, 0x00, effect & 0xff, 0x64, 0x64, ...u32(crc32c(data))))
}

/** Data packet for A952. Not standard 4-byte-header framing, but uses the same CRC. */
export function dataPacket(type: UploadType, data: Uint8Array): Uint8Array {
  if (data.length > MAX_CHUNK) throw new Error(`multi-chunk uploads are not supported yet (${data.length} > ${MAX_CHUNK})`)
  const out = new Uint8Array(11 + data.length + 2)
  out.set([0x01, type, 0x01, ...u32(data.length), ...u32(data.length)], 0)
  out.set(data, 11)
  const crc = crc16Modbus(out.subarray(0, 11 + data.length))
  out[out.length - 2] = crc >>> 8
  out[out.length - 1] = crc & 0xff
  return out
}

/** cmd 01/02 [01] — sent after the data is acknowledged. */
export const applyUpload = (): Uint8Array => buildPacket(0x01, 0x02, Uint8Array.of(0x01))
