// Injects HATLOG BLE logging into an apktool-decoded Mini LedShow base APK.
// usage: node re/patch-src/apply.mjs <decoded-dir>
// Run on a freshly decoded tree; refuses to patch a file twice.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = process.argv[2]
if (!root) throw new Error('usage: apply.mjs <decoded-dir>')

/** apktool emits a mix of LF and CRLF files; patch on LF and restore the original style. */
function edit(rel, fn) {
  const file = join(root, 'smali', rel)
  const raw = readFileSync(file, 'utf8')
  const crlf = raw.includes('\r\n')
  const out = fn(raw.replace(/\r\n/g, '\n'))
  writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out)
}

function insertAt(rel, anchor, code, { before }) {
  edit(rel, (src) => {
    if (src.includes(code.trim())) throw new Error(`${rel}: already contains ${code.trim()}`)
    const count = src.split(anchor).length - 1
    if (count !== 1) throw new Error(`${rel}: expected 1 match for anchor, found ${count}`)
    return src.replace(anchor, before ? `${code}\n\n    ${anchor}` : `${anchor}\n\n${code}`)
  })
  console.log(`patched ${rel}`)
}

// 1. The single GATT write site: log characteristic + payload just before setValue().
insertAt(
  'm4/a.smali',
  'invoke-virtual {p1, p3}, Landroid/bluetooth/BluetoothGattCharacteristic;->setValue([B)Z',
  '    invoke-static {p1, p3}, Lhatlog/L;->tx(Landroid/bluetooth/BluetoothGattCharacteristic;[B)V',
  { before: true }
)

// 2. Notifications from the hat.
insertAt(
  'j4/b$b.smali',
  '.method public onCharacteristicChanged(Landroid/bluetooth/BluetoothGatt;Landroid/bluetooth/BluetoothGattCharacteristic;)V\n    .locals 3',
  '    invoke-static {p2}, Lhatlog/L;->rx(Landroid/bluetooth/BluetoothGattCharacteristic;)V',
  { before: false }
)

// 3. Negotiated MTU (affects chunk sizes).
insertAt(
  'j4/b$b.smali',
  '.method public onMtuChanged(Landroid/bluetooth/BluetoothGatt;II)V\n    .locals 2',
  '    invoke-static {p2, p3}, Lhatlog/L;->mtu(II)V',
  { before: false }
)

// 4. The logger itself goes in a second dex to stay clear of the 64K method limit.
const dest = join(root, 'smali_classes2', 'hatlog')
mkdirSync(dest, { recursive: true })
copyFileSync(join(here, 'hatlog', 'L.smali'), join(dest, 'L.smali'))
console.log('added smali_classes2/hatlog/L.smali')
