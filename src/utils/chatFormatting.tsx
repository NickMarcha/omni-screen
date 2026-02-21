/**
 * Shared chat message formatting: links (incl. short links), greentext, suspost,
 * emotes, mentions, NSFL/NSFW/SPOILERS, URL normalization.
 * Used by CombinedChat and DebugPage.
 */

import type { ReactNode } from 'react'
import { Fragment } from 'react'

export interface ChatFormattingOptions {
  styleSensitiveLinks?: boolean
  normalizeUrls?: boolean
}

const NSFW_REGEX = /\bNSFW\b/i
const NSFL_REGEX = /\bNSFL\b/i
const SPOILERS_REGEX = /\bSPOILERS\b/i

/** Matches http(s) URLs, hash links (#kick/#twitch/#youtube), and bare-domain short links */
export const LINK_REGEX = /(https?:\/\/[^\s]+|#(?:kick|twitch|youtube)\/[^\s]+|(?:www\.)?(?:youtube\.com|youtu\.be|kick\.com|twitch\.tv)(?:\/[^\s]*)?)/gi

export function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Normalize URL: strip tracking params from Twitter/YouTube/Instagram (when options.normalizeUrls) */
export function normalizeUrl(url: string, options?: ChatFormattingOptions): string {
  if (!options?.normalizeUrls) return url
  try {
    if (/(x|twitter)\.com\/\w{1,15}\/status\/\d{2,19}\?/i.test(url)) {
      return url.split('?')[0]
    }
    if (/^(?:(?:https|http):\/\/)?(?:www\.)?youtu(?:be\.com|\.be)/i.test(url)) {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`)
      u.searchParams.delete('si')
      return u.toString()
    }
    if (/^(?:(?:https?):\/\/)?(?:www\.)?instagram\.com/i.test(url)) {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`)
      u.searchParams.delete('igsh')
      return u.toString()
    }
  } catch {
    // ignore
  }
  return url
}

/** Get extra CSS classes for sensitive links (NSFL/NSFW/SPOILERS) when options.styleSensitiveLinks */
export function getLinkSensitiveClasses(url: string, options?: ChatFormattingOptions): string {
  if (!options?.styleSensitiveLinks) return ''
  if (NSFL_REGEX.test(url)) return 'nsfl-link'
  if (NSFW_REGEX.test(url)) return 'nsfw-link'
  if (SPOILERS_REGEX.test(url)) return 'spoilers-link'
  return ''
}

export function processTextWithEmotes(
  text: string,
  emotePattern: RegExp | null,
  emotesMap: Map<string, string>,
  baseKey: number = 0,
  onEmoteDoubleClick?: (prefix: string) => void,
): (string | ReactNode)[] {
  if (!emotePattern || emotesMap.size === 0) return [text]

  emotePattern.lastIndex = 0
  const parts: (string | ReactNode)[] = []
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

const GREENTEXT_STYLE: React.CSSProperties = {
  color: 'rgb(108, 165, 40)',
  fontFamily: '"Roboto", Helvetica, "Trebuchet MS", Verdana, sans-serif',
  boxSizing: 'border-box',
  textRendering: 'optimizeLegibility',
  overflowWrap: 'break-word',
  lineHeight: 1.6,
}

/** Sinhala char U+0D9E (Among Us crewmate) for suspost */
const SUS_CHAR = '\u0D9E'

/** Process greentext (> at line start) and suspost (ඞ at line start). */
export function processGreentext(
  text: string,
  emotePattern: RegExp | null,
  emotesMap: Map<string, string>,
  baseKey: number = 0,
  onEmoteDoubleClick?: (prefix: string) => void,
): (string | ReactNode)[] {
  const lines = text.split('\n')
  const parts: (string | ReactNode)[] = []
  let keyCounter = baseKey

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim()
    const isSuspost = trimmed.startsWith(SUS_CHAR)
    const isGreentext = !isSuspost && trimmed.startsWith('>')
    const processedLine = processTextWithEmotes(line, emotePattern, emotesMap, keyCounter, onEmoteDoubleClick)
    processedLine.forEach((part) => {
      if (isSuspost) {
        parts.push(
          <span key={`suspost-${keyCounter++}`} className="sus">
            {part}
          </span>,
        )
      } else if (isGreentext) {
        parts.push(
          <span key={`greentext-${keyCounter++}`} className="msg-chat-greentext" style={GREENTEXT_STYLE}>
            {part}
          </span>,
        )
      } else {
        parts.push(part)
        keyCounter++
      }
    })

    if (lineIndex < lines.length - 1) parts.push('\n')
  })

  return parts.length > 0 ? parts : [text]
}

export type PrimaryChatContentSegment = { type: 'text'; value: string } | { type: 'nick'; value: string }

