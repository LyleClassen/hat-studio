import { buildPacket } from './packet'

/**
 * Commands confirmed from captured traffic. Value ranges are inferred from the
 * app's sliders (observed 0x38–0x64, i.e. up to 100) and still need live checks
 * at the extremes.
 */

const clampPercent = (v: number): number => Math.max(0, Math.min(100, Math.round(v)))

/** cmd 00/01 — display brightness, 0–100. */
export function setBrightness(percent: number): Uint8Array {
  return buildPacket(0x00, 0x01, Uint8Array.of(clampPercent(percent)))
}

/** cmd 00/02 — animation/scroll speed, 0–100. */
export function setSpeed(percent: number): Uint8Array {
  return buildPacket(0x00, 0x02, Uint8Array.of(clampPercent(percent)))
}

/**
 * cmd 00/04 [effect] — display effect for stored content. Confirmed from the
 * app's text page (2026-11-24, re/capture/hatlog4.txt); reply 00/04 [01].
 * The default (Left) is why uploaded drawings scroll right-to-left.
 */
export const enum Effect {
  Static = 0,
  Left = 1,
  Right = 2,
  Up = 3,
  Down = 4,
  Snowflakes = 5,
  Scroll = 6
}

export const EFFECT_NAMES = ['Static', 'Left', 'Right', 'Up', 'Down', 'Snowflakes', 'Scroll'] as const

export function setEffect(effect: Effect): Uint8Array {
  return buildPacket(0x00, 0x04, Uint8Array.of(effect))
}

/** cmd 05/03 — select stored item by index (observed 0–6 from the GIF page). Meaning of the trailing bytes is unconfirmed. */
export function selectStoredItem(index: number): Uint8Array {
  return buildPacket(0x05, 0x03, Uint8Array.of(index & 0xff, 0x00, 0x00, 0x64))
}
