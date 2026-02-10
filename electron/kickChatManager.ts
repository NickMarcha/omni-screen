import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { fileLogger } from './fileLogger'
import { net, session } from 'electron'

export type KickChatMessage = {
  platform: 'kick'
  slug: string
  chatroomId: number
  id: string
  content: string
  createdAt: string
  // True when emitted from history fetch (not live websocket).
  isHistory?: boolean
  // Optional emote info if Kick provides it in message payload.
  // Shapes vary across endpoints/events, so this is intentionally permissive.
  emotes?: Array<{ id: number; name?: string; start?: number; end?: number }>
  sender: {
    id: number
    username: string
    slug: string
    color?: string
    badges?: Array<{ type: string; text?: string; count?: number }>
  }
}

type KickChannelInfo = { channelId?: number; chatroomId: number; /** From API when available (e.g. chatroom viewers/chatters). */ chatUserCount?: number | null }

const PUSHER_URL =
  'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false'

function safeJsonParse<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function getKickSession() {
  // Use the same persistent session as the renderer windows (so Cloudflare/Kick cookies match).
  return session.fromPartition('persist:main')
}

/** Get CSRF token from session cookie (XSRF-TOKEN). Kick requires it in X-XSRF-TOKEN header for POST. */
async function getKickCsrfToken(): Promise<string | null> {
  const ses = getKickSession()
  const cookies = await ses.cookies.get({ url: 'https://kick.com' })
  const xsrf = cookies.find((c) => c.name === 'XSRF-TOKEN')
  if (!xsrf?.value) return null
  try {
    return decodeURIComponent(xsrf.value)
  } catch {
    return xsrf.value
  }
}

/** Get Bearer token from session_token cookie. Kick requires Authorization: Bearer for authenticated POST. */
async function getKickSessionBearerToken(): Promise<string | null> {
  const ses = getKickSession()
  const cookies = await ses.cookies.get({ url: 'https://kick.com' })
  const sessionToken = cookies.find((c) => c.name === 'session_token')
  if (!sessionToken?.value) return null
  try {
    return decodeURIComponent(sessionToken.value)
  } catch {
    return sessionToken.value
  }
}

function headerValue(headers: Record<string, string | string[]>, key: string): string {
  const v = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()]
  if (Array.isArray(v)) return v.join(', ')
  return typeof v === 'string' ? v : ''
}

async function kickRequestText(
  url: string,
  opts: { accept: string; origin?: string; referer?: string; extraHeaders?: Record<string, string> },
): Promise<{ status: number; headers: Record<string, string | string[]>; bodyText: string }> {
  // IMPORTANT: `ses.fetch()` behaves like browser fetch (CORS can block and surface as net::ERR_FAILED).
  // `net.request()` uses Chromium's network stack but is not subject to CORS, and can still use session cookies.
  return await new Promise((resolve, reject) => {
    const req = net.request({
      method: 'GET',
      url,
      session: getKickSession(),
      redirect: 'follow',
      credentials: 'include',
      useSessionCookies: true,
      origin: opts.origin ?? 'https://kick.com',
      headers: {
        Accept: opts.accept,
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        ...(opts.referer ? { Referer: opts.referer } : {}),
        ...(opts.extraHeaders ?? {}),
      },
    })

    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf-8')
        resolve({ status: res.statusCode, headers: res.headers, bodyText })
      })
      res.on('error', (err) => reject(err))
    })
    req.on('error', (err) => reject(err))
    req.end()
  })
}