function tokenizeNicksInText(text: string, re: RegExp): PrimaryChatContentSegment[] {
  const segments: PrimaryChatContentSegment[] = []
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

export function tokenizePrimaryChatContent(content: string, nicks: string[]): PrimaryChatContentSegment[] {
  if (!content) return [{ type: 'text', value: '' }]
  if (nicks.length === 0) return [{ type: 'text', value: content }]
  const sorted = [...nicks].filter((n) => n.length > 0).sort((a, b) => b.length - a.length)
  const escaped = sorted.map((n) => escapeRegexLiteral(n))
  const nickRe = new RegExp(`(?<!\\w)(${escaped.join('|')})(?!\\w)`, 'gi')
  const segments: PrimaryChatContentSegment[] = []
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

export interface RenderTextWithLinksParams {
  text: string
  emotePattern: RegExp | null
  emotesMap: Map<string, string>
  onOpenLink?: (url: string) => void
  onEmoteDoubleClick?: (prefix: string) => void
  skipGreentext?: boolean
  skipSuspost?: boolean
  options?: ChatFormattingOptions
}

export function renderTextWithLinks(params: RenderTextWithLinksParams): ReactNode {
  const {
    text,
    emotePattern,
    emotesMap,
    onOpenLink,
    onEmoteDoubleClick,
    skipGreentext = false,
    skipSuspost = false,
    options,
  } = params

  const parts: (string | ReactNode)[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasLinks = false
  let keyCounter = 0

  const processSegment = (seg: string) => {
    if (skipGreentext || skipSuspost) {
      return processTextWithEmotes(seg, emotePattern, emotesMap, keyCounter, onEmoteDoubleClick)
    }
    return processGreentext(seg, emotePattern, emotesMap, keyCounter, onEmoteDoubleClick)
  }

  LINK_REGEX.lastIndex = 0
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

    const rawUrl = match[0]
    const isHashLink = rawUrl.startsWith('#')
    const href = isHashLink ? '#' : (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    const displayUrl = options?.normalizeUrls && !isHashLink ? normalizeUrl(href, options) : (isHashLink ? rawUrl : href)
    const sensitiveClasses = getLinkSensitiveClasses(rawUrl, options)

    parts.push(
      <a
        key={`link-${keyCounter++}`}
        href={isHashLink ? '#' : displayUrl}
        target={isHashLink ? undefined : '_blank'}
        rel={isHashLink ? undefined : 'noopener noreferrer'}
        className={`link link-primary break-words overflow-wrap-anywhere ${sensitiveClasses}`.trim()}
        onClick={(e) => {
          if (onOpenLink) {
            e.preventDefault()
            e.stopPropagation()
            onOpenLink(rawUrl)
          }
        }}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {displayUrl}
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

export interface RenderPrimaryChatMessageContentParams {
  content: string
  primaryChatNicks: string[]
  emotePattern: RegExp | null
  emotesMap: Map<string, string>
  onOpenLink?: (url: string) => void
  onEmoteDoubleClick?: (prefix: string) => void
  onNickDoubleClick?: (nick: string) => void
  onUserTooltip?: (e: React.MouseEvent, nick: string) => void
  /** Left-click to focus/unfocus this user (dim others). */
  onUserFocusClick?: (nick: string) => void
  options?: ChatFormattingOptions
}

export function renderPrimaryChatMessageContent(params: RenderPrimaryChatMessageContentParams): ReactNode {
  const {
    content,
    primaryChatNicks,
    emotePattern,
    emotesMap,
    onOpenLink,
    onEmoteDoubleClick,
    onNickDoubleClick,
    onUserTooltip,
    onUserFocusClick,
    options,
  } = params

  const lines = (content ?? '').split('\n')
  const parts: ReactNode[] = []
  let key = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    const isGreentext = line.trim().startsWith('>')
    const isSuspost = line.trim().startsWith(SUS_CHAR)
    const lineSegments = tokenizePrimaryChatContent(line, primaryChatNicks)
    const lineParts: ReactNode[] = []

    for (const seg of lineSegments) {
      if (seg.type === 'text') {
        lineParts.push(
          <Fragment key={`pchat-txt-${key++}`}>
            {renderTextWithLinks({
              text: seg.value,
              emotePattern,
              emotesMap,
              onOpenLink,
              onEmoteDoubleClick,
              skipGreentext: isGreentext,
              skipSuspost: isSuspost,
              options,
            })}
          </Fragment>,
        )
      } else {
        const treatAsEmote = emotesMap.has(seg.value)
        if (treatAsEmote) {
          lineParts.push(
            <Fragment key={`pchat-txt-${key++}`}>
              {renderTextWithLinks({
                text: seg.value,
                emotePattern,
                emotesMap,
                onOpenLink,
                onEmoteDoubleClick,
                skipGreentext: isGreentext,
                skipSuspost: isSuspost,
                options,
              })}
            </Fragment>,
          )
        } else {
          lineParts.push(
            <span
              key={`pchat-nick-${key++}`}
              className={`primary-chat-mention hover:underline ${onUserFocusClick ? 'cursor-pointer' : 'cursor-context-menu'}`}
              onClick={
                onUserFocusClick
                  ? (e) => {
                      e.stopPropagation()
                      if (seg.value?.trim()) onUserFocusClick(seg.value.trim())
                    }
                  : undefined
              }
              onContextMenu={onUserTooltip ? (e) => onUserTooltip(e, seg.value) : undefined}
              onDoubleClick={onNickDoubleClick ? () => onNickDoubleClick(seg.value) : undefined}
              onMouseUp={(e) => e.stopPropagation()}
            >
              {seg.value}
            </span>,
          )
        }
      }
    }

    if (isSuspost) {
      parts.push(
        <span key={`suspost-wrap-${key++}`} className="sus">
          {lineParts}
        </span>,
      )
    } else if (isGreentext) {
      parts.push(
        <span key={`greentext-${key++}`} className="msg-chat-greentext" style={GREENTEXT_STYLE}>
          {lineParts}
        </span>,
      )
    } else {
      parts.push(...lineParts)
    }

    if (lineIndex < lines.length - 1) parts.push(<Fragment key={`nl-${key++}`}>{'\n'}</Fragment>)
  }

  return <>{parts}</>
}
