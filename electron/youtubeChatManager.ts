import { EventEmitter } from 'events'
import { session } from 'electron'
import { fileLogger } from './fileLogger'

/** One segment of a YouTube message: either plain text or an emoji with optional image URL. */
export type YouTubeMessageRun =
  | { text: string }
  | { emojiId: string; imageUrl: string; shortcut?: string }

export type YouTubeChatMessage = {
  platform: 'youtube'
  videoId: string
  id: string
  timestampUsec?: string
  authorName?: string
  message: string
  /** When present, message content as runs (text + emoji with image URLs) for rendering emotes. */
  runs?: YouTubeMessageRun[]
}

type PollState = {
  stopped: boolean
  abort?: AbortController
  continuation?: string
  apiKey?: string
  context?: any
  seenIds: Set<string>
  pollNum?: number
  lastSummaryAtMs?: number
  sawAnyMessages?: boolean
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function safeJsonParse<T = any>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function extractBalancedJsonObject(source: string, startIndex: number): { json: any; endIndex: number } | null {
  // Find first '{'
  let i = startIndex
  while (i < source.length && source[i] !== '{') i++
  if (i >= source.length) return null

  let depth = 0
  let inString = false
  let escape = false
  const begin = i

  for (; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        const jsonStr = source.slice(begin, i + 1)
        const parsed = safeJsonParse(jsonStr)
        if (!parsed) return null
        return { json: parsed, endIndex: i + 1 }
      }
    }
  }

  return null
}

function findFirstContinuation(obj: any): string | null {
  const queue: any[] = [obj]
  const seen = new Set<any>()
  while (queue.length) {
    const cur = queue.shift()
    if (!cur || typeof cur !== 'object') continue
    if (seen.has(cur)) continue
    seen.add(cur)

    // common shapes
    const c1 = cur?.invalidationContinuationData?.continuation
    if (typeof c1 === 'string') return c1
    const c2 = cur?.timedContinuationData?.continuation
    if (typeof c2 === 'string') return c2
    const c3 = cur?.reloadContinuationData?.continuation
    if (typeof c3 === 'string') return c3
    const c4 = cur?.continuation
    if (typeof c4 === 'string' && c4.length > 10) return c4

    for (const v of Object.values(cur)) {
      if (v && typeof v === 'object') queue.push(v)
    }
  }
  return null
}

function runsToText(runs: any[]): string {
  if (!Array.isArray(runs)) return ''
  let out = ''
  for (const r of runs) {
    if (typeof r?.text === 'string') {
      out += r.text
      continue
    }
    const emoji = r?.emoji
    if (emoji) {
      const shortcuts = Array.isArray(emoji?.shortcuts) ? emoji.shortcuts : []
      if (typeof shortcuts[0] === 'string') out += shortcuts[0]
      else if (typeof emoji?.emojiId === 'string') out += `:${emoji.emojiId}:`
      else out += ':emoji:'
      continue
    }
  }
  return out
}

/** YouTube emoji image URL when API doesn't provide thumbnails (yt3.ggpht.com pattern). */
function emojiIdToImageUrl(emojiId: string): string {
  const id = String(emojiId).trim()
  if (!id) return ''
  return `https://yt3.ggpht.com/${id}=s48-c`
}

function runsToRuns(runs: any[]): YouTubeMessageRun[] {
  if (!Array.isArray(runs)) return []
  const out: YouTubeMessageRun[] = []
  for (const r of runs) {
    if (typeof r?.text === 'string') {
      out.push({ text: r.text })
      continue
    }
    const emoji = r?.emoji
    if (emoji && typeof emoji?.emojiId === 'string') {
      const shortcuts = Array.isArray(emoji?.shortcuts) ? emoji.shortcuts : []
      const shortcut = typeof shortcuts[0] === 'string' ? shortcuts[0] : undefined
      let imageUrl = ''
      const thumb = emoji?.image?.thumbnails?.[0]
      if (thumb && typeof thumb?.url === 'string') {
        imageUrl = thumb.url
      } else {
        imageUrl = emojiIdToImageUrl(emoji.emojiId)
      }
      if (imageUrl) out.push({ emojiId: emoji.emojiId, imageUrl, shortcut })
      else if (shortcut) out.push({ text: shortcut })
      else out.push({ text: `:${emoji.emojiId}:` })
      continue
    }
  }
  return out
}

