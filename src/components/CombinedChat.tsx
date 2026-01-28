import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { omniColorForKey, textColorOn } from '../utils/omniColors'

interface DggChatMessage {
  id: number
  nick: string
  roles?: string[]
  features?: string[]
  createdDate?: string
  watching?: { platform: string | null; id: string | null } | null
  subscription?: { tier: number; source: string } | null
  timestamp: number
  data: string
  uuid?: string
}

type DggChatWsMessage = { type: 'MSG'; message: DggChatMessage }
type DggChatWsHistory = { type: 'HISTORY'; messages: DggChatMessage[] }

interface KickChatMessage {
  platform: 'kick'
  slug: string
  chatroomId: number
  id: string
  content: string
  createdAt: string
  isHistory?: boolean
  emotes?: Array<{ id: number; name?: string; start?: number; end?: number }>
  sender: {
    id: number
    username: string
    slug: string
    color?: string
    badges?: Array<{ type: string; text?: string; count?: number }>
  }
}

type YouTubeMessageRun =
  | { text: string }
  | { emojiId: string; imageUrl: string; shortcut?: string }

interface YouTubeChatMessage {
  platform: 'youtube'
  videoId: string
  id: string
  timestampUsec?: string
  authorName?: string
  message: string
  runs?: YouTubeMessageRun[]
}

interface TwitchChatMessage {
  platform: 'twitch'
  channel: string
  id: string
  tmiSentTs?: number
  color?: string
  displayName: string
  userId?: string
  text: string
}

interface EmoteData {
  prefix: string
  creator: string
  twitch: boolean
  theme: number
  minimumSubTier: number
  image: Array<{
    url: string
    name: string
    mime: string
    height: number
    width: number
  }>
}

function loadCSSOnceById(href: string, id: string): Promise<void> {
  const existing = document.getElementById(id)
  if (existing) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.id = id
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`))
    document.head.appendChild(link)
  })
}

function escapeRegexLiteral(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function processTextWithEmotes(
  text: string,
  emotePattern: RegExp | null,
  emotesMap: Map<string, string>,
  baseKey: number = 0,
): (string | JSX.Element)[] {
  if (!emotePattern || emotesMap.size === 0) return [text]

  // Important: global regexes keep state (lastIndex) across calls.
  emotePattern.lastIndex = 0

  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let keyCounter = baseKey

  let match: RegExpExecArray | null
  while ((match = emotePattern.exec(text)) !== null) {
    const matchedPrefix = match[1]
    if (!emotesMap.has(matchedPrefix)) continue

    if (match.index > lastIndex) {
      const beforeText = text.substring(lastIndex, match.index)
      if (beforeText) parts.push(beforeText)
    }

    parts.push(<span key={`emote-${keyCounter++}`} className={`emote ${matchedPrefix}`} style={{ display: 'inline-block' }} />)
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex)
    if (remainingText) parts.push(remainingText)
  }

  return parts.length > 0 ? parts : [text]
}

function processGreentext(
  text: string,
  emotePattern: RegExp | null,
  emotesMap: Map<string, string>,
  baseKey: number = 0,
): (string | JSX.Element)[] {
  const lines = text.split('\n')
  const parts: (string | JSX.Element)[] = []
  let keyCounter = baseKey

  lines.forEach((line, lineIndex) => {
    const isGreentext = line.trim().startsWith('>')

    const processedLine = processTextWithEmotes(line, emotePattern, emotesMap, keyCounter)
    processedLine.forEach((part) => {
      if (!isGreentext) {
        parts.push(part)
        keyCounter++
        return
      }

      // Mimic DGG greentext styling as closely as we reasonably can.
      parts.push(
        <span
          key={`greentext-${keyCounter++}`}
          style={{
            color: 'rgb(108, 165, 40)',
            fontFamily: '"Roboto", Helvetica, "Trebuchet MS", Verdana, sans-serif',
            fontSize: '16px',
            lineHeight: '26.4px',
            boxSizing: 'border-box',
            textRendering: 'optimizeLegibility',
            overflowWrap: 'break-word',
          }}
        >
          {part}
        </span>,
      )
    })

    if (lineIndex < lines.length - 1) parts.push('\n')
  })

  return parts.length > 0 ? parts : [text]
}

function renderTextWithLinks(
  text: string,
  emotePattern: RegExp | null,
  emotesMap: Map<string, string>,
  onOpenLink?: (url: string) => void,
): JSX.Element {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasLinks = false
  let keyCounter = 0

  while ((match = urlRegex.exec(text)) !== null) {
    hasLinks = true
    if (match.index > lastIndex) {
      const textSegment = text.substring(lastIndex, match.index)
      const processedSegment = processGreentext(textSegment, emotePattern, emotesMap, keyCounter)
      processedSegment.forEach((part) => {
        parts.push(part)
        keyCounter++
      })
    }

    const url = match[0]
    parts.push(
      <a
        key={`link-${keyCounter++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="link link-primary break-words overflow-wrap-anywhere"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenLink?.(url)
        }}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {url}
      </a>,
    )

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    const textSegment = text.substring(lastIndex)
    const processedSegment = processGreentext(textSegment, emotePattern, emotesMap, keyCounter)
    processedSegment.forEach((part) => {
      parts.push(part)
      keyCounter++
    })
  }

  if (!hasLinks) {
    const processedSegment = processGreentext(text, emotePattern, emotesMap, keyCounter)
    return <>{processedSegment}</>
  }

  return <>{parts}</>
}

