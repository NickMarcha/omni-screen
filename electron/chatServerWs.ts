/**
 * WebSocket server for unified chat delivery.
 * All chat consumers (main window, chat window, OBS) connect here.
 * Main process broadcasts chat messages to all connected clients.
 * Ping/pong keepalive for disconnect detection.
 */

import { WebSocketServer, WebSocket } from 'ws'

const CHAT_WS_PORT = 5174
const PING_INTERVAL_MS = 30000

export interface ChatWsMessage {
  type: string
  channel?: string
  payload?: unknown
}

let server: WebSocketServer | null = null
const clients = new Set<WebSocket>()
const clientByConsumerId = new Map<string, WebSocket>()
const cachedQueueByConsumerId = new Map<string, Array<{ channel: string; payload: unknown }>>()
let pingInterval: ReturnType<typeof setInterval> | null = null

function startPingInterval() {
  if (pingInterval) return
  pingInterval = setInterval(() => {
    if (!server || clients.size === 0) return
    clients.forEach((sock) => {
      if (sock.readyState === 1) {
        try {
          sock.ping()
        } catch {
          /* ignore */
        }
      }
    })
  }, PING_INTERVAL_MS)
}

function stopPingInterval() {
  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }
}

export function getChatWsServerUrl(): string {
  return `ws://127.0.0.1:${CHAT_WS_PORT}`
}

export function startChatWsServer(): Promise<void> {
  if (server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    try {
      server = new WebSocketServer({ port: CHAT_WS_PORT, host: '127.0.0.1' })
      startPingInterval()

      server.on('connection', (socket) => {
        clients.add(socket)
        socket.on('pong', () => {
          // Client responded to ping - connection alive
        })
        const removeFromRegistry = () => {
          clients.delete(socket)
          for (const [id, s] of clientByConsumerId) {
            if (s === socket) clientByConsumerId.delete(id)
          }
        }
        socket.on('close', removeFromRegistry)
        socket.on('error', removeFromRegistry)
        socket.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString()) as { type?: string; consumerId?: string; embedChatKeys?: string[] }
            if (msg?.type === 'register' && typeof msg.consumerId === 'string') {
              const cid = msg.consumerId.trim()
              if (cid) {
                clientByConsumerId.set(cid, socket)
                const queued = cachedQueueByConsumerId.get(cid)
                if (queued?.length) {
                  cachedQueueByConsumerId.delete(cid)
                  queued.forEach((m) => {
                    if (socket.readyState === 1) {
                      try {
                        socket.send(JSON.stringify({ type: 'ipc', channel: m.channel, payload: m.payload }))
                      } catch {
                        /* ignore */
                      }
                    }
                  })
                }
              }
            }
          } catch {
            /* ignore invalid JSON */
          }
        })
      })

      server.on('error', (err) => {
        console.error('[Chat WS Server] Error:', err)
        reject(err)
      })

      server.on('listening', () => {
        console.log(`[Chat WS Server] Listening on ws://127.0.0.1:${CHAT_WS_PORT}`)
        resolve()
      })
    } catch (err) {
      reject(err)
    }
  })
}

export function sendCachedToConsumer(consumerId: string, cached: Array<{ channel: string; payload: unknown }>) {
  if (!cached.length) return
  const socket = clientByConsumerId.get(consumerId)
  if (socket && socket.readyState === 1) {
    cached.forEach((m) => {
      try {
        socket.send(JSON.stringify({ type: 'ipc', channel: m.channel, payload: m.payload }))
      } catch {
        /* ignore */
      }
    })
  } else {
    const existing = cachedQueueByConsumerId.get(consumerId) ?? []
    existing.push(...cached)
    cachedQueueByConsumerId.set(consumerId, existing)
  }
}

export function broadcastChatMessage(channel: string, ...args: unknown[]) {
  if (!server || clients.size === 0) return
  const msg: ChatWsMessage = { type: 'ipc', channel, payload: args.length === 1 ? args[0] : args }
  const data = JSON.stringify(msg)
  clients.forEach((sock) => {
    if (sock.readyState === 1) {
      try {
        sock.send(data)
      } catch {
        /* ignore */
      }
    }
  })
}

export function stopChatWsServer(): void {
  stopPingInterval()
  clientByConsumerId.clear()
  cachedQueueByConsumerId.clear()
  clients.forEach((w) => {
    try {
      w.close()
    } catch {
      /* ignore */
    }
  })
  clients.clear()
  if (server) {
    server.close()
    server = null
  }
}
