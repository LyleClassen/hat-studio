import { contextBridge, ipcRenderer } from 'electron'

export interface BtDeviceInfo {
  id: string
  name: string
}

const api = {
  /** Subscribe to device-list updates during a pending requestDevice(). */
  onDevices(cb: (devices: BtDeviceInfo[]) => void): () => void {
    const listener = (_e: unknown, devices: BtDeviceInfo[]): void => cb(devices)
    ipcRenderer.on('bt:devices', listener)
    return () => ipcRenderer.removeListener('bt:devices', listener)
  },
  selectDevice(id: string): void {
    ipcRenderer.send('bt:select', id)
  },
  cancelSelect(): void {
    ipcRenderer.send('bt:cancel')
  },
  appendLog(line: string): void {
    ipcRenderer.send('log:append', line)
  },
  /** Shows a save dialog; resolves to the saved path, or null if cancelled. */
  saveFile(defaultName: string, content: string): Promise<string | null> {
    return ipcRenderer.invoke('file:save', defaultName, content)
  },
  /** Shows an open dialog; resolves to the file, or null if cancelled. */
  openFile(): Promise<{ path: string; content: string } | null> {
    return ipcRenderer.invoke('file:open')
  }
}

export type HatApi = typeof api

contextBridge.exposeInMainWorld('hat', api)
