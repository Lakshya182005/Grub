/**
 * ws.ts — WebSocket transport for audio streaming and sidecar communication.
 */

export type SidecarMessage =
  | { t: 'wake' }
  | { t: 'ready'; model: string; voice: string }
  | { t: 'state'; state: 'idle' | 'listening' | 'thinking' | 'speaking' }
  | { t: 'transcript'; text: string; ms?: number }
  | { t: 'note'; id: string; title: string; body: string; path: string }
  | { t: 'say'; text: string; pcm_b64?: string | null; rate?: number }
  | { t: 'error'; kind: string; msg: string }
  | Record<string, unknown>

export interface WebSocketClientOptions {
  onMessage?: (msg: SidecarMessage) => void
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected') => void
}

export class WebSocketClient {
  private socket: WebSocket | null = null
  private queue: ArrayBuffer[] = []
  private readonly maxQueueSize = 40
  private reconnectAttempted = false
  private isDestroyed = false
  private currentUrl = ''

  constructor(private options: WebSocketClientOptions = {}) {}

  public connect(port: number, token: string): void {
    if (this.isDestroyed) return
    this.currentUrl = `ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`
    this.reconnectAttempted = false
    this.initSocket()
  }

  private initSocket(): void {
    if (!this.currentUrl || this.isDestroyed) return

    this.options.onStatusChange?.('connecting')

    try {
      this.socket = new WebSocket(this.currentUrl)
      this.socket.binaryType = 'arraybuffer'

      this.socket.onopen = (): void => {
        this.options.onStatusChange?.('connected')
        this.flushQueue()
      }

      this.socket.onmessage = (event: MessageEvent): void => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data) as SidecarMessage
            this.options.onMessage?.(data)
          } catch (err) {
            console.error('[ws] Failed to parse message JSON:', err)
          }
        }
      }

      this.socket.onclose = (): void => {
        this.socket = null
        this.options.onStatusChange?.('disconnected')

        if (!this.reconnectAttempted && !this.isDestroyed) {
          this.reconnectAttempted = true
          setTimeout(() => {
            if (!this.isDestroyed) {
              this.initSocket()
            }
          }, 1000)
        }
      }

      this.socket.onerror = (err): void => {
        console.error('[ws] WebSocket error:', err)
      }
    } catch (err) {
      console.error('[ws] Failed to create WebSocket connection:', err)
      this.options.onStatusChange?.('disconnected')
    }
  }

  public sendFrame(frame: ArrayBuffer): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(frame)
    } else {
      // Buffer up to maxQueueSize (40 frames ≈ 800 ms), dropping oldest
      if (this.queue.length >= this.maxQueueSize) {
        this.queue.shift()
      }
      this.queue.push(frame)
    }
  }

  public sendJson(data: Record<string, unknown>): void {
    const payload = JSON.stringify(data)
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload)
    }
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    while (this.queue.length > 0) {
      const frame = this.queue.shift()
      if (frame) {
        this.socket.send(frame)
      }
    }
  }

  public destroy(): void {
    this.isDestroyed = true
    this.queue = []
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }
}
