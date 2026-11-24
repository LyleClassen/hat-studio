import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from '../ble/hex'
import { buildPacket, crc16Modbus, parsePacket } from './packet'
import { Effect, selectStoredItem, setBrightness, setEffect, setSpeed } from './commands'

// Byte vectors captured from the official Mini LedShow app (re/capture, 2026-11-24).
const captured = {
  brightness0x62: '000100016285a5',
  brightness0x64: '00010001648725',
  speed0x61: '0002000161c0e5',
  speed0x3c: '000200013c3924',
  unknown0004: '000400010160e5',
  header0201: '0201000a0024016464866b32db0070a2',
  select1: '0503000401000064e342',
  select6: '05030004060000649743',
  ackReply: '05030001011428'
}

describe('crc16Modbus', () => {
  it('matches the standard check value', () => {
    expect(crc16Modbus(new TextEncoder().encode('123456789'))).toBe(0x4b37)
  })
})

describe('buildPacket', () => {
  it.each(Object.entries(captured))('reproduces captured packet %s', (_name, hex) => {
    const p = parsePacket(fromHex(hex))
    expect(toHex(buildPacket(p.cmd, p.sub, p.payload))).toBe(toHex(fromHex(hex)))
  })
})

describe('parsePacket', () => {
  it('decodes fields', () => {
    const p = parsePacket(fromHex(captured.header0201))
    expect(p.cmd).toBe(0x02)
    expect(p.sub).toBe(0x01)
    expect(toHex(p.payload)).toBe('00 24 01 64 64 86 6b 32 db 00')
  })
  it('rejects a corrupted CRC', () => {
    const bad = fromHex(captured.brightness0x62)
    bad[6] = bad[6]! ^ 0xff
    expect(() => parsePacket(bad)).toThrow(/CRC/)
  })
  it('rejects a wrong length field', () => {
    expect(() => parsePacket(fromHex('0001000262' + '85a5'))).toThrow(/length/)
  })
})

describe('commands', () => {
  it('setBrightness matches capture', () => {
    expect(toHex(setBrightness(0x62))).toBe(toHex(fromHex(captured.brightness0x62)))
    expect(toHex(setBrightness(100))).toBe(toHex(fromHex(captured.brightness0x64)))
  })
  it('setSpeed matches capture', () => {
    expect(toHex(setSpeed(0x61))).toBe(toHex(fromHex(captured.speed0x61)))
  })
  it('selectStoredItem matches capture', () => {
    expect(toHex(selectStoredItem(1))).toBe(toHex(fromHex(captured.select1)))
    expect(toHex(selectStoredItem(6))).toBe(toHex(fromHex(captured.select6)))
  })
  it('setEffect matches every captured effect command', () => {
    const captured: [Effect, string][] = [
      [Effect.Static, '0004000100a024'],
      [Effect.Left, '000400010160e5'],
      [Effect.Right, '000400010261a5'],
      [Effect.Up, '0004000103a164'],
      [Effect.Down, '00040001046325'],
      [Effect.Snowflakes, '0004000105a3e4'],
      [Effect.Scroll, '0004000106a2a4']
    ]
    for (const [effect, hex] of captured) expect(toHex(setEffect(effect))).toBe(toHex(fromHex(hex)))
  })
  it('clamps out-of-range values', () => {
    expect(setBrightness(250)[4]).toBe(100)
    expect(setSpeed(-5)[4]).toBe(0)
  })
})
