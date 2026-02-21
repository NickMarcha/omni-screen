import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHAT_HTTP_PROXY_BASE } from '../utils/chatWsClient'
import { loadCSSNoCache } from '../utils/loadCss'
import { escapeRegexLiteral, renderPrimaryChatMessageContent } from '../utils/chatFormatting'
import { Icon } from './Icon'

interface RustleSearchMessage {
  id: string
  date: number
  text: string
  nick: string
  flairs: string
  matchedTerms: string[]
  searchAfter?: number
}

interface SurroundsMessage {
  id: string
  date: number
  nick: string
  text: string
  isMatched: boolean
}

interface RustleSearchViewProps {
  primaryChatSourceId: string | null
  onOpenLink?: (url: string) => void
}

const DEFAULT_SIZE = 150

export function RustleSearchView({ primaryChatSourceId, onOpenLink }: RustleSearchViewProps) {
  const [username, setUsername] = useState('')
  const [text, setText] = useState('')
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState(today)
  const [messages, setMessages] = useState<RustleSearchMessage[]>([])
  const [surroundsMessages, setSurroundsMessages] = useState<SurroundsMessage[] | null>(null)
  const [surroundsLoading, setSurroundsLoading] = useState(false)
  const [lastSearchAfter, setLastSearchAfter] = useState<number | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [emotesMap, setEmotesMap] = useState<Map<string, string>>(new Map())
  const [scrollToBottom, setScrollToBottom] = useState(false)
  const messageListRef = useRef<HTMLDivElement>(null)
  const scrollBeforeLoadMoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const emotePattern = useMemo(() => {
    if (emotesMap.size === 0) return null
    const sortedPrefixes = Array.from(emotesMap.keys()).sort((a, b) => b.length - a.length)
    const pattern = `\\b(${sortedPrefixes.map(escapeRegexLiteral).join('|')})\\b`
    try {
      return new RegExp(pattern, 'gi')
    } catch {
      return null
    }
  }, [emotesMap])

  useEffect(() => {
    setEndDate(new Date().toISOString().slice(0, 10))
  }, [])

  useEffect(() => {
    const el = messageListRef.current
    if (scrollToBottom && el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
      })
      setScrollToBottom(false)
    } else if (scrollBeforeLoadMoreRef.current && el) {
      const prev = scrollBeforeLoadMoreRef.current
      scrollBeforeLoadMoreRef.current = null
      requestAnimationFrame(() => {
        const addedHeight = el.scrollHeight - prev.scrollHeight
        el.scrollTop = prev.scrollTop + addedHeight
      })
    }
  }, [scrollToBottom, messages])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const config = (await window.ipcRenderer?.invoke?.('get-app-config').catch(() => null)) as {
        chatSources?: Record<string, { emotesJsonUrl?: string; emotesCssUrl?: string; flairsJsonUrl?: string; flairsCssUrl?: string }>
      } | null
      const chatSources = config?.chatSources ?? {}
      const primary = primaryChatSourceId ? chatSources[primaryChatSourceId] : Object.values(chatSources)[0]
      if (!primary?.emotesJsonUrl || !primary?.emotesCssUrl) return
      const cacheKey = Date.now()
      try {
        await loadCSSNoCache(`${CHAT_HTTP_PROXY_BASE}/emotes.css?_=${cacheKey}`, 'primary-chat-emotes-css')
        const emotesRes = await fetch(`${CHAT_HTTP_PROXY_BASE}/emotes.json?_=${cacheKey}`, { cache: 'no-store' })
        if (!emotesRes.ok) throw new Error(`Failed to fetch emotes: ${emotesRes.status}`)
        const emotesData: Array<{ prefix?: string; image?: Array<{ url?: string }> }> = await emotesRes.json()
        if (cancelled) return
        const map = new Map<string, string>()
        emotesData.forEach((emote) => {
          if (emote.prefix && emote.image?.length) {
            map.set(emote.prefix, '')
          }
        })
        setEmotesMap(map)
      } catch {
        // Continue without emotes
      }
    }
    run()
    return () => { cancelled = true }
  }, [primaryChatSourceId])

  const runSearch = useCallback(
    async (append: boolean) => {
      if (!window.ipcRenderer?.invoke) return
      const params: {
        username?: string
        text?: string
        start_date?: string
        end_date?: string
        search_after?: number
        size?: number
      } = {
        start_date: startDate || '2025-01-01',
        end_date: endDate || today,
        size: DEFAULT_SIZE,
      }
      if (username.trim()) params.username = username.trim()
      if (text.trim()) params.text = text.trim()
      if (append && lastSearchAfter != null) params.search_after = lastSearchAfter

      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      setError(null)
      try {
        const result = (await window.ipcRenderer.invoke('fetch-rustlesearch-query', params)) as {
          success: boolean
          data?: RustleSearchMessage[]
          searchAfter?: number
          hasMore?: boolean
          error?: string
        }
        if (result.success && Array.isArray(result.data)) {
          if (append) {
            const el = messageListRef.current
            if (el) {
              scrollBeforeLoadMoreRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
            }
            setMessages((prev) => {
              const byId = new Map(prev.map((m) => [m.id, m]))
              result.data!.forEach((m) => {
                if (!byId.has(m.id)) byId.set(m.id, m)
              })
              return Array.from(byId.values()).sort((a, b) => a.date - b.date)
            })
          } else {
            setMessages(result.data.sort((a, b) => a.date - b.date))
            setScrollToBottom(true)
          }
          setLastSearchAfter(result.searchAfter)
          setHasMore(result.hasMore ?? false)
        } else if (!append) {
          setMessages([])
          setError(result.error ?? 'Search failed')
        }
      } catch (err) {
        if (!append) {
          setMessages([])
          setError(err instanceof Error ? err.message : 'Search failed')
        }
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [username, text, startDate, endDate, today, lastSearchAfter]
  )

  const handleSearch = useCallback(() => {
    setLastSearchAfter(undefined)
    setHasMore(false)
    runSearch(false)
  }, [runSearch])

  const handleLoadMore = useCallback(() => {
    runSearch(true)
  }, [runSearch])

  const fetchSurroundsForMessage = useCallback(async (msg: RustleSearchMessage) => {
    if (!window.ipcRenderer?.invoke || !msg.nick?.trim()) return
    const datetimeIso = new Date(msg.date).toISOString()
    setSurroundsLoading(true)
    setError(null)
    try {
      const result = (await window.ipcRenderer.invoke('fetch-rustlesearch-surrounds', msg.nick.trim(), datetimeIso)) as {
        success: boolean
        data?: { messages: SurroundsMessage[]; matchedUsername: string }
        error?: string
      }
      if (result.success && result.data?.messages) {
        setSurroundsMessages(result.data.messages)
      } else {
        setSurroundsMessages([])
        setError(result.error ?? 'Surrounds search failed')
      }
    } catch (err) {
      setSurroundsMessages([])
      setError(err instanceof Error ? err.message : 'Surrounds search failed')
    } finally {
      setSurroundsLoading(false)
    }
  }, [])

  const clearSurroundsView = useCallback(() => {
    setSurroundsMessages(null)
    setError(null)
  }, [])

  const primaryChatNicks = useMemo(() => {
    const nicks = new Set<string>()
    const msgs = surroundsMessages ?? messages
    msgs.forEach((m) => {
      if (m.nick?.trim()) nicks.add(m.nick.trim().toLowerCase())
    })
    return Array.from(nicks)
  }, [messages, surroundsMessages])

  const renderContent = useCallback(
    (content: string) =>
      renderPrimaryChatMessageContent({
        content,
        primaryChatNicks,
        emotePattern,
        emotesMap,
        onOpenLink,
        options: { normalizeUrls: true },
      }),
    [primaryChatNicks, emotePattern, emotesMap, onOpenLink]
  )

  const accent = 'var(--p)' // Use primary theme color for nick badge

  const showSurrounds = surroundsMessages !== null
  const displayMessages = showSurrounds ? surroundsMessages : messages
  const isEmpty = displayMessages.length === 0 && !loading && !surroundsLoading && !error
  const emptyPrompt = 'Enter search criteria and click Search.'

  const renderMessageRow = (m: RustleSearchMessage | SurroundsMessage, isSurrounds: boolean, onSurroundsClick?: (msg: RustleSearchMessage) => void) => {
    const ts = Number.isFinite(m.date) ? new Date(m.date).toLocaleTimeString() : ''
    const fullDatetime = Number.isFinite(m.date) ? new Date(m.date).toLocaleString() : ''
    const isMatched = isSurrounds && 'isMatched' in m && m.isMatched
    const isClickable = !isSurrounds && onSurroundsClick
    const Wrapper = isClickable ? 'button' : 'div'
    const wrapperProps = isClickable
      ? {
          type: 'button' as const,
          onClick: () => onSurroundsClick!(m as RustleSearchMessage),
          disabled: surroundsLoading,
          title: 'View surrounds',
          className: `msg-chat text-sm px-2 py-0.5 -mx-2 flex flex-wrap items-start gap-x-2 gap-y-1 msg-user w-full text-left rounded cursor-pointer hover:bg-primary/15 transition-colors ${isMatched ? 'bg-primary/20 ring-2 ring-primary' : ''}`,
        }
      : {
          className: `msg-chat text-sm px-2 py-0.5 -mx-2 flex flex-wrap items-start gap-x-2 gap-y-1 msg-user ${isMatched ? 'bg-primary/20 ring-2 ring-primary rounded' : ''}`,
        }
    return (
      <Wrapper
        key={m.id}
        {...wrapperProps}
        data-username={m.nick?.trim().toLowerCase() || undefined}
      >
        <time
          className="time shrink-0 text-xs text-base-content/50"
          title={fullDatetime}
          data-unixtimestamp={m.date}
        >
          {ts}
        </time>
        <span
          className="font-semibold shrink-0"
          style={{ color: accent }}
        >
          {m.nick || '?'}:
        </span>
        <span className="msg-chat-content text whitespace-pre-wrap break-words min-w-0">
          <span className="msg-chat msg-chat-inner" style={{ position: 'relative' }}>
            {renderContent(m.text ?? '')}
          </span>
        </span>
      </Wrapper>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Surrounds view: Back button */}
      {showSurrounds && (
        <div className="flex-none flex items-center gap-2 p-2 border-b border-base-300">
          <button
            type="button"
            className="btn btn-sm btn-ghost gap-1"
            onClick={clearSurroundsView}
          >
            <Icon name="arrow-left" size={16} />
            Back
          </button>
          {surroundsLoading && (
            <span className="text-sm text-base-content/60">Loading surrounds…</span>
          )}
        </div>
      )}

      {/* Search form (hidden when in surrounds view) */}
      {!showSurrounds && (
        <div className="flex-none p-2 border-b border-base-300 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Username (e.g. destiny | trainwreckstv)"
              className="input input-sm input-bordered flex-1 min-w-[120px]"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="text"
              placeholder='Text (e.g. "I like books" | lulw -kekw)'
              className="input input-sm input-bordered flex-1 min-w-[120px]"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="date"
              className="input input-sm input-bordered w-32"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <input
              type="date"
              className="input input-sm input-bordered w-32"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleSearch}
              disabled={loading}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>
      )}

      {/* Message list */}
      <div ref={messageListRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 flex flex-col">
        {error && (
          <div className="text-sm text-error py-2">{error}</div>
        )}
        {isEmpty && (
          <div className="text-sm text-base-content/50 text-center py-8">
            {emptyPrompt}
          </div>
        )}
        {!showSurrounds && hasMore && (
          <div className="flex justify-center shrink-0">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
        {showSurrounds ? (
          <div className="min-h-0">
            {surroundsMessages!.map((m) => renderMessageRow(m, true))}
          </div>
        ) : (
          <div className="min-h-0">
            {messages.map((m) => renderMessageRow(m, false, fetchSurroundsForMessage))}
          </div>
        )}
      </div>
    </div>
  )
}

