import { type ReactNode, useCallback, forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { omniColorForKey, textColorOn } from '../utils/omniColors'
import PollView, { type PollData } from './PollView'

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

/** Inbox message from GET /api/messages/usr/:username/inbox */
interface DggInboxMessage {
  id: number
  userid: number
  targetuserid: number
  message: string
  timestamp: string
  isread: number
  deletedbysender: number
  deletedbyreceiver: number
  from: string
  to: string
}

const DGG_WHISPER_USERS_KEY = 'omni-screen:dgg-whisper-usernames'

/** Format whisper timestamp: same day → hh:mm, else → date + hh:mm */
function formatWhisperTimestamp(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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

    parts.push(
      <div
        key={`emote-${keyCounter++}`}
        className={`emote ${matchedPrefix}`}
        title={matchedPrefix}
        role="img"
        aria-label={matchedPrefix}
      />,
    )
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

/** Matches http(s) URLs and Destiny-style # links: #kick/..., #twitch/..., #youtube/... */
const LINK_REGEX = /(https?:\/\/[^\s]+|#(?:kick|twitch|youtube)\/[^\s]+)/gi

function renderTextWithLinks(
  text: string,
  emotePattern: RegExp | null,
  emotesMap: Map<string, string>,
  onOpenLink?: (url: string) => void,
): JSX.Element {
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasLinks = false
  let keyCounter = 0

  while ((match = LINK_REGEX.exec(text)) !== null) {
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
    const isDestinyLink = url.startsWith('#')
    parts.push(
      <a
        key={`link-${keyCounter++}`}
        href={isDestinyLink ? '#' : url}
        target={isDestinyLink ? undefined : '_blank'}
        rel={isDestinyLink ? undefined : 'noopener noreferrer'}
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
const DGG_AUTOCOMPLETE_LIMIT = 20

function isAtBottom(el: HTMLElement) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX
}

function getWordAtCursor(value: string, cursor: number): { start: number; end: number; fragment: string } {
  const before = value.slice(0, cursor)
  const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'))
  const start = lastSpace + 1
  const end = cursor
  const fragment = value.slice(start, end)
  return { start, end, fragment }
}

function getAutocompleteSuggestions(
  fragment: string,
  emotesMap: Map<string, string>,
  dggNicks: string[]
): string[] {
  if (!fragment) return []
  const lower = fragment.toLowerCase()
  const emotes: string[] = []
  emotesMap.forEach((_, prefix) => {
    if (prefix.toLowerCase().startsWith(lower)) emotes.push(prefix)
  })
  const nicks = dggNicks.filter((n) => n.toLowerCase().startsWith(lower))
  const combined = [...new Set([...emotes, ...nicks])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return combined.slice(0, DGG_AUTOCOMPLETE_LIMIT)
}

interface DggInputBarProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  disabled?: boolean
  emotesMap: Map<string, string>
  dggNicks: string[]
  placeholder?: string
  /** Shown on the right of the input when set (e.g. "Ctrl + Space"). */
  shortcutLabel?: string
}

const HISTORY_MAX = 50

const DggInputBar = forwardRef<HTMLTextAreaElement, DggInputBarProps>(function DggInputBar(
  { value, onChange, onSend, onKeyDown, disabled, emotesMap, dggNicks, placeholder, shortcutLabel },
  ref
) {
  const [cursorPosition, setCursorPosition] = useState(0)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [lastInsertedWord, setLastInsertedWord] = useState<string | null>(null)
  const [lastSuggestions, setLastSuggestions] = useState<string[]>([])
  const [messageHistory, setMessageHistory] = useState<string[]>([])
  const [, setHistoryIndex] = useState(-1)
  const [focused, setFocused] = useState(false)
  const savedCurrentRef = useRef('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const mergedRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inputRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    },
    [ref]
  )

  const { start, end, fragment } = getWordAtCursor(value, cursorPosition)
  const suggestionsFromFragment = useMemo(
    () => getAutocompleteSuggestions(fragment, emotesMap, dggNicks),
    [fragment, emotesMap, dggNicks]
  )
  const suggestions = fragment.length >= 1 ? suggestionsFromFragment : lastInsertedWord ? lastSuggestions : []
  const showDropdown = suggestions.length > 0 && (fragment.length >= 1 || lastInsertedWord != null)

  useEffect(() => {
    if (fragment.length >= 1 && suggestionsFromFragment.length > 0) {
      setLastSuggestions(suggestionsFromFragment)
    }
  }, [fragment, suggestionsFromFragment])

  const replaceWordWith = useCallback(
    (suggestion: string, replaceStart: number, replaceEnd: number) => {
      const newValue = value.slice(0, replaceStart) + suggestion + ' ' + value.slice(replaceEnd)
      onChange(newValue)
      const newCursor = replaceStart + suggestion.length + 1
      setCursorPosition(newCursor)
      setLastInsertedWord(suggestion)
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(newCursor, newCursor)
        inputRef.current?.focus()
      })
    },
    [value, onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const cursor = e.currentTarget.selectionStart ?? 0
      setCursorPosition(cursor)

      if (e.key === 'Tab' && showDropdown && suggestions.length > 0) {
        e.preventDefault()
        const forward = !e.shiftKey
        const next = forward
          ? (highlightIndex < 0 ? 0 : (highlightIndex + 1) % suggestions.length)
          : (highlightIndex <= 0 ? suggestions.length - 1 : (highlightIndex - 1 + suggestions.length) % suggestions.length)
        setHighlightIndex(next)
        const suggestion = suggestions[next]
        if (fragment.length >= 1) {
          replaceWordWith(suggestion, start, end)
        } else if (lastInsertedWord != null) {
          const lastStart = Math.max(0, cursor - lastInsertedWord.length - 1)
          const lastEnd = cursor - 1
          if (lastEnd >= lastStart) replaceWordWith(suggestion, lastStart, lastEnd + 1)
        }
        return
      }
      if (e.key === 'ArrowDown' && showDropdown) {
        e.preventDefault()
        setHighlightIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
        return
      }
      if (e.key === 'ArrowUp' && showDropdown) {
        e.preventDefault()
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
        return
      }
      if (e.key === 'Escape' && showDropdown) {
        e.preventDefault()
        setHighlightIndex(-1)
        setLastInsertedWord(null)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        setHighlightIndex(-1)
        setLastInsertedWord(null)
        const trimmed = value.trim()
        if (trimmed) {
          setMessageHistory((prev) => [...prev.slice(-(HISTORY_MAX - 1)), trimmed])
          setHistoryIndex(-1)
        }
        onSend()
        e.preventDefault()
        return
      }
      if (!showDropdown && messageHistory.length > 0) {
        if (e.key === 'ArrowUp') {
          const atStart = cursor === 0
          if (atStart) {
            e.preventDefault()
            setHistoryIndex((prev) => {
              if (prev === -1) {
                savedCurrentRef.current = value
                const next = messageHistory.length - 1
                onChange(messageHistory[next] ?? '')
                return next
              }
              if (prev <= 0) return 0
              const next = prev - 1
              onChange(messageHistory[next] ?? '')
              return next
            })
            return
          }
        }
        if (e.key === 'ArrowDown') {
          const atEnd = cursor === value.length
          if (atEnd) {
            e.preventDefault()
            setHistoryIndex((prev) => {
              if (prev === -1) return -1
              if (prev >= messageHistory.length - 1) {
                onChange(savedCurrentRef.current)
                return -1
              }
              const next = prev + 1
              onChange(messageHistory[next] ?? '')
              return next
            })
            return
          }
        }
      }
      setHighlightIndex(-1)
      setLastInsertedWord(null)
      onKeyDown?.(e)
    },
    [showDropdown, suggestions, highlightIndex, fragment, start, end, lastInsertedWord, replaceWordWith, onSend, onKeyDown, messageHistory, value, onChange]
  )

  const MIN_H = 36
  const MAX_H = 160

  const resize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.overflow = 'hidden'
    el.style.setProperty('min-height', '0', 'important')
    el.style.setProperty('height', '0px', 'important')
    const scrollH = el.scrollHeight
    const h = Math.max(MIN_H, Math.min(scrollH, MAX_H))
    el.style.removeProperty('min-height')
    el.style.removeProperty('height')
    el.style.height = `${h}px`
    el.style.minHeight = `${MIN_H}px`
    el.style.overflowY = h >= MAX_H ? 'auto' : 'hidden'
    el.style.overflowX = 'hidden'
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCursorPosition(e.target.selectionStart ?? 0)
      setHighlightIndex(-1)
      setLastInsertedWord(null)
      setHistoryIndex(-1)
      onChange(e.target.value)
    },
    [onChange]
  )

  useLayoutEffect(() => {
    resize(inputRef.current)
  }, [value, resize])

  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      mergedRef(el)
      if (el) resize(el)
    },
    [mergedRef, resize]
  )

  const inputContent = (
    <>
      <textarea
        ref={setRef}
        className={`min-h-0 resize-none py-2 block break-words border-0 bg-transparent focus:outline-none focus:ring-0 ${shortcutLabel ? 'flex-1 min-w-0' : 'input input-sm input-bordered w-full flex-1 min-w-0'}`}
        style={{
          maxHeight: MAX_H,
          overflowX: 'hidden',
          overflowWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textWrap: 'wrap',
        }}
        placeholder={placeholder}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={() => setCursorPosition(inputRef.current?.selectionStart ?? 0)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        rows={1}
        wrap="soft"
      />
      {shortcutLabel && !focused ? (
        <span className="shrink-0 text-base-content/50 text-xs pr-1" aria-hidden>
          ({shortcutLabel})
        </span>
      ) : null}
    </>
  )

  return (
    <div className="flex-none border-t border-base-300 bg-base-200 p-2 flex items-center gap-2 relative shrink-0">
      <div className="flex-1 min-w-0 relative flex flex-col">
        {shortcutLabel ? (
          <div className="input input-sm input-bordered flex flex-1 min-w-0 items-center gap-2 overflow-hidden w-full">
            {inputContent}
          </div>
        ) : (
          inputContent
        )}
        {showDropdown && (
          <ul
            className="dgg-autocomplete-list absolute left-0 right-0 bottom-full mb-1 py-1 bg-base-300 border border-base-300 rounded-md shadow-lg max-h-48 overflow-y-auto z-50"
            style={{ listStyle: 'none' }}
          >
            {suggestions.map((s, idx) => {
              const isEmote = emotesMap.has(s)
              return (
                <li
                  key={s}
                  data-index={idx}
                  className={`px-2 py-1 text-sm cursor-pointer flex items-center gap-2 min-h-[28px] ${idx === highlightIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    replaceWordWith(s, start, end)
                    setHighlightIndex(-1)
                  }}
                >
                  {isEmote ? (
                    <>
                      <div
                        className={`emote ${s} shrink-0`}
                        style={{ width: 28, height: 28 }}
                        title={s}
                        role="img"
                        aria-label={s}
                      />
                      <span>{s}</span>
                    </>
                  ) : (
                    <span>{s}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
})

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

/** True only if the message is solely a single emote (nothing else). Combo grouping applies only to these. */
function isSingleEmoteMessage(m: CombinedItem, emotesMap: Map<string, string>): boolean {
  if (m.source === 'dgg') {
    const trimmed = (m.content ?? '').trim()
    if (!trimmed) return false
    if (/\s/.test(trimmed)) return false
    return emotesMap.has(trimmed)
  }
  if (m.source === 'kick') {
    const text = String((m as any).raw?.content ?? m.content ?? '').trim()
    return /^\[emote:(\d+):([^\]]+)\]$/.test(text)
  }
  return false
}

/** Emote key for combo grouping: same key = same emote. Returns null if not a single-emote message. */
function getEmoteKey(m: CombinedItem, emotesMap: Map<string, string>): string | null {
  if (!isSingleEmoteMessage(m, emotesMap)) return null
  if (m.source === 'dgg') {
    const trimmed = (m.content ?? '').trim()
    return emotesMap.has(trimmed) ? trimmed : null
  }
  if (m.source === 'kick') {
    const text = String((m as any).raw?.content ?? m.content ?? '').trim()
    const match = text.match(/^\[emote:(\d+):([^\]]+)\]$/)
    return match ? `kick:${match[1]}:${match[2]}` : null
  }
  return null
}

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

function renderKickContent(msg: KickChatMessage, onOpenLink?: (url: string) => void): (string | JSX.Element)[] {
  const text = String(msg?.content ?? '')
  if (!text) return ['']

  const pushText = (segment: string, parts: (string | JSX.Element)[]) => {
    if (!segment) return
    parts.push(renderTextWithLinks(segment, null, new Map(), onOpenLink))
  }

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
      if (start > last) pushText(text.slice(last, start), parts)
      const id = Number(match[1])
      const name = match[2] || undefined
      if (Number.isFinite(id) && id > 0) parts.push(renderKickEmote(id, name, `kick-emote-token-${k++}`))
      else parts.push(match[0])
      last = start + match[0].length
    }
    if (last < text.length) pushText(text.slice(last), parts)
    return parts.length ? parts : [renderTextWithLinks(text, null, new Map(), onOpenLink)]
  }

  const emotes = Array.isArray(msg?.emotes) ? msg.emotes : []
  if (emotes.length === 0) return [renderTextWithLinks(text, null, new Map(), onOpenLink)]

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
      if (s > last) pushText(text.slice(last, s), parts)
      parts.push(renderKickEmote(e.id, e.name, `kick-emote-pos-${k++}`))
      last = en
    }
    if (last < text.length) pushText(text.slice(last), parts)
    return parts.length ? parts : [renderTextWithLinks(text, null, new Map(), onOpenLink)]
  }

  // 3) Fallback: replace emote names in-message.
  const nameToId = new Map<string, number>()
  for (const e of emotes) {
    const id = Number((e as any)?.id)
    const name = typeof (e as any)?.name === 'string' ? String((e as any).name).trim() : ''
    if (!name || !Number.isFinite(id) || id <= 0) continue
    if (!nameToId.has(name)) nameToId.set(name, id)
  }
  if (nameToId.size === 0) return [renderTextWithLinks(text, null, new Map(), onOpenLink)]

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
  if (!re) return [renderTextWithLinks(text, null, new Map(), onOpenLink)]

  const parts: (string | JSX.Element)[] = []
  let last = 0
  let match: RegExpExecArray | null
  let k = 0
  while ((match = re.exec(text)) !== null) {
    const start = match.index
    if (start > last) pushText(text.slice(last, start), parts)
    const name = match[1]
    const id = nameToId.get(name)
    if (id) parts.push(renderKickEmote(id, name, `kick-emote-name-${k++}`))
    else parts.push(match[0])
    last = start + match[0].length
  }
  if (last < text.length) pushText(text.slice(last), parts)
  return parts.length ? parts : [renderTextWithLinks(text, null, new Map(), onOpenLink)]
}

function renderYouTubeContent(msg: YouTubeChatMessage, onOpenLink?: (url: string) => void): ReactNode {
  const runs = msg.runs
  if (!runs || runs.length === 0) {
    const raw = msg.message ?? ''
    return raw ? renderTextWithLinks(raw, null, new Map(), onOpenLink) : ''
  }

  const parts: (string | JSX.Element)[] = []
  runs.forEach((run, i) => {
    if ('text' in run && run.text) {
      parts.push(renderTextWithLinks(run.text, null, new Map(), onOpenLink))
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
  return parts.length ? <>{parts}</> : (() => {
    const raw = msg.message ?? ''
    return raw ? renderTextWithLinks(raw, null, new Map(), onOpenLink) : ''
  })()
}

export default function CombinedChat({
  enableDgg,
  showDggInput = true,
  getEmbedDisplayName,
  maxMessages,
  showTimestamps,
  showSourceLabels,
  sortMode,
  highlightTerm,
  onCountChange,
  onDggUserCountChange,
  onOpenLink: onOpenLinkProp,
  dggInputRef: dggInputRefProp,
  focusShortcutLabel,
}: {
  enableDgg: boolean
  /** When false, DGG chat input is hidden. When true, shown only when authenticated (ME received). */
  showDggInput?: boolean
  /** Lookup display name for a channel key (e.g. youtube:videoId); canonicalizes key so casing matches. */
  getEmbedDisplayName: (key: string) => string
  maxMessages: number
  showTimestamps: boolean
  showSourceLabels: boolean
  sortMode: 'timestamp' | 'arrival'
  /** When set, messages whose text contains this term (case-insensitive) get a light blue background. */
  highlightTerm?: string
  onCountChange?: (count: number) => void
  /** Called when DGG user count (from NAMES/JOIN/QUIT) changes, for header display. */
  onDggUserCountChange?: (count: number) => void
  /** When set, called when user clicks a link; otherwise links open in browser. */
  onOpenLink?: (url: string) => void
  /** Optional ref from parent to focus the DGG input (e.g. for keybind). */
  dggInputRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Shortcut label for placeholder, e.g. "Ctrl + Space". */
  focusShortcutLabel?: string
}) {
  const [emotesMap, setEmotesMap] = useState<Map<string, string>>(new Map())
  const [items, setItems] = useState<CombinedItemWithSeq[]>([])
  const [updateSeq, setUpdateSeq] = useState(0)
  const [dggInputValue, setDggInputValue] = useState('')
  const [dggConnected, setDggConnected] = useState(false)
  const [dggAuthenticated, setDggAuthenticated] = useState(false)
  const [pinnedMessage, setPinnedMessage] = useState<DggChatMessage | null>(null)
  const [pinnedHidden, setPinnedHidden] = useState(false)
  const [showMoreMessagesBelow, setShowMoreMessagesBelow] = useState(false)
  /** DGG nicks from NAMES/JOIN/QUIT (used for autocomplete and count). */
  const [dggUserNicks, setDggUserNicks] = useState<string[]>([])
  const [currentPoll, setCurrentPoll] = useState<PollData | null>(null)
  const [pollOver, setPollOver] = useState(false)
  /** Server time offset (serverNow - clientNow) at POLLSTART; used so timer uses server time. */
  const [pollServerOffsetMs, setPollServerOffsetMs] = useState<number | null>(null)
  const [pollVoteError, setPollVoteError] = useState<string | null>(null)
  const [votePending, setVotePending] = useState(false)
  /** Usernames who have whispered us (from PRIVMSG + unread API); persisted locally. */
  const [whisperUsernames, setWhisperUsernames] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(DGG_WHISPER_USERS_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
    } catch {
      return []
    }
  })
  /** Usernames with unread whispers (from unread API + PRIVMSG); cleared when we open that conversation. */
  const [unreadUsernames, setUnreadUsernames] = useState<Set<string>>(() => new Set())
  /** Per-user unread count (incremented on PRIVMSG, zeroed when opening conversation). Total unread = sum of values. */
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>(() => ({}))
  /** True when we're showing the private messages view (list of users) instead of main chat. */
  const [privViewOpen, setPrivViewOpen] = useState(false)
  /** When set, we're viewing conversation with this user; input sends whisper. */
  const [activeWhisperUsername, setActiveWhisperUsername] = useState<string | null>(null)
  /** Messages for activeWhisperUsername (from inbox API). */
  const [inboxMessages, setInboxMessages] = useState<DggInboxMessage[] | null>(null)
  /** Error from last whisper send attempt (e.g. not logged in, chat not connected). */
  const [whisperSendError, setWhisperSendError] = useState<string | null>(null)
  /** When in list view: recipient for "send to new person" (combobox value; can be any username). */
  const [composeRecipient, setComposeRecipient] = useState('')
  /** Show dropdown for compose recipient suggestions. */
  const [composeRecipientDropdownOpen, setComposeRecipientDropdownOpen] = useState(false)
  const composeRecipientInputRef = useRef<HTMLInputElement | null>(null)
  /** Have we done the initial unread fetch when combined chat first loads. */
  const unreadFetchedRef = useRef(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((a, b) => a + b, 0),
    [unreadCounts]
  )
  const dggInputRefInternal = useRef<HTMLTextAreaElement | null>(null)
  const mergedDggInputRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      dggInputRefInternal.current = el
      if (dggInputRefProp) (dggInputRefProp as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    },
    [dggInputRefProp]
  )
  const wasAtBottomRef = useRef(true)
  const shouldStickToBottomRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const seqRef = useRef(0)

  /** Hard cap so the list never grows unbounded (e.g. if left open for days). ~5k messages ≈ 15k DOM nodes. */
  const HARD_MAX = 5000

  const maxKeep = useMemo(() => {
    const v = Number.isFinite(maxMessages) ? Math.floor(maxMessages) : 600
    return Math.max(50, Math.min(HARD_MAX, v))
  }, [maxMessages])

  const effectiveCap = Math.min(maxKeep, HARD_MAX)

  /** Trim only when at bottom (soft limit). When scrolled up, only trim if over hard max. */
  const trimToLimit = useCallback(
    (arr: CombinedItemWithSeq[], atBottom: boolean): CombinedItemWithSeq[] => {
      const limit = atBottom ? effectiveCap : HARD_MAX
      if (arr.length <= limit) return arr
      return arr.slice(arr.length - limit)
    },
    [effectiveCap]
  )

  const trimToLimitRef = useRef(trimToLimit)
  trimToLimitRef.current = trimToLimit

  useEffect(() => {
    setItems((prev) => trimToLimit(prev, wasAtBottomRef.current))
    setUpdateSeq((v) => v + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxKeep])

  const appendItems = (newItems: CombinedItemWithSeq[]) => {
    if (newItems.length === 0) return
    markStickIfAtBottom()
    setItems((prev) => trimToLimit([...prev, ...newItems], wasAtBottomRef.current))
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
      const atBottom = isAtBottom(el)
      wasAtBottomRef.current = atBottom
      setShowMoreMessagesBelow((prev) => (prev !== !atBottom ? !atBottom : prev))
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
      const slice = history.messages.slice(-HARD_MAX)
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
        return trimToLimitRef.current([...nonDgg, ...mapped], wasAtBottomRef.current)
      })
      setUpdateSeq((v) => v + 1)
    }

    const handleConnected = () => {
      if (alive) setDggConnected(true)
    }
    const handleDisconnected = () => {
      if (alive) setDggConnected(false)
      if (alive) setDggAuthenticated(false)
      if (alive) setDggUserNicks([])
    }
    const handleMe = (_event: any, payload: { type?: string; data?: { nick?: string; id?: number } | null } | null) => {
      if (!alive) return
      const me = payload?.data ?? payload
      const nick = me && 'nick' in me ? me.nick : undefined
      setDggAuthenticated(Boolean(nick))
    }

    const handlePin = (_event: any, payload: { type?: string; pin?: DggChatMessage } | null) => {
      if (!alive) return
      const msg = payload?.pin ?? (payload as DggChatMessage | null)
      setPinnedMessage(msg ?? null)
      if (msg != null) setPinnedHidden(false)
    }

    const handleNames = (_event: any, payload: { type?: string; names?: { users?: Array<{ nick?: string }> } } | null) => {
      if (!alive) return
      const users = payload?.names?.users
      if (!Array.isArray(users)) return
      const nicks = users
        .map((u) => (u?.nick ?? '').trim())
        .filter(Boolean)
      const unique = Array.from(new Set(nicks)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      setDggUserNicks(unique)
    }

    const handleUserEvent = (_event: any, payload: { type?: string; user?: { nick?: string } } | null) => {
      if (!alive) return
      const nick = payload?.user?.nick?.trim()
      if (!nick) return
      if (payload?.type === 'JOIN') {
        setDggUserNicks((prev) => (prev.includes(nick) ? prev : [...prev, nick].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))))
      } else if (payload?.type === 'QUIT') {
        setDggUserNicks((prev) => prev.filter((n) => n !== nick))
      }
    }

    window.ipcRenderer.invoke('chat-websocket-connect').catch(() => {})
    window.ipcRenderer.invoke('chat-websocket-status').then((r: { connected?: boolean }) => {
      if (alive && r?.connected) setDggConnected(true)
    }).catch(() => {})
    window.ipcRenderer.on('chat-websocket-connected', handleConnected)
    window.ipcRenderer.on('chat-websocket-disconnected', handleDisconnected)
    window.ipcRenderer.on('chat-websocket-me', handleMe)
    window.ipcRenderer.on('chat-websocket-message', handleMessage)
    window.ipcRenderer.on('chat-websocket-history', handleHistory)
    window.ipcRenderer.on('chat-websocket-pin', handlePin)
    window.ipcRenderer.on('chat-websocket-names', handleNames)
    window.ipcRenderer.on('chat-websocket-user-event', handleUserEvent)

    const handlePrivmsg = (_event: any, data: { type?: string; privmsg?: { nick?: string } } | null) => {
      if (!alive) return
      const nick = data?.privmsg?.nick?.trim()
      if (!nick) return
      setWhisperUsernames((prev) => {
        const next = prev.includes(nick) ? prev : [...prev, nick]
        try {
          localStorage.setItem(DGG_WHISPER_USERS_KEY, JSON.stringify(next))
        } catch {
          // ignore
        }
        return next
      })
      setUnreadUsernames((prev) => new Set(prev).add(nick))
      setUnreadCounts((prev) => ({ ...prev, [nick]: (prev[nick] ?? 0) + 1 }))
    }

    window.ipcRenderer.on('chat-websocket-privmsg', handlePrivmsg)

    const handleChatErr = (_event: any, data: { description?: string } | null) => {
      if (!alive) return
      const desc = data?.description?.trim()
      if (desc && desc !== 'alreadyvoted') setWhisperSendError(desc)
    }
    window.ipcRenderer.on('chat-websocket-err', handleChatErr)

    return () => {
      alive = false
      setDggConnected(false)
      window.ipcRenderer.off('chat-websocket-err', handleChatErr)
      setDggAuthenticated(false)
      window.ipcRenderer.off('chat-websocket-privmsg', handlePrivmsg)
      window.ipcRenderer.off('chat-websocket-connected', handleConnected)
      window.ipcRenderer.off('chat-websocket-disconnected', handleDisconnected)
      window.ipcRenderer.off('chat-websocket-me', handleMe)
      window.ipcRenderer.off('chat-websocket-message', handleMessage)
      window.ipcRenderer.off('chat-websocket-history', handleHistory)
      window.ipcRenderer.off('chat-websocket-pin', handlePin)
      window.ipcRenderer.off('chat-websocket-names', handleNames)
      window.ipcRenderer.off('chat-websocket-user-event', handleUserEvent)
      window.ipcRenderer.invoke('chat-websocket-disconnect').catch(() => {})
    }
  }, [enableDgg])

  // When combined chat first loads with DGG authenticated, fetch unread private messages once.
  useEffect(() => {
    if (!enableDgg || !dggAuthenticated || unreadFetchedRef.current) return
    unreadFetchedRef.current = true
    window.ipcRenderer.invoke('dgg-messages-unread').then((r: { success?: boolean; data?: Array<{ username?: string }> }) => {
      if (!r?.success || !Array.isArray(r.data)) return
      const usernames = r.data.map((u) => u?.username?.trim()).filter((s): s is string => Boolean(s))
      if (usernames.length === 0) return
      setWhisperUsernames((prev) => {
        const next = [...new Set([...prev, ...usernames])]
        try {
          localStorage.setItem(DGG_WHISPER_USERS_KEY, JSON.stringify(next))
        } catch {
          // ignore
        }
        return next
      })
      setUnreadUsernames((prev) => {
        const next = new Set(prev)
        usernames.forEach((u) => next.add(u))
        return next
      })
      setUnreadCounts((prev) => {
        const next = { ...prev }
        usernames.forEach((u) => { next[u] = (next[u] ?? 0) + 1 })
        return next
      })
    }).catch(() => {})
  }, [enableDgg, dggAuthenticated])

  // When we open a conversation, clear unread for that user and fetch inbox.
  useEffect(() => {
    if (!activeWhisperUsername) {
      setInboxMessages(null)
      return
    }
    setUnreadUsernames((prev) => {
      const next = new Set(prev)
      next.delete(activeWhisperUsername)
      return next
    })
    setUnreadCounts((prev) => {
      const next = { ...prev }
      delete next[activeWhisperUsername]
      return next
    })
    setInboxMessages(null)
    window.ipcRenderer.invoke('dgg-messages-inbox', { username: activeWhisperUsername }).then((r: { success?: boolean; data?: DggInboxMessage[] }) => {
      if (r?.success && Array.isArray(r.data)) setInboxMessages(r.data)
    }).catch(() => {})
  }, [activeWhisperUsername])

  // Keep whisper conversation scrolled to bottom when messages change
  useEffect(() => {
    if (!privViewOpen || !activeWhisperUsername || !inboxMessages?.length) return
    const el = scrollerRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [privViewOpen, activeWhisperUsername, inboxMessages])

  const removeWhisperUsername = useCallback((username: string) => {
    setWhisperUsernames((prev) => {
      const next = prev.filter((u) => u !== username)
      try {
        localStorage.setItem(DGG_WHISPER_USERS_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
    setUnreadUsernames((prev) => {
      const next = new Set(prev)
      next.delete(username)
      return next
    })
    setUnreadCounts((prev) => {
      const next = { ...prev }
      delete next[username]
      return next
    })
    if (activeWhisperUsername === username) {
      setActiveWhisperUsername(null)
      setInboxMessages(null)
      setWhisperSendError(null)
    }
  }, [activeWhisperUsername])

  const handlePollDismiss = useCallback(() => {
    setCurrentPoll(null)
    setPollOver(false)
    setPollServerOffsetMs(null)
    setPollVoteError(null)
  }, [])

  // DGG poll events: POLLSTART, POLLSTOP, VOTECAST, vote-counted, poll-vote-error
  useEffect(() => {
    if (!enableDgg) return
    const handlePollStart = (_event: any, data: { type: 'POLLSTART'; poll: PollData }) => {
      if (data?.type === 'POLLSTART' && data.poll) {
        const poll = data.poll
        const serverNow =
          typeof poll.now === 'number'
            ? (poll.now < 1e12 ? poll.now * 1000 : poll.now)
            : new Date(poll.now as string).getTime()
        const startMs =
          typeof poll.start === 'number'
            ? (poll.start < 1e12 ? poll.start * 1000 : poll.start)
            : new Date(poll.start).getTime()
        const alreadyEnded = Number.isFinite(startMs) && poll.time > 0 && startMs + poll.time <= (Number.isFinite(serverNow) ? serverNow : Date.now())
        setPollServerOffsetMs(Number.isFinite(serverNow) ? serverNow - Date.now() : null)
        setCurrentPoll(poll)
        setPollOver(alreadyEnded)
        try {
          window.ipcRenderer?.invoke('log-to-file', 'info', '[CombinedChat] POLLSTART', [
            { question: poll.question?.slice(0, 40), alreadyEnded, startMs, time: poll.time, serverNow },
          ])
        } catch {
          // ignore
        }
      } else {
        setPollOver(false)
      }
      setPollVoteError(null)
      setVotePending(false)
    }
    const handleVoteCast = (_event: any, data: { type: 'VOTECAST'; vote: { vote: string; quantity: number } }) => {
      if (data?.type !== 'VOTECAST' || !data.vote) return
      setCurrentPoll((prev) => {
        if (!prev) return prev
        const optIndex = Math.max(0, parseInt(data.vote.vote, 10) - 1)
        const quantity = Number.isFinite(data.vote.quantity) ? data.vote.quantity : 0
        if (optIndex >= prev.options.length || quantity <= 0) return prev
        const totals = [...prev.totals]
        while (totals.length <= optIndex) totals.push(0)
        totals[optIndex] = (totals[optIndex] ?? 0) + quantity
        return { ...prev, totals, totalvotes: prev.totalvotes + quantity }
      })
    }
    const handlePollStop = (_event: any, data: { type: 'POLLSTOP'; poll: PollData }) => {
      if (data?.type === 'POLLSTOP' && data.poll) setCurrentPoll(data.poll)
      setPollOver(true)
      setVotePending(false)
      try {
        window.ipcRenderer?.invoke('log-to-file', 'info', '[CombinedChat] POLLSTOP', [{}])
      } catch {
        // ignore
      }
    }
    const handleVoteCounted = (_event: any, data: { vote: string }) => {
      const vote = data?.vote != null ? parseInt(String(data.vote), 10) : 0
      if (!Number.isFinite(vote) || vote < 1) return
      setCurrentPoll((prev) => (prev ? { ...prev, myvote: vote } : prev))
      setPollVoteError(null)
      setVotePending(false)
      try {
        window.ipcRenderer?.invoke('log-to-file', 'info', '[CombinedChat] Vote counted', [{ vote }])
      } catch {
        // ignore
      }
    }
    const handlePollVoteError = (_event: any, data: { description?: string }) => {
      setPollVoteError(data?.description === 'alreadyvoted' ? 'Already voted' : data?.description || 'Vote failed')
      setVotePending(false)
      try {
        window.ipcRenderer?.invoke('log-to-file', 'info', '[CombinedChat] Poll vote error', [{ description: data?.description }])
      } catch {
        // ignore
      }
    }
    window.ipcRenderer.on('chat-websocket-poll-start', handlePollStart)
    window.ipcRenderer.on('chat-websocket-vote-cast', handleVoteCast)
    window.ipcRenderer.on('chat-websocket-poll-stop', handlePollStop)
    window.ipcRenderer.on('chat-websocket-vote-counted', handleVoteCounted)
    window.ipcRenderer.on('chat-websocket-poll-vote-error', handlePollVoteError)
    return () => {
      window.ipcRenderer.off('chat-websocket-poll-start', handlePollStart)
      window.ipcRenderer.off('chat-websocket-vote-cast', handleVoteCast)
      window.ipcRenderer.off('chat-websocket-poll-stop', handlePollStop)
      window.ipcRenderer.off('chat-websocket-vote-counted', handleVoteCounted)
      window.ipcRenderer.off('chat-websocket-poll-vote-error', handlePollVoteError)
    }
  }, [enableDgg])

  useEffect(() => {
    onDggUserCountChange?.(dggUserNicks.length)
  }, [dggUserNicks.length, onDggUserCountChange])

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

  /** DGG nicks for autocomplete: from NAMES/JOIN/QUIT (dggUserNicks). Falls back to nicks seen in messages if WS list empty. */
  const dggNicks = useMemo(() => {
    if (dggUserNicks.length > 0) return dggUserNicks
    const fromItems = new Set<string>()
    items.forEach((m) => {
      if (m.source === 'dgg' && m.nick?.trim()) fromItems.add(m.nick.trim())
    })
    return Array.from(fromItems).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [dggUserNicks, items])

  /** Suggestions for "Send to" combobox: whisper list + DGG nicks, filtered by composeRecipient, unique. */
  const composeRecipientSuggestions = useMemo(() => {
    const combined = [...new Set([...whisperUsernames, ...dggNicks])]
    const q = composeRecipient.trim().toLowerCase()
    if (!q) return combined.slice(0, 25)
    return combined.filter((n) => n.toLowerCase().includes(q)).slice(0, 25)
  }, [whisperUsernames, dggNicks, composeRecipient])

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

  type RenderEntry =
    | { type: 'message'; index: number; item: CombinedItemWithSeq }
    | { type: 'combo'; index: number; count: number; emoteKey: string; source: string; tsMs: number }

  const renderList = useMemo((): RenderEntry[] => {
    const list: RenderEntry[] = []
    const comboSkip = new Set<number>()
    const comboAt = new Map<number, { count: number; emoteKey: string; source: string; tsMs: number }>()

    const sources = ['dgg', 'kick', 'youtube', 'twitch'] as const
    for (const source of sources) {
      const indices = displayItems
        .map((m, i) => (m.source === source ? i : -1))
        .filter((i) => i >= 0)
      if (indices.length === 0) continue
      let runStart = 0
      let runEmoteKey: string | null = null
      for (let j = 0; j <= indices.length; j++) {
        const idx = j < indices.length ? indices[j]! : -1
        const m = idx >= 0 ? displayItems[idx] : undefined
        const key = m && isSingleEmoteMessage(m, emotesMap) ? getEmoteKey(m, emotesMap) : null
        const sameRun = key != null && key === runEmoteKey
        if (sameRun && j < indices.length) continue
        if (runEmoteKey != null && runStart < j) {
          const runLength = j - runStart
          if (runLength >= 2) {
            const lastIdx = indices[j - 1]!
            const lastItem = displayItems[lastIdx]!
            for (let k = runStart; k < j - 1; k++) comboSkip.add(indices[k]!)
            comboAt.set(lastIdx, {
              count: runLength,
              emoteKey: runEmoteKey,
              source,
              tsMs: lastItem.tsMs,
            })
          }
        }
        if (j < indices.length && key != null) {
          runStart = j
          runEmoteKey = key
        } else {
          runEmoteKey = null
        }
      }
    }

    for (let i = 0; i < displayItems.length; i++) {
      if (comboSkip.has(i)) continue
      const combo = comboAt.get(i)
      if (combo) {
        list.push({ type: 'combo', index: i, count: combo.count, emoteKey: combo.emoteKey, source: combo.source, tsMs: combo.tsMs })
      } else {
        list.push({ type: 'message', index: i, item: displayItems[i] })
      }
    }
    return list
  }, [displayItems, emotesMap])

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

  const onOpenLink = onOpenLinkProp ?? ((url: string) => {
    window.ipcRenderer.invoke('link-scroller-handle-link', { url, action: 'browser' }).catch(() => {})
  })

  const sendDggMessage = useCallback(() => {
    const text = dggInputValue.trim()
    if (!text) return
    // Conversation with one user: send whisper to that user
    if (activeWhisperUsername) {
      setWhisperSendError(null)
      window.ipcRenderer
        .invoke('dgg-send-whisper', { recipient: activeWhisperUsername, message: text })
        .then((result: { success?: boolean; error?: string }) => {
          if (result?.success) {
            setDggInputValue('')
            setWhisperSendError(null)
            window.ipcRenderer.invoke('dgg-messages-inbox', { username: activeWhisperUsername }).then((r: { success?: boolean; data?: DggInboxMessage[] }) => {
              if (r?.success && Array.isArray(r.data)) setInboxMessages(r.data)
            }).catch(() => {})
          } else {
            setWhisperSendError(result?.error ?? 'Send failed')
          }
        })
        .catch((err) => {
          setWhisperSendError(err instanceof Error ? err.message : 'Send failed')
        })
      return
    }
    // List view: send whisper, then GET /api/messages/usr/:username/inbox. Only add to list and open conversation when that inbox fetch succeeds.
    const recipient = composeRecipient.trim()
    if (privViewOpen) {
      if (!recipient) return
      setWhisperSendError(null)
      window.ipcRenderer.invoke('dgg-send-whisper', { recipient, message: text }).catch(() => {})
      window.ipcRenderer
        .invoke('dgg-messages-inbox', { username: recipient })
        .then((r: { success?: boolean; data?: DggInboxMessage[] }) => {
          if (r?.success) {
            setDggInputValue('')
            setWhisperSendError(null)
            setComposeRecipient('')
            setWhisperUsernames((prev) => {
              const next = prev.includes(recipient) ? prev : [...prev, recipient]
              try { localStorage.setItem(DGG_WHISPER_USERS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
              return next
            })
            setActiveWhisperUsername(recipient)
          } else {
            setDggInputValue('')
            setComposeRecipient('')
          }
        })
        .catch(() => {
          setDggInputValue('')
          setComposeRecipient('')
        })
      return
    }
    // Public chat
    window.ipcRenderer.invoke('chat-websocket-send', { data: text }).then((result: { success?: boolean }) => {
      if (result?.success) setDggInputValue('')
    }).catch(() => {})
  }, [dggInputValue, activeWhisperUsername, privViewOpen, composeRecipient])

  const onDggInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendDggMessage()
    }
  }, [sendDggMessage])

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (el) {
      programmaticScrollRef.current = true
      el.scrollTop = el.scrollHeight
      wasAtBottomRef.current = true
      setShowMoreMessagesBelow(false)
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false
      })
    }
  }, [])

  const handlePollVote = useCallback((optionIndex: number) => {
    setPollVoteError(null)
    setVotePending(true)
    try {
      window.ipcRenderer?.invoke('log-to-file', 'info', '[CombinedChat] Poll vote sent', [{ option: optionIndex }])
    } catch {
      // ignore
    }
    window.ipcRenderer
      .invoke('chat-websocket-cast-poll-vote', { option: optionIndex })
      .catch((err) => {
        setVotePending(false)
        setPollVoteError('Send failed')
        try {
          window.ipcRenderer?.invoke('log-to-file', 'warn', '[CombinedChat] Poll vote send failed', [String(err)])
        } catch {
          // ignore
        }
      })
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="relative flex-1 min-h-0 flex flex-col">
        {enableDgg && pinnedMessage && !pinnedHidden && (
          <div className="absolute top-0 left-0 right-0 z-10 p-2 pointer-events-none">
            <div
              id="chat-pinned-message"
              className="active bg-base-300 rounded-lg shadow-sm pointer-events-auto"
            >
              <div
                id="chat-pinned-show-btn"
                className="hidden"
                title="Show Pinned Message"
              />
              <div
                className="msg-chat msg-pinned text-sm rounded-md flex flex-nowrap items-start gap-2 bg-base-100 m-2 p-2"
                data-username={pinnedMessage.nick}
                id="msg-pinned"
              >
                <button
                  id="close-pin-btn"
                  type="button"
                  className="chat-tool-btn btn btn-ghost btn-xs btn-circle shrink-0 text-base-content/80 hover:text-base-content hover:bg-base-200"
                  title="Close Pinned Message"
                  onClick={() => setPinnedHidden(true)}
                  aria-label="Close pinned message"
                >
                  <span className="text-lg leading-none select-none">×</span>
                </button>
                {showTimestamps && (
                  <time
                    className="time text-base-content/60 text-xs shrink-0"
                    title={pinnedMessage.createdDate ?? new Date(pinnedMessage.timestamp).toLocaleString()}
                    data-unixtimestamp={pinnedMessage.timestamp}
                  >
                    {new Date(pinnedMessage.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                )}
                <span className="flex-1 min-w-0">
                  <span className="font-semibold shrink-0" style={{ color: omniColorForKey('dgg') }}>
                    {pinnedMessage.nick}
                  </span>
                  <span className="ctrl">: </span>
                  <span className="text whitespace-pre-wrap break-words">
                    {renderTextWithLinks(pinnedMessage.data ?? '', emotePattern, emotesMap, onOpenLink)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}
        {enableDgg && pinnedMessage && pinnedHidden && (
          <div
            id="chat-pinned-show-btn"
            className="active absolute top-2 right-2 z-20 btn btn-ghost btn-sm btn-circle text-base"
            title="Show Pinned Message"
            onClick={() => setPinnedHidden(false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setPinnedHidden(false)}
            aria-label="Show pinned message"
          >
            <span aria-hidden>📍</span>
          </div>
        )}
        {enableDgg && currentPoll && (
          <div className="flex-shrink-0 p-2">
            {votePending && (
              <div className="text-xs text-base-content/70 mb-1">Sending vote…</div>
            )}
            {pollVoteError && (
              <div className="text-xs text-warning mb-1" role="alert">
                {pollVoteError}
              </div>
            )}
            <PollView
              poll={currentPoll}
              pollOver={pollOver}
              serverOffsetMs={pollServerOffsetMs}
              onVote={handlePollVote}
              onDismiss={handlePollDismiss}
              onPollTimeExpired={() => setPollOver(true)}
              votePending={votePending}
            />
          </div>
        )}
        <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {privViewOpen ? (
          activeWhisperUsername ? (
            /* Inbox conversation with one user */
            <>
              <div className="sticky top-0 z-10 flex items-center gap-2 mb-2 pb-2 border-b border-base-300 bg-base-100/95 backdrop-blur-sm">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setActiveWhisperUsername(null); setInboxMessages(null); setWhisperSendError(null) }}
                  aria-label="Back to list"
                >
                  ← Back
                </button>
                <span className="font-semibold">{activeWhisperUsername}</span>
              </div>
              {whisperSendError && (
                <div className="text-xs text-warning mb-2" role="alert">
                  {whisperSendError}
                </div>
              )}
              {inboxMessages === null ? (
                <div className="text-sm text-base-content/50">Loading…</div>
              ) : inboxMessages.length === 0 ? (
                <div className="text-sm text-base-content/50">No messages yet.</div>
              ) : (
                <div className="flex flex-col justify-end min-h-full space-y-2">
                  {[...inboxMessages]
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                    .map((msg) => {
                      const isFromThem = msg.from.toLowerCase() === activeWhisperUsername?.toLowerCase()
                      const ts = formatWhisperTimestamp(msg.timestamp ?? '')
                      return (
                        <div
                          key={msg.id}
                          className={`msg-chat text-sm rounded-md px-2 py-1 ${isFromThem ? 'bg-base-300' : 'bg-primary/15'}`}
                        >
                          {ts ? <span className="text-xs text-base-content/50 mr-2">{ts}</span> : null}
                          <span className="font-semibold mr-2">{msg.from}</span>
                          <span className="whitespace-pre-wrap break-words inline-flex flex-wrap items-baseline gap-0.5">
                            {renderTextWithLinks(msg.message ?? '', emotePattern, emotesMap, onOpenLink)}
                          </span>
                        </div>
                      )
                    })}
                </div>
              )}
            </>
          ) : (
            /* List of users who have whispered us */
            <>
              <div className="flex items-center gap-2 mb-2 pb-2 border-b border-base-300">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPrivViewOpen(false)}
                  aria-label="Back to chat"
                >
                  ← Back to chat
                </button>
                <span className="font-semibold">Private messages</span>
              </div>
              {whisperUsernames.length === 0 ? (
                <div className="text-sm text-base-content/50">No private messages yet.</div>
              ) : (
                <ul className="space-y-1" style={{ listStyle: 'none' }}>
                  {whisperUsernames.map((username) => (
                    <li
                      key={username}
                      role="button"
                      tabIndex={0}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-base-300 group cursor-pointer"
                      onClick={() => setActiveWhisperUsername(username)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveWhisperUsername(username) } }}
                    >
                      <span className="flex-1 min-w-0 font-medium truncate inline-flex items-center gap-2">
                        {unreadUsernames.has(username) ? (
                          <span className="inline-flex items-center gap-1">
                            <span aria-hidden>📬</span>
                            {username}
                          </span>
                        ) : (
                          username
                        )}
                        {(unreadCounts[username] ?? 0) > 0 && (
                          <span className="text-xs text-base-content/70 tabular-nums" aria-label={`${unreadCounts[username]} unread`}>
                            ({unreadCounts[username]})
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs opacity-0 group-hover:opacity-100"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); removeWhisperUsername(username) }}
                        title="Remove from list"
                        aria-label={`Remove ${username} from list`}
                      >
                        Clear
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )
        ) : (
        <>
        {renderList.map((entry) => {
          if (entry.type === 'message') {
            const m = entry.item
            const ts = Number.isFinite(m.tsMs) ? new Date(m.tsMs).toLocaleTimeString() : ''
            const colorKey =
              m.source === 'dgg'
                ? 'dgg'
                : m.source === 'kick'
                  ? `kick:${m.slug}`
                  : m.source === 'youtube'
                    ? `youtube:${m.videoId}`
                    : `twitch:${m.channel}`
            const displayName = getEmbedDisplayName(colorKey)
            const accent =
              m.source === 'dgg'
                ? omniColorForKey(colorKey)
                : omniColorForKey(colorKey, { displayName })
            const badgeText = textColorOn(accent)
            const term = highlightTerm?.trim() ?? ''
            const isHighlighted =
              term.length > 0 && (m.content?.toLowerCase().includes(term.toLowerCase()) ?? false)
            return (
              <div
                key={`msg-${entry.index}-${m.source}-${m.tsMs}-${m.nick}`}
                className={`text-sm leading-snug rounded-md px-2 py-1 -mx-2 -my-0.5 ${isHighlighted ? 'bg-blue-500/15' : ''}`}
              >
                {showTimestamps ? <span className="text-xs text-base-content/50 mr-2">{ts}</span> : null}
                {showSourceLabels ? (
                  <span
                    className="badge badge-sm mr-2 align-middle"
                    style={{ backgroundColor: accent, borderColor: accent, color: badgeText }}
                  >
                    {m.source === 'dgg'
                      ? 'DGG'
                      : (displayName ||
                          (m.source === 'kick'
                            ? `K:${m.slug}`
                            : m.source === 'youtube'
                              ? `Y:${m.videoId}`
                              : `T:${m.channel}`))}
                  </span>
                ) : null}
                <span className="font-semibold mr-2" style={{ color: accent }}>
                  {m.nick}
                </span>
                <span className="whitespace-pre-wrap break-words">
                  {m.source === 'dgg' ? (
                    <span
                      className="msg-chat"
                      style={{ position: 'relative', display: 'inline', overflow: 'visible' }}
                    >
                      {renderTextWithLinks(m.content ?? '', emotePattern, emotesMap, onOpenLink)}
                    </span>
                  ) : m.source === 'kick'
                    ? renderKickContent(m.raw, onOpenLink)
                    : m.source === 'youtube'
                      ? renderYouTubeContent(m.raw, onOpenLink)
                      : renderTextWithLinks(m.content ?? '', null, new Map(), onOpenLink)}
                </span>
              </div>
            )
          }
          const { count, emoteKey, source, tsMs } = entry
          const ts = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleTimeString() : ''
          const isDgg = source === 'dgg'
          const colorKey = isDgg ? 'dgg' : 'kick'
          const displayName = getEmbedDisplayName(colorKey)
          const accent = isDgg ? omniColorForKey('dgg') : omniColorForKey(colorKey, { displayName })
          const badgeText = textColorOn(accent)
          const prefix = isDgg ? emoteKey : null
          const kickParts = !isDgg && emoteKey.startsWith('kick:') ? emoteKey.slice(5).split(':') : []
          const kickId = kickParts.length >= 1 ? Number(kickParts[0]) : 0
          const kickName = kickParts.length >= 2 ? kickParts.slice(1).join(':') : undefined
          return (
            <div
              key={`combo-${entry.index}-${source}-${emoteKey}-${count}`}
              className="msg-chat msg-emote text-sm leading-snug rounded-md px-2 py-1 -mx-2 -my-0.5 flex flex-wrap items-center gap-2"
              data-combo={count}
            >
              {showTimestamps ? <span className="text-xs text-base-content/50">{ts}</span> : null}
              {showSourceLabels ? (
                <span
                  className="badge badge-sm align-middle"
                  style={{ backgroundColor: accent, borderColor: accent, color: badgeText }}
                >
                  {source === 'dgg' ? 'DGG' : displayName || 'Kick'}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1 shrink-0">
                {isDgg && prefix ? (
                  <div
                    className={`emote ${prefix}`}
                    title={prefix}
                    role="img"
                    aria-label={prefix}
                  />
                ) : Number.isFinite(kickId) && kickId > 0 ? (
                  renderKickEmote(kickId, kickName, `combo-kick-${entry.index}`)
                ) : null}
              </span>
              <span className="chat-combo combo-complete inline-flex items-center gap-1 text-base-content/70 text-xs">
                <i className="count font-semibold">{count}</i>
                <i className="x">×</i>
                <i className="hit">Hits</i>
                <i className="combo font-semibold text-primary">C-C-C-COMBO</i>
              </span>
            </div>
          )
        })}
        </>
        )}
        {!privViewOpen && showMoreMessagesBelow && (
          <div className="chat-scroll-notify absolute bottom-0 left-0 right-0 z-10 p-2 pointer-events-none">
            <div
              className="text-sm text-center text-primary font-medium hover:underline rounded-lg bg-base-300 shadow-sm m-2 p-2 cursor-pointer pointer-events-auto hover:bg-base-200"
              onClick={scrollToBottom}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && scrollToBottom()}
            >
              More messages below
            </div>
          </div>
        )}
        </div>
      </div>
      {enableDgg && showDggInput && dggAuthenticated && (
        <div className="flex flex-col gap-1 min-w-0 flex-none">
          {privViewOpen && !activeWhisperUsername && (
            <>
              {whisperSendError && (
                <div className="text-xs text-warning px-1" role="alert">
                  {whisperSendError}
                </div>
              )}
              <div className="relative min-w-0">
                <input
                  ref={composeRecipientInputRef}
                  type="text"
                  value={composeRecipient}
                  onChange={(e) => { setComposeRecipient(e.target.value); setComposeRecipientDropdownOpen(true) }}
                  onFocus={() => setComposeRecipientDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setComposeRecipientDropdownOpen(false), 150)}
                  placeholder="Whisper To"
                  className="input input-bordered input-sm w-full"
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={composeRecipientDropdownOpen && composeRecipientSuggestions.length > 0}
                  aria-controls="compose-recipient-list"
                  id="compose-recipient-input"
                />
                {composeRecipientDropdownOpen && composeRecipientSuggestions.length > 0 && (
                  <ul
                    id="compose-recipient-list"
                    role="listbox"
                    className="absolute z-20 left-0 right-0 bottom-full mb-1 max-h-48 overflow-y-auto rounded-md border border-base-300 bg-base-100 shadow-lg py-1"
                  >
                    {composeRecipientSuggestions.map((nick) => (
                      <li
                        key={nick}
                        role="option"
                        className="px-3 py-2 cursor-pointer hover:bg-base-300 text-sm truncate"
                        onMouseDown={(e) => { e.preventDefault(); setComposeRecipient(nick); setComposeRecipientDropdownOpen(false); composeRecipientInputRef.current?.blur() }}
                      >
                        {nick}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <div className="flex items-center gap-1 min-w-0 flex-1">
          <div className="flex-1 min-w-0">
            <DggInputBar
            ref={mergedDggInputRef}
            value={dggInputValue}
            onChange={setDggInputValue}
            onSend={sendDggMessage}
            onKeyDown={onDggInputKeyDown}
            disabled={privViewOpen && !activeWhisperUsername ? !dggConnected || !composeRecipient.trim() : !dggConnected}
            emotesMap={emotesMap}
            dggNicks={dggNicks}
            placeholder={
              activeWhisperUsername
                ? (dggConnected ? `Whisper ${activeWhisperUsername}...` : 'Connecting...')
                : privViewOpen
                  ? (dggConnected ? 'whisper message..' : 'Connecting...')
                  : (dggConnected ? 'Message destiny.gg...' : 'Connecting...')
            }
            shortcutLabel={dggConnected ? focusShortcutLabel : undefined}
          />
          </div>
          <button
            type="button"
            className={`btn btn-ghost btn-sm shrink-0 min-w-0 w-8 h-8 p-0 flex items-center justify-center text-base relative ${(whisperUsernames.length > 0 || privViewOpen) ? 'opacity-100' : 'opacity-50'}`}
            title={privViewOpen ? 'Back to chat' : totalUnread > 0 ? `Private messages (${totalUnread} unread)` : 'Private messages'}
            aria-label={privViewOpen ? 'Back to chat' : 'Private messages'}
            disabled={false}
            onClick={() => {
              setPrivViewOpen((prev) => {
                if (prev) {
                  setActiveWhisperUsername(null)
                  setInboxMessages(null)
                  setWhisperSendError(null)
                }
                return !prev
              })
            }}
          >
            {totalUnread > 0 ? '📬' : '📫'}
            {totalUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 flex items-center justify-center text-[10px] font-medium rounded-full bg-primary text-primary-content" aria-hidden>
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>
          </div>
        </div>
      )}
    </div>
  )
}

