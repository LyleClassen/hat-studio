# Hat Studio

An open desktop controller for the cheap Bluetooth LED-matrix hats sold under the **Mini LedShow** app. The hats advertise as `ledshow-XXXX`.

The official app only runs on phones. It can draw on the hat, scroll text and pick from a few built-in animations, but it **cannot upload custom animations**. Hat Studio aims to drive the hat from a desktop, and eventually to animate it, by reverse-engineering the BLE protocol and reimplementing it in an Electron app that uses Web Bluetooth.

> **Status:** research prototype. The protocol for brightness, speed, effects, live pixel drawing, drawing uploads and text uploads is decoded and works from Windows. The app has an early frame-based animation editor and player next to the original probe and test bench.

The full, evidence-backed protocol write-up is in **[docs/PROTOCOL.md](docs/PROTOCOL.md)**. This README summarises it.

---

## The hardware

| | |
|---|---|
| Display | 32 × 16 LED matrix, 8 fixed colours |
| SoC | JieLi (杰理) **AC692X family (BR21)**. The package marking `AK24BP2A931` is a lot code, not a part number |
| Radio | BLE. The device connects without pairing and grants an MTU of 512 |
| USB | Power only from the user's side. The flex PCB exposes `DP`/`DM` pads, probably JieLi's USB download (ISP) interface |
| Advertised name | `ledshow-` plus the last two bytes of the BLE address, such as `ledshow-A241` |

