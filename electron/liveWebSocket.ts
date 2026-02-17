import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { fileLogger } from './fileLogger'

/** Parse Retry-After header to ms. Supports seconds (e.g. "3061") or HTTP-date. */
function parseRetryAfter(value: string | string[] | undefined): number | null {
  if (value == null) return null
  const s = Array.isArray(value) ? value[0] : value
  if (typeof s !== 'string' || !s.trim()) return null
  const sec = parseInt(s, 10)
  if (!Number.isNaN(sec)) return sec * 1000
  const date = Date.parse(s)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - Date.now())
}

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
  /** When rate limited (429) without Retry-After header, use this delay. */
  private readonly rateLimitDelay = 120_000
  /** Parsed Retry-After from last 429 response (ms), if present. */
  private retryAfterMs: number | null = null
  private lastErrorMsg = ''
  private reconnectTimer: NodeJS.Timeout | null = null
  private isIntentionallyClosed = false
  private connectionTimeout: NodeJS.Timeout | null = null
  private typeCounts: Map<string, number> = new Map()
  private lastConnectOptions?: { headers?: Record<string, string> }

  private readonly origin: string

  /** URL and origin are provided by the chat source extension when the live socket is created. */
  constructor(url: string, origin: string) {
    super()
    this.url = url
    this.origin = origin
  }

  /** Connect with optional headers (e.g. Cookie for authenticated watching). Stored for reconnect. */
  connect(options?: { headers?: Record<string, string> }): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.isIntentionallyClosed = false
    if (options) this.lastConnectOptions = options

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      Accept: '*/*',
      'Accept-Language': 'en,en-US;q=0.9',
      Origin: this.origin,
      ...(options ?? this.lastConnectOptions)?.headers,
    }

    try {
      this.ws = new WebSocket(this.url, {
        origin: this.origin,
        headers,
        perMessageDeflate: true,
        handshakeTimeout: 10000,
      })

      this.ws.on('unexpected-response', (_req: unknown, res: { statusCode?: number; headers?: Record<string, string | string[] | undefined> }) => {
        if (res.statusCode === 429) {
          this.lastErrorMsg = '429'
          const raw = res.headers?.['retry-after'] ?? res.headers?.['Retry-After']
          const parsed = parseRetryAfter(raw)
          if (parsed != null) {
            this.retryAfterMs = parsed
            fileLogger.writeLog('info', 'main', '[LiveWebSocket] 429_retry_after', [this.url, `${parsed}ms`])
          }
        }
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
          fileLogger.writeChatHistory('primary-live', raw)
        } catch {
          // ignore
        }
        try {
          const parsed = JSON.parse(raw)
          const type = (parsed as any)?.type
          if (typeof type === 'string') {
            const nextCount = (this.typeCounts.get(type) || 0) + 1
            this.typeCounts.set(type, nextCount)
          } else {
            fileLogger.writeWsDiscrepancy('live', 'unexpected_message_shape', {
              preview: raw.slice(0, 1000),
              sampleKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
            })
          }
          this.emit('message', parsed)
        } catch {
          fileLogger.writeWsDiscrepancy('live', 'non_json_message', {
            preview: raw.slice(0, 2000),
          })
          this.emit('message', raw)
        }
      })

      this.ws.on('error', (error: Error) => {
        const msg = error?.message || String(error) || 'Unknown error'
        this.lastErrorMsg = msg
        fileLogger.writeLog('warn', 'main', '[LiveWebSocket] socket_error', [this.url, msg])
        try {
          this.emit('error', { message: msg })
        } catch {
          // ignore
        }
      })

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.connectionTimeout && clearTimeout(this.connectionTimeout)
        this.connectionTimeout = null
        const reasonStr = reason.toString()
        if (reasonStr) this.lastErrorMsg = reasonStr
        this.emit('disconnected', { code, reason: reasonStr })
        if (!this.isIntentionallyClosed) {
          this.handleReconnect()
        }
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error) || 'Unknown error'
      fileLogger.writeLog('error', 'main', '[LiveWebSocket] connect_exception', [this.url, msg])
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

  /** Send a JSON-serializable object to the server (e.g. { type: 'watching', data: { platform, id } }). */
  send(data: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      const raw = JSON.stringify(data)
      this.ws.send(raw)
      try {
        fileLogger.writeChatHistory('primary-live-out', raw)
      } catch {
        /* ignore */
      }
    } catch (err) {
      fileLogger.writeLog('warn', 'main', '[LiveWebSocket] send_error', [String(err)])
    }
  }

  getUrl(): string {
    return this.url
  }

  destroy(): void {
    this.disconnect()
    this.removeAllListeners()
  }

  private handleReconnect(): void {
    if (this.isIntentionallyClosed) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      fileLogger.writeLog('warn', 'main', '[LiveWebSocket] max_reconnect_attempts_reached', [this.url, this.maxReconnectAttempts])
      this.emit('maxReconnectAttemptsReached')
      return
    }

    this.reconnectAttempts++
    const isRateLimited = /429|rate.?limit|too many/i.test(this.lastErrorMsg)
    let delay: number
    if (isRateLimited) {
      delay = this.retryAfterMs ?? Math.min(this.rateLimitDelay * Math.pow(2, this.reconnectAttempts - 1), 600_000)
      this.retryAfterMs = null
    } else {
      delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay)
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.lastErrorMsg = ''
      this.connect(this.lastConnectOptions)
    }, delay)
  }
}