function extractMessagesFromActions(videoId: string, actions: any[]): YouTubeChatMessage[] {
  const out: YouTubeChatMessage[] = []
  if (!Array.isArray(actions)) return out

  for (const a of actions) {
    const item =
      a?.addChatItemAction?.item ??
      a?.addLiveChatTickerItemAction?.item ??
      a?.replaceChatItemAction?.replacementItem ??
      null

    const r =
      item?.liveChatTextMessageRenderer ??
      item?.liveChatPaidMessageRenderer ??
      item?.liveChatMembershipItemRenderer ??
      null

    if (!r) continue

    const id = typeof r?.id === 'string' ? r.id : ''
    const authorName = typeof r?.authorName?.simpleText === 'string' ? r.authorName.simpleText : undefined

    // Different renderers have different "message" locations
    const messageRuns =
      r?.message?.runs ??
      r?.headerSubtext?.runs ??
      r?.primaryText?.runs ??
      r?.text?.runs ??
      []

    const message = runsToText(messageRuns)
    if (!message) continue

    const runs = runsToRuns(messageRuns)
    const hasEmoji = runs.some((x) => 'emojiId' in x && x.imageUrl)
    out.push({
      platform: 'youtube',
      videoId,
      id: id || `${r?.timestampUsec || ''}-${authorName || 'unknown'}-${message.slice(0, 20)}`,
      timestampUsec: typeof r?.timestampUsec === 'string' ? r.timestampUsec : undefined,
      authorName,
      message,
      runs: hasEmoji ? runs : undefined,
    })
  }

  return out
}

function getYouTubeSession() {
  return session.fromPartition('persist:main')
}

