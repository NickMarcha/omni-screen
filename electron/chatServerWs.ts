/**
 * WebSocket server for unified chat delivery.
 * All chat consumers (main window, chat window, OBS) connect here.
 * Main process broadcasts chat messages to all connected clients.
 * Ping/pong keepalive for disconnect detection.
 * HTTP proxy for emotes/flairs (CORS-safe, server-side fetch).
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'

const CHAT_WS_PORT = 5174
const PING_INTERVAL_MS = 30000

export interface ChatWsMessage {
  type: string
  channel?: string
  payload?: unknown
}

export interface EmotesConfig {
  emotesJsonUrl: string
  emotesCssUrl: string
  flairsJsonUrl?: string
  flairsCssUrl?: string
}

let httpServer: ReturnType<typeof createServer> | null = null
let server: WebSocketServer | null = null
let cachedEmotesConfig: EmotesConfig | null = null

/** Set primary chat emotes URLs for proxy (called from main when overlay loads). */
export function setEmotesProxyConfig(config: EmotesConfig | null) {
  cachedEmotesConfig = config
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }
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

const PROXY_BASE = `http://127.0.0.1:${CHAT_WS_PORT}`

async function proxyFetch(url: string): Promise<{ body: string; contentType: string }> {
  const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
  const res = await fetch(fetchUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`)
  const body = await res.text()
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  return { body, contentType }
}

async function proxyFetchBinary(url: string): Promise<{ body: Buffer; contentType: string }> {
  const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
  const res = await fetch(fetchUrl, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`)
  const ab = await res.arrayBuffer()
  const body = Buffer.from(ab)
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  return { body, contentType }
}

/** Rewrite relative url() in CSS to proxy URLs so emote/flair images load without CORS. */
function rewriteCssUrls(css: string, proxyPathPrefix: string): string {
  return css.replace(/url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/g, (_m, path: string) => {
    const trimmed = path.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//') || trimmed.startsWith('/')) {
      return `url(${path})`
    }
    const clean = trimmed.replace(/^\.\//, '')
    return `url(${PROXY_BASE}${proxyPathPrefix}${clean})`
  })
}

function getBaseUrl(cssUrl: string): string {
  const u = new URL(cssUrl)
  return u.origin + u.pathname.replace(/\/[^/]*$/, '/')
}

export function startChatWsServer(): Promise<void> {
  if (server) return Promise.resolve()
  return new Promise((resolve, reject) => {
    try {
      httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        if (req.headers.upgrade === 'websocket') return
        const urlPath = (req.url || '').split('?')[0]
        const config = cachedEmotesConfig
        if (config && req.method === 'GET') {
          let targetUrl: string | null = null
          let rewriteCss: ((body: string) => string) | null = null
          if (urlPath === '/emotes.json') {
            targetUrl = config.emotesJsonUrl
          } else if (urlPath === '/emotes.css') {
            targetUrl = config.emotesCssUrl
            rewriteCss = (body) => rewriteCssUrls(body, '/emote/')
          } else if (urlPath === '/flairs.json' && config.flairsJsonUrl) {
            targetUrl = config.flairsJsonUrl
          } else if (urlPath === '/flairs.css' && config.flairsCssUrl) {
            targetUrl = config.flairsCssUrl
            rewriteCss = (body) => rewriteCssUrls(body, '/flair/')
          } else if (urlPath.startsWith('/emote/')) {
            const path = decodeURIComponent(urlPath.slice('/emote/'.length))
            const base = getBaseUrl(config.emotesCssUrl)
            const imageUrl = base + path
            try {
              const { body, contentType: ct } = await proxyFetchBinary(imageUrl)
              res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': ct })
              res.end(body)
            } catch {
              res.writeHead(502, CORS_HEADERS)
              res.end('Proxy fetch failed')
            }
            return
          } else if (urlPath.startsWith('/flair/') && config.flairsCssUrl) {
            const path = decodeURIComponent(urlPath.slice('/flair/'.length))
            const base = getBaseUrl(config.flairsCssUrl)
            const imageUrl = base + path
            try {
              const { body, contentType: ct } = await proxyFetchBinary(imageUrl)
              res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': ct })
              res.end(body)
            } catch {
              res.writeHead(502, CORS_HEADERS)
              res.end('Proxy fetch failed')
            }
            return
          }
          if (targetUrl) {
            try {
              const { body, contentType: ct } = await proxyFetch(targetUrl)
              const out = rewriteCss ? rewriteCss(body) : body
              res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': ct })
              res.end(out)
            } catch {
              res.writeHead(502, CORS_HEADERS)
              res.end('Proxy fetch failed')
            }
            return
          }
        }
        res.writeHead(404, CORS_HEADERS)
        res.end('Not found')
      })
      server = new WebSocketServer({ server: httpServer })
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
                const base = `http://127.0.0.1:${CHAT_WS_PORT}`
                if (cachedEmotesConfig) {
                  try {
                    socket.send(
                      JSON.stringify({
                        type: 'ipc',
                        channel: 'chat-emotes-config',
                        payload: {
                          emotesJsonUrl: `${base}/emotes.json`,
                          emotesCssUrl: `${base}/emotes.css`,
                          flairsJsonUrl: cachedEmotesConfig.flairsJsonUrl ? `${base}/flairs.json` : undefined,
                          flairsCssUrl: cachedEmotesConfig.flairsCssUrl ? `${base}/flairs.css` : undefined,
                        },
                      })
                    )
                  } catch {
                    /* ignore */
                  }
                }
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

      httpServer.listen(CHAT_WS_PORT, '127.0.0.1', () => {
        console.log(`[Chat WS Server] Listening on ws://127.0.0.1:${CHAT_WS_PORT} (HTTP proxy: /emotes.json, /emotes.css, /emote/*, /flairs.json, /flairs.css, /flair/*)`)
        resolve()
      })
      httpServer.on('error', (err) => {
        console.error('[Chat WS Server] Error:', err)
        reject(err)
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
  if (httpServer) {
    httpServer.close()
    httpServer = null
  }
}
