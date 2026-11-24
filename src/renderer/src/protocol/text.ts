import { HEIGHT } from './frame'

/**
 * Text uploads carry one record per character (18 bytes, confirmed):
 *   [05] [07] [col0 u16 BE] … [col7 u16 BE]
 * Each column is 16 pixels; bit 15 = top row, bit 0 = bottom row
 * (lowercase 'e' occupies bits 2–9, 'h' ascends to bit 13, 'y' descends to bit 0).
 * The meaning of 05/07 is unconfirmed (colour? width?) and is copied verbatim.
 */
export const GLYPH_COLUMNS = 8
export const GLYPH_BYTES = 2 + GLYPH_COLUMNS * 2

/** A glyph is GLYPH_COLUMNS column bitmaps. */
export type Glyph = number[]

export function encodeGlyphs(glyphs: Glyph[], attr: [number, number] = [0x05, 0x07]): Uint8Array {
  const out = new Uint8Array(glyphs.length * GLYPH_BYTES)
  glyphs.forEach((g, i) => {
    const o = i * GLYPH_BYTES
    out[o] = attr[0]
    out[o + 1] = attr[1]
    for (let c = 0; c < GLYPH_COLUMNS; c++) {
      const col = g[c] ?? 0
      out[o + 2 + c * 2] = (col >>> 8) & 0xff
      out[o + 3 + c * 2] = col & 0xff
    }
  })
  return out
}

/** Converts a monochrome bitmap (rows of booleans, HEIGHT tall) into column words. */
export function columnsFromBitmap(isOn: (x: number, y: number) => boolean, width: number): number[] {
  const cols: number[] = []
  for (let x = 0; x < width; x++) {
    let word = 0
    for (let y = 0; y < HEIGHT; y++) if (isOn(x, y)) word |= 1 << (HEIGHT - 1 - y)
    cols.push(word)
  }
  return cols
}
