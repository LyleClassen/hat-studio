import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from '../ble/hex'
import { crc32c } from './crc32c'
import { applyUpload, dataPacket, drawingHeader, textHeader, UploadType } from './upload'
import { blankFrame, Colour, DisplayMode, livePixel, packFrame, WIDTH, enterMode } from './frame'
import { encodeGlyphs } from './text'

// Captured from the official app, 2026-11-24 (re/capture/hatlog3.txt).
const HI_DATA = '05073ffc3ffc0180018001803ffc3ffc0000' + '0507000000000204' + '33fc33fc000400000000'
const HEY_DATA =
  '050720043ffc3ffc0100020003fc01fc0000' + '050701f803fc024402440244' + '03cc01c80000' + '050703e103e10011001300' + '1603fc03f80000'
const cap = {
  hiHeader: '0201000a0024016464866b32db0070a2',
  heyHeader: '0201000a003601646490150184' + '00c4ee',
  hiData: '0102010000002400000024' + HI_DATA + '82d8',
  heyData: '0102010000003600000036' + HEY_DATA + 'ef4e',
  drawingHeader: '0401000901000164644e5b016db9e2',
  drawingData: '010401000001000000010010' + '00'.repeat(255) + 'd64f',
  apply: '010200010128d8',
  enterDraw: '0301000101aca1'
}

const same = (a: Uint8Array, hex: string): void => expect(toHex(a)).toBe(toHex(fromHex(hex)))

describe('crc32c', () => {
  it('matches the standard check value', () => {
    expect(crc32c(new TextEncoder().encode('123456789'))).toBe(0xe3069283)
  })
  it('matches captured header hashes', () => {
    expect(crc32c(fromHex(HI_DATA))).toBe(0x866b32db)
    expect(crc32c(fromHex(HEY_DATA))).toBe(0x90150184)
  })
})

describe('text upload', () => {
  it('reproduces the captured headers', () => {
    same(textHeader(fromHex(HI_DATA)), cap.hiHeader)
    same(textHeader(fromHex(HEY_DATA)), cap.heyHeader)
  })
  it('reproduces the captured data packets', () => {
    same(dataPacket(UploadType.Text, fromHex(HI_DATA)), cap.hiData)
    same(dataPacket(UploadType.Text, fromHex(HEY_DATA)), cap.heyData)
  })
  it('encodeGlyphs rebuilds the captured "hi" bytes from column words', () => {
    const h = [0x3ffc, 0x3ffc, 0x0180, 0x0180, 0x0180, 0x3ffc, 0x3ffc, 0x0000]
    const i = [0x0000, 0x0000, 0x0204, 0x33fc, 0x33fc, 0x0004, 0x0000, 0x0000]
    same(encodeGlyphs([h, i]), HI_DATA)
  })
})

describe('drawing upload', () => {
  const frame = blankFrame()
  frame[0] = Colour.Red // top-left red pixel, as captured
  it('packs the captured frame', () => {
    const packed = packFrame(frame)
    expect(packed.length).toBe(256)
    expect(packed[0]).toBe(0x10)
    expect(packed.slice(1).every((b) => b === 0)).toBe(true)
  })
  it('reproduces the captured header and data packet', () => {
    const packed = packFrame(frame)
    expect(crc32c(packed)).toBe(0x4e5b016d)
    same(drawingHeader(packed), cap.drawingHeader)
    same(dataPacket(UploadType.Drawing, packed), cap.drawingData)
  })
  it('embeds the effect in the drawing header (captured with Static selected)', () => {
    same(drawingHeader(packFrame(frame), 0x00), '0401000901000064644e5b016d79f2')
  })
  it('reproduces the hand-drawn copy of the test pattern (column-major, Static)', () => {
    // User redrew the test pattern in the app: green left column, red top row, red dot bottom-right.
    const f = blankFrame()
    for (let x = 0; x < WIDTH; x++) f[x] = Colour.Red
    for (let y = 0; y < 16; y++) f[y * WIDTH] = Colour.Green
    f[15 * WIDTH + 31] = Colour.Red
    const packed = packFrame(f)
    same(drawingHeader(packed, 0x00), '04010009010000646446889e4ec929')
    expect(toHex(dataPacket(UploadType.Drawing, packed)).replace(/ /g, '').slice(-4)).toBe('c422')
  })
  it('column-major explains the observed hat output of a row-major upload (2026-11-24)', () => {
    // Sent row-major: green left column, red top row, red dot bottom-right.
    const sent = blankFrame()
    for (let x = 0; x < WIDTH; x++) sent[x] = Colour.Red
    for (let y = 0; y < 16; y++) sent[y * WIDTH] = Colour.Green
    sent[15 * WIDTH + 31] = Colour.Red
    const bytes = packFrame(sent, 'row')
    // Decode those bytes the way the hat does (column-major) and compare with what was painted.
    const shown = blankFrame()
    for (let i = 0; i < 512; i++) {
      const v = i % 2 === 0 ? bytes[i >> 1]! >> 4 : bytes[i >> 1]! & 15
      shown[(i % 16) * WIDTH + Math.floor(i / 16)] = v
    }
    const observed = [
      '212.2.2.2.2.2.2.2.2.2.2.2.2.2.2.',
      ...Array.from({ length: 14 }, () => '11..............................'),
      '11.............................1'
    ]
    const text = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: WIDTH }, (_, x) => (shown[y * WIDTH + x] ? String(shown[y * WIDTH + x]) : '.')).join('')
    )
    expect(text).toEqual(observed)
  })

  it('row and column order differ for non-origin pixels', () => {
    const f = blankFrame()
    f[1 * WIDTH + 0] = Colour.Green // (x=0, y=1)
    expect(packFrame(f, 'row')[WIDTH / 2]).toBe(0x20)
    expect(packFrame(f, 'column')[0]).toBe(0x02)
  })
})

describe('live drawing', () => {
  it('reproduces captured pixel commands', () => {
    same(livePixel(0, 0, Colour.Red), '0302000400000001de13')
    same(livePixel(31, 15, Colour.Green), '03020004000f1f02ec6b')
    same(livePixel(1, 0, Colour.Red), '03020004000001014e12')
  })
  it('display modes match captured 03/01 packets', () => {
    same(enterMode(DisplayMode.LiveDraw), cap.enterDraw)
    same(enterMode(DisplayMode.Drawing), '03010001036d20')
    same(enterMode(DisplayMode.Text), '0301000104af61')
    same(applyUpload(), cap.apply)
  })
})
