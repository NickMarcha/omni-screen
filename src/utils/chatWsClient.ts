/**
 * WebSocket client for unified chat delivery.
 * All chat consumers (main window, chat window, OBS) connect here.
 */

import { incrementWsClientDispatched, incrementWsClientNoHandler } from './primaryChatDebugCounters'

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
        let targetChannel = msg.channel
        let payload = msg.payload
        if (msg.channel === 'chat-message') {
          const inner = payload as { channel?: string; payload?: unknown } | undefined
          if (inner?.channel) {
            targetChannel = inner.channel
            payload = inner.payload
          }
        }
        const set = handlers.get(targetChannel)
        if (!set) {
          if (targetChannel === 'chat-websocket-message') {
            const p = (Array.isArray(payload) ? payload[0] : payload) as { type?: string } | undefined
            if (p?.type === 'MSG') incrementWsClientNoHandler()
          }
          return
        }
        if (targetChannel === 'chat-websocket-message') {
          const p = (Array.isArray(payload) ? payload[0] : payload) as { type?: string } | undefined
          if (p?.type === 'MSG') incrementWsClientDispatched()
        }
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

export interface ChatRegisterOpts {
  delayMultiplier?: number
}

let pendingRegister: { consumerId: string; embedChatKeys: string[]; opts?: ChatRegisterOpts } | null = null

export function chatWsSendRegister(consumerId: string, embedChatKeys: string[], opts?: ChatRegisterOpts): void {
  const payload = opts ? { type: 'register' as const, consumerId, embedChatKeys, opts } : { type: 'register' as const, consumerId, embedChatKeys }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload))
    return
  }
  pendingRegister = { consumerId, embedChatKeys, opts }
  if (!ws) connect()
}

export function chatWsSendUnregister(consumerId: string): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unregister', consumerId }))
  }
}
