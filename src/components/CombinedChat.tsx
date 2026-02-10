import { type ReactNode, useCallback, forwardRef, Fragment, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { omniColorForKey, textColorOn } from '../utils/omniColors'
import PollView, { type PollData } from './PollView'
import dggPlatformIcon from '../assets/icons/third-party/platforms/dgg.png'
import kickPlatformIcon from '../assets/icons/third-party/platforms/kick-favicon.ico'
import youtubePlatformIcon from '../assets/icons/third-party/platforms/youtube-favicon.ico'
import twitchPlatformIcon from '../assets/icons/third-party/platforms/twitch-favicon.png'

const PLATFORM_ICONS: Record<string, string> = {
  dgg: dggPlatformIcon,
  kick: kickPlatformIcon,
  youtube: youtubePlatformIcon,
  twitch: twitchPlatformIcon,
}

function getPlatformIcon(colorKey: string): string | undefined {
  if (colorKey === 'dgg') return PLATFORM_ICONS.dgg
  if (colorKey.startsWith('kick:')) return PLATFORM_ICONS.kick
  if (colorKey.startsWith('youtube:')) return PLATFORM_ICONS.youtube
  if (colorKey.startsWith('twitch:')) return PLATFORM_ICONS.twitch
  return undefined
}

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
/** Broadcast payload from DGG (BROADCAST {...}). */
interface DggBroadcastPayload {
  timestamp: number
  nick: string
  data: string
  user: { id: number; nick: string; roles: string[]; features: string[]; createdDate: string | null }
  uuid: string
}
type DggChatWsHistory = {
  type: 'HISTORY'
  messages: DggChatMessage[]
  /** When set, MSG and BROADCAST in order for correct timeline. */
  items?: Array<{ type: 'MSG'; message: DggChatMessage } | { type: 'BROADCAST'; broadcast: DggBroadcastPayload }>
}

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

/** DGG flair (from flairs.json): used for nickname color and flair icons. */
interface DggFlair {
  name: string
  label: string
  priority: number
  color?: string
  rainbowColor?: boolean
  hidden?: boolean
  image?: Array<{ url: string; name: string; height: number; width: number }>
}

/** Highest-priority flair with a color for the user's features (mirrors chat-gui usernameColorFlair). */
function usernameColorFlair(flairs: DggFlair[], user: { features?: string[] }): DggFlair | undefined {
  if (!Array.isArray(user.features) || user.features.length === 0) return undefined
  return flairs
    .filter((flair) => user.features!.some((f) => f === flair.name))
    .sort((a, b) => a.priority - b.priority)
    .find((f) => f.rainbowColor || f.color)
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
  onEmoteDoubleClick?: (prefix: string) => void,
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
        className={`emote ${matchedPrefix} ${onEmoteDoubleClick ? 'cursor-pointer' : ''}`}
        title={onEmoteDoubleClick ? `${matchedPrefix} (double-click to insert)` : matchedPrefix}
        role="img"
        aria-label={matchedPrefix}
        onDoubleClick={
          onEmoteDoubleClick
            ? (e) => {
                e.preventDefault()
                e.stopPropagation()
                onEmoteDoubleClick(matchedPrefix)
              }
            : undefined
        }
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
  onEmoteDoubleClick?: (prefix: string) => void,
): (string | JSX.Element)[] {
  const lines = text.split('\n')
  const parts: (string | JSX.Element)[] = []
  let keyCounter = baseKey

  lines.forEach((line, lineIndex) => {
    const isGreentext = line.trim().startsWith('>')

    const processedLine = processTextWithEmotes(line, emotePattern, emotesMap, keyCounter, onEmoteDoubleClick)
    processedLine.forEach((part) => {
      if (!isGreentext) {
        parts.push(part)
        keyCounter++
        return
      }

      // Mimic DGG greentext styling (color, font); font size inherits; line-height inline so it wins.
      parts.push(
        <span
          key={`greentext-${keyCounter++}`}
          className="msg-chat-greentext"
          style={{
            color: 'rgb(108, 165, 40)',
            fontFamily: '"Roboto", Helvetica, "Trebuchet MS", Verdana, sans-serif',
            boxSizing: 'border-box',
            textRendering: 'optimizeLegibility',
            overflowWrap: 'break-word',
            lineHeight: 1.6,
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
  onEmoteDoubleClick?: (prefix: string) => void,
  skipGreentext?: boolean,
): JSX.Element {
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasLinks = false
  let keyCounter = 0
  const processSegment = skipGreentext
    ? (seg: string) => processTextWithEmotes(seg, emotePattern, emotesMap, keyCounter, onEmoteDoubleClick)
    : (seg: string) => processGreentext(seg, emotePattern, emotesMap, keyCounter, onEmoteDoubleClick)

  while ((match = LINK_REGEX.exec(text)) !== null) {
    hasLinks = true
    if (match.index > lastIndex) {
      const textSegment = text.substring(lastIndex, match.index)
      const processedSegment = processSegment(textSegment)
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
    const processedSegment = processSegment(textSegment)
    processedSegment.forEach((part) => {
      parts.push(part)
      keyCounter++
    })
  }

  if (!hasLinks) {
    const processedSegment = processSegment(text)
    return <>{processedSegment}</>
  }

  return <>{parts}</>
}

/** Plain text used for highlight-term matching only (excludes emote names so "destiny" doesn't match "destinycool" emote). */
function getContentForHighlight(m: CombinedItem): string {
  if (m.source === 'dgg' || m.source === 'dgg-broadcast') return m.content ?? ''
  if (m.source === 'kick') {
    const raw = (m as any).raw?.content ?? m.content ?? ''
    return String(raw).replace(/\[emote:\d+:[^\]]+\]/g, '')
  }
  if (m.source === 'youtube') {
    const runs = (m as any).raw?.runs
    if (Array.isArray(runs)) {
      return runs
        .filter((r: any) => r && 'text' in r && typeof r.text === 'string')
        .map((r: any) => r.text)
        .join('')
    }
    return m.content ?? ''
  }
  return m.content ?? ''
}

/** Segment type for DGG message content: plain text or a mentioned nick. */
type DggContentSegment = { type: 'text'; value: string } | { type: 'nick'; value: string }

/** Split a non-link string into text and nick segments. Nicks match only as whole words (not inside other words). */
function tokenizeNicksInText(text: string, re: RegExp): DggContentSegment[] {
  const segments: DggContentSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  re.lastIndex = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'nick', value: match[1]! })
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments.length ? segments : [{ type: 'text', value: text }]
}

/** Split DGG message content into text and nick segments. Nicks are only matched outside of links, and only as whole words (not inside other words). */
function tokenizeDggContent(content: string, nicks: string[]): DggContentSegment[] {
  if (!content) return [{ type: 'text', value: '' }]
  if (nicks.length === 0) return [{ type: 'text', value: content }]
  const sorted = [...nicks].filter((n) => n.length > 0).sort((a, b) => b.length - a.length)
  const escaped = sorted.map((n) => escapeRegexLiteral(n))
  /* Whole-word only: not preceded/followed by word char (so "John" in "Johnny" or "someJohn" does not match) */
  const nickRe = new RegExp(`(?<!\\w)(${escaped.join('|')})(?!\\w)`, 'gi')
  const segments: DggContentSegment[] = []
  let lastIndex = 0
  let linkMatch: RegExpExecArray | null
  LINK_REGEX.lastIndex = 0
  while ((linkMatch = LINK_REGEX.exec(content)) !== null) {
    const textBeforeLink = content.slice(lastIndex, linkMatch.index)
    if (textBeforeLink.length > 0) {
      segments.push(...tokenizeNicksInText(textBeforeLink, nickRe))
    }
    segments.push({ type: 'text', value: linkMatch[0] })
    lastIndex = linkMatch.index + linkMatch[0].length
  }
  if (lastIndex < content.length) {
    segments.push(...tokenizeNicksInText(content.slice(lastIndex), nickRe))
  }
  return segments.length ? segments : [{ type: 'text', value: content }]
}

const SCROLL_THRESHOLD_PX = 40
const DGG_AUTOCOMPLETE_LIMIT = 20
/** Base height for YouTube/Kick/Twitch inline emotes. 25% larger than previous 18px for readability. */
const THIRD_PARTY_EMOTE_HEIGHT_PX = 23

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

/** @-mode: fragment starts with @ → user search only (strip @ for match). Otherwise emote search only. */
function getAutocompleteSuggestions(
  fragment: string,
  emotesMap: Map<string, string>,
  dggNicks: string[]
): string[] {
  if (!fragment) return []
  const isUserSearch = fragment.startsWith('@')
  const search = (isUserSearch ? fragment.slice(1) : fragment).trim().toLowerCase()
  if (!search && !isUserSearch) return []
  if (isUserSearch) {
    const nicks = dggNicks.filter((n) => n.toLowerCase().startsWith(search))
    return nicks.slice(0, DGG_AUTOCOMPLETE_LIMIT)
  }
  const emotes: string[] = []
  emotesMap.forEach((_, prefix) => {
    if (prefix.toLowerCase().startsWith(search)) emotes.push(prefix)
  })
  return emotes.slice(0, DGG_AUTOCOMPLETE_LIMIT)
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
  /** When true, render autocomplete dropdown in a portal with fixed position (avoids clipping in overlay mode; keeps dropdown on-screen). */
  dropdownInPortal?: boolean
}

const HISTORY_MAX = 50

const DROPDOWN_MAX_H = 192
const DROPDOWN_MARGIN = 8

const DggInputBar = forwardRef<HTMLTextAreaElement, DggInputBarProps>(function DggInputBar(
  { value, onChange, onSend, onKeyDown, disabled, emotesMap, dggNicks, placeholder, shortcutLabel, dropdownInPortal = false },
  ref
) {
  const [cursorPosition, setCursorPosition] = useState(0)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const [lastInsertedWord, setLastInsertedWord] = useState<string | null>(null)
  const [lastSuggestions, setLastSuggestions] = useState<string[]>([])
  const [messageHistory, setMessageHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyIndexRef = useRef(-1)
  const [focused, setFocused] = useState(false)
  const savedCurrentRef = useRef('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [portalPosition, setPortalPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  if (historyIndexRef.current !== historyIndex) historyIndexRef.current = historyIndex
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
      // Message history takes precedence over autocomplete: when browsing history or at start/end, ArrowUp/ArrowDown navigate history
      if (messageHistory.length > 0) {
        const inHistory = historyIndexRef.current >= 0
        const atStart = cursor === 0
        const atEnd = cursor === value.length
        if (e.key === 'ArrowUp' && (inHistory || atStart)) {
          e.preventDefault()
          setHistoryIndex((prev) => {
            const next = prev === -1 ? messageHistory.length - 1 : Math.max(0, prev - 1)
            if (prev === -1) savedCurrentRef.current = value
            onChange(messageHistory[next] ?? '')
            historyIndexRef.current = next
            return next
          })
          setHighlightIndex(-1)
          setLastInsertedWord(null)
          return
        }
        if (e.key === 'ArrowDown' && (inHistory || atEnd)) {
          e.preventDefault()
          setHistoryIndex((prev) => {
            if (prev === -1) return -1
            const next = prev >= messageHistory.length - 1 ? -1 : prev + 1
            if (next === -1) onChange(savedCurrentRef.current)
            else onChange(messageHistory[next] ?? '')
            historyIndexRef.current = next
            return next
          })
          setHighlightIndex(-1)
          setLastInsertedWord(null)
          return
        }
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
        setHistoryIndex(-1)
        historyIndexRef.current = -1
        setHighlightIndex(-1)
        setLastInsertedWord(null)
        const trimmed = value.trim()
        if (trimmed) {
          setMessageHistory((prev) => [...prev.slice(-(HISTORY_MAX - 1)), trimmed])
        }
        onSend()
        e.preventDefault()
        return
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

  useLayoutEffect(() => {
    if (!dropdownInPortal || !showDropdown || !inputRef.current) {
      setPortalPosition(null)
      return
    }
    const el = inputRef.current
    const rect = el.getBoundingClientRect()
    const margin = DROPDOWN_MARGIN
    const spaceAbove = rect.top - margin
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const preferAbove = spaceAbove >= Math.min(spaceBelow, 80)
    let top: number
    let maxHeight: number
    if (preferAbove && spaceAbove >= margin) {
      maxHeight = Math.min(DROPDOWN_MAX_H, spaceAbove - 4)
      top = rect.top - 4 - maxHeight
      if (top < margin) {
        top = margin
        maxHeight = rect.top - 4 - margin
      }
    } else {
      top = rect.bottom + 4
      maxHeight = Math.min(DROPDOWN_MAX_H, window.innerHeight - rect.bottom - 4 - margin)
    }
    const left = Math.max(margin, rect.left)
    const right = Math.min(window.innerWidth - margin, rect.right)
    const width = Math.max(0, right - left)
    setPortalPosition({ top, left, width, maxHeight })
  }, [dropdownInPortal, showDropdown, suggestions.length])

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
    <div className="chat-input-bar flex-none border-t border-base-300 bg-base-200 flex items-center gap-2 relative shrink-0">
      <div className="flex-1 min-w-0 relative flex flex-col">
        {shortcutLabel ? (
          <div className="input input-sm input-bordered flex flex-1 min-w-0 items-center gap-2 overflow-hidden w-full">
            {inputContent}
          </div>
        ) : (
          inputContent
        )}
        {showDropdown && !dropdownInPortal && (
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
                  className={`px-2 py-1 text-sm cursor-pointer flex items-center min-h-[28px] w-full ${isEmote ? 'justify-between gap-2' : ''} ${idx === highlightIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    replaceWordWith(s, start, end)
                    setHighlightIndex(-1)
                  }}
                >
                  {isEmote ? (
                    <>
                      <span className="min-w-0 truncate">{s}</span>
                      <div
                        className={`emote ${s} shrink-0`}
                        title={s}
                        role="img"
                        aria-label={s}
                      />
                    </>
                  ) : (
                    <span>{s}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {showDropdown && dropdownInPortal && portalPosition && createPortal(
          <ul
            className="dgg-autocomplete-list py-1 bg-base-300 border border-base-300 rounded-md shadow-lg overflow-y-auto z-[100]"
            style={{
              listStyle: 'none',
              position: 'fixed',
              top: portalPosition.top,
              left: portalPosition.left,
              width: portalPosition.width,
              maxHeight: portalPosition.maxHeight,
            }}
          >
            {suggestions.map((s, idx) => {
              const isEmote = emotesMap.has(s)
              return (
                <li
                  key={s}
                  data-index={idx}
                  className={`px-2 py-1 text-sm cursor-pointer flex items-center min-h-[28px] w-full ${isEmote ? 'justify-between gap-2' : ''} ${idx === highlightIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-200'}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    replaceWordWith(s, start, end)
                    setHighlightIndex(-1)
                  }}
                >
                  {isEmote ? (
                    <>
                      <span className="min-w-0 truncate">{s}</span>
                      <div
                        className={`emote ${s} shrink-0`}
                        title={s}
                        role="img"
                        aria-label={s}
                      />
                    </>
                  ) : (
                    <span>{s}</span>
                  )}
                </li>
              )
            })}
          </ul>,
          document.body
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
  | {
      source: 'dgg-event'
      eventType: 'giftsub' | 'massgift' | 'donation'
      tsMs: number
      nick: string
      content: string
      raw: unknown
      isHistory?: boolean
    }
  | {
      source: 'dgg-system'
      kind: 'mute' | 'ban' | 'unmute'
      tsMs: number
      content: string
      raw: unknown
      isHistory?: boolean
    }
  | {
      source: 'dgg-broadcast'
      tsMs: number
      nick: string
      content: string
      raw: DggBroadcastPayload
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
      style={{ height: THIRD_PARTY_EMOTE_HEIGHT_PX, width: 'auto' }}
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

  const parts: React.ReactNode[] = []
  runs.forEach((run, i) => {
    if ('text' in run && run.text) {
      parts.push(
        <Fragment key={`yt-txt-${i}`}>
          {renderTextWithLinks(run.text, null, new Map(), onOpenLink)}
        </Fragment>,
      )
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
          style={{ height: THIRD_PARTY_EMOTE_HEIGHT_PX, width: 'auto', verticalAlign: 'middle' }}
        />,
      )
    }
  })
  return parts.length ? <>{parts}</> : (() => {
    const raw = msg.message ?? ''
    return raw ? renderTextWithLinks(raw, null, new Map(), onOpenLink) : ''
  })()
}

/** Optional config for right-click context menu on the message area (toggle chat options). */
export type CombinedChatContextMenuConfig = {
  display: {
    showTimestamps: boolean
    setShowTimestamps: (v: boolean) => void
    showLabels: boolean
    setShowLabels: (v: boolean) => void
    showPlatformIcons: boolean
    setShowPlatformIcons: (v: boolean) => void
    showDggFlairsAndColors: boolean
    setShowDggFlairsAndColors: (v: boolean) => void
  }
  order: { sortMode: 'timestamp' | 'arrival'; setSortMode: (v: 'timestamp' | 'arrival') => void }
  emotes: { pauseOffScreen: boolean; setPauseOffScreen: (v: boolean) => void }
  linkAction: { value: 'none' | 'clipboard' | 'browser' | 'viewer'; setValue: (v: 'none' | 'clipboard' | 'browser' | 'viewer') => void }
  /** Chat pane side: left or right. */
  paneSide: { value: 'left' | 'right'; setPaneSide: (v: 'left' | 'right') => void }
  dgg?: { showInput: boolean; setShowInput: (v: boolean) => void }
  highlightTerms?: string[]
  addHighlightTerm?: (term: string) => void
  removeHighlightTerm?: (term: string) => void
}

/** Parse optional DGG label color (hex or rgb(r,g,b)) to hex; return undefined to use theme default. */
function parseDggLabelColor(value: string | undefined): string | undefined {
  if (!value || !value.trim()) return undefined
  const v = value.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v
  const rgb = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (rgb) {
    const r = Math.max(0, Math.min(255, parseInt(rgb[1], 10)))
    const g = Math.max(0, Math.min(255, parseInt(rgb[2], 10)))
    const b = Math.max(0, Math.min(255, parseInt(rgb[3], 10)))
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  return undefined
}

export default function CombinedChat({
  enableDgg,
  showDggInput = true,
  getEmbedDisplayName,
  getEmbedColor,
  getEmbedLabelHidden,
  dggLabelColor,
  dggLabelText = 'dgg',
  maxMessages,
  maxMessagesScroll = 5000,
  showTimestamps,
  showSourceLabels,
  showPlatformIcons = false,
  sortMode,
  highlightTerms = [],
  pauseEmoteAnimationsOffScreen = false,
  showDggFlairsAndColors = true,
  contextMenuConfig,
  onCountChange,
  onDggUserCountChange,
  onOpenLink: onOpenLinkProp,
  dggInputRef: dggInputRefProp,
  dggChatActionsRef: dggChatActionsRefProp,
  focusShortcutLabel,
  overlayMode = false,
  overlayOpacity = 0.85,
  messagesClickThrough = false,
  overlayHeaderHeight,
  inputContainerRef,
  contextMenuRef,
}: {
  enableDgg: boolean
  /** When false, DGG chat input is hidden. When true, shown only when authenticated (ME received). */
  showDggInput?: boolean
  /** Lookup display name for a channel key (e.g. youtube:videoId); canonicalizes key so casing matches. */
  getEmbedDisplayName: (key: string) => string
  /** Optional: color for embed channel in combined chat (hex). When set, used for non-DGG message accent. */
  getEmbedColor?: (key: string, displayName?: string) => string
  /** Optional: when true for an embed key, hide the source label (badge) for that message. */
  getEmbedLabelHidden?: (key: string) => boolean
  /** Optional: override color for DGG label/badge (hex or rgb(r,g,b)). Default when unset: theme DGG color. */
  dggLabelColor?: string
  /** Text shown in the source badge for DGG messages. Default "dgg". */
  dggLabelText?: string
  maxMessages: number
  /** Max messages to keep when scrolled up (hard cap). Default 5000. */
  maxMessagesScroll?: number
  showTimestamps: boolean
  showSourceLabels: boolean
  /** When true, show platform favicon (dgg, kick, youtube, twitch) in the source badge. */
  showPlatformIcons?: boolean
  sortMode: 'timestamp' | 'arrival'
  /** When set, messages whose text contains any of these terms (case-insensitive) get a light blue background. */
  highlightTerms?: string[]
  /** When true, pause CSS animations on DGG emotes when they scroll out of view (reduces restart-on-scroll). */
  pauseEmoteAnimationsOffScreen?: boolean
  /** When false, DGG usernames use a single accent color and no flair icons. Default true. */
  showDggFlairsAndColors?: boolean
  /** When set, right-click on the message area shows a menu to toggle these options. */
  contextMenuConfig?: CombinedChatContextMenuConfig
  onCountChange?: (count: number) => void
  /** Called when DGG user count (from NAMES/JOIN/QUIT) changes, for header display. */
  onDggUserCountChange?: (count: number) => void
  /** When set, called when user clicks a link; otherwise links open in browser. */
  onOpenLink?: (url: string) => void
  /** Optional ref from parent to focus the DGG input (e.g. for keybind). */
  dggInputRef?: React.RefObject<HTMLTextAreaElement | null>
  /** Optional ref from parent to get { appendToInput(text) } for pasting into DGG input (e.g. from dock menu). */
  dggChatActionsRef?: React.RefObject<{ appendToInput: (text: string) => void } | null>
  /** Shortcut label for placeholder, e.g. "Ctrl + Space". */
  focusShortcutLabel?: string
  /** When true, chat is overlaid on embed area; messages area uses semi-transparent background. */
  overlayMode?: boolean
  /** Opacity of the messages area background in overlay mode (0–1). Default 0.85. */
  overlayOpacity?: number
  /** When true in overlay mode, the messages area has pointer-events: none so clicks pass through to the video underneath. */
  messagesClickThrough?: boolean
  /** When set (e.g. in overlay mode), top offset in px so pinned message and pin button sit below the overlay header. */
  overlayHeaderHeight?: number
  /** When set (e.g. in overlay mode), the input bar is portaled into this container (e.g. next to dock). */
  inputContainerRef?: React.RefObject<HTMLDivElement | null>
  /** When set, parent can call .openContextMenu(e) to show the same context menu as the message area (e.g. on header). */
  contextMenuRef?: React.MutableRefObject<{ openContextMenu: (e: React.MouseEvent) => void } | null>
}) {
  const [emotesMap, setEmotesMap] = useState<Map<string, string>>(new Map())
  const [flairsList, setFlairsList] = useState<DggFlair[]>([])
  const flairsMapRef = useRef<Map<string, DggFlair>>(new Map())
  flairsMapRef.current = useMemo(() => {
    const m = new Map<string, DggFlair>()
    flairsList.forEach((f) => m.set(f.name, f))
    return m
  }, [flairsList])
  const dggAccentColor = useMemo(
    () => parseDggLabelColor(dggLabelColor) ?? omniColorForKey('dgg'),
    [dggLabelColor],
  )
  const [items, setItems] = useState<CombinedItemWithSeq[]>([])
  const [updateSeq, setUpdateSeq] = useState(0)
  const [dggInputValue, setDggInputValue] = useState('')
  const [dggConnected, setDggConnected] = useState(false)
  const [dggAuthenticated, setDggAuthenticated] = useState(false)
  const [pinnedMessage, setPinnedMessage] = useState<DggChatMessage | null>(null)
  const [pinnedHidden, setPinnedHidden] = useState(false)
  const pinnedColorFlair = useMemo(
    () => (pinnedMessage ? usernameColorFlair(flairsList, { features: pinnedMessage.features ?? [] }) : undefined),
    [pinnedMessage, flairsList],
  )
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
  /** Right-click context menu position (when contextMenuConfig is provided). */
  const [contextMenuAt, setContextMenuAt] = useState<{ x: number; y: number } | null>(null)
  /** Selected text at time of right-click (for "Add to highlight terms"). */
  const [contextMenuSelection, setContextMenuSelection] = useState<string | null>(null)
  /** Which parent menu item is hovered (shows that submenu). */
  const [contextMenuHover, setContextMenuHover] = useState<string | null>(null)
  const contextMenuDivRef = useRef<HTMLDivElement | null>(null)
  /** Error from last whisper send attempt (e.g. not logged in, chat not connected). */
  const [whisperSendError, setWhisperSendError] = useState<string | null>(null)
  /** When in list view: recipient for "send to new person" (combobox value; can be any username). */
  const [composeRecipient, setComposeRecipient] = useState('')
  /** Show dropdown for compose recipient suggestions. */
  const [composeRecipientDropdownOpen, setComposeRecipientDropdownOpen] = useState(false)
  /** Banned phrases from ADDPHRASE/REMOVEPHRASE; block public chat send if message contains one. */
  const [bannedPhrases, setBannedPhrases] = useState<string[]>([])
  /** Error for public chat send (e.g. banned phrase, not connected). */
  const [dggPublicSendError, setDggPublicSendError] = useState<string | null>(null)
  /** Sub-only mode: when true, only subscribers can type in public chat. */
  const [subOnlyEnabled, setSubOnlyEnabled] = useState(false)
  /** Current user from ME event (for subscriber check and own-message highlight). */
  const [dggMeUser, setDggMeUser] = useState<{ features?: string[]; subscription?: { tier?: number } } | null>(null)
  /** Current user's nick from ME event (for own-message highlight). */
  const [dggMeNick, setDggMeNick] = useState<string | null>(null)
  /** User tooltip (right-click on message): show created date, watching, flairs, Whisper, Rustlesearch; if message is highlighted, which terms matched. */
  const [userTooltip, setUserTooltip] = useState<{
    nick: string
    source: 'dgg' | 'kick' | 'youtube' | 'twitch'
    createdDate?: string
    watching?: { platform: string | null; id: string | null } | null
    features?: string[]
    colorFlairName?: string
    matchingTerms?: string[]
  } | null>(null)
  const [userTooltipPosition, setUserTooltipPosition] = useState({ x: 0, y: 0 })
  const userTooltipRef = useRef<HTMLDivElement | null>(null)
  const composeRecipientInputRef = useRef<HTMLInputElement | null>(null)
  /** Have we done the initial unread fetch when combined chat first loads. */
  const unreadFetchedRef = useRef(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** Show scrollbar briefly when user scrolls; used for auto-hide scrollbar. */
  const [scrollbarVisible, setScrollbarVisible] = useState(false)
  const scrollbarHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((a, b) => a + b, 0),
    [unreadCounts]
  )
  const isSubscriber = useMemo(() => {
    const u = dggMeUser
    if (!u) return false
    if (Array.isArray(u.features) && u.features.includes('subscriber')) return true
    const tier = u.subscription?.tier
    return tier != null && Number(tier) > 0
  }, [dggMeUser])
  const dggPublicChatDisabled = subOnlyEnabled && !isSubscriber
  const dggInputRefInternal = useRef<HTMLTextAreaElement | null>(null)
  const mergedDggInputRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      dggInputRefInternal.current = el
      if (dggInputRefProp) (dggInputRefProp as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
    },
    [dggInputRefProp]
  )
  const dggChatActionsRefInternal = useRef<{ appendToInput: (text: string) => void } | null>(null)
  const dggChatActionsRefMerged = dggChatActionsRefProp ?? dggChatActionsRefInternal
  useImperativeHandle(
    dggChatActionsRefMerged,
    () => ({
      appendToInput: (text: string) => {
        setDggInputValue((prev) => (prev ?? '') + text)
      },
    }),
    []
  )
  const wasAtBottomRef = useRef(true)
  /** True when user has scrolled up (don't auto-scroll). Set false when user scrolls to bottom or clicks "scroll to bottom". Kept separate from isAtBottom so layout changes (e.g. poll bar) don't disable stick. */
  const userScrolledUpRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const seqRef = useRef(0)
  const prevPrivViewOpenRef = useRef(false)

  /** Hard cap when scrolled up (from settings). */
  const hardCap = useMemo(() => {
    const v = Number.isFinite(maxMessagesScroll) ? Math.floor(maxMessagesScroll) : 5000
    return Math.max(50, Math.min(50000, v))
  }, [maxMessagesScroll])
  const hardCapRef = useRef(hardCap)
  hardCapRef.current = hardCap

  const maxKeep = useMemo(() => {
    const v = Number.isFinite(maxMessages) ? Math.floor(maxMessages) : 70
    return Math.max(50, Math.min(hardCap, v))
  }, [maxMessages, hardCap])

  const effectiveCap = Math.min(maxKeep, hardCap)

  /** Trim only when at bottom (soft limit). When scrolled up, only trim if over hard cap. */
  const trimToLimit = useCallback(
    (arr: CombinedItemWithSeq[], atBottom: boolean): CombinedItemWithSeq[] => {
      const limit = atBottom ? effectiveCap : hardCap
      if (arr.length <= limit) return arr
      return arr.slice(arr.length - limit)
    },
    [effectiveCap, hardCap]
  )

  const trimToLimitRef = useRef(trimToLimit)
  trimToLimitRef.current = trimToLimit

  useEffect(() => {
    setItems((prev) => trimToLimit(prev, wasAtBottomRef.current))
    setUpdateSeq((v) => v + 1)
  }, [trimToLimit])

  const appendItems = (newItems: CombinedItemWithSeq[]) => {
    if (newItems.length === 0) return
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

  // Default DGG CDN URLs (used when get-app-config is unavailable, e.g. tests).
  const defaultDggUrls = {
    emotesCssUrl: 'https://cdn.destiny.gg/emotes/emotes.css',
    emotesJsonUrl: 'https://cdn.destiny.gg/emotes/emotes.json',
    flairsCssUrl: 'https://cdn.destiny.gg/flairs/flairs.css',
    flairsJsonUrl: 'https://cdn.destiny.gg/flairs/flairs.json',
  }

  // Load Destiny emotes + flairs (CSS + JSON, no-store). URLs from main process config (env).
  useEffect(() => {
    let cancelled = false
    const cacheKey = Date.now()

    const run = async () => {
      const config = await window.ipcRenderer.invoke('get-app-config').catch(() => null)
      const dgg = config?.dgg ?? defaultDggUrls
      try {
        const existingEmotesCss = document.getElementById('destiny-emotes-css')
        if (existingEmotesCss) existingEmotesCss.remove()
        await loadCSSOnceById(
          `${dgg.emotesCssUrl}?_=${cacheKey}`,
          'destiny-emotes-css',
        )
        const emotesRes = await fetch(`${dgg.emotesJsonUrl}?_=${cacheKey}`, {
          cache: 'no-store',
        })
        if (!emotesRes.ok) throw new Error(`Failed to fetch emotes: ${emotesRes.status}`)
        const emotesData: EmoteData[] = await emotesRes.json()
        if (cancelled) return
        const map = new Map<string, string>()
        emotesData.forEach((emote) => {
          if (emote.image && emote.image.length > 0) map.set(emote.prefix, '')
        })
        setEmotesMap(map)
      } catch {
        // Continue without emotes if fetch fails.
      }

      try {
        const existingFlairsCss = document.getElementById('destiny-flairs-css')
        if (existingFlairsCss) existingFlairsCss.remove()
        await loadCSSOnceById(
          `${dgg.flairsCssUrl}?_=${cacheKey}`,
          'destiny-flairs-css',
        )
        const flairsRes = await fetch(`${dgg.flairsJsonUrl}?_=${cacheKey}`, {
          cache: 'no-store',
        })
        if (!flairsRes.ok) return
        const flairsData: DggFlair[] = await flairsRes.json()
        if (cancelled) return
        setFlairsList(Array.isArray(flairsData) ? flairsData : [])
      } catch {
        // Continue without flairs if fetch fails.
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [])

  // RELOAD: server asked to reload emotes/flairs (e.g. new emotes or flairs).
  useEffect(() => {
    if (!enableDgg) return
    const handleReload = async () => {
      const config = await window.ipcRenderer.invoke('get-app-config').catch(() => null)
      const dgg = config?.dgg ?? defaultDggUrls
      const cacheKey = Date.now()
      try {
        const existingEmotesCss = document.getElementById('destiny-emotes-css')
        if (existingEmotesCss) existingEmotesCss.remove()
        await loadCSSOnceById(
          `${dgg.emotesCssUrl}?_=${cacheKey}`,
          'destiny-emotes-css',
        )
        const emotesRes = await fetch(`${dgg.emotesJsonUrl}?_=${cacheKey}`, {
          cache: 'no-store',
        })
        if (!emotesRes.ok) return
        const emotesData: EmoteData[] = await emotesRes.json()
        const map = new Map<string, string>()
        emotesData.forEach((emote) => {
          if (emote.image && emote.image.length > 0) map.set(emote.prefix, '')
        })
        setEmotesMap(map)
      } catch {
        // ignore
      }
      try {
        const existingFlairsCss = document.getElementById('destiny-flairs-css')
        if (existingFlairsCss) existingFlairsCss.remove()
        await loadCSSOnceById(
          `${dgg.flairsCssUrl}?_=${cacheKey}`,
          'destiny-flairs-css',
        )
        const flairsRes = await fetch(`${dgg.flairsJsonUrl}?_=${cacheKey}`, {
          cache: 'no-store',
        })
        if (!flairsRes.ok) return
        const flairsData: DggFlair[] = await flairsRes.json()
        setFlairsList(Array.isArray(flairsData) ? flairsData : [])
      } catch {
        // ignore
      }
    }
    window.ipcRenderer.on('chat-websocket-reload', handleReload)
    return () => {
      window.ipcRenderer.off('chat-websocket-reload', handleReload)
    }
  }, [enableDgg])

  // Track "at bottom" and "user scrolled up" for auto-scroll behavior.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const onScroll = () => {
      if (programmaticScrollRef.current) return
      const atBottom = isAtBottom(el)
      wasAtBottomRef.current = atBottom
      // Only update userScrolledUp from actual scroll: true when not at bottom, false when at bottom.
      userScrolledUpRef.current = !atBottom
      setShowMoreMessagesBelow((prev) => (prev !== !atBottom ? !atBottom : prev))
    }

    el.addEventListener('scroll', onScroll)
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  /** When appending or after history/reconnect: if we're at bottom, clear "user scrolled up" so we keep sticking. */
  const markStickIfAtBottom = () => {
    const el = scrollerRef.current
    const atBottom = el ? isAtBottom(el) : true
    wasAtBottomRef.current = atBottom
    if (atBottom) userScrolledUpRef.current = false
  }

  // When "pause emote animations off-screen" is on, pause CSS animations on .emote when they leave the viewport.
  useEffect(() => {
    if (!pauseEmoteAnimationsOffScreen || privViewOpen) return
    const el = scrollerRef.current
    if (!el) return
    const emotes = el.querySelectorAll('.emote')
    if (emotes.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const target = e.target as HTMLElement
          if (e.isIntersecting) target.classList.remove('emote-paused')
          else target.classList.add('emote-paused')
        }
      },
      { root: el, rootMargin: '0px', threshold: 0 }
    )
    emotes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [pauseEmoteAnimationsOffScreen, privViewOpen, updateSeq])

  const closeContextMenu = useCallback(() => {
    setContextMenuAt(null)
    setContextMenuSelection(null)
  }, [])
  useEffect(() => {
    if (!contextMenuAt) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    const onPointerDown = (e: MouseEvent) => {
      const el = contextMenuDivRef.current
      if (el && el.contains(e.target as Node)) return
      closeContextMenu()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [contextMenuAt, closeContextMenu])

  // Clear scrollbar hide timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollbarHideTimeoutRef.current) clearTimeout(scrollbarHideTimeoutRef.current)
    }
  }, [])

  // Expose openContextMenu so parent (e.g. header) can open the same context menu on right-click
  useEffect(() => {
    if (!contextMenuRef) return
    contextMenuRef.current = {
      openContextMenu(e: React.MouseEvent) {
        e.preventDefault()
        setContextMenuSelection(null)
        setContextMenuAt({ x: e.clientX, y: e.clientY })
      },
    }
    return () => {
      contextMenuRef.current = null
    }
  }, [contextMenuRef])

  const closeUserTooltip = useCallback(() => setUserTooltip(null), [])

  const openUserTooltip = useCallback(
    (e: React.MouseEvent, m: CombinedItem) => {
      if (m.source === 'dgg-event' || m.source === 'dgg-system' || m.source === 'dgg-broadcast') return
      e.preventDefault()
      e.stopPropagation()
      const raw = m.source === 'dgg' ? m.raw : m.source === 'kick' ? m.raw : m.source === 'youtube' ? m.raw : m.raw
      const nick = m.nick?.trim()
      if (!nick) return
      const colorFlair = m.source === 'dgg' ? usernameColorFlair(flairsList, { features: (raw as DggChatMessage).features ?? [] }) : undefined
      const contentForHighlight = getContentForHighlight(m)
      const matchingTerms = highlightTerms.filter((term) => term.trim() && contentForHighlight.toLowerCase().includes(term.trim().toLowerCase()))
      setUserTooltip({
        nick,
        source: m.source,
        createdDate: (raw as DggChatMessage).createdDate,
        watching: (raw as DggChatMessage).watching ?? undefined,
        features: (raw as DggChatMessage).features,
        colorFlairName: colorFlair?.name,
        matchingTerms: matchingTerms.length > 0 ? matchingTerms : undefined,
      })
      setUserTooltipPosition({ x: e.clientX, y: e.clientY })
    },
    [flairsList, highlightTerms]
  )

  useEffect(() => {
    if (!userTooltip) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeUserTooltip()
    }
    const onPointerDown = (e: MouseEvent) => {
      if (userTooltipRef.current?.contains(e.target as Node)) return
      closeUserTooltip()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [userTooltip, closeUserTooltip])

  // If DGG is disabled, drop existing DGG items (and broadcasts) from the feed.
  useEffect(() => {
    if (enableDgg) return
    setItems((prev) => {
      const next = prev.filter((m) => m.source !== 'dgg' && m.source !== 'dgg-broadcast')
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
      if (!history || history.type !== 'HISTORY') return
      const items = history.items
      const useItems = Array.isArray(items) && items.length > 0
      const mapped: CombinedItemWithSeq[] = useItems
        ? items.map((item) => {
            if (item.type === 'MSG') {
              const m = item.message
              return {
                source: 'dgg' as const,
                tsMs: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
                nick: m.nick,
                content: m.data ?? '',
                raw: m,
                isHistory: true,
                seq: seqRef.current++,
              }
            }
            const b = item.broadcast
            return {
              source: 'dgg-broadcast' as const,
              tsMs: typeof b.timestamp === 'number' ? b.timestamp : Date.now(),
              nick: b.nick ?? '',
              content: b.data ?? '',
              raw: b,
              isHistory: true,
              seq: seqRef.current++,
            }
          })
        : (Array.isArray(history.messages) ? history.messages : [])
            .slice(-hardCapRef.current)
            .map((m) => ({
              source: 'dgg' as const,
              tsMs: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
              nick: m.nick,
              content: m.data ?? '',
              raw: m,
              isHistory: true,
              seq: seqRef.current++,
            }))
      if (mapped.length === 0) return
      const slice = useItems ? mapped.slice(-hardCapRef.current) : mapped
      markStickIfAtBottom()
      setItems((prev) => {
        const nonDgg = prev.filter((m) => m.source !== 'dgg' && m.source !== 'dgg-broadcast')
        return trimToLimitRef.current([...nonDgg, ...slice], wasAtBottomRef.current)
      })
      setUpdateSeq((v) => v + 1)
    }

    const handleBroadcast = (_event: any, payload: { type?: string; broadcast?: DggBroadcastPayload } | null) => {
      if (!alive) return
      const b = payload?.broadcast
      if (!b) return
      appendItems([
        {
          source: 'dgg-broadcast',
          tsMs: typeof b.timestamp === 'number' ? b.timestamp : Date.now(),
          nick: b.nick ?? '',
          content: b.data ?? '',
          raw: b,
          seq: seqRef.current++,
        },
      ])
    }

    const handleConnected = () => {
      if (alive) setDggConnected(true)
      // Capture scroll position so next HISTORY or MSG will auto-scroll if user was at bottom (fixes scroll stopping after reconnect)
      if (alive) markStickIfAtBottom()
    }
    const handleDisconnected = () => {
      if (alive) setDggConnected(false)
      if (alive) setDggAuthenticated(false)
      if (alive) setDggUserNicks([])
      if (alive) setDggMeUser(null)
      if (alive) setDggMeNick(null)
    }
    const handleSubOnly = (_event: any, payload: { type?: string; subonly?: { data?: string } } | null) => {
      if (!alive) return
      const data = payload?.subonly?.data ?? (payload as { data?: string } | null)?.data
      setSubOnlyEnabled(data === 'on')
    }
    const handleMe = (_event: any, payload: { type?: string; data?: { nick?: string; id?: number; features?: string[]; subscription?: { tier?: number } } | null } | null) => {
      if (!alive) return
      const me = payload?.data ?? payload
      const nick = me && typeof me === 'object' && 'nick' in me ? (me as { nick?: string }).nick : undefined
      setDggAuthenticated(Boolean(nick))
      setDggMeNick(nick?.trim() ?? null)
      if (me && typeof me === 'object') {
        const user = me as { features?: string[]; subscription?: { tier?: number } }
        setDggMeUser({ features: user.features, subscription: user.subscription ?? undefined })
      } else {
        setDggMeUser(null)
      }
    }

    const handlePin = (_event: any, payload: { type?: string; pin?: DggChatMessage } | null) => {
      if (!alive) return
      const msg = payload?.pin ?? (payload as DggChatMessage | null)
      // When DGG clears the pin it can send an empty pin (no nick, no data); treat as no pin so we don't show ":" box
      const hasContent = msg && (String(msg.nick ?? '').trim() || String(msg.data ?? '').trim())
      setPinnedMessage(hasContent ? msg : null)
      if (hasContent) setPinnedHidden(false)
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
    window.ipcRenderer.on('chat-websocket-broadcast', handleBroadcast)
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

    const handleAddPhrase = (_event: any, payload: { type?: string; phrase?: { data?: string } } | null) => {
      if (!alive) return
      const phrase = payload?.phrase?.data?.trim()
      if (phrase) setBannedPhrases((prev) => (prev.includes(phrase) ? prev : [...prev, phrase]))
    }
    const handleRemovePhrase = (_event: any, payload: { type?: string; phrase?: { data?: string } } | null) => {
      if (!alive) return
      const phrase = payload?.phrase?.data?.trim()
      if (phrase) setBannedPhrases((prev) => prev.filter((p) => p !== phrase))
    }
    window.ipcRenderer.on('chat-websocket-addphrase', handleAddPhrase)
    window.ipcRenderer.on('chat-websocket-removephrase', handleRemovePhrase)
    window.ipcRenderer.on('chat-websocket-subonly', handleSubOnly)

    const handleGiftSub = (_event: any, payload: { type?: string; giftSub?: { user?: { nick?: string }; recipient?: { nick?: string }; tierLabel?: string; tier?: number } } | null) => {
      if (!alive) return
      const g = payload?.giftSub
      if (!g) return
      const from = g.user?.nick ?? 'Someone'
      const to = g.recipient?.nick ?? 'someone'
      const tier = g.tierLabel ?? (g.tier != null ? `Tier ${g.tier}` : '')
      const content = tier ? `${from} gifted ${to} a ${tier} subscription` : `${from} gifted ${to} a subscription`
      appendItems([
        { source: 'dgg-event', eventType: 'giftsub', tsMs: Date.now(), nick: from, content, raw: g, seq: seqRef.current++ },
      ])
    }
    const handleMassGift = (_event: any, payload: { type?: string; massGift?: { user?: { nick?: string }; quantity?: number; tierLabel?: string; tier?: number } } | null) => {
      if (!alive) return
      const g = payload?.massGift
      if (!g) return
      const from = g.user?.nick ?? 'Someone'
      const qty = typeof g.quantity === 'number' ? g.quantity : 1
      const tier = g.tierLabel ?? (g.tier != null ? `Tier ${g.tier}` : '')
      const content = tier ? `${from} gifted ${qty} ${tier} subscriptions` : `${from} gifted ${qty} subscription${qty !== 1 ? 's' : ''}`
      appendItems([
        { source: 'dgg-event', eventType: 'massgift', tsMs: Date.now(), nick: from, content, raw: g, seq: seqRef.current++ },
      ])
    }
    const handleDonation = (_event: any, payload: { type?: string; donation?: { user?: { nick?: string }; amount?: number } } | null) => {
      if (!alive) return
      const d = payload?.donation
      if (!d) return
      const from = d.user?.nick ?? 'Someone'
      const amount = typeof d.amount === 'number' ? d.amount / 100 : 0
      const content = `${from} donated ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
      appendItems([
        { source: 'dgg-event', eventType: 'donation', tsMs: Date.now(), nick: from, content, raw: d, seq: seqRef.current++ },
      ])
    }
    window.ipcRenderer.on('chat-websocket-giftsub', handleGiftSub)
    window.ipcRenderer.on('chat-websocket-massgift', handleMassGift)
    window.ipcRenderer.on('chat-websocket-donation', handleDonation)

    const handleMute = (_event: any, payload: { type?: string; mute?: { data?: string; nick?: string } } | null) => {
      if (!alive) return
      const m = payload?.mute
      if (!m) return
      const target = m.data?.trim() ?? 'someone'
      const by = m.nick?.trim()
      const content = by ? `${target} was muted by ${by}` : `${target} was muted`
      appendItems([
        { source: 'dgg-system', kind: 'mute', tsMs: Date.now(), content, raw: m, seq: seqRef.current++ },
      ])
    }
    const handleBan = (_event: any, payload: { type?: string; ban?: { data?: string; nick?: string } } | null) => {
      if (!alive) return
      const b = payload?.ban
      if (!b) return
      const target = b.data?.trim() ?? 'someone'
      const by = b.nick?.trim()
      const content = by ? `${target} was banned by ${by}` : `${target} was banned`
      appendItems([
        { source: 'dgg-system', kind: 'ban', tsMs: Date.now(), content, raw: b, seq: seqRef.current++ },
      ])
    }
    const handleUnban = (_event: any, payload: { type?: string; unban?: { nick?: string } } | null) => {
      if (!alive) return
      const u = payload?.unban
      if (!u) return
      const target = u.nick?.trim() ?? 'someone'
      appendItems([
        { source: 'dgg-system', kind: 'unmute', tsMs: Date.now(), content: `${target} was unbanned`, raw: u, seq: seqRef.current++ },
      ])
    }
    window.ipcRenderer.on('chat-websocket-mute', handleMute)
    window.ipcRenderer.on('chat-websocket-ban', handleBan)
    window.ipcRenderer.on('chat-websocket-unban', handleUnban)

    const handleChatErr = (_event: any, data: { description?: string } | null) => {
      if (!alive) return
      const desc = data?.description?.trim()
      if (desc && desc !== 'alreadyvoted') setWhisperSendError(desc)
    }
    window.ipcRenderer.on('chat-websocket-err', handleChatErr)

    return () => {
      alive = false
      setDggConnected(false)
      window.ipcRenderer.off('chat-websocket-addphrase', handleAddPhrase)
      window.ipcRenderer.off('chat-websocket-removephrase', handleRemovePhrase)
      window.ipcRenderer.off('chat-websocket-subonly', handleSubOnly)
      window.ipcRenderer.off('chat-websocket-giftsub', handleGiftSub)
      window.ipcRenderer.off('chat-websocket-massgift', handleMassGift)
      window.ipcRenderer.off('chat-websocket-donation', handleDonation)
      window.ipcRenderer.off('chat-websocket-mute', handleMute)
      window.ipcRenderer.off('chat-websocket-ban', handleBan)
      window.ipcRenderer.off('chat-websocket-unban', handleUnban)
      window.ipcRenderer.off('chat-websocket-err', handleChatErr)
      setDggAuthenticated(false)
      window.ipcRenderer.off('chat-websocket-privmsg', handlePrivmsg)
      window.ipcRenderer.off('chat-websocket-connected', handleConnected)
      window.ipcRenderer.off('chat-websocket-disconnected', handleDisconnected)
      window.ipcRenderer.off('chat-websocket-me', handleMe)
      window.ipcRenderer.off('chat-websocket-message', handleMessage)
      window.ipcRenderer.off('chat-websocket-history', handleHistory)
      window.ipcRenderer.off('chat-websocket-broadcast', handleBroadcast)
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

  // When returning from whisper view to combined feed, scroll to bottom so we don't stay at top
  useEffect(() => {
    if (prevPrivViewOpenRef.current && !privViewOpen) {
      const el = scrollerRef.current
      if (el) {
        programmaticScrollRef.current = true
        userScrolledUpRef.current = false
        wasAtBottomRef.current = true
        setShowMoreMessagesBelow(false)
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight
          requestAnimationFrame(() => {
            programmaticScrollRef.current = false
          })
        })
      }
    }
    prevPrivViewOpenRef.current = privViewOpen
  }, [privViewOpen])

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

  /** Cache of DGG user data by nick (from last message seen from that nick), for tooltips on mentioned nicks. */
  const dggUserDataCache = useMemo(() => {
    const map = new Map<
      string,
      { createdDate?: string; watching?: { platform: string | null; id: string | null } | null; features?: string[] }
    >()
    const limit = 500
    const dggItems = items.filter((m): m is typeof m & { source: 'dgg' } => m.source === 'dgg')
    for (let i = dggItems.length - 1; i >= 0 && map.size < limit; i--) {
      const m = dggItems[i]
      const nick = m.raw.nick?.trim()?.toLowerCase()
      if (!nick || map.has(nick)) continue
      map.set(nick, {
        createdDate: m.raw.createdDate,
        watching: m.raw.watching ?? undefined,
        features: m.raw.features,
      })
    }
    return map
  }, [items])

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
    | { type: 'combo'; index: number; count: number; emoteKey: string; source: string; tsMs: number; slug?: string }

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
        const lastItem = displayItems[i]
        const slug = lastItem && (lastItem as any).source === 'kick' ? (lastItem as any).slug : undefined
        list.push({ type: 'combo', index: i, count: combo.count, emoteKey: combo.emoteKey, source: combo.source, tsMs: combo.tsMs, slug })
      } else {
        list.push({ type: 'message', index: i, item: displayItems[i] })
      }
    }
    return list
  }, [displayItems, emotesMap])

  useEffect(() => {
    onCountChange?.(displayItems.length)
  }, [displayItems.length, onCountChange])

  // Auto-scroll when user has not scrolled up (stick to bottom).
  // Use updateSeq (not merged.length) because the list is capped at MAX_MESSAGES
  // and length can stay constant even as new messages arrive.
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (userScrolledUpRef.current) return

    programmaticScrollRef.current = true
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
    userScrolledUpRef.current = false
    wasAtBottomRef.current = true
  }, [updateSeq])

  const onOpenLink = onOpenLinkProp ?? ((url: string) => {
    window.ipcRenderer.invoke('link-scroller-handle-link', { url, action: 'browser' }).catch(() => {})
  })

  const handleNickDoubleClick = useCallback(
    (nick: string) => {
      setDggInputValue((prev) => (prev ? prev + ' ' + nick : nick))
      dggInputRefInternal.current?.focus()
    },
    []
  )

  const handleEmoteDoubleClick = useCallback((prefix: string) => {
    setDggInputValue((prev) => (prev && !prev.endsWith(' ') ? prev + ' ' + prefix : (prev || '') + prefix))
    dggInputRefInternal.current?.focus()
  }, [])

  const openUserTooltipByNick = useCallback(
    (e: React.MouseEvent, nick: string) => {
      e.preventDefault()
      e.stopPropagation()
      const trimmed = nick?.trim()
      if (!trimmed) return
      const cached = dggUserDataCache.get(trimmed.toLowerCase())
      const colorFlair = cached?.features?.length
        ? usernameColorFlair(flairsList, { features: cached.features })
        : undefined
      setUserTooltip({
        nick: trimmed,
        source: 'dgg',
        createdDate: cached?.createdDate,
        watching: cached?.watching ?? undefined,
        features: cached?.features,
        colorFlairName: colorFlair?.name,
      })
      setUserTooltipPosition({ x: e.clientX, y: e.clientY })
    },
    [dggUserDataCache, flairsList]
  )

  /** Render DGG message content with mentioned nicks as hover-underline, right-click menu, double-click to insert; emotes double-click to insert into input. Greentext lines (starting with >) wrap the whole line so nicks don't interrupt the green style. */
  const renderDggMessageContent = useCallback(
    (content: string) => {
      const lines = (content ?? '').split('\n')
      const parts: React.ReactNode[] = []
      let key = 0
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex]!
        const isGreentext = line.trim().startsWith('>')
        const lineSegments = tokenizeDggContent(line, dggNicks)
        const lineParts: React.ReactNode[] = []
        for (const seg of lineSegments) {
          if (seg.type === 'text') {
            lineParts.push(
              <Fragment key={`dgg-txt-${key++}`}>
                {renderTextWithLinks(seg.value, emotePattern, emotesMap, onOpenLink, handleEmoteDoubleClick, isGreentext)}
              </Fragment>
            )
          } else {
            /* When a word is both a nick and an emote, prefer emote (emote match is case-sensitive; nick match is not). */
            const treatAsEmote = emotesMap.has(seg.value)
            if (treatAsEmote) {
              lineParts.push(
                <Fragment key={`dgg-txt-${key++}`}>
                  {renderTextWithLinks(seg.value, emotePattern, emotesMap, onOpenLink, handleEmoteDoubleClick, isGreentext)}
                </Fragment>
              )
            } else {
              lineParts.push(
                <span
                  key={`dgg-nick-${key++}`}
                  className="dgg-mention hover:underline cursor-context-menu"
                  onContextMenu={(e) => openUserTooltipByNick(e, seg.value)}
                  onDoubleClick={() => handleNickDoubleClick(seg.value)}
                  onMouseUp={(e) => e.stopPropagation()}
                >
                  {seg.value}
                </span>
              )
            }
          }
        }
        if (isGreentext) {
          parts.push(
            <span
              key={`greentext-${key++}`}
              className="msg-chat-greentext"
              style={{
                color: 'rgb(108, 165, 40)',
                fontFamily: '"Roboto", Helvetica, "Trebuchet MS", Verdana, sans-serif',
                boxSizing: 'border-box',
                textRendering: 'optimizeLegibility',
                overflowWrap: 'break-word',
                lineHeight: 1.6,
              }}
            >
              {lineParts}
            </span>
          )
        } else {
          parts.push(...lineParts)
        }
        if (lineIndex < lines.length - 1) parts.push(<Fragment key={`nl-${key++}`}>{'\n'}</Fragment>)
      }
      return <>{parts}</>
    },
    [dggNicks, emotePattern, emotesMap, onOpenLink, openUserTooltipByNick, handleNickDoubleClick, handleEmoteDoubleClick]
  )

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
    // Public chat: block if sub-only and not subscriber
    if (subOnlyEnabled && !isSubscriber) return
    // Public chat: block if message contains a banned phrase
    if (bannedPhrases.length > 0) {
      const lower = text.toLowerCase()
      const matched = bannedPhrases.find((p) => p.length > 0 && lower.includes(p.toLowerCase()))
      if (matched) {
        setDggPublicSendError(`Message contains a banned phrase.`)
        return
      }
    }
    setDggPublicSendError(null)
    window.ipcRenderer.invoke('chat-websocket-send', { data: text }).then((result: { success?: boolean }) => {
      if (result?.success) {
        setDggInputValue('')
        setDggPublicSendError(null)
      }
    }).catch(() => {})
  }, [dggInputValue, activeWhisperUsername, privViewOpen, composeRecipient, bannedPhrases, subOnlyEnabled, isSubscriber])

  useEffect(() => {
    setDggPublicSendError(null)
  }, [dggInputValue])

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
      userScrolledUpRef.current = false
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

  const inputBlock = (
    <>
      {enableDgg && showDggInput && !dggAuthenticated && (
        <div className="flex-none px-2 py-2 text-sm text-base-content/60 border-t border-base-300">
          Login → Main menu → Connections
        </div>
      )}
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
          {dggPublicSendError && (
            <div className="text-xs text-warning px-2 py-0.5" role="alert">
              {dggPublicSendError}
            </div>
          )}
          <div className="flex items-center gap-1 min-w-0 flex-1 min-h-[var(--embed-dock-height)] w-full" style={{ backgroundColor: 'var(--color-base-200)' }}>
            <div className="flex-1 min-w-0">
              <DggInputBar
                ref={mergedDggInputRef}
                value={dggInputValue}
                onChange={setDggInputValue}
                onSend={sendDggMessage}
                onKeyDown={onDggInputKeyDown}
                disabled={
                  privViewOpen && !activeWhisperUsername
                    ? !dggConnected || !composeRecipient.trim()
                    : !dggConnected || (dggPublicChatDisabled && !activeWhisperUsername)
                }
                emotesMap={emotesMap}
                dggNicks={dggNicks}
                placeholder={
                  activeWhisperUsername
                    ? (dggConnected ? `Whisper ${activeWhisperUsername}...` : 'Connecting...')
                    : privViewOpen
                      ? (dggConnected ? 'whisper message..' : 'Connecting...')
                      : dggPublicChatDisabled
                        ? 'Sub only mode — subscribers can type'
                        : (dggConnected ? 'Message destiny.gg...' : 'Connecting...')
                }
                shortcutLabel={dggConnected ? focusShortcutLabel : undefined}
                dropdownInPortal={overlayMode}
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
    </>
  )

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {overlayMode && inputContainerRef?.current && createPortal(
        <div className="chat-overlay-input-strip h-full min-h-0 flex flex-col w-full" style={{ backgroundColor: 'var(--color-base-200)' }}>
          {inputBlock}
        </div>,
        inputContainerRef.current
      )}
      <div className={`relative flex-1 min-h-0 flex flex-col ${overlayMode && messagesClickThrough ? 'pointer-events-none' : ''}`}>
        {enableDgg && pinnedMessage && !pinnedHidden && (
          <div
            className="absolute left-0 right-0 z-10 p-2 pointer-events-none"
            style={overlayMode && overlayHeaderHeight != null ? { top: overlayHeaderHeight } : { top: 0 }}
          >
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
                className="msg-chat msg-pinned text-sm rounded-md flex flex-nowrap items-start gap-2 bg-base-100 m-2 p-2 cursor-pointer hover:bg-red-500/15 transition-colors"
                data-username={pinnedMessage.nick}
                id="msg-pinned"
                role="button"
                tabIndex={0}
                title="Click to close pinned message"
                onClick={() => {
                  const sel = window.getSelection?.()
                  if (!sel?.toString()?.trim()) setPinnedHidden(true)
                }}
                onKeyDown={(e) => e.key === 'Enter' && setPinnedHidden(true)}
                aria-label="Pinned message; click to close"
              >
                {showTimestamps && (
                  <time
                    className="time text-base-content/60 text-xs shrink-0"
                    title={pinnedMessage.createdDate ?? new Date(pinnedMessage.timestamp).toLocaleString()}
                    data-unixtimestamp={pinnedMessage.timestamp}
                  >
                    {new Date(pinnedMessage.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </time>
                )}
                <span className="flex-1 min-w-0 flex flex-col gap-y-1">
                  <span className="shrink-0">
                    <span
                      className={`font-semibold ${pinnedColorFlair ? `user ${pinnedColorFlair.name}` : ''}`}
                      style={pinnedColorFlair ? undefined : { color: dggAccentColor }}
                    >
                      {pinnedMessage.nick}
                    </span>
                    <span className="ctrl">: </span>
                  </span>
                  <span className="msg-chat-content text whitespace-pre-wrap break-words">
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
            className="active absolute right-2 z-20 btn btn-ghost btn-sm btn-circle text-base"
            style={overlayMode && overlayHeaderHeight != null ? { top: overlayHeaderHeight + 8 } : { top: 8 }}
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
          <div
            className="flex-shrink-0 p-2 relative z-10"
            style={overlayMode && overlayHeaderHeight != null ? { marginTop: overlayHeaderHeight } : undefined}
          >
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
        <div
          ref={scrollerRef}
          className={`chat-messages-scroll overflow-y-auto p-2 space-y-1 ${overlayMode && overlayHeaderHeight != null ? 'absolute inset-0 z-0' : 'flex-1 min-h-0'} ${scrollbarVisible ? 'chat-messages-scroll-visible' : ''} ${pauseEmoteAnimationsOffScreen ? 'emote-pause-offscreen' : ''} ${overlayMode ? 'combined-chat-overlay-messages' : ''} ${overlayMode && messagesClickThrough ? 'pointer-events-none' : ''}`}
          style={
            overlayMode
              ? {
                  background: `color-mix(in oklch, var(--color-base-200) ${(overlayOpacity * 100).toFixed(0)}% , transparent)`,
                  ...(overlayHeaderHeight != null ? { paddingTop: overlayHeaderHeight } : {}),
                }
              : undefined
          }
          onWheel={() => {
            setScrollbarVisible(true)
            if (scrollbarHideTimeoutRef.current) clearTimeout(scrollbarHideTimeoutRef.current)
            scrollbarHideTimeoutRef.current = setTimeout(() => {
              scrollbarHideTimeoutRef.current = null
              setScrollbarVisible(false)
            }, 800)
          }}
          onContextMenu={
            contextMenuConfig && !privViewOpen
              ? (e) => {
                  e.preventDefault()
                  setContextMenuHover(null)
                  const sel = window.getSelection()?.toString()?.trim() ?? ''
                  setContextMenuSelection(sel || null)
                  setContextMenuAt({ x: e.clientX, y: e.clientY })
                }
              : undefined
          }
        >
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
                          className={`msg-chat text-sm px-2 py-0.5 -mx-2 ${isFromThem ? 'bg-base-300' : 'bg-primary/15'}`}
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
            if (m.source === 'dgg-event') {
              const ts = Number.isFinite(m.tsMs) ? new Date(m.tsMs).toLocaleTimeString() : ''
              const icon = m.eventType === 'donation' ? '💰' : '🎁'
              return (
                <div
                  key={`msg-dgg-event-${(m as CombinedItemWithSeq).seq}-${m.tsMs}-${m.nick}`}
                  className="text-sm leading-snug px-2 py-0.5 -mx-2 text-base-content/80"
                >
                  {showTimestamps ? <span className="text-xs text-base-content/50 mr-2">{ts}</span> : null}
                  <span className="mr-1.5" aria-hidden>{icon}</span>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                </div>
              )
            }
            if (m.source === 'dgg-system') {
              const ts = Number.isFinite(m.tsMs) ? new Date(m.tsMs).toLocaleTimeString() : ''
              const icon = m.kind === 'ban' ? '🔨' : m.kind === 'unmute' ? '🔓' : '🔇'
              return (
                <div
                  key={`msg-dgg-system-${(m as CombinedItemWithSeq).seq}-${m.kind}-${m.tsMs}`}
                  className="text-sm leading-snug px-2 py-0.5 -mx-2 text-base-content/70"
                >
                  {showTimestamps ? <span className="text-xs text-base-content/50 mr-2">{ts}</span> : null}
                  <span className="mr-1.5" aria-hidden>{icon}</span>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                </div>
              )
            }
            if (m.source === 'dgg-broadcast') {
              const ts = Number.isFinite(m.tsMs) ? new Date(m.tsMs).toLocaleTimeString() : ''
              return (
                <div
                  key={`msg-dgg-broadcast-${(m as CombinedItemWithSeq).seq}-${m.tsMs}-${m.raw?.uuid ?? ''}`}
                  className="msg-chat text-sm leading-snug px-2 py-1 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 overflow-hidden rounded border"
                  style={{ borderColor: '#edea12' }}
                >
                  {showTimestamps ? <span className="text-xs text-base-content/50 shrink-0">{ts}</span> : null}
                  <span className="msg-chat-content whitespace-pre-wrap break-words min-w-0 flex-1">
                    <span className="msg-chat msg-chat-inner" style={{ position: 'relative' }}>
                      {renderDggMessageContent(m.content ?? '')}
                    </span>
                  </span>
                  <span className="shrink-0 ml-auto" aria-hidden title="Broadcast">📢</span>
                </div>
              )
            }
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
                ? dggAccentColor
                : (getEmbedColor?.(colorKey, displayName) ?? omniColorForKey(colorKey, { displayName }))
            const badgeText = textColorOn(accent)
            const contentForHighlight = getContentForHighlight(m)
            const contentLower = contentForHighlight.toLowerCase()
            const matchingTerms = highlightTerms.filter((term) => term.trim() && contentLower.includes(term.trim().toLowerCase()))
            const isHighlighted = matchingTerms.length > 0
            const isOwn =
              m.source === 'dgg' &&
              dggMeNick != null &&
              (m.nick?.trim().toLowerCase() === dggMeNick.toLowerCase())
            const dggColorFlair =
              m.source === 'dgg' && showDggFlairsAndColors
                ? usernameColorFlair(flairsList, { features: m.raw.features ?? [] })
                : undefined
            const dggFlairFeatures =
              m.source === 'dgg' && showDggFlairsAndColors
                ? (m.raw.features ?? []).filter((f) => flairsMapRef.current.has(f))
                : []
            return (
              <div
                key={`msg-${m.source}-${(m as CombinedItemWithSeq).seq}-${m.tsMs}-${m.nick}`}
                className={`msg-chat text-sm px-2 py-0.5 -mx-2 flex flex-wrap items-center gap-x-2 gap-y-1 ${isOwn ? 'msg-own' : ''} ${!isOwn && isHighlighted ? 'bg-blue-500/15' : ''}`}
              >
                {showTimestamps ? <span className="text-xs text-base-content/50 shrink-0">{ts}</span> : null}
                {showSourceLabels && (m.source === 'dgg' ? (dggLabelText != null && dggLabelText.trim() !== '') : !getEmbedLabelHidden?.(colorKey)) ? (
                  <span
                    className="badge badge-sm shrink-0"
                    style={{ backgroundColor: accent, borderColor: accent, color: badgeText }}
                  >
                    {m.source === 'dgg'
                      ? (dggLabelText ?? '').trim()
                      : (displayName ||
                          (m.source === 'kick'
                            ? `K:${m.slug}`
                            : m.source === 'youtube'
                              ? `Y:${m.videoId}`
                              : `T:${m.channel}`))}
                  </span>
                ) : null}
                {showPlatformIcons && getPlatformIcon(colorKey) ? (
                  <img
                    src={getPlatformIcon(colorKey)}
                    alt=""
                    className="w-4 h-4 shrink-0"
                    aria-hidden
                  />
                ) : null}
                <span
                  className="shrink-0 flex items-center gap-1 cursor-context-menu"
                  onContextMenu={(e) => openUserTooltip(e, m)}
                  onMouseUp={(e) => e.stopPropagation()}
                  onDoubleClick={m.source === 'dgg' ? () => handleNickDoubleClick(m.nick) : undefined}
                >
                  {m.source === 'dgg' ? (
                    <>
                      {dggFlairFeatures.length > 0 ? (
                        <span className="inline-flex items-center">
                          {dggFlairFeatures.map((f) => {
                            const fl = flairsMapRef.current.get(f)!
                            return (
                              <i
                                key={f}
                                className={`flair ${fl.name}`}
                                title={fl.label}
                                aria-hidden
                              />
                            )
                          })}
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-0">
                        <span
                          className={`font-semibold hover:underline ${dggColorFlair ? `user ${dggColorFlair.name}` : ''}`}
                          style={dggColorFlair ? undefined : { color: accent }}
                        >
                          {m.nick}
                        </span>
                        {overlayMode ? <span className="msg-chat-overlay-colon">: </span> : null}
                      </span>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-0">
                      <span className="font-semibold" style={{ color: accent }}>
                        {m.nick}
                      </span>
                      {overlayMode ? <span className="msg-chat-overlay-colon">: </span> : null}
                    </span>
                  )}
                </span>
                <span className="msg-chat-content whitespace-pre-wrap break-words min-w-0">
                  {m.source === 'dgg' ? (
                    <span className="msg-chat msg-chat-inner" style={{ position: 'relative' }}>
                      {renderDggMessageContent(m.content ?? '')}
                    </span>
                  ) : m.source === 'kick'
                    ? renderKickContent(m.raw, onOpenLink).map((node, i) => (
                        <Fragment key={`kick-${(m as CombinedItemWithSeq).seq}-${m.tsMs}-${i}`}>{node}</Fragment>
                      ))
                    : m.source === 'youtube'
                      ? renderYouTubeContent(m.raw, onOpenLink)
                      : renderTextWithLinks(m.content ?? '', null, new Map(), onOpenLink)}
                </span>
              </div>
            )
          }
          const { count, emoteKey, source, tsMs, slug } = entry
          const ts = Number.isFinite(tsMs) ? new Date(tsMs).toLocaleTimeString() : ''
          const isDgg = source === 'dgg'
          const colorKey = isDgg ? 'dgg' : (slug ? `kick:${slug}` : 'kick')
          const displayName = getEmbedDisplayName(colorKey)
          const accent = isDgg ? dggAccentColor : (getEmbedColor?.(colorKey, displayName) ?? omniColorForKey(colorKey, { displayName }))
          const badgeText = textColorOn(accent)
          const prefix = isDgg ? emoteKey : null
          const kickParts = !isDgg && emoteKey.startsWith('kick:') ? emoteKey.slice(5).split(':') : []
          const kickId = kickParts.length >= 1 ? Number(kickParts[0]) : 0
          const kickName = kickParts.length >= 2 ? kickParts.slice(1).join(':') : undefined
          const comboStepClass = count >= 50 ? 'x50' : count >= 30 ? 'x30' : count >= 20 ? 'x20' : count >= 10 ? 'x10' : count >= 5 ? 'x5' : 'x2'
          return (
            <div
              key={`combo-${source}-${emoteKey}-${tsMs}-${count}`}
              className={`msg-chat msg-emote text-sm px-2 py-0.5 -mx-2 flex flex-wrap items-center gap-2 ${comboStepClass}`}
              data-combo={count}
              data-combo-group={comboStepClass}
            >
              {showTimestamps ? <span className="text-xs text-base-content/50">{ts}</span> : null}
              {showSourceLabels && (isDgg ? (dggLabelText != null && dggLabelText.trim() !== '') : !getEmbedLabelHidden?.(colorKey)) ? (
                <span
                  className="badge badge-sm align-middle mr-2"
                  style={{ backgroundColor: accent, borderColor: accent, color: badgeText }}
                >
                  {source === 'dgg' ? (dggLabelText ?? '').trim() : (displayName || (slug ? `K:${slug}` : 'Kick'))}
                </span>
              ) : null}
              {showPlatformIcons && getPlatformIcon(colorKey) ? (
                <img
                  src={getPlatformIcon(colorKey)}
                  alt=""
                  className="w-4 h-4 shrink-0 align-middle"
                  aria-hidden
                />
              ) : null}
              <span className="inline-flex items-center gap-1 shrink-0">
                {isDgg && prefix ? (
                  <div
                    className={`emote ${prefix} cursor-pointer`}
                    title={`${prefix} (double-click to insert)`}
                    role="img"
                    aria-label={prefix}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleEmoteDoubleClick(prefix)
                    }}
                  />
                ) : Number.isFinite(kickId) && kickId > 0 ? (
                  renderKickEmote(kickId, kickName, `combo-kick-${entry.index}`)
                ) : null}
              </span>
              <span className={`chat-combo combo-complete ${comboStepClass} inline-flex items-center gap-1 text-base-content/70 text-xs`}>
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
      {!(overlayMode && inputContainerRef?.current) && inputBlock}
      {userTooltip && (
        <div
          ref={userTooltipRef}
          className="fixed z-[200] min-w-[200px] max-w-[320px] rounded-lg border border-base-300 bg-base-200 shadow-xl p-3 flex flex-col gap-2"
          style={{
            left: Math.min(userTooltipPosition.x, window.innerWidth - 340),
            top: userTooltipPosition.y + 8,
          }}
          role="dialog"
          aria-label="User info"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-semibold text-sm ${userTooltip.colorFlairName ? `user ${userTooltip.colorFlairName}` : ''}`}
            >
              {userTooltip.nick}
            </span>
            {userTooltip.features && userTooltip.features.length > 0 && (
              <span className="inline-flex items-center gap-0.5">
                {userTooltip.features
                  .filter((f) => flairsMapRef.current.has(f))
                  .map((f) => {
                    const fl = flairsMapRef.current.get(f)!
                    return (
                      <i key={f} className={`flair ${fl.name}`} title={fl.label} aria-hidden />
                    )
                  })}
              </span>
            )}
          </div>
          {userTooltip.createdDate && (
            <p className="text-xs text-base-content/70">
              Joined on{' '}
              <time dateTime={userTooltip.createdDate}>
                {new Date(userTooltip.createdDate).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </p>
          )}
          {userTooltip.watching?.platform && userTooltip.watching?.id && (
            <p className="text-xs text-base-content/70">
              Watching:{' '}
              <a
                href={`#${userTooltip.watching!.platform}/${userTooltip.watching!.id}`}
                className="link link-hover"
                onClick={(e) => {
                  e.preventDefault()
                  onOpenLink(`#${userTooltip.watching!.platform}/${userTooltip.watching!.id}`)
                  closeUserTooltip()
                }}
              >
                {userTooltip.watching.id} on {userTooltip.watching.platform}
              </a>
            </p>
          )}
          {userTooltip.matchingTerms && userTooltip.matchingTerms.length > 0 && contextMenuConfig?.removeHighlightTerm && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-base-300">
              <span className="text-xs text-base-content/60 w-full">Remove from highlight terms:</span>
              {userTooltip.matchingTerms.map((term) => (
                <button
                  key={term}
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => {
                    contextMenuConfig.removeHighlightTerm?.(term)
                    closeUserTooltip()
                  }}
                >
                  {term} ×
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-base-300">
            {userTooltip.source === 'dgg' && enableDgg && (
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => {
                  setActiveWhisperUsername(userTooltip!.nick)
                  setPrivViewOpen(true)
                  closeUserTooltip()
                }}
              >
                Whisper
              </button>
            )}
            <a
              href={`https://rustlesearch.dev/?username=${encodeURIComponent(userTooltip.nick)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-xs btn-ghost"
              onClick={() => closeUserTooltip()}
            >
              Rustlesearch
            </a>
          </div>
        </div>
      )}
      {contextMenuAt &&
        contextMenuConfig &&
        (() => {
          const menuW = 180
          const submenuW = 228
          const maxH = 420
          const pad = 8
          let left = Math.max(pad, Math.min(contextMenuAt.x, window.innerWidth - menuW - pad))
          const top = Math.max(pad, Math.min(contextMenuAt.y, window.innerHeight - maxH - pad))
          const submenuOnRight = left + menuW + submenuW + pad <= window.innerWidth
          const showSubmenuLeft = contextMenuHover && !submenuOnRight
          if (showSubmenuLeft) left = Math.max(pad, left - submenuW)
          return createPortal(
            <div
              ref={contextMenuDivRef}
              className="fixed z-[200] flex rounded-lg border border-base-300 bg-base-200 shadow-xl py-1 text-sm"
              style={{
                left,
                top,
                maxHeight: maxH,
                flexDirection: showSubmenuLeft ? 'row-reverse' : 'row',
              }}
              role="menu"
              onMouseLeave={() => setContextMenuHover(null)}
            >
              <div className="w-[180px] shrink-0 flex flex-col py-0.5">
                {contextMenuSelection && contextMenuConfig.addHighlightTerm && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="px-3 py-1.5 text-left hover:bg-base-300 w-full truncate"
                      onClick={() => {
                        contextMenuConfig.addHighlightTerm?.(contextMenuSelection)
                        closeContextMenu()
                      }}
                    >
                      Add &quot;{contextMenuSelection.length > 20 ? contextMenuSelection.slice(0, 20) + '…' : contextMenuSelection}&quot; to highlights
                    </button>
                    <div className="border-t border-base-300 my-1" />
                  </>
                )}
                <div
                  className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                  onMouseEnter={() => setContextMenuHover('display')}
                  role="menuitem"
                >
                  <span>Display</span>
                  <span aria-hidden className="text-base-content/50">▸</span>
                </div>
                <div
                  className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                  onMouseEnter={() => setContextMenuHover('order')}
                  role="menuitem"
                >
                  <span>Order</span>
                  <span aria-hidden className="text-base-content/50">▸</span>
                </div>
                <div
                  className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                  onMouseEnter={() => setContextMenuHover('emotes')}
                  role="menuitem"
                >
                  <span>Emotes</span>
                  <span aria-hidden className="text-base-content/50">▸</span>
                </div>
                <div
                  className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                  onMouseEnter={() => setContextMenuHover('links')}
                  role="menuitem"
                >
                  <span>Links</span>
                  <span aria-hidden className="text-base-content/50">▸</span>
                </div>
                <div
                  className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                  onMouseEnter={() => setContextMenuHover('paneSide')}
                  role="menuitem"
                >
                  <span>Chat pane side</span>
                  <span aria-hidden className="text-base-content/50">▸</span>
                </div>
                {contextMenuConfig.dgg && (
                  <div
                    className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                    onMouseEnter={() => setContextMenuHover('dgg')}
                    role="menuitem"
                  >
                    <span>DGG</span>
                    <span aria-hidden className="text-base-content/50">▸</span>
                  </div>
                )}
              </div>
              {contextMenuHover === 'display' && (
                <div
                  className={`w-[228px] shrink-0 bg-base-200 py-1 overflow-y-auto ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                  style={{ maxHeight: maxH - 8 }}
                  onMouseEnter={() => setContextMenuHover('display')}
                >
                  <button type="button" role="menuitemcheckbox" aria-checked={contextMenuConfig.display.showTimestamps} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.display.setShowTimestamps(!contextMenuConfig.display.showTimestamps); closeContextMenu() }}>
                    <span>Show timestamps</span>
                    {contextMenuConfig.display.showTimestamps && <span aria-hidden>✓</span>}
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={contextMenuConfig.display.showLabels} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.display.setShowLabels(!contextMenuConfig.display.showLabels); closeContextMenu() }}>
                    <span>Source labels</span>
                    {contextMenuConfig.display.showLabels && <span aria-hidden>✓</span>}
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={contextMenuConfig.display.showPlatformIcons} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.display.setShowPlatformIcons(!contextMenuConfig.display.showPlatformIcons); closeContextMenu() }}>
                    <span>Platform icons</span>
                    {contextMenuConfig.display.showPlatformIcons && <span aria-hidden>✓</span>}
                  </button>
                  <button type="button" role="menuitemcheckbox" aria-checked={contextMenuConfig.display.showDggFlairsAndColors} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.display.setShowDggFlairsAndColors(!contextMenuConfig.display.showDggFlairsAndColors); closeContextMenu() }}>
                    <span>DGG flairs and colors</span>
                    {contextMenuConfig.display.showDggFlairsAndColors && <span aria-hidden>✓</span>}
                  </button>
                </div>
              )}
              {contextMenuHover === 'order' && (
                <div
                  className={`w-[228px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                  style={{ maxHeight: maxH - 8 }}
                  onMouseEnter={() => setContextMenuHover('order')}
                >
                  <button type="button" role="menuitemradio" aria-checked={contextMenuConfig.order.sortMode === 'timestamp'} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.order.setSortMode('timestamp'); closeContextMenu() }}>
                    <span>By timestamp</span>
                    {contextMenuConfig.order.sortMode === 'timestamp' && <span aria-hidden>✓</span>}
                  </button>
                  <button type="button" role="menuitemradio" aria-checked={contextMenuConfig.order.sortMode === 'arrival'} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.order.setSortMode('arrival'); closeContextMenu() }}>
                    <span>By arrival</span>
                    {contextMenuConfig.order.sortMode === 'arrival' && <span aria-hidden>✓</span>}
                  </button>
                </div>
              )}
              {contextMenuHover === 'emotes' && (
                <div
                  className={`w-[228px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                  onMouseEnter={() => setContextMenuHover('emotes')}
                >
                  <button type="button" role="menuitemcheckbox" aria-checked={contextMenuConfig.emotes.pauseOffScreen} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.emotes.setPauseOffScreen(!contextMenuConfig.emotes.pauseOffScreen); closeContextMenu() }}>
                    <span>Pause animations when off-screen</span>
                    {contextMenuConfig.emotes.pauseOffScreen && <span aria-hidden>✓</span>}
                  </button>
                </div>
              )}
              {contextMenuHover === 'links' && (
                <div
                  className={`w-[228px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                  onMouseEnter={() => setContextMenuHover('links')}
                >
                  {(['none', 'clipboard', 'browser', 'viewer'] as const).map((action) => (
                    <button key={action} type="button" role="menuitemradio" aria-checked={contextMenuConfig.linkAction.value === action} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.linkAction.setValue(action); closeContextMenu() }}>
                      <span>{action === 'none' ? "Don't open" : action === 'clipboard' ? 'Copy to clipboard' : action === 'browser' ? 'Open in browser' : 'Open in Viewer'}</span>
                      {contextMenuConfig.linkAction.value === action && <span aria-hidden>✓</span>}
                    </button>
                  ))}
                </div>
              )}
              {contextMenuHover === 'paneSide' && (
                <div
                  className={`w-[228px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                  onMouseEnter={() => setContextMenuHover('paneSide')}
                >
                  <button type="button" role="menuitemradio" aria-checked={contextMenuConfig.paneSide.value === 'left'} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.paneSide.setPaneSide('left'); closeContextMenu() }}>
                    <span>Left</span>
                    {contextMenuConfig.paneSide.value === 'left' && <span aria-hidden>✓</span>}
                  </button>
                  <button type="button" role="menuitemradio" aria-checked={contextMenuConfig.paneSide.value === 'right'} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.paneSide.setPaneSide('right'); closeContextMenu() }}>
                    <span>Right</span>
                    {contextMenuConfig.paneSide.value === 'right' && <span aria-hidden>✓</span>}
                  </button>
                </div>
              )}
              {contextMenuHover === 'dgg' && contextMenuConfig.dgg && (
                <div
                  className={`w-[228px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                  onMouseEnter={() => setContextMenuHover('dgg')}
                >
                  <button type="button" role="menuitemcheckbox" aria-checked={contextMenuConfig.dgg.showInput} className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2" onClick={() => { contextMenuConfig.dgg!.setShowInput(!contextMenuConfig.dgg!.showInput); closeContextMenu() }}>
                    <span>Show chat input</span>
                    {contextMenuConfig.dgg.showInput && <span aria-hidden>✓</span>}
                  </button>
                </div>
              )}
            </div>,
            document.body
          )
        })()}
    </div>
  )
}