async function kickPostJson(
  url: string,
  body: Record<string, unknown>,
  opts: { referer?: string }
): Promise<{ status: number; bodyText: string }> {
  const bodyStr = JSON.stringify(body)
  const [csrfToken, bearerToken] = await Promise.all([getKickCsrfToken(), getKickSessionBearerToken()])
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    ...(opts.referer ? { Referer: opts.referer } : {}),
  }
  if (csrfToken) headers['X-XSRF-TOKEN'] = csrfToken
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'POST',
      url,
      session: getKickSession(),
      redirect: 'follow',
      useSessionCookies: true,
      origin: 'https://kick.com',
      headers,
    })
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, bodyText: Buffer.concat(chunks).toString('utf-8') })
      })
      res.on('error', (err) => reject(err))
    })
    req.on('error', (err) => reject(err))
    req.write(bodyStr, 'utf-8')
    req.end()
  })
}

async function fetchKickJson(url: string): Promise<any> {
  // Note: Kick history often requires Cloudflare/Kick cookies (cf_clearance, etc).
  // Ensure we include cookies from the Electron session.
  const { status, headers, bodyText } = await kickRequestText(url, {
    accept: 'application/json',
    origin: 'https://kick.com',
    referer: 'https://kick.com/',
    extraHeaders: {
      DNT: '1',
      'Sec-GPC': '1',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
    },
  })

  const contentType = headerValue(headers, 'content-type')
  const text = bodyText || ''

  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status} for ${url} ct=${contentType} body=${text.slice(0, 200)}`)
  }

  const parsed = safeJsonParse<any>(text)
  if (!parsed) {
    throw new Error(`Non-JSON response for ${url} ct=${contentType} body=${text.slice(0, 200)}`)
  }
  return parsed
}

function extractKickEmotes(raw: any): Array<{ id: number; name?: string; start?: number; end?: number }> | undefined {
  const candidates = [raw?.emotes, raw?.emoticons, raw?.message?.emotes, raw?.message?.emoticons].filter(Boolean)
  let first = candidates.find((x) => Array.isArray(x)) as any[] | undefined

  // Some Kick payloads use content as array of fragments: [{ type: 'text', content: '...' }, { type: 'emote', id, ... }]
  if (!first && Array.isArray(raw?.content)) {
    const fromFragments: Array<{ id: number; name?: string; start?: number; end?: number }> = []
    let offset = 0
    for (const frag of raw.content as any[]) {
      if (!frag || typeof frag !== 'object') continue
      const type = String(frag?.type ?? frag?.kind ?? '').toLowerCase()
      const text = typeof frag?.content === 'string' ? frag.content : String(frag?.text ?? '')
      if (type === 'emote' || type === 'emoticon') {
        const id = Number(frag?.id ?? frag?.emote_id ?? frag?.emoticon_id)
        if (Number.isFinite(id) && id > 0) {
          fromFragments.push({ id, name: typeof frag?.name === 'string' ? frag.name : undefined, start: offset, end: offset + text.length })
        }
      }
      offset += text.length
    }
    if (fromFragments.length > 0) return fromFragments
  }

  if (!first) return undefined

  const out: Array<{ id: number; name?: string; start?: number; end?: number }> = []
  for (const e of first as any[]) {
    if (!e || typeof e !== 'object') continue
    const id = Number((e as any).id ?? (e as any).emote_id ?? (e as any).emoticon_id)
    if (!Number.isFinite(id) || id <= 0) continue

    const name = typeof (e as any).name === 'string' ? (e as any).name : typeof (e as any).code === 'string' ? (e as any).code : undefined

    const start = Number((e as any).start ?? (e as any).from ?? (e as any).begin)
    const end = Number((e as any).end ?? (e as any).to ?? (e as any).finish)
    const hasRange = Number.isFinite(start) && Number.isFinite(end) && end > start && start >= 0

    if (Array.isArray((e as any).positions)) {
      for (const p of (e as any).positions) {
        const ps = Number(p?.start ?? p?.from ?? p?.begin)
        const pe = Number(p?.end ?? p?.to ?? p?.finish)
        if (Number.isFinite(ps) && Number.isFinite(pe) && pe > ps && ps >= 0) out.push({ id, name, start: ps, end: pe })
      }
      continue
    }

    out.push(hasRange ? { id, name, start, end } : { id, name })
  }

  return out.length ? out : undefined
}

function normalizeKickMessage(parsed: any, slugHint?: string, chatroomIdHint?: number): KickChatMessage | null {
  if (!parsed || typeof parsed !== 'object') return null

  // IMPORTANT:
  // - Live pusher events commonly use `chatroom_id`
  // - History endpoint commonly returns `chat_id` that can be *different* (often the channel id).
  // To keep routing + dedupe consistent, prefer the hint (which comes from channelInfo.chatroomId).
  const chatroomId =
    Number(
      chatroomIdHint ??
        parsed?.chatroom_id ??
        parsed?.chatroomId ??
        parsed?.chatroom?.id ??
        parsed?.chat_id ??
        parsed?.chatId ??
        parsed?.chat?.id,
    ) || 0
  const slug = typeof parsed?.slug === 'string' ? parsed.slug : slugHint || 'unknown'

  const sender = parsed?.sender ?? parsed?.user ?? parsed?.author ?? {}
  const createdAt = String(parsed?.created_at ?? parsed?.createdAt ?? parsed?.created_at?.date ?? parsed?.timestamp ?? '')

  let content: string
  if (Array.isArray(parsed?.content)) {
    content = (parsed.content as any[])
      .map((f: any) => (typeof f?.content === 'string' ? f.content : typeof f?.text === 'string' ? f.text : String(f ?? '')))
      .join('')
  } else {
    content = String(parsed?.content ?? parsed?.message ?? parsed?.body ?? '')
  }

  const msg: KickChatMessage = {
    platform: 'kick',
    slug,
    chatroomId,
    id: String(parsed?.id ?? parsed?.message_id ?? ''),
    content,
    createdAt,
    emotes: extractKickEmotes(parsed),
    sender: {
      id: Number(sender?.id) || 0,
      username: String(sender?.username || sender?.slug || sender?.name || 'unknown'),
      slug: String(sender?.slug || sender?.username || sender?.name || 'unknown'),
      color: typeof sender?.identity?.color === 'string' ? sender.identity.color : undefined,
      badges: Array.isArray(sender?.identity?.badges) ? sender.identity.badges : undefined,
    },
  }

  if (!msg.id || !msg.content) return null
  return msg
}

function extractChatroomIdFromHtml(html: string): number {
  // Try a few common patterns seen in Kick pages.
  const patterns: RegExp[] = [
    /"chatroom_id"\s*:\s*(\d+)/,
    /"chatroomId"\s*:\s*(\d+)/,
    /"chatroom"\s*:\s*\{\s*"id"\s*:\s*(\d+)/,
    /chatroom_id\s*=\s*(\d+)/,
    /chatroomId\s*=\s*(\d+)/,
  ]

  for (const re of patterns) {
    const m = re.exec(html)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return n
  }

  // Some pages embed JSON in a script tag as a giant blob; try a more brute force scan.
  const brute = html.match(/chatroom(?:_id|Id)["']?\s*[:=]\s*(\d{3,})/i)
  if (brute) {
    const n = Number(brute[1])
    if (Number.isFinite(n) && n > 0) return n
  }

  return 0
}

async function fetchKickHtml(url: string, slug: string): Promise<string> {
  const { status, headers, bodyText } = await kickRequestText(url, {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    origin: 'https://kick.com',
    referer: `https://kick.com/${encodeURIComponent(slug)}`,
  })
  if (status < 200 || status >= 300) {
    const ct = headerValue(headers, 'content-type')
    throw new Error(`HTTP ${status} for ${url} ct=${ct} body=${(bodyText || '').slice(0, 200)}`)
  }
  return bodyText || ''
}

