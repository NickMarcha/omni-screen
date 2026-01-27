import WebSocket from 'ws'
import { EventEmitter } from 'events'

export type LiveWebSocketEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; code: number; reason: string }
  | { type: 'message'; data: any }
  | { type: 'error'; message: string }

export class LiveWebSocket extends EventEmitter {
  private ws: WebSocket | null = null
  private url: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private reconnectTimer: NodeJS.Timeout | null = null
  private isIntentionallyClosed = false
  private connectionTimeout: NodeJS.Timeout | null = null

  constructor(url: string = 'wss://live.destiny.gg/') {
    super()
    this.url = url
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.isIntentionallyClosed = false

    try {
      // live.destiny.gg appears to validate Origin (the website sends Origin: https://www.destiny.gg)
      // Incognito works without cookies, so we intentionally do NOT forward cookies here.
      this.ws = new WebSocket(this.url, {
        origin: 'https://www.destiny.gg',
        headers: {
          // A normal UA can help if the server does heuristic filtering.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        perMessageDeflate: true,
        handshakeTimeout: 10000,
      })

      this.connectionTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
          try {
            this.ws.close()
          } catch {
            // ignore
          }
          this.handleReconnect()
        }
      }, 10000)

      this.ws.on('open', () => {
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        this.reconnectAttempts = 0
        this.reconnectDelay = 1000
        this.emit('connected')
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        const raw = data.toString()
        try {
          const parsed = JSON.parse(raw)
          this.emit('message', parsed)
        } catch {
          // Forward raw text if it isn't JSON (still useful)
          this.emit('message', raw)
        }
      })

      this.ws.on('error', (error: Error) => {
        const msg = error?.message || String(error) || 'Unknown error'
        try {
          this.emit('error', { message: msg })
        } catch {
          // ignore
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        this.emit('disconnected', { code, reason: reason.toString() })
        if (!this.isIntentionallyClosed) {
          this.handleReconnect()
        }
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error) || 'Unknown error'
      this.emit('error', { message: msg })
      this.handleReconnect()
    }
  }

  disconnect(): void {
    this.isIntentionallyClosed = true

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }

    if (!this.ws) {
      this.emit('disconnected', { code: 1000, reason: 'Intentional disconnect' })
      return
    }

    const ws = this.ws
    const readyState = ws.readyState

    // Prevent unhandled 'error' events during shutdown
    try {
      ws.on('error', () => {})
    } catch {
      // ignore
    }

    // Remove other listeners to prevent callbacks firing during cleanup
    ws.removeAllListeners('open')
    ws.removeAllListeners('message')
    ws.removeAllListeners('close')

    try {
      if (readyState === WebSocket.CONNECTING) ws.terminate()
      else if (readyState === WebSocket.OPEN) ws.close()
    } catch {
      // ignore
    }

    this.ws = null
    this.emit('disconnected', { code: 1000, reason: 'Intentional disconnect' })
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  destroy(): void {
    this.disconnect()
    this.removeAllListeners()
  }

  private handleReconnect(): void {
    if (this.isIntentionallyClosed) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('maxReconnectAttemptsReached')
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

