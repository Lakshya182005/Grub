import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

export interface SidecarReadyInfo {
  port: number
  token: string
}

export interface SidecarStatusInfo {
  status: string
  code?: number | string
}

export interface PttEventInfo {
  on: boolean
}

export interface ScribeAPI {
  getMicStatus: () => Promise<string>
  openMicSettings: () => Promise<void>
  getSidecarInfo: () => Promise<{ port: number | null; token: string; status: string }>
  onSidecarReady: (callback: (info: SidecarReadyInfo) => void) => () => void
  onSidecarStatus: (callback: (info: SidecarStatusInfo) => void) => () => void
  onPttChange: (callback: (info: PttEventInfo) => void) => () => void
}

const scribeAPI: ScribeAPI = {
  getMicStatus: (): Promise<string> => ipcRenderer.invoke('scribe:get-mic-status'),
  openMicSettings: (): Promise<void> => ipcRenderer.invoke('scribe:open-mic-settings'),
  getSidecarInfo: (): Promise<{ port: number | null; token: string; status: string }> =>
    ipcRenderer.invoke('scribe:get-sidecar-info'),

  onSidecarReady: (callback: (info: SidecarReadyInfo) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, info: SidecarReadyInfo): void => callback(info)
    ipcRenderer.on('scribe:sidecar-ready', subscription)
    return (): void => {
      ipcRenderer.removeListener('scribe:sidecar-ready', subscription)
    }
  },

  onSidecarStatus: (callback: (info: SidecarStatusInfo) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, info: SidecarStatusInfo): void => callback(info)
    ipcRenderer.on('scribe:sidecar-status', subscription)
    return (): void => {
      ipcRenderer.removeListener('scribe:sidecar-status', subscription)
    }
  },

  onPttChange: (callback: (info: PttEventInfo) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, info: PttEventInfo): void => callback(info)
    ipcRenderer.on('scribe:ptt-change', subscription)
    return (): void => {
      ipcRenderer.removeListener('scribe:ptt-change', subscription)
    }
  }
}

try {
  contextBridge.exposeInMainWorld('scribe', scribeAPI)
} catch (error) {
  console.error('[preload] Failed to expose scribe bridge:', error)
}