/** Try to read chat/viewer user count from Kick API response (field names vary). */
function readChatUserCount(data: any): number | null {
  if (!data || typeof data !== 'object') return null
  const n =
    data.chatters_count ??
    data.chattersCount ??
    data.viewers_count ??
    data.viewersCount ??
    data.chatroom?.users_online ??
    data.chatroom?.usersOnline ??
    data.chatroom?.viewers_count ??
    data.livestream?.viewer_count ??
    data.livestream?.viewers_count
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

async function fetchKickChannelInfo(slug: string): Promise<KickChannelInfo> {
  // Dedicated chatroom endpoint: GET /api/v2/channels/{slug}/chatroom returns { id: number, ... }
  const chatroomUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/chatroom`
  try {
    const { status, bodyText } = await kickRequestText(chatroomUrl, {
      accept: 'application/json,text/plain,*/*',
      origin: 'https://kick.com',
      referer: `https://kick.com/${encodeURIComponent(slug)}`,
    })
    if (status >= 200 && status < 300) {
      const data = safeJsonParse<any>(bodyText || '')
      const chatroomId = Number(data?.id)
      const chatUserCount = readChatUserCount(data)
      if (chatroomId > 0) return { chatroomId, chatUserCount }
    }
  } catch (e) {
    fileLogger.writeLog('warn', 'main', '[Kick] chatroom_endpoint_exception', [slug, e instanceof Error ? e.message : String(e)])
  }

  const channelUrls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`,
  ]

  let lastErr: unknown = null
  for (const url of channelUrls) {
    try {
      const { status, headers, bodyText } = await kickRequestText(url, {
        accept: 'application/json,text/plain,*/*',
        origin: 'https://kick.com',
        referer: `https://kick.com/${encodeURIComponent(slug)}`,
      })
      if (status < 200 || status >= 300) {
        const ct = headerValue(headers, 'content-type')
        lastErr = new Error(`HTTP ${status} for ${url} ct=${ct}`)
        continue
      }
      const data = safeJsonParse<any>(bodyText || '')
      if (!data) throw new Error(`Non-JSON response for ${url} ct=${headerValue(headers, 'content-type')}`)

      // Observed shapes vary across Kick versions; support multiple common layouts.
      const channelId =
        Number(data?.id ?? data?.channel_id ?? data?.channelId ?? data?.channel?.id ?? data?.channel?.channel_id) || 0

      const chatroomId =
        Number(
          data?.chatroom?.id ??
            data?.chatroom_id ??
            data?.chatroomId ??
            data?.livestream?.chatroom_id ??
            data?.livestream?.chatroom?.id,
        ) || 0

      if (chatroomId > 0) {
        const chatUserCount = readChatUserCount(data)
        return { channelId: channelId > 0 ? channelId : undefined, chatroomId, chatUserCount }
      }
      lastErr = new Error(`Missing channelId/chatroomId for slug "${slug}" from ${url}`)
    } catch (e) {
      lastErr = e
      fileLogger.writeLog('warn', 'main', '[Kick] channel_info_fetch_exception', [slug, url, e instanceof Error ? e.message : String(e)])
    }
  }

  // Fallback: scrape from the popout chat page (often accessible even when API endpoints 403).
  const fallbackUrls = [
    `https://kick.com/popout/${encodeURIComponent(slug)}/chat`,
    `https://kick.com/${encodeURIComponent(slug)}/chatroom`,
  ]

  for (const url of fallbackUrls) {
    try {
      const html = await fetchKickHtml(url, slug)
      const chatroomId = extractChatroomIdFromHtml(html)
      if (chatroomId > 0) return { chatroomId }
    } catch (e) {
      fileLogger.writeLog('warn', 'main', '[Kick] chatroom_scrape_exception', [slug, url, e instanceof Error ? e.message : String(e)])
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch Kick channel info for "${slug}"`)
}

/** Get chat user count for a Kick channel (from API when available). Returns null if unavailable or fetch fails. */
export async function getKickChatUserCount(slug: string): Promise<number | null> {
  try {
    const info = await fetchKickChannelInfo(slug)
    return info.chatUserCount ?? null
  } catch {
    return null
  }
}

/** GET /api/v2/channels/{slug}/me — current user's relationship to the channel (requires session). */
export type KickChannelMe = {
  subscription?: { id?: number } | null
  is_super_admin?: boolean
  is_following?: boolean
  following_since?: string | null
  is_broadcaster?: boolean
  is_moderator?: boolean
  leaderboards?: { gifts?: { quantity?: number; weekly?: number; monthly?: number } }
  banned?: unknown
  celebrations?: unknown[]
  has_notifications?: boolean
}

export async function fetchKickChannelMe(slug: string): Promise<KickChannelMe | null> {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}/me`
  try {
    const { status, bodyText } = await kickRequestText(url, {
      accept: 'application/json',
      origin: 'https://kick.com',
      referer: `https://kick.com/${encodeURIComponent(slug)}`,
    })
    if (status < 200 || status >= 300) return null
    const data = safeJsonParse<KickChannelMe>(bodyText || '')
    return data
  } catch {
    return null
  }
}

async function sendKickMessageToChatroom(
  chatroomId: number,
  slug: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const url = `https://kick.com/api/v2/messages/send/${chatroomId}`
  const messageRef = `${Date.now()}`
  fileLogger.writeLog('info', 'main', '[Kick] send_message attempt', [slug, chatroomId, content.length, url])
  const { status, bodyText } = await kickPostJson(
    url,
    { content, type: 'message', message_ref: messageRef },
    { referer: `https://kick.com/${encodeURIComponent(slug)}` }
  )
  fileLogger.writeLog('info', 'main', '[Kick] send_message response', [slug, status, bodyText?.slice(0, 500) ?? ''])
  if (status < 200 || status >= 300) {
    const err = safeJsonParse<{ status?: { message?: string } }>(bodyText)?.status?.message || bodyText?.slice(0, 200) || `HTTP ${status}`
    return { success: false, error: String(err) }
  }
  return { success: true }
}

/** Send a chat message to a Kick channel (fetches channel info if needed). Use when KickChatManager may not be initialized. */
export async function sendKickMessage(slug: string, content: string): Promise<{ success: boolean; error?: string }> {
  const s = String(slug || '').trim().toLowerCase()
  const text = String(content || '').trim()
  if (!s || !text) return { success: false, error: 'Missing slug or content' }
  try {
    const info = await fetchKickChannelInfo(s)
    return await sendKickMessageToChatroom(info.chatroomId, s, text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    fileLogger.writeLog('warn', 'main', '[Kick] send_message_failed', [s, msg])
    return { success: false, error: msg }
  }
}

class KickPusherClient extends EventEmitter {
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private intentionallyClosed = false
  private connectionId = 0
  private subscribedChannels = new Set<string>()
  private pendingSubscribe = new Set<string>()

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return

    this.intentionallyClosed = false
    this.connectionId++

    const ws = new WebSocket(PUSHER_URL, {
      headers: {
        Origin: 'https://kick.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      handshakeTimeout: 10000,
      perMessageDeflate: true,
    })
    this.ws = ws

    ws.on('open', () => {
      this.emit('connected')
    })

    ws.on('message', (data: WebSocket.Data) => {
      const raw = data.toString()
      const msg = safeJsonParse<any>(raw)
      if (!msg || typeof msg?.event !== 'string') {
        fileLogger.writeWsDiscrepancy('kick', 'non_json_message', { preview: raw.slice(0, 2000) })
        return
      }

      const ev = msg.event as string

      if (ev === 'pusher:ping') {
        this.send({ event: 'pusher:pong', data: {} })
        return
      }

      if (ev === 'pusher:connection_established') {
        // data is a JSON string
        safeJsonParse<any>(String(msg.data || ''))

        // flush any pending subscriptions
        const toSub = Array.from(this.pendingSubscribe.values())
        this.pendingSubscribe.clear()
        toSub.forEach((ch) => this.subscribe(ch))
        return
      }

      if (ev === 'pusher_internal:subscription_succeeded') {
        if (typeof msg.channel === 'string') this.subscribedChannels.add(msg.channel)
        this.emit('subscribed', msg.channel)
        return
      }

      this.emit('event', msg)
    })

    ws.on('error', (err) => {
      fileLogger.writeLog('warn', 'main', '[Kick] Pusher socket_error', [err?.message || String(err)])
      try {
        this.emit('error', err)
      } catch {
        // ignore
      }
    })

    ws.on('close', (code, reason) => {
      const text = reason?.toString?.() || ''
      this.ws = null
      this.subscribedChannels.clear()
      if (!this.intentionallyClosed) this.scheduleReconnect()
      this.emit('disconnected', { code, reason: text })
    })
  }

  disconnect(): void {
    this.intentionallyClosed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (!this.ws) return
    try {
      this.ws.on('error', () => {})
    } catch {
      // ignore
    }
    try {
      this.ws.close()
    } catch {
      // ignore
    }
    this.ws = null
    this.subscribedChannels.clear()
    this.pendingSubscribe.clear()
  }

  subscribe(channel: string): void {
    // If not connected yet, queue it.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingSubscribe.add(channel)
      this.connect()
      return
    }
    this.send({ event: 'pusher:subscribe', data: { auth: '', channel } })
  }

  unsubscribe(channel: string): void {
    this.pendingSubscribe.delete(channel)
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.send({ event: 'pusher:unsubscribe', data: { channel } })
    this.subscribedChannels.delete(channel)
  }

  private send(payload: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      this.ws.send(JSON.stringify(payload))
    } catch {
      // ignore
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 2000)
  }
}

