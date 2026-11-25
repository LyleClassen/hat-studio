import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Electron has no built-in Web Bluetooth device picker. While a
 * navigator.bluetooth.requestDevice() call is pending, Chromium repeatedly
 * fires 'select-bluetooth-device' with the growing list of discovered devices.
 * We forward that list to the renderer and hold the callback until the user
 * picks a device (or cancels).
 */
let pendingSelect: ((deviceId: string) => void) | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  })

  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    pendingSelect = callback
    win.webContents.send(
      'bt:devices',
      devices.map((d) => ({ id: d.deviceId, name: d.deviceName }))
    )
  })

  // Some devices request pairing; accept "just works" confirmation.
  win.webContents.session.setBluetoothPairingHandler((details, callback) => {
    callback({ confirmed: details.pairingKind === 'confirm' })
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// Mirror the renderer log to disk so sessions can be inspected/diffed later.
const logDir = join(process.cwd(), 'logs')
mkdirSync(logDir, { recursive: true })
const logFile = join(logDir, 'probe.log')
ipcMain.on('log:append', (_e, line: string) => {
  appendFileSync(logFile, line.endsWith('\n') ? line : line + '\n')
})

// Animation files: native open/save dialogs; the renderer only sees text.
const animFilters = [{ name: 'Hat Studio animation', extensions: ['hatanim', 'json'] }]

ipcMain.handle('file:save', async (e, defaultName: string, content: string) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showSaveDialog(win, {
    defaultPath: join(app.getPath('documents'), `${defaultName.replace(/[\\/:*?"<>|]/g, '_') || 'animation'}.hatanim`),
    filters: animFilters
  })
  if (r.canceled || !r.filePath) return null
  writeFileSync(r.filePath, content, 'utf8')
  return r.filePath
})

ipcMain.handle('file:open', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: animFilters })
  if (r.canceled || !r.filePaths[0]) return null
  return { path: r.filePaths[0], content: readFileSync(r.filePaths[0], 'utf8') }
})

ipcMain.on('bt:select', (_e, deviceId: string) => {
  pendingSelect?.(deviceId)
  pendingSelect = null
})

ipcMain.on('bt:cancel', () => {
  pendingSelect?.('')
  pendingSelect = null
})

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
