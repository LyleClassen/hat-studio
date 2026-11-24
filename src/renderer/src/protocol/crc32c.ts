/** CRC-32C (Castagnoli), as used for upload content hashes. Check value of "123456789" is 0xE3069283. */
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32c(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of data) crc = TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