The chip family comes from the hat's own RCSP *target info* reply. That reply reports `SdkType = 1`, and JieLi's firmware SDKs (`rcsp_bluetooth.h`) assign `SDK_TYPE_AC692X` to that value, selected only for `CONFIG_CPU_BR21`. The official [Jieli-Tech GitHub](https://github.com/Jieli-Tech) does **not** publish an SDK for this family. An SDK would not contain the vendor's LED firmware anyway, so this project leaves the firmware alone and talks to it over BLE.

## How the protocol was recovered

1. **Static analysis** of the Mini LedShow Android app (`com.led.miniled` 1.3.3) with [rea](https://github.com/morluto/rea) and jadx. The app is Flutter: the protocol lives in Dart AOT code (`libapp.so`), and the Java side is only a thin GATT plugin plus JieLi's OTA library. The string pool gave the service UUIDs, the checksum types (`Crc16Modbus`, CRC32) and the packet-builder names. The analysis output is in [`re/`](re/).
2. **Instrumented capture.** The test phone ignored the HCI snoop log setting, so the official app was decoded, patched with three logging hooks (GATT write, notify and MTU change), re-signed and run. The hook source is in [`re/patch-src/`](re/patch-src/). This produced a full TX/RX log of every packet the app sends.
3. **Live verification** with the Hat Studio probe app from Windows. Every claim in the protocol doc is marked ✅ confirmed, 🟡 inferred or ❓ unknown. Captured packets are used as test vectors. 596 of 596 captured packets parse, and every captured upload is reproduced byte-for-byte in the tests.

No vendor binaries are included in this repository.

## Protocol summary

### GATT
| Characteristic | Use |
|---|---|
| `A950` service → `A951` | commands (write without response) |
| `A952` | bulk upload data |
| `A953` | notifications and replies |
| `AE00` service → `AE01` / `AE02` | JieLi RCSP / OTA channel. **Leave it alone** |

The phone app runs a JieLi challenge/response auth on `AE01`/`AE02`. **It is not needed for LED control**: the desktop talks to `A951` directly without it.

### Framing
```
[cmd] [sub] [len_hi] [len_lo] [payload × len] [crc_hi] [crc_lo]
crc = CRC-16/MODBUS over all preceding bytes, big-endian
```

### Commands
| cmd/sub | Payload | Meaning |
|---|---|---|
| `00/01` | `[0–100]` | brightness |
| `00/02` | `[0–100]` | speed |
| `00/04` | `[effect]` | 00 static, 01 left, 02 right, 03 up, 04 down, 05 snowflakes, 06 scroll |
| `03/01` | `[mode]` | 01 live canvas, 03 stored drawing, 04 stored text |
| `03/02` | `00 [y] [x] [colour]` | set one live pixel |
| `05/03` | `[i] 00 00 64` | select built-in animation `i` |
| `02/01`, `04/01` | header | start a text or drawing upload (see below) |

### Display facts
- **Palette:** 0 off, 1 red, 2 green, 3 blue, 4 yellow, 5 magenta, 6 cyan, 7 white. It is a fixed palette, not RGB bits.
- **One packet per BLE write.** Concatenated packets are ignored after the first.
- **Live pixels need about 15 ms between writes.** Faster writes drop about half of them, so a full 512-pixel repaint takes about 8 s. Animation therefore has to send **only the pixels that changed**.
- **The live canvas persists** across mode switches, but **a drawing upload wipes it**. Uploading a blank drawing is a fast full clear (about 0.3 s).
- **A full upload flickers**, because the hat redraws the whole screen. Streaming changed pixels to the live canvas does not.

### Uploads (stored content the hat plays on its own)
1. A header on `A951` carries the **CRC-32C** of the data. The hat replies `01` (send the data) or `03` (already stored, because it deduplicates by CRC).
2. Data goes on `A952` in chunks with a CRC-16 trailer.
3. An apply command goes on `A951`.

- **Drawing:** 256 bytes, 32×16 at 4 bpp, **column-major**, high nibble first.
- **Text:** the phone renders the font. Each character is 18 bytes (`05 07` plus 8 columns × u16). The hat scrolls it.

### Open questions
- What the text attribute bytes `05 07` mean.
- Display mode `02`.
- Whether the two `64` bytes in upload headers are speed and brightness.
- Multi-chunk uploads, which are not needed for a 32×16 panel.

## Running it

Requirements: Node.js 22 or newer, and a Bluetooth LE adapter that Windows can use.

```sh
npm install
npm run dev        # Electron app with hot reload
npm test           # protocol unit tests (captured vectors)
npm run typecheck
```

Click **Scan & connect** and pick the `ledshow-…` device. The app then gives you:
- **Studio:** a frame-based animation editor with pencil, line, rectangle, fill and shift tools, onion skinning, per-frame durations, and save/open as `.hatanim` files. The player streams the animation to the hat. **Smooth** (the default) sends only the changed pixels. **Upload** sends whole frames, which flicker. **Auto** chooses per frame. You can set the erase order and the pixel gap.
- **Controls:** brightness, speed and effect, plus a raw-bytes sender and a log.
- **Hat tests:** numbered probes (palette, drawing upload, row and pixel pacing, text). Each has a compare grid for recording what the hat actually showed. A built-in **hat simulator** predicts the expected screen from the exact bytes sent, so a mismatch shows a dropped write or a gap in the protocol model.

> Windows note: run Vitest from an uppercase drive path (`C:\…`). A lowercase `c:` working directory breaks config loading.

## Repository layout

```
src/main, src/preload          Electron shell
src/renderer/src/ble           Web Bluetooth transport, UUIDs
src/renderer/src/protocol      framing, CRCs, commands, uploads, text (with tests)
src/renderer/src/editor        animation model, drawing tools, transfer planner, player, Studio UI
src/renderer/src/sim           hat simulator (predicts the display from the bytes sent)
src/renderer/src/render        bitmap glyphs for text uploads
src/renderer/src/ui            compare grid
docs/PROTOCOL.md               the full protocol notes
re/                            rea analysis output and the logging-hook patch source
scripts/check-served.mjs       dev helper: detects a stale Vite module before hardware tests
```

## Roadmap
- [x] Decode the framing, CRC, control commands and the live canvas
- [x] Drawing and text uploads, byte-exact against captures
- [x] Identify the SoC
- [x] Pixel editor and frame-based animations (early)
- [x] Flicker-free playback by streaming only changed pixels
- [ ] Import animations from GIF
- [ ] Desktop-side text rendering with arbitrary fonts

## License
[MIT](LICENSE)

## Disclaimer
This is an independent interoperability project. It is not affiliated with the hat's manufacturer, the Mini LedShow app or JieLi Technology. All protocol knowledge comes from observing a device the author owns. Nothing here modifies or redistributes the device firmware or the vendor app.
