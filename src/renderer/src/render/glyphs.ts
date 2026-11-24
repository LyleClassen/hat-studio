import { GLYPH_COLUMNS, columnsFromBitmap, type Glyph } from '../protocol/text'
import { HEIGHT } from '../protocol/frame'

/**
 * Rasterises text into 8×16 monochrome glyphs using a canvas, mirroring what
 * the phone app does (lib_draw_text renders on the phone; the hat gets bitmaps).
 */
export function renderGlyphs(text: string, font = 'bold 13px "Segoe UI", sans-serif'): Glyph[] {
  const canvas = document.createElement('canvas')
  canvas.width = GLYPH_COLUMNS
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const glyphs: Glyph[] = []
  for (const ch of text) {
    ctx.clearRect(0, 0, GLYPH_COLUMNS, HEIGHT)
    ctx.fillStyle = '#fff'
    ctx.font = font
    ctx.textBaseline = 'alphabetic'
    const w = ctx.measureText(ch).width
    ctx.fillText(ch, Math.max(0, Math.floor((GLYPH_COLUMNS - 1 - w) / 2)), 13)
    const img = ctx.getImageData(0, 0, GLYPH_COLUMNS, HEIGHT).data
    glyphs.push(columnsFromBitmap((x, y) => img[(y * GLYPH_COLUMNS + x) * 4 + 3]! > 110, GLYPH_COLUMNS))
  }
  return glyphs
}