/** Generate a short client message id (YouTube-style). */
function generateClientMessageId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let out = ''
  for (let i = 0; i < 24; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const res = await getYouTubeSession().fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function fetchJson(url: string, headers: Record<string, string>, body: any, signal?: AbortSignal): Promise<any> {
  const res = await getYouTubeSession().fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  } as any)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} for ${url} body=${text.slice(0, 300)}`)
  }
  return await res.json()
}

export class YouTubeChatManager extends EventEmitter {
  private targets = new Set<string>()
  private states = new Map<string, PollState>()
  private delayMultiplier = 1

  async setTargets(videoIds: string[], opts?: { delayMultiplier?: number }): Promise<void> {
    const next = new Set(videoIds.map((v) => String(v || '').trim()).filter(Boolean))
    const mulRaw = opts?.delayMultiplier
    if (typeof mulRaw === 'number' && Number.isFinite(mulRaw)) {
      this.delayMultiplier = Math.max(0.25, Math.min(5, mulRaw))
    }
    for (const old of Array.from(this.targets.values())) {
      if (next.has(old)) continue
      this.stopVideo(old)
    }

    for (const v of Array.from(next.values())) {
      if (this.targets.has(v)) continue
      this.targets.add(v)
      this.startVideo(v).catch((e) => {
        fileLogger.writeLog('warn', 'main', '[YouTube] start_failed', [v, e instanceof Error ? e.message : String(e)])
        // Important: if init fails (rate limit / consent page / transient), allow future retries.
        this.stopVideo(v)
      })
    }

    if (next.size === 0) {
      // stop all
      for (const v of Array.from(this.targets.values())) this.stopVideo(v)
    }
  }

  private stopVideo(videoId: string) {
    this.targets.delete(videoId)
    const st = this.states.get(videoId)
    if (st) {
      st.stopped = true
      try {
        st.abort?.abort()
      } catch {
        // ignore
      }
    }
    this.states.delete(videoId)
  }

  private async startVideo(videoId: string): Promise<void> {
    const state: PollState = { stopped: false, seenIds: new Set(), pollNum: 0, lastSummaryAtMs: 0, sawAnyMessages: false }
    this.states.set(videoId, state)

    await this.init(videoId, state)
    await this.pollLoop(videoId, state)
  }

  private async init(videoId: string, state: PollState): Promise<void> {
    const url = `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}`
    const html = await fetchText(url, {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    })

    // Extract ytcfg + ytInitialData
    let ytcfg: any = null
    const ytcfgMarker = 'ytcfg.set('
    const ytcfgIdx = html.indexOf(ytcfgMarker)
    if (ytcfgIdx >= 0) {
      const parsed = extractBalancedJsonObject(html, ytcfgIdx + ytcfgMarker.length)
      if (parsed) ytcfg = parsed.json
    }

    const key = ytcfg?.INNERTUBE_API_KEY
    const context = ytcfg?.INNERTUBE_CONTEXT
    if (typeof key === 'string') state.apiKey = key
    if (context && typeof context === 'object') state.context = context

    // ytInitialData
    let ytInitial: any = null
    const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = ']
    for (const m of markers) {
      const idx = html.indexOf(m)
      if (idx < 0) continue
      const parsed = extractBalancedJsonObject(html, idx + m.length)
      if (parsed) {
        ytInitial = parsed.json
        break
      }
    }

    let continuation = ytInitial ? findFirstContinuation(ytInitial) : null
    if (typeof continuation === 'string') state.continuation = continuation

    // Fallback: regex for continuation in HTML (live_chat page may not embed ytInitialData in initial response)
    if (!state.continuation) {
      const contMatch = /"(?:continuation|token)"\s*:\s*"([^"]{20,})"/.exec(html)
      if (contMatch) state.continuation = contMatch[1]
    }

    // Fallbacks if ytcfg parsing failed
    if (!state.apiKey) {
      const m = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)
      if (m) state.apiKey = m[1]
    }
    if (!state.context) {
      const m = /"INNERTUBE_CONTEXT":(\{[\s\S]*?\})\s*,\s*"INNERTUBE_CONTEXT_CLIENT_NAME"/.exec(html)
      if (m) {
        const ctx = safeJsonParse(m[1])
        if (ctx) state.context = ctx
      }
    }

    // Fallback: fetch watch page; it often has live chat continuation in ytInitialData
    if (!state.continuation || !state.context) {
      const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
      try {
        const watchHtml = await fetchText(watchUrl, {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        })
        if (!state.apiKey || !state.context) {
          const watchCfgIdx = watchHtml.indexOf(ytcfgMarker)
          if (watchCfgIdx >= 0) {
            const parsed = extractBalancedJsonObject(watchHtml, watchCfgIdx + ytcfgMarker.length)
            if (parsed?.json) {
              const cfg = parsed.json
              if (!state.apiKey && typeof cfg?.INNERTUBE_API_KEY === 'string') state.apiKey = cfg.INNERTUBE_API_KEY
              if (!state.context && cfg?.INNERTUBE_CONTEXT && typeof cfg.INNERTUBE_CONTEXT === 'object')
                state.context = cfg.INNERTUBE_CONTEXT
            }
          }
          if (!state.context) {
            const ctxM = /"INNERTUBE_CONTEXT":(\{[\s\S]*?\})\s*,\s*"INNERTUBE_CONTEXT_CLIENT_NAME"/.exec(watchHtml)
            if (ctxM) {
              const ctx = safeJsonParse(ctxM[1])
              if (ctx) state.context = ctx
            }
          }
        }
        if (!state.continuation) {
          for (const m of ['var ytInitialData = ', 'window["ytInitialData"] = ', 'ytInitialData = ']) {
            const idx = watchHtml.indexOf(m)
            if (idx < 0) continue
            const parsed = extractBalancedJsonObject(watchHtml, idx + m.length)
            if (parsed) {
              continuation = findFirstContinuation(parsed.json)
              if (typeof continuation === 'string') {
                state.continuation = continuation
                break
              }
            }
          }
          if (!state.continuation) {
            const contMatch = /"(?:continuation|token)"\s*:\s*"([^"]{20,})"/.exec(watchHtml)
            if (contMatch) state.continuation = contMatch[1]
          }
        }
      } catch (fallbackErr) {
        fileLogger.writeLog('warn', 'main', '[YouTube] init_fallback_watch_error', [videoId, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)])
      }
    }

    if (!state.context || !state.continuation) {
      throw new Error('Failed to extract INNERTUBE_CONTEXT or continuation from live_chat page')
    }
  }

  private async pollLoop(videoId: string, state: PollState): Promise<void> {
    while (!state.stopped) {
      if (!state.continuation) {
        await sleep(1000)
        continue
      }

      const controller = new AbortController()
      state.abort = controller

      const apiKey = state.apiKey
      const url =
        apiKey && apiKey.length > 0
          ? `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=${encodeURIComponent(apiKey)}`
          : `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false`

      const body = {
        context: state.context,
        continuation: state.continuation,
      }

      try {
        const json = await fetchJson(
          url,
          {
            'Content-Type': 'application/json',
            Accept: '*/*',
            Origin: 'https://www.youtube.com',
            Referer: `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}`,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          },
          body,
          controller.signal,
        )

        const actions = json?.continuationContents?.liveChatContinuation?.actions ?? []
        const msgs = extractMessagesFromActions(videoId, actions)
        if (!state.sawAnyMessages && msgs.length > 0) {
          state.sawAnyMessages = true
        }

        for (const m of msgs) {
          if (state.seenIds.has(m.id)) continue
          state.seenIds.add(m.id)
          if (state.seenIds.size > 5000) {
            // keep bounded
            const it = state.seenIds.values()
            for (let i = 0; i < 1000; i++) {
              const n = it.next()
              if (n.done) break
              state.seenIds.delete(n.value)
            }
          }
          this.emit('message', m)
        }

        const conts = json?.continuationContents?.liveChatContinuation?.continuations
        let nextContinuation: string | null = null
        let timeoutMs: number | null = null
        if (Array.isArray(conts) && conts[0]) {
          const c = conts[0]
          const inv = c?.invalidationContinuationData
          const timed = c?.timedContinuationData
          const rel = c?.reloadContinuationData
          if (inv?.continuation) {
            nextContinuation = inv.continuation
            timeoutMs = Number(inv.timeoutMs) || null
          } else if (timed?.continuation) {
            nextContinuation = timed.continuation
            timeoutMs = Number(timed.timeoutMs) || null
          } else if (rel?.continuation) {
            nextContinuation = rel.continuation
            timeoutMs = Number(rel.timeoutMs) || null
          }
        }

        if (nextContinuation) state.continuation = nextContinuation
        const baseDelayMs = timeoutMs && timeoutMs > 0 ? timeoutMs : 1000
        const scaledDelayMs = Math.floor(baseDelayMs * this.delayMultiplier)
        const actualDelayMs = Math.min(Math.max(scaledDelayMs, 250), 15000)

        // Lightweight visibility into polling behavior (helps debug "only one chat shows").
        state.pollNum = (state.pollNum || 0) + 1
        const now = Date.now()
        const shouldSummary =
          state.pollNum <= 2 || !state.lastSummaryAtMs || now - (state.lastSummaryAtMs || 0) >= 30000 || msgs.length > 0
        if (shouldSummary) {
          state.lastSummaryAtMs = now
        }

        await sleep(actualDelayMs)
      } catch (e) {
        if (state.stopped) break
        fileLogger.writeLog('warn', 'main', '[YouTube] poll_error', [videoId, e instanceof Error ? e.message : String(e)])
        await sleep(2000)
      } finally {
        state.abort = undefined
      }
    }
  }

  /**
   * Normalize a continuation/token string for send_message params (TYPE_BYTES = base64).
   * YouTube may use base64url (- and _); the API expects standard base64. Strip non-base64 chars and add padding.
   */
  private static normalizeParamsBase64(raw: string): string {
    let s = String(raw || '').trim().replace(/\s/g, '')
    s = s.replace(/-/g, '+').replace(/_/g, '/')
    s = s.replace(/[^A-Za-z0-9+/=]/g, '')
    const pad = s.length % 4
    if (pad !== 0) s += '='.repeat(4 - pad)
    return s
  }

  /**
   * Send a chat message to a live chat. Uses current context/continuation for that video.
   * Returns { success, error }. Requires the video to already be polled (state exists).
   */
  async sendMessage(videoId: string, text: string): Promise<{ success: boolean; error?: string }> {
    const state = this.states.get(videoId)
    if (!state?.context || !state.continuation) {
      return { success: false, error: 'Chat not loaded for this stream' }
    }
    const trimmed = String(text || '').trim()
    if (!trimmed) return { success: false, error: 'Message is empty' }

    const params = YouTubeChatManager.normalizeParamsBase64(state.continuation)
    const url = 'https://www.youtube.com/youtubei/v1/live_chat/send_message?prettyPrint=false'
    const body = {
      context: state.context,
      params,
      clientMessageId: generateClientMessageId(),
      richMessage: {
        textSegments: [{ text: trimmed }],
      },
    }

    try {
      const res = await getYouTubeSession().fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: '*/*',
          Origin: 'https://www.youtube.com',
          Referer: `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
        body: JSON.stringify(body),
      } as RequestInit)
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        fileLogger.writeLog('warn', 'main', '[YouTube] send_message_http', [videoId, res.status, errText.slice(0, 200)])
        return { success: false, error: `Send failed (${res.status})` }
      }
      const json = (await res.json().catch(() => null)) as any
      const err = json?.errors?.[0]?.message || json?.error?.message
      if (err) {
        fileLogger.writeLog('warn', 'main', '[YouTube] send_message_api_error', [videoId, err])
        return { success: false, error: String(err) }
      }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      fileLogger.writeLog('warn', 'main', '[YouTube] send_message_exception', [videoId, msg])
      return { success: false, error: msg }
    }
  }
}

