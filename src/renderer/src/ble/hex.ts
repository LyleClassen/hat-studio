export function toHex(bytes: Uint8Array | DataView): string {
  const u8 =
    bytes instanceof DataView
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : bytes
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ')
}

/** Parses "aa 01 ff", "aa01ff", "0xaa,0x01" etc. Throws on malformed input. */
export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[\s,:;-]/g, '')
  if (clean.length === 0) return new Uint8Array(0)
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`Invalid hex: "${text}"`)
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}
