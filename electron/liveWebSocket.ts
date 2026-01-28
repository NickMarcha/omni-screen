import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { fileLogger } from './fileLogger'

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
  private typeCounts: Map<string, number> = new Map()
  private seenTypes: Set<string> = new Set()

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
      fileLogger.writeWsDiscrepancy('live', 'connect_attempt', {
        url: this.url,
        reconnectAttempts: this.reconnectAttempts,
        options: {
          origin: 'https://www.destiny.gg',
          perMessageDeflate: true,
          handshakeTimeout: 10000,
        },
      })

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
        const anyWs = this.ws as any
        const sock = anyWs?._socket
        const socketInfo =
          sock && typeof sock === 'object'
            ? {
                remoteAddress: sock.remoteAddress,
                remotePort: sock.remotePort,
                localAddress: sock.localAddress,
                localPort: sock.localPort,
                alpnProtocol: sock.alpnProtocol,
                servername: sock.servername,
              }
            : undefined
        fileLogger.writeWsDiscrepancy('live', 'connected', {
          url: this.url,
          socketInfo,
          protocol: (this.ws as any)?.protocol,
          extensions: (this.ws as any)?.extensions,
        })
        this.emit('connected')
      })

      this.ws.on('message', (data: WebSocket.Data) => {
        const raw = data.toString()
        try {
          const parsed = JSON.parse(raw)
          const type = (parsed as any)?.type
          if (typeof type === 'string') {
            const nextCount = (this.typeCounts.get(type) || 0) + 1
            this.typeCounts.set(type, nextCount)
            if (!this.seenTypes.has(type)) {
              this.seenTypes.add(type)
              fileLogger.writeWsDiscrepancy('live', 'new_type_observed', {
                type,
                sampleKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
                sample: parsed,
              })
            }

            // Extra shape validation for types we actively use
            if (type === 'dggApi:embeds') {
              const dataField = (parsed as any).data
              if (!Array.isArray(dataField)) {
                fileLogger.writeWsDiscrepancy('live', 'shape_mismatch:dggApi:embeds', {
                  expected: 'data: array',
                  actualType: typeof dataField,
                  sample: parsed,
                })
              } else {
                const missing = dataField.filter((e: any) => !e || typeof e.platform !== 'string' || typeof e.id !== 'string').length
                if (missing > 0) {
                  fileLogger.writeWsDiscrepancy('live', 'item_mismatch:dggApi:embeds', {
                    total: dataField.length,
                    missingPlatformOrId: missing,
                    sampleFirst: dataField[0],
                  })
                }
              }
            } else if (type === 'dggApi:bannedEmbeds') {
              const dataField = (parsed as any).data
              if (!(dataField === null || Array.isArray(dataField))) {
                fileLogger.writeWsDiscrepancy('live', 'shape_mismatch:dggApi:bannedEmbeds', {
                  expected: 'data: null | array',
                  actualType: typeof dataField,
                  sample: parsed,
                })
              }
            }
          } else {
            // JSON but unexpected shape
            fileLogger.writeWsDiscrepancy('live', 'unexpected_message_shape', {
              preview: raw.slice(0, 1000),
              sampleKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
            })
          }
          this.emit('message', parsed)
        } catch {
          // Forward raw text if it isn't JSON (still useful)
          fileLogger.writeWsDiscrepancy('live', 'non_json_message', {
            preview: raw.slice(0, 2000),
          })
          this.emit('message', raw)
        }
      })

      this.ws.on('error', (error: Error) => {
        const msg = error?.message || String(error) || 'Unknown error'
        fileLogger.writeWsDiscrepancy('live', 'socket_error', {
          message: msg,
          stack: error?.stack,
          url: this.url,
        })
        try {
          this.emit('error', { message: msg })
        } catch {
          // ignore
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        fileLogger.writeWsDiscrepancy('live', 'disconnected', {
          url: this.url,
          code,
          reason: reason.toString(),
          reconnectAttempts: this.reconnectAttempts,
          typeCounts: Object.fromEntries(this.typeCounts.entries()),
        })
        this.emit('disconnected', { code, reason: reason.toString() })
        if (!this.isIntentionallyClosed) {
          this.handleReconnect()
        }
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error) || 'Unknown error'
      fileLogger.writeWsDiscrepancy('live', 'connect_exception', {
        url: this.url,
        error: msg,
      })
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
      fileLogger.writeWsDiscrepancy('live', 'max_reconnect_attempts_reached', {
        url: this.url,
        maxReconnectAttempts: this.maxReconnectAttempts,
        typeCounts: Object.fromEntries(this.typeCounts.entries()),
      })
      this.emit('maxReconnectAttemptsReached')
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay)

    fileLogger.writeWsDiscrepancy('live', 'reconnect_scheduled', {
      url: this.url,
      attempt: this.reconnectAttempts,
      delayMs: delay,
    })

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

