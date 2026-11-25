# Mini LedShow BLE protocol (work in progress)

Source: Mini LedShow 1.3.3 (`com.led.miniled`, versionCode 133). The app was analysed with
[rea](https://github.com/morluto/rea) 6.10.1 and jadx-headless-mcp 0.7.1. The raw evidence is in `re/`.

Status legend: ✅ confirmed · 🟡 inferred from static strings, needs live confirmation · ❓ unknown

## App architecture ✅
- The app is **Flutter** (Dart 3.8.1, AOT). It ships only the `armeabi-v7a` split. Snapshot hash: `830f4f59e7969c70b595182826435c19`.
- Protocol logic is written in Dart (`libapp.so`). The Java/DEX side is R8-obfuscated. It contains only a thin GATT plugin (`lib_bt`) and the JieLi OTA library (`com.jieli.jl_bt_ota`, `libjl_ota_auth.so`). This suggests the hat uses a **JieLi** BLE SoC.
- Two device families appear under `package:miniled/ble/protocol/`:
  - `miniledshow/`: `UUIDConfig`, `MiniLedBleSupportImpl`, `MiniLedSendImpl`, `send/MiniLedPackageImpl`, and sources (`graffiti`, `text`).
  - `iledcolor/`: `UUIDConfig`, `ColorBleSupportImpl`, `ColorSendImpl`, `send/ColorPackageImpl`, sources (`gif`, `graffiti`, `partition`, `text`), and `ota/`.
  - `selectedProtocol` in the pool suggests the app selects the family per device.
- The transport plugin `lib_bt` has these Dart files: `BleManager`, `BleSendManager`, `SendTask`, `SendBean`, `SendProgressBean`, `PackageInterface`, `OnBleDataListener`, `OnOtaListener`, plus `onMtuChanged`.

## Live observations (2026-11-24, desktop probe)
- ✅ The hat advertises as **`ledshow-A241`**. The suffix is probably per-unit, so a scan filter can use the prefix `ledshow-`.
- ✅ The hat connects from Windows without pairing.
- ✅ `A953` and `AE02` accept notification subscriptions.
- ✅ `A951` accepts writes; a 0-byte write produced no error and no reply.
- ✅ The hat sends no unprompted notifications after connecting.

## GATT layout
| UUID | Pool field name | Role |
|---|---|---|
| `0000A950-…` | `uuid_server` | LED service 🟡 (string sits next to `miniledshow/UUIDConfig.dart`) |
| `0000A951-…` | `uuid_write_1`? | write 🟡 |
| `0000A952-…` | `uuid_write_2`? | write 🟡 |
| `0000A953-…` | `uuid_notify`? | notify 🟡 |
| `0000AE00-…` | `uuid_server_ota` | JieLi OTA service 🟡: **do not write** |
| `0000AE01-…` | `uuid_write_ota` | OTA write 🟡 |
| `0000AE02-…` | `uuid_notify_ota` | OTA notify 🟡 |

Which A95x characteristic is write_1, write_2 or notify will be confirmed from the GATT properties the probe reports.

## Framing hints from the string pool 🟡
- **Checksums:** `crclib` with `Crc16Modbus` and CRC32 variants. Helpers include `CrcUtils.getCRC16` and `getCRC32`.
- **Packet builders:** `createPackage`, `createSimplePackage`, `getSimplePackage`, `getNextPackage`, `addPackage(s)`.
- **Chunked uploads:** `beginChunkNumber`, `continueChunkNumber`, `finishChunkNumber`, `sendNext`, `sendDone`, `sendError` and `SendProgressBean`.
- **Pixel data:** `rgbRle` (RLE-compressed RGB), `getScreenColorType`, `setPixelRgb`, `GifDecoder`/`getGifBytes`, `frameCount`/`frameDuration`.
- **Settings:** `mini_brightness`, `mini_speed`, `setBrightness`, `setSpeed`, `updateMode`.
- **Live streaming:** `MicDataSendImpl` and `MusicDataSendImpl`, which are FFT-driven via `fftea`.
- **Text:** `lib_draw_text` renders text and emoji to bitmaps on the phone. The hat therefore receives pixels, not font data.

## Capture method ✅
The Honor phone ignored the standard HCI snoop setting and hid all app logcat output. Instead, the official app was re-signed with three injected logging hooks; the patch is in `re/patch-src/`. The hooks cover the single `BluetoothGatt.writeCharacteristic` call site (`m4/a`), `onCharacteristicChanged`, and `onMtuChanged`. Lines go to `/sdcard/Android/data/com.led.miniled/files/hatlog.txt`. Raw capture: `re/capture/hatlog.txt`.

## Connection sequence ✅ (from capture)
1. The app requests MTU 512 and the hat grants 512.
2. A **JieLi RCSP auth handshake runs on AE01/AE02** (17-byte challenge/response pairs, then `02 70 61 73 73` = `"\x02pass"` in both directions):
   ```
   TX AE01 00 <16 random>         RX AE02 01 <16 response>
   TX AE01 02 "pass"              RX AE02 00 <16 random>
   TX AE01 01 <16 response>       RX AE02 02 "pass"
   ```
   The response is computed by JieLi's native `libjl_ota_auth.so` (`com.jieli.jl_bt_ota.impl.RcspAuth`). ✅ **It is not needed for LED control.** On 2026-11-24, Hat Studio connected from Windows with no handshake, and brightness and speed sweeps on A951 visibly changed the hat. The auth only gates the JieLi RCSP/OTA channel.
3. An RCSP "get target info" request follows (`fe dc ba c0 03 …`). The 70-byte reply contains the device name `a241` near the end.

### Chip identification ✅ (2026-11-25)
The target-info reply is a TLV list. Each entry is `[len][type][value…]`, where `len` counts the type byte. The JieLi OTA library's parser in the app (`smali/h4/t.smali`, `parseTargetInfo`) maps these types:
- `02 06 01`: **SdkType = 1**. In JieLi's firmware SDKs (`JL_rcsp/rcsp_bluetooth.h` in `fw-AC63_BT_SDK` and `fw-AW31N_BLE_SDK`), `SDK_TYPE_AC692X = 0x1` and it is selected only by `CONFIG_CPU_BR21`. For comparison, AC63x/BD19 reports `0x10` and AC695X/BR23 reports `0x3`. The hat is therefore a **BR21 / AC692X-family** SoC. The package marking (`AK24BP2A931`) is a JieLi lot code, not a part number.
- `08 11 00 86 28 03 bd a2 41`: BLE address `86:28:03:BD:A2:41`. The advertised name suffix `A241` comes from the last two bytes of this address.
- `02 0a 00`: the VID/PID attribute is too short, so the library ignores it.

The official Jieli-Tech GitHub org does **not** host an AC692X/BR21 SDK. It only hosts AC63, AW30N/AW31N and AD1x/AD2x. Either way, an SDK would not contain the hat's LED application, which is the vendor's own firmware.
4. LED commands go to **A951** (write without response is fine) and replies arrive on **A953**.

## LED packet framing ✅ (596/596 captured packets)
```
[cmd] [sub] [len_hi] [len_lo] [payload × len] [crc_hi] [crc_lo]
crc = CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF) over all preceding bytes, big-endian
```
Implementation: `src/renderer/src/protocol/packet.ts`. Tests use the captured vectors.

Replies use the same framing and echo cmd/sub. They usually carry a 1-byte status, and `01` appears to mean OK.

## Command set
| cmd/sub | Payload | Meaning | Example (captured) | Status |
|---|---|---|---|---|
| `00/01` | `[v]` | brightness 0–100 (no reply) | `00 01 00 01 62 85 a5` | ✅ works from the desktop |
| `00/02` | `[v]` | speed 0–100 (no reply) | `00 02 00 01 61 c0 e5` | ✅ works from the desktop |
| `00/04` | `[effect]` | **display effect**: 00 Static, 01 Left (default), 02 Right, 03 Up, 04 Down, 05 Snowflakes, 06 Scroll. The reply is `00 04 00 01 01` (OK) | `00 04 00 01 00 a0 24` (static) | ✅ all 7 captured |
| `03/01` | `[mode]` | **display mode**: `01` live-draw canvas (blank, takes `03/02` pixels), `03` stored drawing (sent before a drawing upload), `04` stored text (sent before a text upload), `02` unknown (seen once in the editor). The reply is `01`. ✅ Entering `01` after an upload hides the upload, which is what blanked our earlier tests | `03 01 00 01 03 6d 20` | ✅ 01/03/04 |
| `03/02` | `00 00 00 01` | ❓ | `03 02 00 04 00 00 00 01 de 13` | ❓ |
| `02/01` | 10 bytes | 🟡 **upload header?** `00 \| 0024 \| 01 \| 64 64 \| 866b32db \| 00`. It may be type, size (36), frame count, brightness/speed, CRC32 of data, then a flag. The hat replied `03` and no data followed. Theory: `03` = "already stored" (content-addressed by CRC32) | `02 01 00 0a 00 24 01 64 64 86 6b 32 db 00 70 a2` | 🟡 |
| `05/03` | `[i] 00 00 64` | select stored item `i` (0–6 seen on the GIF page) | `05 03 00 04 01 00 00 64 e3 42` | ✅ encoder, 🟡 meaning |

## Display ✅
The panel is **32 × 16**. Live-draw coordinates in the capture reach x=31 and y=15. Colours use a **fixed 8-entry palette**, confirmed with the comparison grid: **0 off, 1 red, 2 green, 3 blue, 4 yellow, 5 magenta, 6 cyan, 7 white**. It is not bitwise RGB. Indices 8–15 display nothing.

**One packet per write** ✅: when several `03/02` packets are concatenated into one write, only the first is applied. Batching is not possible.

**Live pixel pacing** ✅: with a **15 ms gap** between writes, the row test (64 pixels in about 1.05 s) and a full 512-pixel clear matched exactly, with 0 differences. Unpaced writes (about 0.5 ms apart) lost around 50%. A full 512-pixel repaint therefore takes about 8 s, so animation should send only the pixels that changed.

**Drawing pixel order** ✅: **column-major**. The 256 bytes hold x=0 (y 0→15), then x=1, and so on, at 4 bpp with the high nibble first. A row-major test upload displayed exactly as the column-major reinterpretation predicts (see `upload.test.ts`). Verified again with a column-major upload, which showed 0 differences. The stored drawing **scrolls right-to-left** in standalone mode. The scrolling comes from the **effect byte in the upload header**: the app default is 01 = Left. See Uploads below. (The first header byte was tested and has no effect.)

**Drawing upload = standalone display** ✅: the upload is accepted (`04/01 → 01`, data ack, apply echo). Nothing shows **while the desktop stays connected in live mode**. When the desktop **disconnects, the hat shows the uploaded drawing**, so it is the content the hat plays on its own.

## Live drawing ✅
| cmd/sub | Payload | Meaning |
|---|---|---|
| `03/01` | `01` | enter the drawing page; the reply is `01` |
| `03/02` | `00 [y] [x] [colour]` | set one pixel immediately, with no reply. Captured examples: `03 02 00 04 00 0f 1f 02 ec 6b` (green at 31,15) and `… 00 00 00 01 de 13` (red at 0,0) |

**The live canvas persists** ✅: after drawing live pixels, switching to the stored drawing (`03/01 03`) for 3 s and back (`03/01 01`), the live pixels reappeared unchanged (0-pixel diff, 2026-11-24). The live canvas and the stored drawing are separate buffers.

**A drawing upload wipes the live canvas** ✅: probe test 7 (2026-11-24) drew a red square live, uploaded a blue square, then re-entered `03/01 01`. The screen was blank: the red square did not come back. Plain mode switches keep the live canvas, but uploads clear it. A blank-drawing upload is therefore a fast full clear, about 0.3 s compared with about 8 s for 512 live pixels. 🟡 Not checked: whether a deduplicated upload (reply `03`, no data sent) also clears it.

**Animation without flicker:** a full drawing upload makes the hat redraw the whole screen, which shows as a visible flicker. Streaming only the changed pixels on the persistent live canvas, with `00` overwriting pixels that turn off, avoids it. Hat Studio's default "Smooth" playback works this way. It writes erasures first by default, because at ~16 ms per pixel, drawing first left visible trails. Erase order and pixel gap can be changed in the Studio panel.

## Uploads ✅ (all captured uploads reproduced byte-for-byte in `upload.test.ts`)
1. A **header on A951** carries the **CRC-32C (Castagnoli) of the data**, big-endian:
   - Text `02/01`: `[size u16][effect][64][64][crc32c u32][00]`. Example: `02 01 00 0a 00 24 01 64 64 86 6b 32 db 00 70 a2`
   - Drawing `04/01`: `[01][00][effect][64][64][crc32c u32]`
   - ✅ `effect` uses the same values as cmd `00/04` (00 Static … 06 Scroll). With Static selected, the app sent `04 01 00 09 01 00 00 64 64 4e 5b 01 6d 79 f2`. 🟡 The two `64` bytes are probably speed and brightness at 100.
   - The reply has the same cmd/sub, with status **`01` = send the data** or **`03` = already stored**. The hat deduplicates content by CRC.
2. **Data on A952**: `[01][type 02|04][01][total u32][chunk u32][data…][crc16-modbus]`, which gets a 9-byte ack `01 01 00 00 00 01 01 00 00`.
3. **Apply on A951**: `01 02 00 01 01 28 d8`, which the hat echoes.

**Drawing data** is 256 bytes: 32×16 pixels at 4 bits per pixel, high nibble first. Pixel (0,0) is the high nibble of byte 0. 🟡 Row-major order is assumed.

**Text data** is 18 bytes per character: `05 07` + 8 columns × u16 BE. Bit 15 is the top row and bit 0 the bottom. The phone renders the font, and the hat scrolls it. 🟡 The meaning of `05 07` is unknown, possibly colour or attributes.

## Animations
The miniledshow app cannot upload custom GIFs. Its GIF page only selects built-in animations (`05/03 [i]`). Custom animation will have to be **streamed from the desktop**, either as live pixel diffs (`03/02`) or as repeated drawing uploads.

## Still needed ❓
- Palette indices 3–15.
- Drawing pixel order (row-major or column-major).
- Meaning of the text attribute bytes `05 07`.
- Multi-chunk uploads (> 496 bytes). Not needed for 32×16.

## Superseded notes
- Image, text and GIF data transfer. The next capture must send content the hat has never seen, so it can't short-circuit.
- Display resolution and pixel format.
- Whether the JieLi auth is required for A951.