export class KickChatManager extends EventEmitter {
  private pusher = new KickPusherClient()

  private desiredSlugs = new Set<string>()
  private slugToInfo = new Map<string, KickChannelInfo>()
  private chatroomToSlug = new Map<number, string>()
  private activeChannels = new Map<string, string[]>() // slug -> channels
  private seenIdsByChatroom = new Map<number, Set<string>>() // dedupe history + live

  private markSeen(chatroomId: number, id: string): boolean {
    if (!chatroomId || !id) return false
    let set = this.seenIdsByChatroom.get(chatroomId)
    if (!set) {
      set = new Set<string>()
      this.seenIdsByChatroom.set(chatroomId, set)
    }
    if (set.has(id)) return true
    set.add(id)
    // keep bounded
    if (set.size > 5000) {
      const it = set.values()
      for (let i = 0; i < 1000; i++) {
        const n = it.next()
        if (n.done) break
        set.delete(n.value)
      }
    }
    return false
  }

  private async fetchHistoryForSlug(slug: string, chatroomId: number, triedChatroomIds?: Set<number>): Promise<void> {
    const tried = triedChatroomIds ?? new Set<number>()
    if (tried.has(chatroomId)) return
    tried.add(chatroomId)

    // Kick is inconsistent about which numeric id the history endpoint wants.
    // In practice we've seen:
    // - channelInfo.chatroomId works for pusher subscriptions
    // - history response contains `chat_id` that looks like channel id
    // So we try both *request ids* (channelId then chatroomId) against web.kick.com.
    const info = this.slugToInfo.get(slug)
    const channelId = Number(info?.channelId) || 0
    const requestIds = Array.from(
      new Set<number>([channelId, chatroomId].filter((n) => Number.isFinite(n) && n > 0)),
    )

    let lastErr: unknown = null
    let sawEmpty = false

    for (const requestId of requestIds) {
      const url = `https://web.kick.com/api/v1/chat/${requestId}/history`
      try {
        const json = await fetchKickJson(url)

        const candidates = [json?.data?.messages, json?.data, json?.messages, json?.history, json]
        const arr = candidates.find((x) => Array.isArray(x)) as any[] | undefined
        if (!arr) {
          fileLogger.writeWsDiscrepancy('kick', 'history_fetch_unrecognized', {
            slug,
            chatroomId,
            requestId,
            url,
            keys: json && typeof json === 'object' ? Object.keys(json).slice(0, 40) : null,
          })
          continue
        }

        if (arr.length === 0) {
          sawEmpty = true
          continue
        }

        // Kick history ordering is not guaranteed (often newest -> oldest).
        // Always emit history in chronological order so "incoming order" mode still reads correctly.
        const toMs = (s: string) => {
          const ms = Date.parse(String(s || ''))
          return Number.isFinite(ms) ? ms : 0
        }

        const normalized: KickChatMessage[] = []
        for (const raw of arr) {
          const msg = normalizeKickMessage(raw, slug, chatroomId)
          if (!msg) continue
          normalized.push(msg)
        }
        normalized.sort((a, b) => {
          const d = toMs(a.createdAt) - toMs(b.createdAt)
          if (d) return d
          // deterministic tie-breaker
          return String(a.id).localeCompare(String(b.id))
        })

        let emitted = 0
        for (const msg of normalized) {
          if (this.markSeen(chatroomId, msg.id)) continue
          emitted++
          this.emit('message', { ...msg, isHistory: true })
        }
        return
      } catch (e) {
        lastErr = e
        fileLogger.writeLog('warn', 'main', '[Kick] history_fetch_attempt_failed', [slug, requestId, e instanceof Error ? e.message : String(e)])
      }
    }

    // If we got JSON but no messages, the most common cause is using the wrong ID.
    // Kick sometimes embeds a different chatroom/chat id in the popout chat HTML than the channel API returns.
    if (sawEmpty) {
      const popoutUrl = `https://kick.com/popout/${encodeURIComponent(slug)}/chat`
      try {
        const html = await fetchKickHtml(popoutUrl, slug)
        const scraped = extractChatroomIdFromHtml(html)
        if (scraped > 0 && scraped !== chatroomId && !tried.has(scraped)) {
          await this.fetchHistoryForSlug(slug, scraped, tried)
          return
        }
      } catch (e) {
        fileLogger.writeLog('warn', 'main', '[Kick] history_id_scrape_failed', [slug, chatroomId, e instanceof Error ? e.message : String(e)])
      }
    }

    fileLogger.writeLog('warn', 'main', '[Kick] history_fetch_failed', [slug, chatroomId, lastErr instanceof Error ? lastErr.message : String(lastErr)])
  }

