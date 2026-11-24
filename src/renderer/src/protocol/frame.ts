import { buildPacket } from './packet'

/** The hat's panel, inferred from live-draw coordinates (max x=31, y=15). */
export const WIDTH = 32
export const HEIGHT = 16

/**
 * Fixed 8-colour palette, confirmed on the hat 2026-11-24 via the comparison grid:
 * 0 off, 1 red, 2 green, 3 blue, 4 yellow, 5 magenta, 6 cyan, 7 white.
 * (Not bitwise RGB: 3 is blue, 4 is yellow.) Indices 8–15 display nothing.
 */
export const enum Colour {
  Off = 0,
  Red = 1,
  Green = 2,
  Blue = 3,
  Yellow = 4,
  Magenta = 5,
  Cyan = 6,
  White = 7
}

/** A frame is WIDTH×HEIGHT colour indices, row-major (index = y * WIDTH + x). */
export type Frame = Uint8Array

export const blankFrame = (): Frame => new Uint8Array(WIDTH * HEIGHT)

/**
 * Packs a frame to 4 bits per pixel, high nibble first (256 bytes).
 * Confirmed on the hat 2026-11-24: the hat reads pixels COLUMN-major — 16 pixels
 * top-to-bottom for x=0, then x=1, … (a row-major test upload rendered exactly as
 * the column-major reinterpretation predicts).
 */
export function packFrame(frame: Frame, order: 'row' | 'column' = 'column'): Uint8Array {
  const out = new Uint8Array((WIDTH * HEIGHT) / 2)
  let i = 0
  const put = (v: number): void => {
    const byte = i >> 1
    out[byte] = (i & 1) === 0 ? (out[byte]! & 0x0f) | ((v & 0xf) << 4) : (out[byte]! & 0xf0) | (v & 0xf)
    i++
  }
  if (order === 'row') {
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) put(frame[y * WIDTH + x]!)
  } else {
    for (let x = 0; x < WIDTH; x++) for (let y = 0; y < HEIGHT; y++) put(frame[y * WIDTH + x]!)
  }
  return out
}

/**
 * cmd 03/01 [mode] — what the hat shows. From the app captures (2026-11-24):
 *   01 LiveDraw  — blank live canvas for 03/02 pixels (app: opening the editor)
 *   03 Drawing   — the stored drawing (app: sent right before a drawing upload)
 *   04 Text      — the stored text (app: sent right before a text upload)
 *   02 seen once in the editor; meaning unknown.
 * Entering LiveDraw after an upload hides the stored drawing (blank screen).
 */
export const enum DisplayMode {
  LiveDraw = 0x01,
  Drawing = 0x03,
  Text = 0x04
}

export const enterMode = (mode: number): Uint8Array => buildPacket(0x03, 0x01, Uint8Array.of(mode & 0xff))

/** cmd 03/02 [00][y][x][colour] — set one pixel live. Confirmed from captures. */
export function livePixel(x: number, y: number, colour: number): Uint8Array {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) throw new Error(`pixel out of range: ${x},${y}`)
  return buildPacket(0x03, 0x02, Uint8Array.of(0x00, y, x, colour & 0xff))
}
