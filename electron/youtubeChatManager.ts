import { EventEmitter } from 'events'
import { session } from 'electron'
import { fileLogger } from './fileLogger'

export type YouTubeChatMessage = {
  platform: 'youtube'
  videoId: string
  id: string
  timestampUsec?: string
  authorName?: string
  message: string
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

    out.push({
      platform: 'youtube',
      videoId,
      id: id || `${r?.timestampUsec || ''}-${authorName || 'unknown'}-${message.slice(0, 20)}`,
      timestampUsec: typeof r?.timestampUsec === 'string' ? r.timestampUsec : undefined,
      authorName,
      message,
    })
  }

  return out
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const res = await session.defaultSession.fetch(url, { headers })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function fetchJson(url: string, headers: Record<string, string>, body: any, signal?: AbortSignal): Promise<any> {
  const res = await session.defaultSession.fetch(url, {
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
    fileLogger.writeWsDiscrepancy('youtube', 'targets_set', {
      videoIds: Array.from(next.values()),
      opts: { delayMultiplier: this.delayMultiplier },
    })

    for (const old of Array.from(this.targets.values())) {
      if (next.has(old)) continue
      this.stopVideo(old)
    }

    for (const v of Array.from(next.values())) {
      if (this.targets.has(v)) continue
      this.targets.add(v)
      this.startVideo(v).catch((e) => {
        fileLogger.writeWsDiscrepancy('youtube', 'start_failed', { videoId: v, error: e instanceof Error ? e.message : String(e) })
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
    fileLogger.writeWsDiscrepancy('youtube', 'init_fetch', { videoId, url })

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

    const continuation = ytInitial ? findFirstContinuation(ytInitial) : null
    if (typeof continuation === 'string') state.continuation = continuation

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

    fileLogger.writeWsDiscrepancy('youtube', 'init_parsed', {
      videoId,
      hasApiKey: Boolean(state.apiKey),
      hasContext: Boolean(state.context),
      hasContinuation: Boolean(state.continuation),
    })

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
          const sample = msgs[0]
          fileLogger.writeWsDiscrepancy('youtube', 'first_messages', {
            videoId,
            count: msgs.length,
            sample: sample ? { id: sample.id, authorName: sample.authorName, message: sample.message.slice(0, 160) } : null,
          })
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
          fileLogger.writeWsDiscrepancy('youtube', 'poll_summary', {
            videoId,
            pollNum: state.pollNum,
            actions: Array.isArray(actions) ? actions.length : 0,
            msgs: msgs.length,
            hasContinuation: Boolean(state.continuation),
            delayMultiplier: this.delayMultiplier,
            baseDelayMs,
            actualDelayMs,
          })
        }

        await sleep(actualDelayMs)
      } catch (e) {
        if (state.stopped) break
        fileLogger.writeWsDiscrepancy('youtube', 'poll_error', {
          videoId,
          error: e instanceof Error ? e.message : String(e),
        })
        await sleep(2000)
      } finally {
        state.abort = undefined
      }
    }
  }
}

