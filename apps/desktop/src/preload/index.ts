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
  revealFile: (path: string) => Promise<void>
  openNotesFolder: () => Promise<void>
  setState: (state: string) => Promise<void>
  captureScreenshot: (name: string) => Promise<string>
  getSidecarInfo: () => Promise<{ port: number | null; token: string; status: string }>
  onSidecarReady: (callback: (info: SidecarReadyInfo) => void) => () => void
  onSidecarStatus: (callback: (info: SidecarStatusInfo) => void) => () => void
  onPttChange: (callback: (info: PttEventInfo) => void) => () => void
  onTriggerDemo: (callback: (file: string) => void) => () => void
}

const scribeAPI: ScribeAPI = {
  getMicStatus: (): Promise<string> => ipcRenderer.invoke('scribe:get-mic-status'),
  openMicSettings: (): Promise<void> => ipcRenderer.invoke('scribe:open-mic-settings'),
  revealFile: (path: string): Promise<void> => ipcRenderer.invoke('scribe:reveal-file', path),
  openNotesFolder: (): Promise<void> => ipcRenderer.invoke('scribe:open-notes-folder'),
  setState: (state: string): Promise<void> => ipcRenderer.invoke('scribe:set-state', state),
  captureScreenshot: (name: string): Promise<string> => ipcRenderer.invoke('scribe:capture-screenshot', name),
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
  },

  onTriggerDemo: (callback: (file: string) => void): (() => void) => {
    const subscription = (_event: IpcRendererEvent, file: string): void => callback(file)
    ipcRenderer.on('scribe:trigger-demo', subscription)
    return (): void => {
      ipcRenderer.removeListener('scribe:trigger-demo', subscription)
    }
  }
}

try {
  contextBridge.exposeInMainWorld('scribe', scribeAPI)
} catch (error) {
  console.error('[preload] Failed to expose scribe bridge:', error)
}
