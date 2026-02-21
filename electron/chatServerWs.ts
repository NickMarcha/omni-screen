/**
 * WebSocket server for unified chat delivery.
 * All chat consumers (main window, chat window, OBS) connect here.
 * Main process broadcasts chat messages to all connected clients.
 * Ping/pong keepalive for disconnect detection.
 * HTTP proxy for emotes/flairs (CORS-safe, server-side fetch).
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { incrementMainBroadcastDroppedNoClients, incrementMainBroadcastSent } from './primaryChatDebugCounters'

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

/** Cached proxy responses: emotes.json, emotes.css, flairs.json, flairs.css. Pre-fetched so renderer gets instant response. */
const emotesCache = new Map<string, { body: string; contentType: string }>()

function cacheKey(path: string): string {
  return path
}

/** Pre-fetch emotes/flairs into cache. Called when config is set or on reload. */
async function populateEmotesCache(config: EmotesConfig): Promise<void> {
  const entries: Array<{ path: string; url: string; rewrite?: (body: string) => string }> = [
    { path: '/emotes.json', url: config.emotesJsonUrl },
    { path: '/emotes.css', url: config.emotesCssUrl, rewrite: (b) => rewriteCssUrls(b, '/emote/') },
  ]
  if (config.flairsJsonUrl) entries.push({ path: '/flairs.json', url: config.flairsJsonUrl })
  if (config.flairsCssUrl) entries.push({ path: '/flairs.css', url: config.flairsCssUrl, rewrite: (b) => rewriteCssUrls(b, '/flair/') })

  await Promise.all(
    entries.map(async ({ path, url, rewrite }) => {
      try {
        const { body, contentType } = await proxyFetch(url)
        const out = rewrite ? rewrite(body) : body
        emotesCache.set(cacheKey(path), { body: out, contentType })
      } catch {
        emotesCache.delete(cacheKey(path))
      }
    })
  )
}

/** Set primary chat emotes URLs for proxy (called from main when overlay loads). Pre-fetches into cache. */
export function setEmotesProxyConfig(config: EmotesConfig | null) {
  cachedEmotesConfig = config
  emotesCache.clear()
  if (config) {
    populateEmotesCache(config).catch((e) => console.error('[Chat WS Server] Pre-fetch emotes failed:', e))
  }
}

/** Clear cache and refetch. Called on chat-websocket-reload. Returns when refetch is done. */
export async function clearAndRefetchPrimaryChatEmotes(): Promise<void> {
  emotesCache.clear()
  const config = cachedEmotesConfig
  if (config) {
    await populateEmotesCache(config)
  }
}

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }
const clients = new Set<WebSocket>()
const clientByConsumerId = new Map<string, WebSocket>()
const cachedQueueByConsumerId = new Map<string, Array<{ channel: string; payload: unknown }>>()
let pingInterval: ReturnType<typeof setInterval> | null = null

export type RegisterOpts = { delayMultiplier?: number }
export type OnRegisterCallback = (consumerId: string, embedChatKeys: string[], opts?: RegisterOpts) => void
export type OnUnregisterCallback = (consumerId: string) => void
let onRegisterCallback: OnRegisterCallback | null = null
let onUnregisterCallback: OnUnregisterCallback | null = null

/** Set callbacks for subscription registry updates. Called from main when starting the chat server. */
export function setChatSubscriptionCallbacks(onRegister: OnRegisterCallback | null, onUnregister: OnUnregisterCallback | null): void {
  onRegisterCallback = onRegister
  onUnregisterCallback = onUnregister
}

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
            const cached = emotesCache.get(cacheKey(urlPath))
            if (cached) {
              res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': cached.contentType })
              res.end(cached.body)
              return
            }
            try {
              const { body, contentType: ct } = await proxyFetch(targetUrl)
              const out = rewriteCss ? rewriteCss(body) : body
              emotesCache.set(cacheKey(urlPath), { body: out, contentType: ct })
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
          const idsToUnregister: string[] = []
          for (const [id, s] of clientByConsumerId) {
            if (s === socket) {
              idsToUnregister.push(id)
              clientByConsumerId.delete(id)
            }
          }
          idsToUnregister.forEach((id) => onUnregisterCallback?.(id))
        }
        socket.on('close', removeFromRegistry)
        socket.on('error', removeFromRegistry)
        socket.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString()) as { type?: string; consumerId?: string; embedChatKeys?: string[]; opts?: RegisterOpts }
            if (msg?.type === 'unregister' && typeof msg.consumerId === 'string') {
              const cid = msg.consumerId.trim()
              if (cid && clientByConsumerId.get(cid) === socket) {
                clientByConsumerId.delete(cid)
                onUnregisterCallback?.(cid)
              }
              return
            }
            if (msg?.type === 'register' && typeof msg.consumerId === 'string') {
              const cid = msg.consumerId.trim()
              const keys = Array.isArray(msg.embedChatKeys) ? msg.embedChatKeys.filter((k): k is string => typeof k === 'string') : []
              const opts = msg.opts && typeof msg.opts === 'object' ? msg.opts : undefined
              if (cid) {
                // Same socket re-registering with different consumerId: unregister old one(s)
                const idsToUnregister: string[] = []
                for (const [id, s] of clientByConsumerId) {
                  if (s === socket && id !== cid) {
                    idsToUnregister.push(id)
                    clientByConsumerId.delete(id)
                  }
                }
                idsToUnregister.forEach((id) => onUnregisterCallback?.(id))

                clientByConsumerId.set(cid, socket)
                onRegisterCallback?.(cid, keys, opts)

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
                        socket.send(JSON.stringify({ type: 'ipc', channel: 'chat-message', payload: { channel: m.channel, payload: m.payload } }))
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
        socket.send(JSON.stringify({ type: 'ipc', channel: 'chat-message', payload: { channel: m.channel, payload: m.payload } }))
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

function isPrimaryChatMsg(channel: string, args: unknown[]): boolean {
  if (channel !== 'chat-message') return false
  const payload = args.length === 1 ? args[0] : args
  const inner = payload as { channel?: string; payload?: { type?: string } } | undefined
  return inner?.channel === 'chat-websocket-message' && inner?.payload?.type === 'MSG'
}

export function broadcastChatMessage(channel: string, ...args: unknown[]) {
  const isPrimaryMsg = isPrimaryChatMsg(channel, args)
  if (!server || clients.size === 0) {
    if (isPrimaryMsg) incrementMainBroadcastDroppedNoClients()
    return
  }
  if (isPrimaryMsg) incrementMainBroadcastSent()
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
