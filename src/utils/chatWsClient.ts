/**
 * WebSocket client for unified chat delivery.
 * All chat consumers (main window, chat window, OBS) connect here.
 */

const CHAT_WS_URL = 'ws://127.0.0.1:5174'

/** HTTP base for emotes/flairs proxy (same host as WebSocket). Use for emotes when CORS would block direct CDN. */
export const CHAT_HTTP_PROXY_BASE = 'http://127.0.0.1:5174'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void

let ws: WebSocket | null = null
const handlers = new Map<string, Set<Handler>>()
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
const RECONNECT_DELAY_MS = 3000

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return
  try {
    ws = new WebSocket(CHAT_WS_URL)
    ws.onopen = () => {
      if (pendingRegister) {
        ws?.send(JSON.stringify({ type: 'register', ...pendingRegister }))
        pendingRegister = null
      }
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type?: string; channel?: string; payload?: unknown }
        if (msg?.type !== 'ipc' || !msg.channel) return
        const set = handlers.get(msg.channel)
        if (!set) return
        const payload = msg.payload
        const args = Array.isArray(payload) ? payload : payload !== undefined ? [payload] : []
        set.forEach((h) => {
          try {
            h(null, ...args)
          } catch {
            /* ignore */
          }
        })
      } catch {
        /* ignore parse error */
      }
    }
    ws.onclose = () => {
      ws = null
      if (handlers.size > 0) {
        reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS)
      }
    }
    ws.onerror = () => {
      /* close will fire */
    }
  } catch {
    /* ignore */
  }
}

export function chatWsOn(channel: string, handler: Handler): () => void {
  let set = handlers.get(channel)
  if (!set) {
    set = new Set()
    handlers.set(channel, set)
  }
  set.add(handler)
  if (!ws || ws.readyState !== WebSocket.OPEN) connect()
  return () => {
    set?.delete(handler)
    if (set?.size === 0) handlers.delete(channel)
    if (handlers.size === 0 && reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
      ws?.close()
      ws = null
    }
  }
}

export function chatWsOff(channel: string, handler: Handler): void {
  handlers.get(channel)?.delete(handler)
}

let pendingRegister: { consumerId: string; embedChatKeys: string[] } | null = null

export function chatWsSendRegister(consumerId: string, embedChatKeys: string[]): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'register', consumerId, embedChatKeys }))
    return
  }
  pendingRegister = { consumerId, embedChatKeys }
  if (!ws) connect()
}