  constructor() {
    super()

    this.pusher.on('event', (msg: any) => this.handlePusherEvent(msg))
    this.pusher.on('connected', () => {
      // Ensure all desired subscriptions are (re)sent.
      for (const slug of this.desiredSlugs) {
        const chs = this.activeChannels.get(slug)
        if (chs) chs.forEach((ch) => this.pusher.subscribe(ch))
      }
    })
  }

  async setTargets(slugs: string[]): Promise<void> {
    const next = new Set(slugs.map((s) => String(s || '').trim()).filter(Boolean))

    // Unsubscribe removed
    for (const oldSlug of Array.from(this.desiredSlugs.values())) {
      if (next.has(oldSlug)) continue
      const channels = this.activeChannels.get(oldSlug) || []
      channels.forEach((ch) => this.pusher.unsubscribe(ch))
      this.activeChannels.delete(oldSlug)
      this.slugToInfo.delete(oldSlug)
      this.desiredSlugs.delete(oldSlug)
    }

    // Subscribe new
    for (const slug of Array.from(next.values())) {
      if (this.desiredSlugs.has(slug)) continue
      this.desiredSlugs.add(slug)

      try {
        const info = await fetchKickChannelInfo(slug)
        this.slugToInfo.set(slug, info)
        this.chatroomToSlug.set(info.chatroomId, slug)

        // Based on observed traffic + public implementations, this is the key channel for messages.
        const channels = [`chatrooms.${info.chatroomId}.v2`]
        // Subscribe to extras if we have them (not required for messages).
        channels.push(`chatroom_${info.chatroomId}`)
        channels.push(`chatrooms.${info.chatroomId}`)
        if (typeof info.channelId === 'number' && info.channelId > 0) channels.push(`channel_${info.channelId}`)

        this.activeChannels.set(slug, channels)
        this.pusher.connect()
        channels.forEach((ch) => this.pusher.subscribe(ch))

        this.fetchHistoryForSlug(slug, info.chatroomId).catch(() => {})
      } catch (e) {
        fileLogger.writeLog('warn', 'main', '[Kick] targets_add_failed', [slug, e instanceof Error ? e.message : String(e)])
      }
    }

    // If nothing desired, disconnect to save resources.
    if (this.desiredSlugs.size === 0) this.pusher.disconnect()
  }