const SCROLL_THRESHOLD_PX = 40

function isAtBottom(el: HTMLElement) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX
}

type CombinedItem =
  | {
      source: 'dgg'
      tsMs: number
      nick: string
      content: string
      raw: DggChatMessage
      isHistory?: boolean
    }
  | {
      source: 'kick'
      tsMs: number
      nick: string
      content: string
      slug: string
      raw: KickChatMessage
      isHistory?: boolean
    }
  | {
      source: 'youtube'
      tsMs: number
      nick: string
      content: string
      videoId: string
      raw: YouTubeChatMessage
      isHistory?: boolean
    }
  | {
      source: 'twitch'
      tsMs: number
      nick: string
      content: string
      channel: string
      raw: TwitchChatMessage
      isHistory?: boolean
    }

type CombinedItemWithSeq = CombinedItem & { seq: number }

function renderKickEmote(id: number, name?: string, key?: string) {
  const src = `https://files.kick.com/emotes/${encodeURIComponent(String(id))}/fullsize`
  return (
    <img
      key={key ?? `kick-emote-${id}`}
      src={src}
      alt={name ? `:${name}:` : 'kick emote'}
      title={name ? `:${name}:` : undefined}
      loading="lazy"
      className="inline-block align-middle mx-0.5"
      style={{ height: 18, width: 'auto' }}
    />
  )
}

