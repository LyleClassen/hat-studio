import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from './hex'

describe('hex', () => {
  it('round-trips', () => {
    const b = new Uint8Array([0x00, 0xaa, 0x55, 0xff])
    expect(toHex(b)).toBe('00 aa 55 ff')
    expect(fromHex(toHex(b))).toEqual(b)
  })
  it('accepts common separators and 0x prefixes', () => {
    expect(fromHex('0xAA,0x01 ff:10')).toEqual(new Uint8Array([0xaa, 0x01, 0xff, 0x10]))
  })
  it('rejects odd-length or non-hex input', () => {
    expect(() => fromHex('abc')).toThrow()
    expect(() => fromHex('zz')).toThrow()
  })
})