  // Retry history fetch (useful after Cloudflare/Kick cookies are established).
  async refetchHistory(slugs?: string[]): Promise<void> {
    const list = Array.isArray(slugs) && slugs.length > 0 ? Array.from(new Set(slugs.map((s) => String(s || '').trim()).filter(Boolean))) : Array.from(this.desiredSlugs.values())
    if (list.length === 0) return

    for (const slug of list) {
      try {
        let info = this.slugToInfo.get(slug)
        if (!info) {
          info = await fetchKickChannelInfo(slug)
          this.slugToInfo.set(slug, info)
          this.chatroomToSlug.set(info.chatroomId, slug)
        }
        // Clear seen set for this chatroom so refetched history is re-emitted to the renderer
        if (info.chatroomId) this.seenIdsByChatroom.delete(info.chatroomId)
        await this.fetchHistoryForSlug(slug, info.chatroomId)
      } catch (e) {
        fileLogger.writeLog('warn', 'main', '[Kick] history_refetch_failed', [slug, e instanceof Error ? e.message : String(e)])
      }
    }
  }

  /** Send a chat message to a Kick channel (uses cached slugToInfo if available). */
  async sendMessage(slug: string, content: string): Promise<{ success: boolean; error?: string }> {
    const s = String(slug || '').trim().toLowerCase()
    const text = String(content || '').trim()
    if (!s || !text) return { success: false, error: 'Missing slug or content' }
    try {
      let info = this.slugToInfo.get(s)
      if (!info) {
        info = await fetchKickChannelInfo(s)
        this.slugToInfo.set(s, info)
        this.chatroomToSlug.set(info.chatroomId, s)
      }
      return await sendKickMessageToChatroom(info.chatroomId, s, text)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      fileLogger.writeLog('warn', 'main', '[Kick] send_message_failed', [s, msg])
      return { success: false, error: msg }
    }
  }

  private handlePusherEvent(msg: any): void {
    const ev = String(msg?.event || '')
    if (ev !== 'App\\Events\\ChatMessageEvent') return

    const channel = String(msg?.channel || '')
    const dataRaw = msg?.data
    const parsed = safeJsonParse<any>(typeof dataRaw === 'string' ? dataRaw : JSON.stringify(dataRaw ?? {}))
    if (!parsed) {
      fileLogger.writeWsDiscrepancy('kick', 'chat_message_parse_error', { channel, preview: String(dataRaw || '').slice(0, 2000) })
      return
    }

    const chatroomId = Number(parsed?.chatroom_id ?? parsed?.chatroomId) || 0
    const slug = this.chatroomToSlug.get(chatroomId) || 'unknown'
    const kickMsg = normalizeKickMessage(parsed, slug, chatroomId)
    if (!kickMsg) return
    if (this.markSeen(chatroomId, kickMsg.id)) return
    this.emit('message', kickMsg)
  }
}

