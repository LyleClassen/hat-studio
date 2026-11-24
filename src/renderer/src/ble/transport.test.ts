import { describe, expect, it } from 'vitest'
import { BleTransport } from './transport'

/** Builds a transport with one fake write-without-response characteristic. */
function fakeTransport(): { t: BleTransport; writes: number[] } {
  const t = new BleTransport()
  const writes: number[] = []
  const char = {
    writeValueWithoutResponse: async () => {
      writes.push(performance.now())
    }
  }
  // Inject the characteristic directly (bypasses Web Bluetooth discovery).
  ;(t as unknown as { chars: Map<string, unknown> }).chars.set('a951', {
    serviceUuid: 'a950',
    uuid: 'a951',
    props: ['writeWithoutResponse'],
    char
  })
  return { t, writes }
}

describe('BleTransport pacing', () => {
  it('waits writeGapMs between sequential awaited writes', async () => {
    const { t, writes } = fakeTransport()
    t.writeGapMs = 30
    const start = performance.now()
    for (let i = 0; i < 4; i++) await t.write('a951', Uint8Array.of(i), false)
    expect(performance.now() - start).toBeGreaterThanOrEqual(4 * 30 - 5)
    for (let i = 1; i < writes.length; i++) expect(writes[i]! - writes[i - 1]!).toBeGreaterThanOrEqual(25)
  })

  it('paces writes that are fired without awaiting', async () => {
    const { t, writes } = fakeTransport()
    t.writeGapMs = 30
    await Promise.all([0, 1, 2, 3].map((i) => t.write('a951', Uint8Array.of(i), false)))
    for (let i = 1; i < writes.length; i++) expect(writes[i]! - writes[i - 1]!).toBeGreaterThanOrEqual(25)
  })
})
