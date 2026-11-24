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
  }
}

export type HatApi = typeof api

contextBridge.exposeInMainWorld('hat', api)