function renderKickContent(msg: KickChatMessage): (string | JSX.Element)[] {
  const text = String(msg?.content ?? '')
  if (!text) return ['']

  // 1) If we ever embed explicit tokens, handle them.
  const tokenRe = /\[emote:(\d+):([^\]]+)\]/g
  if (tokenRe.test(text)) {
    tokenRe.lastIndex = 0
    const parts: (string | JSX.Element)[] = []
    let last = 0
    let match: RegExpExecArray | null
    let k = 0
    while ((match = tokenRe.exec(text)) !== null) {
      const start = match.index
      if (start > last) parts.push(text.slice(last, start))
      const id = Number(match[1])
      const name = match[2] || undefined
      if (Number.isFinite(id) && id > 0) parts.push(renderKickEmote(id, name, `kick-emote-token-${k++}`))
      else parts.push(match[0])
      last = start + match[0].length
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts.length ? parts : [text]
  }

  const emotes = Array.isArray(msg?.emotes) ? msg.emotes : []
  if (emotes.length === 0) return [text]

  // 2) If Kick provides positions, use them (most accurate).
  const withRanges = emotes
    .map((e) => ({
      id: Number(e?.id),
      name: typeof e?.name === 'string' ? e.name : undefined,
      start: typeof e?.start === 'number' ? e.start : Number(e?.start),
      end: typeof e?.end === 'number' ? e.end : Number(e?.end),
    }))
    .filter((e) => Number.isFinite(e.id) && e.id > 0 && Number.isFinite(e.start) && Number.isFinite(e.end) && (e.end as number) > (e.start as number))
    .sort((a, b) => (a.start as number) - (b.start as number))

  if (withRanges.length > 0) {
    const parts: (string | JSX.Element)[] = []
    let last = 0
    let k = 0
    for (const e of withRanges) {
      const s = e.start as number
      const en = e.end as number
      if (s < last) continue // overlap, skip
      if (s > text.length) continue
      if (en > text.length) continue
      if (s > last) parts.push(text.slice(last, s))
      parts.push(renderKickEmote(e.id, e.name, `kick-emote-pos-${k++}`))
      last = en
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts.length ? parts : [text]
  }

  // 3) Fallback: replace emote names in-message.
  const nameToId = new Map<string, number>()
  for (const e of emotes) {
    const id = Number((e as any)?.id)
    const name = typeof (e as any)?.name === 'string' ? String((e as any).name).trim() : ''
    if (!name || !Number.isFinite(id) || id <= 0) continue
    if (!nameToId.has(name)) nameToId.set(name, id)
  }
  if (nameToId.size === 0) return [text]

  const names = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length).slice(0, 50)
  const pattern = `:?(${names.map(escapeRegexLiteral).join('|')}):?`
  let re: RegExp | null = null
  try {
    // Prefer lookarounds so we don't match inside words.
    re = new RegExp(`(?<![\\w])${pattern}(?![\\w])`, 'g')
  } catch {
    try {
      re = new RegExp(`\\b${pattern}\\b`, 'g')
    } catch {
      re = null
    }
  }
  if (!re) return [text]

  const parts: (string | JSX.Element)[] = []
  let last = 0
  let match: RegExpExecArray | null
  let k = 0
  while ((match = re.exec(text)) !== null) {
    const start = match.index
    if (start > last) parts.push(text.slice(last, start))
    const name = match[1]
    const id = nameToId.get(name)
    if (id) parts.push(renderKickEmote(id, name, `kick-emote-name-${k++}`))
    else parts.push(match[0])
    last = start + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

function renderYouTubeContent(msg: YouTubeChatMessage): ReactNode {
  const runs = msg.runs
  if (!runs || runs.length === 0) return msg.message ?? ''

  const parts: (string | JSX.Element)[] = []
  runs.forEach((run, i) => {
    if ('text' in run && run.text) {
      parts.push(run.text)
      return
    }
    if ('emojiId' in run && run.imageUrl) {
      parts.push(
        <img
          key={`yt-emote-${i}-${run.emojiId}`}
          src={run.imageUrl}
          alt={run.shortcut ?? `:${run.emojiId}:`}
          title={run.shortcut ?? undefined}
          loading="lazy"
          className="inline-block align-middle mx-0.5"
          style={{ height: 18, width: 'auto', verticalAlign: 'middle' }}
        />,
      )
    }
  })
  return parts.length ? <>{parts}</> : (msg.message ?? '')
}

export default function CombinedChat({
  enableDgg,
  embedDisplayNameByKey,
  maxMessages,
  showTimestamps,
  showSourceLabels,
  sortMode,
  onCountChange,
}: {
  enableDgg: boolean
  embedDisplayNameByKey: Record<string, string>
  maxMessages: number
  showTimestamps: boolean
  showSourceLabels: boolean
  sortMode: 'timestamp' | 'arrival'
  onCountChange?: (count: number) => void
}) {
  const [emotesMap, setEmotesMap] = useState<Map<string, string>>(new Map())
  const [items, setItems] = useState<CombinedItemWithSeq[]>([])
  const [updateSeq, setUpdateSeq] = useState(0)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const wasAtBottomRef = useRef(true)
  const shouldStickToBottomRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const seqRef = useRef(0)

  const maxKeep = useMemo(() => {
    const v = Number.isFinite(maxMessages) ? Math.floor(maxMessages) : 600
    return Math.max(50, Math.min(5000, v))
  }, [maxMessages])

  const cap = (arr: CombinedItemWithSeq[]) => {
    if (arr.length <= maxKeep) return arr
    return arr.slice(arr.length - maxKeep)
  }

  useEffect(() => {
    setItems((prev) => cap(prev))
    setUpdateSeq((v) => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxKeep])

  const appendItems = (newItems: CombinedItemWithSeq[]) => {
    if (newItems.length === 0) return
    markStickIfAtBottom()
    setItems((prev) => cap([...prev, ...newItems]))
    setUpdateSeq((v) => v + 1)
  }

  const emotePattern = useMemo(() => {
    if (emotesMap.size === 0) return null
    // Sort by prefix length (longest first) to match longer prefixes first.
    const sortedPrefixes = Array.from(emotesMap.keys()).sort((a, b) => b.length - a.length)
    // Match any prefix as a whole word (same behavior as LinkScroller’s renderer).
    const pattern = `\\b(${sortedPrefixes.map(escapeRegexLiteral).join('|')})\\b`
    try {
      return new RegExp(pattern, 'gi')
    } catch {
      return null
    }
  }, [emotesMap])

  // Load Destiny emotes CSS + prefix list once.
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        await loadCSSOnceById('https://cdn.destiny.gg/emotes/emotes.css', 'destiny-emotes-css')
        const response = await fetch('https://cdn.destiny.gg/emotes/emotes.json', { cache: 'force-cache' })
        if (!response.ok) throw new Error(`Failed to fetch emotes: ${response.status}`)
        const emotesData: EmoteData[] = await response.json()
        if (cancelled) return

        const map = new Map<string, string>()
        emotesData.forEach((emote) => {
          if (emote.image && emote.image.length > 0) map.set(emote.prefix, '')
        })
        setEmotesMap(map)
      } catch {
        // Continue without emotes if fetch fails.
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  // Track "at bottom" for auto-scroll behavior.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const onScroll = () => {
      if (programmaticScrollRef.current) return
      wasAtBottomRef.current = isAtBottom(el)
    }

    el.addEventListener('scroll', onScroll)
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const markStickIfAtBottom = () => {
    const el = scrollerRef.current
    const atBottom = el ? isAtBottom(el) : true
    // Only stick if the user is currently at bottom.
    shouldStickToBottomRef.current = atBottom
    wasAtBottomRef.current = atBottom
  }

  // If DGG is disabled, drop existing DGG items from the feed.
  useEffect(() => {
    if (enableDgg) return
    setItems((prev) => {
      const next = prev.filter((m) => m.source !== 'dgg')
      return next.length === prev.length ? prev : next
    })
    setUpdateSeq((v) => v + 1)
  }, [enableDgg])

  // DGG WebSocket connection (via main process IPC)
  useEffect(() => {
    let alive = true
    if (!enableDgg) {
      return () => {
        alive = false
      }
    }

    const handleMessage = (_event: any, data: DggChatWsMessage) => {
      if (!alive) return
      if (!data || data.type !== 'MSG' || !data.message) return
      const msg = data.message
      appendItems([
        {
          source: 'dgg',
          tsMs: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(),
          nick: msg.nick,
          content: msg.data ?? '',
          raw: msg,
          seq: seqRef.current++,
        },
      ])
    }

    const handleHistory = (_event: any, history: DggChatWsHistory) => {
      if (!alive) return
      if (!history || history.type !== 'HISTORY' || !Array.isArray(history.messages)) return
      const slice = history.messages.slice(-maxKeep)
      const mapped: CombinedItemWithSeq[] = slice.map((m) => ({
        source: 'dgg',
        tsMs: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
        nick: m.nick,
        content: m.data ?? '',
        raw: m,
        isHistory: true,
        seq: seqRef.current++,
      }))
      markStickIfAtBottom()
      setItems((prev) => {
        const nonDgg = prev.filter((m) => m.source !== 'dgg')
        return cap([...nonDgg, ...mapped])
      })
      setUpdateSeq((v) => v + 1)
    }

    window.ipcRenderer.invoke('chat-websocket-connect').catch(() => {})
    window.ipcRenderer.on('chat-websocket-message', handleMessage)
    window.ipcRenderer.on('chat-websocket-history', handleHistory)

    return () => {
      alive = false
      window.ipcRenderer.off('chat-websocket-message', handleMessage)
      window.ipcRenderer.off('chat-websocket-history', handleHistory)
      window.ipcRenderer.invoke('chat-websocket-disconnect').catch(() => {})
    }
  }, [enableDgg])

  // Kick chat messages forwarded from main process (Pusher)
  useEffect(() => {
    let alive = true
    const handleKick = (_event: any, msg: KickChatMessage) => {
      if (!alive) return
      if (!msg || msg.platform !== 'kick') return
      appendItems([
        {
          source: 'kick',
          tsMs: Number.isFinite(Date.parse(msg.createdAt)) ? Date.parse(msg.createdAt) : Date.now(),
          nick: msg.sender?.username || msg.sender?.slug || 'kick',
          content: msg.content ?? '',
          slug: msg.slug || 'kick',
          raw: msg,
          isHistory: Boolean(msg.isHistory),
          seq: seqRef.current++,
        },
      ])
    }

    window.ipcRenderer.on('kick-chat-message', handleKick)
    return () => {
      alive = false
      window.ipcRenderer.off('kick-chat-message', handleKick)
    }
  }, [])

  // YouTube chat messages forwarded from main process (polling youtubei)
  useEffect(() => {
    let alive = true
    const handleYouTube = (_event: any, msg: YouTubeChatMessage) => {
      if (!alive) return
      if (!msg || msg.platform !== 'youtube') return
      const usec = typeof msg.timestampUsec === 'string' ? Number(msg.timestampUsec) : NaN
      const tsMs = Number.isFinite(usec) ? Math.floor(usec / 1000) : Date.now()
      appendItems([
        {
          source: 'youtube',
          tsMs,
          nick: msg.authorName || 'youtube',
          content: msg.message ?? '',
          videoId: msg.videoId || 'unknown',
          raw: msg,
          seq: seqRef.current++,
        },
      ])
    }

    window.ipcRenderer.on('youtube-chat-message', handleYouTube)
    return () => {
      alive = false
      window.ipcRenderer.off('youtube-chat-message', handleYouTube)
    }
  }, [])

  // Twitch chat messages forwarded from main process (IRC over WebSocket)
  useEffect(() => {
    let alive = true
    const handleTwitch = (_event: any, msg: TwitchChatMessage) => {
      if (!alive) return
      if (!msg || msg.platform !== 'twitch') return
      const tsMs = typeof msg.tmiSentTs === 'number' && Number.isFinite(msg.tmiSentTs) ? msg.tmiSentTs : Date.now()
      appendItems([
        {
          source: 'twitch',
          tsMs,
          nick: msg.displayName || 'twitch',
          content: msg.text ?? '',
          channel: msg.channel || 'unknown',
          raw: msg,
          seq: seqRef.current++,
        },
      ])
    }

    window.ipcRenderer.on('twitch-chat-message', handleTwitch)
    return () => {
      alive = false
      window.ipcRenderer.off('twitch-chat-message', handleTwitch)
    }
  }, [])

  const displayItems = useMemo(() => {
    if (sortMode === 'timestamp') {
      const copy = [...items]
      copy.sort((a, b) => (a.tsMs - b.tsMs) || (a.seq - b.seq))
      return copy
    }

    // "Arrival" mode:
    // - keep live messages in arrival order (seq)
    // - but ALWAYS blend any history items (from any source) by timestamp so startup doesn't
    //   show separate "DGG history block" then "Kick history block".
    const history = items.filter((m) => Boolean((m as any).isHistory))
    const live = items.filter((m) => !Boolean((m as any).isHistory))
    history.sort((a, b) => (a.tsMs - b.tsMs) || (a.seq - b.seq))
    return [...history, ...live]
  }, [items, sortMode])

  useEffect(() => {
    onCountChange?.(displayItems.length)
  }, [displayItems.length, onCountChange])

  // Auto-scroll when we were already at bottom.
  // Use updateSeq (not merged.length) because the list is capped at MAX_MESSAGES
  // and length can stay constant even as new messages arrive.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (!shouldStickToBottomRef.current) return

    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    // release after the browser processes scroll
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })

    shouldStickToBottomRef.current = false
    wasAtBottomRef.current = true
  }, [updateSeq])

  const onOpenLink = (url: string) => {
    // Reuse the existing "open link" IPC handler (opens in browser).
    window.ipcRenderer.invoke('link-scroller-handle-link', { url, action: 'browser' }).catch(() => {})
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {displayItems.map((m, idx) => {
          const ts = Number.isFinite(m.tsMs) ? new Date(m.tsMs).toLocaleTimeString() : ''
          const colorKey =
            m.source === 'dgg'
              ? 'dgg'
              : m.source === 'kick'
                ? `kick:${m.slug}`
                : m.source === 'youtube'
                  ? `youtube:${m.videoId}`
                  : `twitch:${m.channel}`
          const accent =
            m.source === 'dgg'
              ? omniColorForKey(colorKey)
              : omniColorForKey(colorKey, { displayName: embedDisplayNameByKey[colorKey] })
          const badgeText = textColorOn(accent)
          return (
            <div key={`${m.source}-${m.tsMs}-${m.nick}-${idx}`} className="text-sm leading-snug">
              {showTimestamps ? <span className="text-xs text-base-content/50 mr-2">{ts}</span> : null}
              {showSourceLabels ? (
                <span
                  className="badge badge-sm mr-2 align-middle"
                  style={{ backgroundColor: accent, borderColor: accent, color: badgeText }}
                >
                  {m.source === 'dgg'
                    ? 'DGG'
                    : m.source === 'kick'
                      ? `K:${m.slug}`
                      : m.source === 'youtube'
                        ? `Y:${m.videoId}`
                        : `T:${m.channel}`}
                </span>
              ) : null}
              <span className="font-semibold mr-2" style={{ color: accent }}>
                {m.nick}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {m.source === 'dgg'
                  ? renderTextWithLinks(m.content ?? '', emotePattern, emotesMap, onOpenLink)
                  : m.source === 'kick'
                    ? renderKickContent(m.raw)
                    : m.source === 'youtube'
                      ? renderYouTubeContent(m.raw)
                      : m.content ?? ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

