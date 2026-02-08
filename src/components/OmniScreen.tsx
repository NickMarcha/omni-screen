import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import * as d3 from 'd3'
import KickEmbed from './embeds/KickEmbed'
import TwitchEmbed from './embeds/TwitchEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import CombinedChat, { type CombinedChatContextMenuConfig } from './CombinedChat'
import { LiteLinkScroller, type LiteLinkScrollerSettings } from './LiteLinkScroller'
import { buildLinkCardsFromMessage } from './LinkScroller'
import type { LinkCard } from './LinkScroller'
import danTheBuilderBg from '../assets/media/DanTheBuilder.png'
import autoplayIcon from '../assets/icons/autoplay.png'
import autoplayPausedIcon from '../assets/icons/autoplay-paused.png'
import { omniColorForKey, textColorOn, withAlpha, COLOR_BOOKMARKED_DEFAULT } from '../utils/omniColors'

/** Log to console and to app log file (so user can search logs without DevTools). */
function logPinned(message: string, detail?: unknown) {
  const line = detail !== undefined ? `${message} ${JSON.stringify(detail)}` : message
  console.log('[OmniScreen:pinned]', message, detail !== undefined ? detail : '')
  try {
    window.ipcRenderer?.invoke('log-to-file', 'info', `[OmniScreen:pinned] ${line}`, [])
  } catch {
    // ignore
  }
}

type ChatPaneSide = 'left' | 'right'
type CombinedSortMode = 'timestamp' | 'arrival'

type LiveWsMessage =
  | { type: 'dggApi:embeds'; data: LiveEmbed[] }
  | { type: 'dggApi:bannedEmbeds'; data: BannedEmbed[] | null }
  | { type: string; data: any }

interface LiveEmbed {
  platform: string
  id: string
  count?: number
  mediaItem?: {
    identifier?: { platform?: string; mediaId?: string }
    metadata?: {
      previewUrl?: string
      displayName?: string
      title?: string
      createdDate?: string
      live?: boolean
      viewers?: number | null
    }
  }
}

interface BannedEmbed {
  platform: string
  name: string
  reason?: string
}

/** Bookmarked streamer: up to 3 platforms (YouTube channel, Kick, Twitch); optional nickname and accent color. */
export interface PinnedStreamer {
  id: string
  nickname: string
  youtubeChannelId?: string
  kickSlug?: string
  twitchLogin?: string
  /** Hex color for dock button (e.g. #7dcf67). */
  color?: string
  /** Per-platform hex for combined chat; undefined = use dock color. */
  youtubeColor?: string
  kickColor?: string
  twitchColor?: string
  /** When true, preferred video auto-opens when this streamer is detected as live. */
  openWhenLive?: boolean
  /** When true, hide the source label (badge) in combined chat for this streamer's messages. */
  hideLabelInCombinedChat?: boolean
}

function makeEmbedKey(platform: string, id: string) {
  const p = String(platform || '').toLowerCase()
  const rawId = String(id || '')
  // YouTube video IDs are case-sensitive (11-char A-Za-z0-9_-); preserve exact casing. Other platforms normalize to lowercase.
  const normalizedId = p === 'youtube' ? rawId : rawId.toLowerCase()
  return `${p}:${normalizedId}`
}

function makeLegacyEmbedKey(platform: string, id: string) {
  // Previous behavior: lowercased everything. Keep to migrate persisted selections.
  return `${String(platform || '').toLowerCase()}:${String(id || '').toLowerCase()}`
}

function makeViewTransitionNameForKey(key: string) {
  // `view-transition-name` must be a valid CSS identifier-ish token.
  // Keep it deterministic and stable across reorders.
  return `omni-embed-${String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')}`
}

type PieDatum = { name: string; value: number; color?: string }

/** Donut + labels outside with polylines (D3 example style). Hover tooltips show name, value, %. */
function midAngle(d: d3.PieArcDatum<PieDatum>) {
  return d.startAngle + (d.endAngle - d.startAngle) / 2
}

/** Prefer showing labels for larger slices; hide labels that overlap on the y-axis. */
function visibleLabelIndices(
  arcs: d3.PieArcDatum<PieDatum>[],
  labelArc: d3.Arc<any, d3.PieArcDatum<PieDatum>>,
  yThreshold: number,
): Set<number> {
  const sortedByValue = arcs
    .map((arc, i) => ({ arc, i }))
    .sort((a, b) => b.arc.data.value - a.arc.data.value)
  const visible = new Set<number>()
  for (const { arc, i } of sortedByValue) {
    const y = labelArc.centroid(arc)[1]
    const overlaps = [...visible].some((j) => {
      const yOther = labelArc.centroid(arcs[j])[1]
      return Math.abs(y - yOther) < yThreshold
    })
    if (!overlaps) visible.add(i)
  }
  return visible
}

const LABEL_Y_OVERLAP_THRESHOLD = 10

function PieChartSvg({
  data,
  fallbackColor,
  size,
  outerRadius,
}: {
  data: PieDatum[]
  fallbackColor: string
  size: number
  outerRadius: number
}) {
  const [hovered, setHovered] = useState<PieDatum | null>(null)
  const cx = size / 2
  const cy = size / 2
  const radius = outerRadius
  const pie = d3.pie<PieDatum>().sort(null).value((d) => d.value)
  const arcs = pie(data)
  const arcGen = d3
    .arc<d3.PieArcDatum<PieDatum>>()
    .innerRadius(radius * 0.4)
    .outerRadius(radius * 0.8)
  const labelArc = d3
    .arc<d3.PieArcDatum<PieDatum>>()
    .innerRadius(radius * 0.9)
    .outerRadius(radius * 0.9)
  const total = data.reduce((s, d) => s + d.value, 0)
  const showLabel = useMemo(() => {
    const arc = d3.arc<d3.PieArcDatum<PieDatum>>().innerRadius(radius * 0.9).outerRadius(radius * 0.9)
    return visibleLabelIndices(arcs, arc, LABEL_Y_OVERLAP_THRESHOLD)
  }, [arcs, radius])
  const labelPadding = 70
  const svgViewWidth = size + 2 * labelPadding
  return (
    <div className="relative flex flex-col items-center" style={{ width: svgViewWidth, minHeight: size }}>
      <svg width={svgViewWidth} height={size} viewBox={`-${labelPadding} 0 ${svgViewWidth} ${size}`} className="block mx-auto" preserveAspectRatio="xMidYMid meet">
        <g transform={`translate(${cx},${cy})`}>
          {arcs.map((arc, i) => {
            const pct = total > 0 ? Math.round((100 * arc.data.value) / total) : 0
            const isHovered = hovered === arc.data
            const mid = midAngle(arc)
            const labelPos: [number, number] = [
              radius * 0.95 * (mid < Math.PI ? 1 : -1),
              labelArc.centroid(arc)[1],
            ]
            const arcCentroid = arcGen.centroid(arc)
            const labelCentroid = labelArc.centroid(arc)
            const polylinePoints: [number, number][] = [
              arcCentroid,
              labelCentroid,
              labelPos,
            ]
            const labelVisible = showLabel.has(i)
            return (
              <g
                key={`${arc.data.name}-${i}`}
                onMouseEnter={() => setHovered(arc.data)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>
                  {arc.data.name}: {arc.data.value.toLocaleString()} ({pct}%)
                </title>
                <path
                  className="slice"
                  d={arcGen(arc) ?? ''}
                  fill={arc.data.color ?? fallbackColor}
                  stroke="var(--color-base-100)"
                  strokeWidth={2}
                  style={{ opacity: isHovered ? 1 : hovered ? 0.6 : 1 }}
                />
                {labelVisible ? (
                  <polyline
                    points={polylinePoints.map((p) => p.join(',')).join(' ')}
                    fill="none"
                    stroke="var(--color-base-content)"
                    strokeWidth={2}
                    opacity={0.3}
                    className="pointer-events-none"
                  />
                ) : null}
                {labelVisible ? (
                  <text
                    transform={`translate(${labelPos[0]},${labelPos[1]})`}
                    textAnchor={mid < Math.PI ? 'start' : 'end'}
                    dominantBaseline="middle"
                    className="fill-base-content text-[10px] font-medium pointer-events-none"
                    dy="0.35em"
                  >
                    {arc.data.name} {pct}%
                  </text>
                ) : null}
              </g>
            )
          })}
        </g>
      </svg>
      {hovered && total > 0 ? (
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-full z-[100] mb-1 text-xs text-base-content/80 text-center px-2 py-1 rounded bg-base-200 shadow border border-base-300 pointer-events-none"
          style={{ whiteSpace: 'nowrap' }}
        >
          <span className="font-medium">{hovered.name}</span>
          <br />
          {hovered.value.toLocaleString()} ({Math.round((100 * hovered.value) / total)}%)
        </div>
      ) : null}
    </div>
  )
}

const CHANNEL_LABEL_MAX = 20

/** Short label for pinned streamer channel: e.g. "destiny" from "https://www.youtube.com/destiny". Up to CHANNEL_LABEL_MAX chars. */
function shortChannelLabel(value: string, kind: 'yt' | 'kick' | 'twitch'): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (kind === 'kick' || kind === 'twitch') return v.length <= CHANNEL_LABEL_MAX ? v : v.slice(0, CHANNEL_LABEL_MAX) + '…'
  if (v.includes('youtube.com/') || v.includes('youtu.be/')) {
    try {
      const url = v.startsWith('http') ? v : `https://${v}`
      const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '')
      const segments = path.split('/').filter(Boolean)
      const last = segments[segments.length - 1] || ''
      if (last === 'channel' || last === 'c' || last === 'user') return last
      if (/^UC[\w-]{20,}$/i.test(last)) return 'channel'
      const label = last || v.slice(0, CHANNEL_LABEL_MAX)
      return label.length <= CHANNEL_LABEL_MAX ? label : label.slice(0, CHANNEL_LABEL_MAX) + '…'
    } catch {
      return v.slice(0, CHANNEL_LABEL_MAX) + (v.length > CHANNEL_LABEL_MAX ? '…' : '')
    }
  }
  if (/^UC[\w-]{20,}$/i.test(v)) return 'channel'
  return v.slice(0, CHANNEL_LABEL_MAX) + (v.length > CHANNEL_LABEL_MAX ? '…' : '')
}

/** Full URL for a pinned streamer platform value (YouTube channel, Kick streamer, Twitch channel). */
function platformChannelUrl(value: string, kind: 'yt' | 'kick' | 'twitch'): string {
  const v = (value || '').trim()
  if (!v) return '#'
  if (kind === 'kick') return `https://kick.com/${v}`
  if (kind === 'twitch') return `https://twitch.tv/${v}`
  if (v.startsWith('http://') || v.startsWith('https://')) return v
  if (v.includes('youtube.com') || v.includes('youtu.be')) return v.startsWith('http') ? v : `https://${v}`
  if (/^UC[\w-]+$/i.test(v)) return `https://www.youtube.com/channel/${v}`
  return `https://www.youtube.com/${v}`
}

function formatDggFocusKeybind(kb: { key: string; ctrl: boolean; shift: boolean; alt: boolean }): string {
  const parts: string[] = []
  if (kb.ctrl) parts.push('Ctrl')
  if (kb.alt) parts.push('Alt')
  if (kb.shift) parts.push('Shift')
  const key = kb.key === ' ' ? 'Space' : kb.key
  parts.push(key)
  return parts.join(' + ')
}

function startViewTransitionIfSupported(run: () => void) {
  const anyDoc = document as any
  if (typeof anyDoc?.startViewTransition === 'function') {
    anyDoc.startViewTransition(() => {
      flushSync(() => {
        run()
      })
    })
    return
  }
  run()
}

function parseEmbedKey(key: string): { platform: string; id: string } | null {
  const k = String(key || '')
  const idx = k.indexOf(':')
  if (idx <= 0) return null
  const platform = k.slice(0, idx).toLowerCase()
  const id = k.slice(idx + 1)
  if (!platform || !id) return null
  return { platform, id }
}

/** Return canonical key: platform lowercased; YouTube ID preserved (case-sensitive); other IDs lowercased. */
function canonicalEmbedKey(key: string): string {
  const parsed = parseEmbedKey(key)
  return parsed ? makeEmbedKey(parsed.platform, parsed.id) : key
}

/** Find all pinned streamers that own this embed key (same key can belong to multiple streamers, e.g. same YT stream). */
function findStreamersForKey(
  key: string,
  streamers: PinnedStreamer[],
  youtubeVideoToStreamerIds?: Map<string, string[]>
): PinnedStreamer[] {
  const parsed = parseEmbedKey(key)
  if (!parsed) return []
  const { platform, id } = parsed
  const idLower = id.toLowerCase()
  const result: PinnedStreamer[] = []
  for (const s of streamers) {
    if (platform === 'kick' && s.kickSlug && s.kickSlug.toLowerCase() === idLower) result.push(s)
    else if (platform === 'twitch' && s.twitchLogin && s.twitchLogin.toLowerCase() === idLower) result.push(s)
    else if (platform === 'youtube' && youtubeVideoToStreamerIds) {
      // YouTube video IDs are case-sensitive; use exact key only (no lowercase fallback).
      const ids = youtubeVideoToStreamerIds.get(key) ?? youtubeVideoToStreamerIds.get(`youtube:${id}`)
      if (ids?.includes(s.id)) result.push(s)
    }
  }
  return result
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function getBestGridColumns(opts: { count: number; width: number; height: number; gapPx?: number; headerHeightPx?: number }): number {
  const { count, width, height } = opts
  const n = Number(count)
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(n) || n <= 1) return 1
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return Math.min(Math.max(0, n), 2)

  // Tailwind gap-3 = 0.75rem = 12px
  const gap = Number.isFinite(opts.gapPx) ? Math.max(0, Math.floor(opts.gapPx as number)) : 12
  // Our cards have a small header; approximate so we don't overflow vertically.
  const headerHeight = Number.isFinite(opts.headerHeightPx) ? Math.max(0, Math.floor(opts.headerHeightPx as number)) : 56
  const aspectW = 16
  const aspectH = 9

  const maxCols = Math.min(n, 6) // cap so it doesn't get silly
  let bestCols = 1
  let bestArea = 0

  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(n / cols)
    const colW = (w - gap * (cols - 1)) / cols
    const rowH = (h - gap * (rows - 1)) / rows

    // available height for video portion after header
    const videoMaxH = Math.max(0, rowH - headerHeight)
    if (colW <= 0 || videoMaxH <= 0) continue

    // Our embeds are inherently 16:9; constrain by both width and height.
    const videoW = Math.min(colW, (videoMaxH * aspectW) / aspectH)
    const videoH = (videoW * aspectH) / aspectW
    const area = videoW * videoH

    if (area > bestArea) {
      bestArea = area
      bestCols = cols
    }
  }

  // If nothing fit (very small window), use the max cols to reduce overflow.
  if (bestArea === 0) return maxCols
  return bestCols
}

function buildYouTubeEmbed(id: string) {
  const url = `https://www.youtube.com/watch?v=${id}`
  const embedUrl = `https://www.youtube.com/embed/${id}`
  return { url, embedUrl }
}

function isLikelyYouTubeId(id: string) {
  return /^[a-zA-Z0-9_-]{8,20}$/.test(id)
}

/** Destiny-style # links: #kick/dggjams, #twitch/whatever, #youtube/videoId */
function parseDestinyHashLink(s: string): { platform: string; id: string } | null {
  const m = String(s || '').trim().match(/^#(kick|twitch|youtube)\/([^\s]+)$/i)
  if (!m) return null
  const platform = m[1].toLowerCase()
  const id = m[2].trim()
  return id ? { platform, id } : null
}

/** Build canonical embed URL from platform + id (for addEmbedFromUrl). */
function buildEmbedUrl(platform: string, id: string): string {
  const p = platform.toLowerCase()
  const cleanId = id.trim()
  if (p === 'youtube') return `https://www.youtube.com/watch?v=${cleanId}`
  if (p === 'kick') return `https://kick.com/${cleanId}`
  if (p === 'twitch') return `https://www.twitch.tv/${cleanId}`
  return `https://${p}.com/${cleanId}`
}

/** Parse supported embed URLs into platform + id. Returns null if not supported. */
function parseEmbedUrl(url: string): { platform: string; id: string } | null {
  const s = String(url || '').trim()
  if (!s) return null
  const hashParsed = parseDestinyHashLink(s)
  if (hashParsed) return hashParsed
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    const host = (u.hostname || '').toLowerCase()
    // YouTube: youtube.com/watch?v=ID, youtu.be/ID
    if (host === 'www.youtube.com' || host === 'youtube.com') {
      const v = u.searchParams.get('v')
      if (v && isLikelyYouTubeId(v)) return { platform: 'youtube', id: v }
    }
    if (host === 'youtu.be') {
      const id = (u.pathname || '').replace(/^\/+/, '').split('/')[0]
      if (id && isLikelyYouTubeId(id)) return { platform: 'youtube', id }
    }
    // Kick: kick.com/channelname
    if (host === 'www.kick.com' || host === 'kick.com') {
      const m = (u.pathname || '').match(/^\/([^/]+)/)
      if (m && m[1]) return { platform: 'kick', id: m[1].toLowerCase() }
    }
    // Twitch: twitch.tv/channelname
    if (host === 'www.twitch.tv' || host === 'twitch.tv') {
      const m = (u.pathname || '').match(/^\/([^/]+)/)
      if (m && m[1]) return { platform: 'twitch', id: m[1].toLowerCase() }
    }
  } catch {
    // ignore
  }
  return null
}

export default function OmniScreen({ onBackToMenu }: { onBackToMenu?: () => void }) {
  // ---- Live WS (embeds list) ----
  const [availableEmbeds, setAvailableEmbeds] = useState<Map<string, LiveEmbed>>(new Map())
  const [bannedEmbeds, setBannedEmbeds] = useState<Map<string, BannedEmbed>>(new Map())

  // ---- Pinned embeds (temporary; from pasted links or "Pin" from dock) ----
  const [pinnedEmbeds, setPinnedEmbeds] = useState<Map<string, LiveEmbed>>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:pinned-embeds') ?? localStorage.getItem('omni-screen:manual-embeds')
      if (!raw) return new Map()
      const arr = JSON.parse(raw) as Array<{ key: string; platform: string; id: string; title?: string }>
      if (!Array.isArray(arr)) return new Map()
      const m = new Map<string, LiveEmbed>()
      arr.forEach((item) => {
        if (item?.key && item?.platform && item?.id) {
          m.set(item.key, {
            platform: item.platform,
            id: item.id,
            mediaItem: item.title ? { metadata: { displayName: item.title, title: item.title } } : undefined,
          })
        }
      })
      return m
    } catch {
      return new Map()
    }
  })

  // ---- Selection + layout ----
  const [selectedEmbedKeys, setSelectedEmbedKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:selected-embeds')
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return new Set()
      return new Set(arr.filter((x) => typeof x === 'string').map((k) => canonicalEmbedKey(k)))
    } catch {
      return new Set()
    }
  })

  const [selectedEmbedChatKeys, setSelectedEmbedChatKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:selected-embed-chats')
      if (!raw) return new Set()
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return new Set()
      return new Set(arr.filter((x) => typeof x === 'string').map((k) => canonicalEmbedKey(k)))
    } catch {
      return new Set()
    }
  })

  /** When set, the embed tile with this key shows a short shake (e.g. after clicking # link for already-selected embed). */
  const [shakeEmbedKey, setShakeEmbedKey] = useState<string | null>(null)
  const selectedEmbedKeysRef = useRef(selectedEmbedKeys)
  selectedEmbedKeysRef.current = selectedEmbedKeys
  const selectedEmbedChatKeysRef = useRef(selectedEmbedChatKeys)
  selectedEmbedChatKeysRef.current = selectedEmbedChatKeys
  const handleDestinyLinkRef = useRef<(platform: string, id: string) => void>(() => {})

  const [autoplay, setAutoplay] = useState(true)
  const [mute, setMute] = useState(true)
  const [cinemaMode, setCinemaMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:cinema-mode')
    if (saved === '1' || saved === 'true') return true
    return false
  })
  const [dockAtTop, setDockAtTop] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:dock-at-top')
    return saved === '1' || saved === 'true'
  })

  // ---- Chat pane (combined chat only; DGG is included via combined chat) ----
  const [chatPaneOpen, setChatPaneOpen] = useState(true)
  const [combinedIncludeDgg, setCombinedIncludeDgg] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:combined-include-dgg')
    if (saved === '0' || saved === 'false') return false
    return true
  })
  const initialCombinedMaxMessages = useMemo(() => {
    const saved = Number(localStorage.getItem('omni-screen:combined-max-messages'))
    return Number.isFinite(saved) && saved >= 50 ? Math.floor(saved) : 70
  }, [])
  const [combinedMaxMessages, setCombinedMaxMessages] = useState<number>(initialCombinedMaxMessages)
  const [combinedMaxMessagesDraft, setCombinedMaxMessagesDraft] = useState<string>(() => String(initialCombinedMaxMessages))
  const initialCombinedMaxMessagesScroll = useMemo(() => {
    const saved = Number(localStorage.getItem('omni-screen:combined-max-messages-scroll'))
    return Number.isFinite(saved) && saved >= 50 ? Math.floor(saved) : 5000
  }, [])
  const [combinedMaxMessagesScroll, setCombinedMaxMessagesScroll] = useState<number>(initialCombinedMaxMessagesScroll)
  const [combinedMaxMessagesScrollDraft, setCombinedMaxMessagesScrollDraft] = useState<string>(() => String(initialCombinedMaxMessagesScroll))
  const [combinedShowTimestamps, setCombinedShowTimestamps] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:combined-show-timestamps')
    if (saved === '0' || saved === 'false') return false
    return true
  })
  const [combinedShowLabels, setCombinedShowLabels] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:combined-show-labels')
    if (saved === '0' || saved === 'false') return false
    return true
  })
  const [combinedShowPlatformIcons, setCombinedShowPlatformIcons] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:combined-show-platform-icons')
    if (saved === '1' || saved === 'true') return true
    return false
  })
  const [combinedSortMode, setCombinedSortMode] = useState<CombinedSortMode>(() => {
    const saved = localStorage.getItem('omni-screen:combined-sort-mode')
    return saved === 'timestamp' ? 'timestamp' : 'arrival'
  })
  const [youTubePollMultiplier, setYouTubePollMultiplier] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:youtube-poll-multiplier'))
    return Number.isFinite(saved) && saved > 0 ? saved : 1
  })
  /** Multiplier for pinned streamers' YouTube live check interval only (separate from combined chat YT poll). */
  const [pinnedYoutubeCheckMultiplier, setPinnedYoutubeCheckMultiplier] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:pinned-youtube-check-multiplier'))
    return Number.isFinite(saved) && saved > 0 ? saved : 1
  })
  const [combinedHighlightTerms, setCombinedHighlightTerms] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:combined-highlight-terms')
      if (!raw) {
        const legacy = localStorage.getItem('omni-screen:combined-highlight-term')
        if (legacy?.trim()) return [legacy.trim()]
        return []
      }
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()) : []
    } catch {
      return []
    }
  })
  const [combinedHighlightTermDraft, setCombinedHighlightTermDraft] = useState('')
  const [combinedPauseEmoteAnimationsOffScreen, setCombinedPauseEmoteAnimationsOffScreen] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:combined-pause-emote-offscreen')
    if (saved === '1' || saved === 'true') return true
    return false
  })
  const [combinedDisableDggFlairsAndColors, setCombinedDisableDggFlairsAndColors] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:combined-disable-dgg-flairs-colors')
    if (saved === '1' || saved === 'true') return true
    return false
  })
  const [chatLinkOpenAction, setChatLinkOpenAction] = useState<'none' | 'clipboard' | 'browser' | 'viewer'>(() => {
    const saved = localStorage.getItem('omni-screen:chat-link-open-action')
    if (saved === 'none' || saved === 'clipboard' || saved === 'browser' || saved === 'viewer') return saved
    return 'browser'
  })
  const [showDggInput, setShowDggInput] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:show-dgg-input')
    if (saved === '0' || saved === 'false') return false
    return true
  })
  type DggFocusKeybind = { key: string; ctrl: boolean; shift: boolean; alt: boolean }
  const [dggFocusKeybind, setDggFocusKeybind] = useState<DggFocusKeybind>(() => {
    try {
      const saved = localStorage.getItem('omni-screen:dgg-focus-keybind')
      if (!saved) return { key: ' ', ctrl: true, shift: false, alt: false }
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed.key === 'string') {
        return {
          key: parsed.key === ' ' ? ' ' : parsed.key,
          ctrl: Boolean(parsed.ctrl),
          shift: Boolean(parsed.shift),
          alt: Boolean(parsed.alt),
        }
      }
    } catch {}
    return { key: ' ', ctrl: true, shift: false, alt: false }
  })
  /** DGG label/badge color in combined chat. Empty = use theme default. Default #ffffff (white). */
  const [dggLabelColorOverride, setDggLabelColorOverride] = useState<string>(() => {
    const saved = localStorage.getItem('omni-screen:dgg-label-color-override')
    if (saved === '' || saved == null) return '#ffffff'
    if (/^#[0-9A-Fa-f]{6}$/.test(saved)) return saved
    if (/^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(saved)) {
      const m = saved.match(/\d+/g)
      if (m && m.length === 3) {
        const r = parseInt(m[0], 10)
        const g = parseInt(m[1], 10)
        const b = parseInt(m[2], 10)
        if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
          return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
        }
      }
    }
    return ''
  })
  /** DGG label text in combined chat badge. Default "dgg". */
  const [dggLabelText, setDggLabelText] = useState<string>(() => {
    const saved = localStorage.getItem('omni-screen:dgg-label-text')
    return (saved != null && saved !== '') ? saved : 'dgg'
  })
  const dggInputRef = useRef<HTMLTextAreaElement | null>(null)
  const dggChatActionsRef = useRef<{ appendToInput: (text: string) => void } | null>(null)

  // ---- Lite link scroller (links from combined chat, opposite side of chat) ----
  const [liteLinkScrollerOpen, setLiteLinkScrollerOpen] = useState(false)
  const [liteLinkScrollerCards, setLiteLinkScrollerCards] = useState<LinkCard[]>([])
  const initialLiteLinkScrollerSettings = useMemo((): LiteLinkScrollerSettings => {
    try {
      const max = Number(localStorage.getItem('omni-screen:lite-link-scroller-max-messages'))
      const autoScroll = localStorage.getItem('omni-screen:lite-link-scroller-auto-scroll') !== '0'
      const autoplay = localStorage.getItem('omni-screen:lite-link-scroller-autoplay') === '1'
      const mute = localStorage.getItem('omni-screen:lite-link-scroller-mute') !== '0'
      const autoAdvance = Number(localStorage.getItem('omni-screen:lite-link-scroller-auto-advance-seconds'))
      return {
        maxMessages: Number.isFinite(max) && max >= 10 ? Math.floor(max) : 100,
        autoScroll,
        autoplay,
        mute,
        autoAdvanceSeconds: Number.isFinite(autoAdvance) && autoAdvance >= 1 ? Math.min(120, Math.floor(autoAdvance)) : 10,
      }
    } catch {
      return { maxMessages: 100, autoScroll: false, autoplay: false, mute: true, autoAdvanceSeconds: 10 }
    }
  }, [])
  const [liteLinkScrollerSettings, setLiteLinkScrollerSettings] = useState<LiteLinkScrollerSettings>(initialLiteLinkScrollerSettings)

  const [chatPaneSide, setChatPaneSide] = useState<ChatPaneSide>(() => {
    const saved = localStorage.getItem('omni-screen:chat-pane-side')
    return saved === 'right' ? 'right' : 'left'
  })
  const [chatPaneWidth, setChatPaneWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:chat-pane-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 420
  })
  const [combinedChatOverlayMode, setCombinedChatOverlayMode] = useState<boolean>(() => {
    return localStorage.getItem('omni-screen:combined-chat-overlay-mode') === '1'
  })
  const [combinedChatOverlayOpacity, setCombinedChatOverlayOpacity] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:combined-chat-overlay-opacity'))
    return Number.isFinite(saved) && saved >= 0 && saved <= 1 ? saved : 0.85
  })
  const [overlayOpacityDropdownOpen, setOverlayOpacityDropdownOpen] = useState(false)
  const overlayOpacityDropdownRef = useRef<HTMLDivElement | null>(null)
  const [overlayMessagesClickThrough, setOverlayMessagesClickThrough] = useState<boolean>(() => {
    return localStorage.getItem('omni-screen:overlay-messages-click-through') === '1'
  })
  const [overlayHeaderVisible, setOverlayHeaderVisible] = useState(true)
  const overlayHeaderHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leftChatContainerRef = useRef<HTMLDivElement | null>(null)
  const rightChatContainerRef = useRef<HTMLDivElement | null>(null)
  const overlayChatContainerRef = useRef<HTMLDivElement | null>(null)
  const chatOverlayInputContainerRef = useRef<HTMLDivElement | null>(null)
  const overlayPortalClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [chatPortalTarget, setChatPortalTarget] = useState<HTMLDivElement | null>(null)
  const combinedChatContextMenuRef = useRef<{ openContextMenu: (e: React.MouseEvent) => void } | null>(null)
  useEffect(() => {
    if (!chatPaneOpen) {
      setChatPortalTarget(null)
      return
    }
    const el = combinedChatOverlayMode
      ? overlayChatContainerRef.current
      : chatPaneSide === 'left'
        ? leftChatContainerRef.current
        : rightChatContainerRef.current
    // When in overlay mode, avoid setting target to null if the overlay ref isn't set yet
    // (ref is set in a callback after the same commit), so we don't briefly unmount the chat and cause a flash.
    if (el) setChatPortalTarget(el)
    else if (!combinedChatOverlayMode) setChatPortalTarget(null)
  }, [chatPaneOpen, combinedChatOverlayMode, chatPaneSide])

  // Debug: set to true to log when chat portal target or pane state changes (helps track chat flash/disappear).
  const DEBUG_CHAT_PORTAL = false
  useEffect(() => {
    if (!DEBUG_CHAT_PORTAL) return
    console.log('[OmniScreen:chat-portal]', {
      chatPaneOpen,
      combinedChatOverlayMode,
      chatPaneSide,
      hasPortalTarget: !!chatPortalTarget,
      portalTargetId: chatPortalTarget?.id ?? null,
    })
  }, [chatPaneOpen, combinedChatOverlayMode, chatPaneSide, chatPortalTarget])

  const setLeftChatContainerRef = useCallback((el: HTMLDivElement | null) => {
    leftChatContainerRef.current = el
    if (!combinedChatOverlayMode && chatPaneSide === 'left' && el) setChatPortalTarget(el)
  }, [combinedChatOverlayMode, chatPaneSide])
  const setRightChatContainerRef = useCallback((el: HTMLDivElement | null) => {
    rightChatContainerRef.current = el
    if (!combinedChatOverlayMode && chatPaneSide === 'right' && el) setChatPortalTarget(el)
  }, [combinedChatOverlayMode, chatPaneSide])
  useEffect(() => {
    if (!overlayOpacityDropdownOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const el = overlayOpacityDropdownRef.current
      if (el && !el.contains(e.target as Node)) setOverlayOpacityDropdownOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [overlayOpacityDropdownOpen])

  useEffect(() => {
    if (!combinedChatOverlayMode) setOverlayHeaderVisible(true)
  }, [combinedChatOverlayMode])

  useEffect(() => {
    return () => {
      if (overlayHeaderHideTimeoutRef.current) clearTimeout(overlayHeaderHideTimeoutRef.current)
      if (overlayPortalClearTimeoutRef.current) clearTimeout(overlayPortalClearTimeoutRef.current)
    }
  }, [])

  const setOverlayChatContainerRef = useCallback((el: HTMLDivElement | null) => {
    overlayChatContainerRef.current = el
    if (overlayPortalClearTimeoutRef.current) {
      clearTimeout(overlayPortalClearTimeoutRef.current)
      overlayPortalClearTimeoutRef.current = null
    }
    if (el) {
      setChatPortalTarget(el)
    } else if (combinedChatOverlayMode) {
      // Defer clearing portal target so we don't flash when ref is briefly null during embed/grid updates.
      overlayPortalClearTimeoutRef.current = setTimeout(() => {
        overlayPortalClearTimeoutRef.current = null
        if (!overlayChatContainerRef.current) setChatPortalTarget(null)
      }, 0)
    }
  }, [combinedChatOverlayMode])
  const [combinedMsgCount, setCombinedMsgCount] = useState(0)
  const [combinedDggUserCount, setCombinedDggUserCount] = useState(0)
  const pinnedEmbedsRef = useRef<Map<string, LiveEmbed>>(pinnedEmbeds)
  pinnedEmbedsRef.current = pinnedEmbeds
  const pinnedOriginatedEmbedsRef = useRef<Map<string, LiveEmbed>>(new Map())
  const [ytChannelLoading, setYtChannelLoading] = useState(false)
  const [ytChannelError, setYtChannelError] = useState<string | null>(null)
  const [pasteLinkError, setPasteLinkError] = useState<string | null>(null)

  // ---- Pinned streamers (group embeds by streamer; nickname; poll options in modal) ----
  const [pinnedStreamers, setPinnedStreamers] = useState<PinnedStreamer[]>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:pinned-streamers')
      if (!raw) return []
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return []
      return arr.filter(
        (x: any) => x && typeof x.id === 'string'
      ).map((x: any) => ({
        ...x,
        nickname: typeof x.nickname === 'string' ? x.nickname : (x.nickname ?? ''),
        color: typeof x.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x.color) ? x.color : undefined,
        youtubeColor: typeof x.youtubeColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x.youtubeColor) ? x.youtubeColor : undefined,
        kickColor: typeof x.kickColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x.kickColor) ? x.kickColor : undefined,
        twitchColor: typeof x.twitchColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x.twitchColor) ? x.twitchColor : undefined,
        openWhenLive: x.openWhenLive === true,
      })) as PinnedStreamer[]
    } catch {
      return []
    }
  })
  type SettingsTab = 'pinned' | 'chat' | 'liteLinkScroller' | 'keybinds'
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('pinned')
  const settingsTabContentRef = useRef<HTMLDivElement>(null)
  const [editingStreamerId, setEditingStreamerId] = useState<string | null>(null)
  /** YouTube embed key -> pinned streamer ids that resolved to this video (multiple streamers can share same stream). */
  const [youtubeVideoToStreamerId, setYoutubeVideoToStreamerId] = useState<Map<string, string[]>>(() => new Map())
  /** Embeds from pinned streamer poll only (not in pinned list, not persisted). "Unpin" does not apply to these. */
  const [pinnedOriginatedEmbeds, setPinnedOriginatedEmbeds] = useState<Map<string, LiveEmbed>>(() => new Map())
  pinnedOriginatedEmbedsRef.current = pinnedOriginatedEmbeds
  /** Increment to trigger one immediate run of pinned streamer polls (e.g. Refresh button). */
  const [pinnedPollRefreshTrigger, setPinnedPollRefreshTrigger] = useState(0)

  /** Preferred platform order for "turn on" dock click: first matching platform's video is enabled. */
  const PREFERRED_PLATFORMS_DEFAULT: ('youtube' | 'kick' | 'twitch')[] = ['youtube', 'kick', 'twitch']
  const [preferredPlatformOrder, setPreferredPlatformOrder] = useState<('youtube' | 'kick' | 'twitch')[]>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:preferred-platform-order')
      if (!raw) return PREFERRED_PLATFORMS_DEFAULT
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return PREFERRED_PLATFORMS_DEFAULT
      const valid = arr.filter((p: string) => ['youtube', 'kick', 'twitch'].includes(p))
      const seen = new Set<string>()
      const order = valid.filter((p: string) => {
        if (seen.has(p)) return false
        seen.add(p)
        return true
      })
      for (const p of ['youtube', 'kick', 'twitch'] as const) {
        if (!seen.has(p)) order.push(p)
      }
      return order as ('youtube' | 'kick' | 'twitch')[]
    } catch {
      return PREFERRED_PLATFORMS_DEFAULT
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:pinned-streamers', JSON.stringify(pinnedStreamers))
    } catch {
      // ignore
    }
  }, [pinnedStreamers])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:preferred-platform-order', JSON.stringify(preferredPlatformOrder))
    } catch {
      // ignore
    }
  }, [preferredPlatformOrder])

  // Prevent layout shift (gap on right) when modal opens: body may get overflow hidden and scrollbar disappears
  useEffect(() => {
    if (!settingsModalOpen) return
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const prevPadding = document.body.style.paddingRight
    document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.body.style.paddingRight = prevPadding
    }
  }, [settingsModalOpen])

  const combinedChatContextMenuConfig = useMemo<CombinedChatContextMenuConfig>(
    () => ({
      display: {
        showTimestamps: combinedShowTimestamps,
        setShowTimestamps: setCombinedShowTimestamps,
        showLabels: combinedShowLabels,
        setShowLabels: setCombinedShowLabels,
        showPlatformIcons: combinedShowPlatformIcons,
        setShowPlatformIcons: setCombinedShowPlatformIcons,
        showDggFlairsAndColors: !combinedDisableDggFlairsAndColors,
        setShowDggFlairsAndColors: (v) => setCombinedDisableDggFlairsAndColors(!v),
      },
      order: { sortMode: combinedSortMode, setSortMode: setCombinedSortMode },
      emotes: {
        pauseOffScreen: combinedPauseEmoteAnimationsOffScreen,
        setPauseOffScreen: setCombinedPauseEmoteAnimationsOffScreen,
      },
      linkAction: { value: chatLinkOpenAction, setValue: setChatLinkOpenAction },
      paneSide: { value: chatPaneSide, setPaneSide: setChatPaneSide },
      dgg: combinedIncludeDgg ? { showInput: showDggInput, setShowInput: setShowDggInput } : undefined,
      highlightTerms: combinedHighlightTerms,
      addHighlightTerm: (term: string) => {
        const t = term.trim()
        if (!t) return
        setCombinedHighlightTerms((prev) => (prev.includes(t) ? prev : [...prev, t]))
      },
      removeHighlightTerm: (term: string) => {
        setCombinedHighlightTerms((prev) => prev.filter((x) => x !== term))
      },
    }),
    [
      combinedShowTimestamps,
      combinedShowLabels,
      combinedShowPlatformIcons,
      combinedDisableDggFlairsAndColors,
      combinedSortMode,
      combinedPauseEmoteAnimationsOffScreen,
      chatLinkOpenAction,
      chatPaneSide,
      combinedIncludeDgg,
      showDggInput,
      combinedHighlightTerms,
    ]
  )

  const combinedHeaderText = useMemo(() => {
    const parts: string[] = []
    if (combinedIncludeDgg) parts.push('dgg')

    const extra: string[] = []
    selectedEmbedChatKeys.forEach((k) => {
      const s = String(k || '')
      const idx = s.indexOf(':')
      if (idx <= 0) return
      const platform = s.slice(0, idx).toLowerCase()
      const id = s.slice(idx + 1)
      if (!platform || !id) return
      if (platform === 'kick') extra.push(`K:${id}`)
      else if (platform === 'youtube') extra.push(`Y:${id}`)
      else if (platform === 'twitch') extra.push(`T:${id}`)
      else extra.push(`${platform}:${id}`)
    })

    extra.sort()
    for (const e of extra) parts.push(e)

    const maxShow = 3
    const shown = parts.slice(0, maxShow)
    const remaining = parts.length - shown.length
    const summary = shown.length ? `${shown.join(', ')}${remaining > 0 ? ` +${remaining} others` : ''}` : 'none'
    return `Chat (combined: ${summary})`
  }, [combinedIncludeDgg, selectedEmbedChatKeys])


  // ---- Center grid sizing (responsive to window size) ----
  // Measure ONLY the available area for the embed grid (not including the bottom dock).
  const gridAreaRef = useRef<HTMLDivElement | null>(null)
  const [gridHostSize, setGridHostSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // Persist selection
  /** Remove embed(s) from pinned list (and selection). Use for pinned embeds you want to unpin. */
  const removePinnedEmbed = useCallback((key: string) => {
    setPinnedEmbeds((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setSelectedEmbedKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setSelectedEmbedChatKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }, [])

  /** True if this canonical key has an entry in pinnedEmbeds (any pinned key that canonicalizes to this). */
  const isPinnedEmbedKey = useCallback(
    (canonicalKey: string) => Array.from(pinnedEmbeds.keys()).some((k) => canonicalEmbedKey(k) === canonicalKey),
    [pinnedEmbeds],
  )
  /** Remove all pinned embed entries that canonicalize to this key. */
  const removePinnedEmbedsWithCanonicalKey = useCallback(
    (canonicalKey: string) => {
      Array.from(pinnedEmbeds.keys())
        .filter((k) => canonicalEmbedKey(k) === canonicalKey)
        .forEach((k) => removePinnedEmbed(k))
    },
    [pinnedEmbeds, removePinnedEmbed],
  )

  // Merge pinned (temporary list), pinned-originated (bookmark poll), and DGG embeds.
  const combinedAvailableEmbeds = useMemo(() => {
    const m = new Map<string, LiveEmbed>()
    pinnedEmbeds.forEach((v, k) => {
      const c = canonicalEmbedKey(k)
      m.set(c, v)
    })
    pinnedOriginatedEmbeds.forEach((v, k) => {
      const c = canonicalEmbedKey(k)
      if (!m.has(c)) m.set(c, v)
    })
    availableEmbeds.forEach((v, k) => {
      const c = canonicalEmbedKey(k)
      const existing = m.get(c)
      if (existing && v?.mediaItem?.metadata && (v.mediaItem.metadata.viewers != null || (v as LiveEmbed).count != null))
        m.set(c, { ...existing, ...v, mediaItem: { ...existing?.mediaItem, metadata: { ...existing?.mediaItem?.metadata, ...v?.mediaItem?.metadata } }, count: (v as LiveEmbed).count ?? existing?.count })
      else if (!existing)
        m.set(c, v)
    })
    logPinned('combinedAvailableEmbeds', { pinnedCount: pinnedEmbeds.size, pinnedOriginatedCount: pinnedOriginatedEmbeds.size, dggCount: availableEmbeds.size, combinedCount: m.size })
    return m
  }, [availableEmbeds, pinnedEmbeds, pinnedOriginatedEmbeds])
  const combinedAvailableEmbedsRef = useRef<Map<string, LiveEmbed>>(combinedAvailableEmbeds)
  combinedAvailableEmbedsRef.current = combinedAvailableEmbeds
  const prevCombinedEmbedsRef = useRef<Map<string, LiveEmbed>>(new Map())
  const prevPinnedOriginatedRef = useRef<Map<string, LiveEmbed>>(new Map())

  /** When poll or DGG removes an embed that the user is watching, add to pinned list (📌) so it stays in the list. */
  useEffect(() => {
    const prev = prevCombinedEmbedsRef.current
    const current = combinedAvailableEmbeds
    if (prev.size === 0) {
      prevCombinedEmbedsRef.current = new Map(current)
      return
    }
    const watched = new Set([...selectedEmbedKeys, ...selectedEmbedChatKeys])
    const toPin = new Map<string, LiveEmbed>()
    watched.forEach((k) => {
      const c = canonicalEmbedKey(k)
      if (current.has(k) || current.has(c)) return
      const embed = prev.get(k) || prev.get(c)
      if (embed) toPin.set(c, embed)
    })
    if (toPin.size > 0) {
      setPinnedEmbeds((m) => {
        const next = new Map(m)
        toPin.forEach((embed, c) => next.set(c, embed))
        return next
      })
    }
    prevCombinedEmbedsRef.current = new Map(current)
  }, [combinedAvailableEmbeds, selectedEmbedKeys, selectedEmbedChatKeys])

  /** When a bookmarked streamer comes live and that streamer has openWhenLive, add preferred platform video to selection. */
  useEffect(() => {
    const prev = prevPinnedOriginatedRef.current
    const current = pinnedOriginatedEmbeds
    prevPinnedOriginatedRef.current = new Map(current)
    if (prev.size === 0) return
    const prevKeys = new Set(prev.keys())
    const newKeys = Array.from(current.keys()).filter((k) => !prevKeys.has(k))
    if (newKeys.length === 0) return
    const toAdd = new Set<string>()
    for (const newKey of newKeys) {
      const streamers = findStreamersForKey(newKey, pinnedStreamers, youtubeVideoToStreamerId).filter((s) => s.openWhenLive === true)
      for (const s of streamers) {
        const streamerKeys = Array.from(combinedAvailableEmbeds.keys()).filter((k) =>
          findStreamersForKey(k, pinnedStreamers, youtubeVideoToStreamerId).some((x) => x.id === s.id),
        )
        const anySelected = streamerKeys.some((k) => selectedEmbedKeys.has(k))
        if (anySelected) continue
        for (const platform of preferredPlatformOrder) {
          const match = streamerKeys.find((k) => (k.split(':')[0] || '').toLowerCase() === platform)
          if (match) {
            toAdd.add(match)
            break
          }
        }
      }
    }
    if (toAdd.size > 0) {
      setSelectedEmbedKeys((prevSel) => {
        const next = new Set(prevSel)
        toAdd.forEach((k) => next.add(k))
        return next
      })
    }
  }, [pinnedOriginatedEmbeds, preferredPlatformOrder, pinnedStreamers, youtubeVideoToStreamerId, combinedAvailableEmbeds, selectedEmbedKeys])

  /** Why each embed is in the list: Bookmarked (bookmarked streamer), DGG (websocket), Pinned (temporary list). */
  const embedSourcesByKey = useMemo(() => {
    const out = new Map<string, { pinned: boolean; dgg: boolean; pinnedToList: boolean }>()
    for (const key of combinedAvailableEmbeds.keys()) {
      const pinned = findStreamersForKey(key, pinnedStreamers, youtubeVideoToStreamerId).length > 0
      const dgg = availableEmbeds.has(key)
      const pinnedToList = isPinnedEmbedKey(key)
      out.set(key, { pinned, dgg, pinnedToList })
    }
    return out
  }, [combinedAvailableEmbeds, pinnedStreamers, youtubeVideoToStreamerId, availableEmbeds, isPinnedEmbedKey])

  /** Icons for embed source: 🔖 bookmarked, #️⃣ DGG embed, 📌 pinned. */
  function embedSourceIcons(s: { pinned: boolean; dgg: boolean; pinnedToList: boolean }): { icon: string; title: string }[] {
    const out: { icon: string; title: string }[] = []
    if (s.pinnedToList) out.push({ icon: '📌', title: 'Pinned' })
    if (s.pinned) out.push({ icon: '🔖', title: 'Bookmarked' })
    if (s.dgg) out.push({ icon: '#️⃣', title: 'DGG embed' })
    return out
  }

  /** Combined chat: color for an embed key. Bookmarked: use streamer platform/dock color if set, else fixed default. Non-bookmarked: palette color. */
  const getEmbedColor = useCallback(
    (key: string, displayName?: string) => {
      const streamers = findStreamersForKey(key, pinnedStreamers, youtubeVideoToStreamerId)
      const s = streamers[0]
      if (s) {
        const parsed = parseEmbedKey(key)
        if (parsed) {
          const platform = parsed.platform.toLowerCase()
          const platformColor =
            platform === 'youtube' ? s.youtubeColor
            : platform === 'kick' ? s.kickColor
            : platform === 'twitch' ? s.twitchColor
            : undefined
          const hex = (platformColor && /^#[0-9A-Fa-f]{6}$/.test(platformColor)) ? platformColor : (s.color && /^#[0-9A-Fa-f]{6}$/.test(s.color) ? s.color : undefined)
          if (hex) return hex
          return COLOR_BOOKMARKED_DEFAULT
        }
      }
      return omniColorForKey(key, { displayName })
    },
    [pinnedStreamers, youtubeVideoToStreamerId],
  )

  /** True if the embed key belongs to a bookmarked streamer that has hideLabelInCombinedChat. */
  const getEmbedLabelHidden = useCallback(
    (key: string) => {
      const streamers = findStreamersForKey(key, pinnedStreamers, youtubeVideoToStreamerId)
      return streamers.some((s) => s.hideLabelInCombinedChat === true)
    },
    [pinnedStreamers, youtubeVideoToStreamerId],
  )

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:selected-embeds', JSON.stringify(Array.from(selectedEmbedKeys.values())))
    } catch {
      // ignore
    }
  }, [selectedEmbedKeys])

  useEffect(() => {
    try {
      const arr = Array.from(pinnedEmbeds.entries()).map(([key, e]) => ({
        key,
        platform: e.platform,
        id: e.id,
        title: e.mediaItem?.metadata?.displayName || e.mediaItem?.metadata?.title,
      }))
      localStorage.setItem('omni-screen:pinned-embeds', JSON.stringify(arr))
    } catch {
      // ignore
    }
  }, [pinnedEmbeds])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:selected-embed-chats', JSON.stringify(Array.from(selectedEmbedChatKeys.values())))
    } catch {
      // ignore
    }
  }, [selectedEmbedChatKeys])

  useEffect(() => {
    setCombinedMaxMessagesDraft(String(combinedMaxMessages))
  }, [combinedMaxMessages])
  useEffect(() => {
    setCombinedMaxMessagesScrollDraft(String(combinedMaxMessagesScroll))
  }, [combinedMaxMessagesScroll])

  // Persist all combined chat and chat pane settings in one place so none are missed on restart.
  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:combined-include-dgg', combinedIncludeDgg ? '1' : '0')
      localStorage.setItem('omni-screen:combined-max-messages', String(combinedMaxMessages))
      localStorage.setItem('omni-screen:combined-max-messages-scroll', String(combinedMaxMessagesScroll))
      localStorage.setItem('omni-screen:combined-show-timestamps', combinedShowTimestamps ? '1' : '0')
      localStorage.setItem('omni-screen:combined-show-labels', combinedShowLabels ? '1' : '0')
      localStorage.setItem('omni-screen:combined-show-platform-icons', combinedShowPlatformIcons ? '1' : '0')
      localStorage.setItem('omni-screen:combined-sort-mode', combinedSortMode)
      localStorage.setItem('omni-screen:combined-highlight-terms', JSON.stringify(combinedHighlightTerms))
      localStorage.setItem('omni-screen:combined-pause-emote-offscreen', combinedPauseEmoteAnimationsOffScreen ? '1' : '0')
      localStorage.setItem('omni-screen:combined-disable-dgg-flairs-colors', combinedDisableDggFlairsAndColors ? '1' : '0')
      localStorage.setItem('omni-screen:chat-link-open-action', chatLinkOpenAction)
      localStorage.setItem('omni-screen:show-dgg-input', showDggInput ? '1' : '0')
      localStorage.setItem('omni-screen:dgg-focus-keybind', JSON.stringify(dggFocusKeybind))
      localStorage.setItem('omni-screen:dgg-label-color-override', dggLabelColorOverride)
      localStorage.setItem('omni-screen:dgg-label-text', dggLabelText)
      localStorage.setItem('omni-screen:chat-pane-width', String(chatPaneWidth))
      localStorage.setItem('omni-screen:chat-pane-side', chatPaneSide)
      localStorage.setItem('omni-screen:combined-chat-overlay-mode', combinedChatOverlayMode ? '1' : '0')
      localStorage.setItem('omni-screen:combined-chat-overlay-opacity', String(combinedChatOverlayOpacity))
      localStorage.setItem('omni-screen:overlay-messages-click-through', overlayMessagesClickThrough ? '1' : '0')
      localStorage.setItem('omni-screen:lite-link-scroller-max-messages', String(liteLinkScrollerSettings.maxMessages))
      localStorage.setItem('omni-screen:lite-link-scroller-auto-scroll', liteLinkScrollerSettings.autoScroll ? '1' : '0')
      localStorage.setItem('omni-screen:lite-link-scroller-autoplay', liteLinkScrollerSettings.autoplay ? '1' : '0')
      localStorage.setItem('omni-screen:lite-link-scroller-mute', liteLinkScrollerSettings.mute ? '1' : '0')
      localStorage.setItem('omni-screen:lite-link-scroller-auto-advance-seconds', String(liteLinkScrollerSettings.autoAdvanceSeconds))
    } catch {
      // ignore
    }
  }, [
    combinedIncludeDgg,
    combinedMaxMessages,
    combinedMaxMessagesScroll,
    combinedShowTimestamps,
    combinedShowLabels,
    combinedShowPlatformIcons,
    combinedSortMode,
    dggLabelColorOverride,
    dggLabelText,
    combinedHighlightTerms,
    combinedPauseEmoteAnimationsOffScreen,
    combinedDisableDggFlairsAndColors,
    chatLinkOpenAction,
    showDggInput,
    dggFocusKeybind,
    chatPaneWidth,
    chatPaneSide,
    combinedChatOverlayMode,
    combinedChatOverlayOpacity,
    overlayMessagesClickThrough,
    liteLinkScrollerSettings,
  ])

  useEffect(() => {
    window.ipcRenderer?.invoke('set-chat-link-open-action', chatLinkOpenAction).catch(() => {})
  }, [chatLinkOpenAction])

  // Collect messages with links for lite link scroller (same sources as combined chat)
  useEffect(() => {
    const max = liteLinkScrollerSettings.maxMessages
    const appendCards = (newCards: LinkCard[]) => {
      if (newCards.length === 0) return
      setLiteLinkScrollerCards((prev) => {
        const existingIds = new Set(prev.map((c) => c.id))
        const added = newCards.filter((c) => !existingIds.has(c.id))
        if (added.length === 0) return prev
        const combined = [...prev, ...added]
        combined.sort((a, b) => (a.date || 0) - (b.date || 0))
        if (combined.length <= max) return combined
        return combined.slice(-max)
      })
    }

    const handleDggMessage = (_e: unknown, data: { type?: string; message?: { nick?: string; data?: string; timestamp?: number } }) => {
      if (!data || data.type !== 'MSG' || !data.message) return
      const msg = data.message
      const text = msg.data ?? ''
      const cards = buildLinkCardsFromMessage('dgg', 'Destinygg', msg.nick ?? '', typeof msg.timestamp === 'number' ? msg.timestamp : Date.now(), text)
      appendCards(cards)
    }
    const handleDggHistory = (_e: unknown, history: { type?: string; messages?: Array<{ nick?: string; data?: string; timestamp?: number }> }) => {
      if (!history || history.type !== 'HISTORY' || !Array.isArray(history.messages)) return
      const cards: LinkCard[] = []
      history.messages.forEach((m) => {
        const text = m.data ?? ''
        const dateMs = typeof m.timestamp === 'number' ? m.timestamp : Date.now()
        cards.push(...buildLinkCardsFromMessage('dgg', 'Destinygg', m.nick ?? '', dateMs, text))
      })
      appendCards(cards)
    }
    const handleKick = (_e: unknown, msg: { platform?: string; slug?: string; sender?: { username?: string }; content?: string; createdAt?: string }) => {
      if (!msg || msg.platform !== 'kick') return
      const text = msg.content ?? ''
      const tsMs = Number.isFinite(Date.parse(msg.createdAt ?? '')) ? Date.parse(msg.createdAt!) : Date.now()
      appendCards(buildLinkCardsFromMessage('kick', msg.slug ?? 'kick', msg.sender?.username ?? 'kick', tsMs, text))
    }
    const handleYouTube = (_e: unknown, msg: { platform?: string; videoId?: string; authorName?: string; message?: string; timestampUsec?: string }) => {
      if (!msg || msg.platform !== 'youtube') return
      const usec = typeof msg.timestampUsec === 'string' ? Number(msg.timestampUsec) : NaN
      const tsMs = Number.isFinite(usec) ? Math.floor(usec / 1000) : Date.now()
      appendCards(buildLinkCardsFromMessage('youtube', msg.videoId ?? 'unknown', msg.authorName ?? 'youtube', tsMs, msg.message ?? ''))
    }
    const handleTwitch = (_e: unknown, msg: { platform?: string; channel?: string; displayName?: string; text?: string; tmiSentTs?: number }) => {
      if (!msg || msg.platform !== 'twitch') return
      const tsMs = typeof msg.tmiSentTs === 'number' && Number.isFinite(msg.tmiSentTs) ? msg.tmiSentTs : Date.now()
      appendCards(buildLinkCardsFromMessage('twitch', msg.channel ?? 'unknown', msg.displayName ?? 'twitch', tsMs, msg.text ?? ''))
    }

    window.ipcRenderer.on('chat-websocket-message', handleDggMessage)
    window.ipcRenderer.on('chat-websocket-history', handleDggHistory)
    window.ipcRenderer.on('kick-chat-message', handleKick)
    window.ipcRenderer.on('youtube-chat-message', handleYouTube)
    window.ipcRenderer.on('twitch-chat-message', handleTwitch)
    return () => {
      window.ipcRenderer.off('chat-websocket-message', handleDggMessage)
      window.ipcRenderer.off('chat-websocket-history', handleDggHistory)
      window.ipcRenderer.off('kick-chat-message', handleKick)
      window.ipcRenderer.off('youtube-chat-message', handleYouTube)
      window.ipcRenderer.off('twitch-chat-message', handleTwitch)
    }
  }, [liteLinkScrollerSettings.maxMessages])

  useEffect(() => {
    const max = liteLinkScrollerSettings.maxMessages
    setLiteLinkScrollerCards((prev) => (prev.length <= max ? prev : prev.slice(-max)))
  }, [liteLinkScrollerSettings.maxMessages])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (settingsModalOpen) return
      const target = e.target as Node
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (!chatPaneOpen || !combinedIncludeDgg || !showDggInput) return
      const key = e.key === ' ' ? ' ' : e.key
      if (dggFocusKeybind.key !== key || dggFocusKeybind.ctrl !== e.ctrlKey || dggFocusKeybind.shift !== e.shiftKey || dggFocusKeybind.alt !== e.altKey) return
      e.preventDefault()
      dggInputRef.current?.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsModalOpen, chatPaneOpen, combinedIncludeDgg, showDggInput, dggFocusKeybind])

  useEffect(() => {
    const handler = (_: unknown, payload: { platform: string; id: string }) => {
      if (payload?.platform && payload?.id) handleDestinyLinkRef.current?.(payload.platform, payload.id)
    }
    window.ipcRenderer?.on('add-embed-from-destiny-link', handler)
    return () => {
      window.ipcRenderer?.off('add-embed-from-destiny-link', handler)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:youtube-poll-multiplier', String(youTubePollMultiplier))
    } catch {
      // ignore
    }
  }, [youTubePollMultiplier])
  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:pinned-youtube-check-multiplier', String(pinnedYoutubeCheckMultiplier))
    } catch {
      // ignore
    }
  }, [pinnedYoutubeCheckMultiplier])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:cinema-mode', cinemaMode ? '1' : '0')
      localStorage.setItem('omni-screen:dock-at-top', dockAtTop ? '1' : '0')
    } catch {
      // ignore
    }
  }, [cinemaMode, dockAtTop])

  const commitCombinedMaxMessages = useCallback(
    (raw?: string) => {
      const s = String(raw ?? combinedMaxMessagesDraft).trim()
      if (!s) {
        setCombinedMaxMessagesDraft(String(combinedMaxMessages))
        return
      }
      const n = Math.floor(Number(s))
      if (!Number.isFinite(n)) {
        setCombinedMaxMessagesDraft(String(combinedMaxMessages))
        return
      }
      const next = clamp(n, 50, combinedMaxMessagesScroll)
      setCombinedMaxMessages(next)
      setCombinedMaxMessagesDraft(String(next))
    },
    [combinedMaxMessages, combinedMaxMessagesDraft, combinedMaxMessagesScroll],
  )
  const commitCombinedMaxMessagesScroll = useCallback(
    (raw?: string) => {
      const s = String(raw ?? combinedMaxMessagesScrollDraft).trim()
      if (!s) {
        setCombinedMaxMessagesScrollDraft(String(combinedMaxMessagesScroll))
        return
      }
      const n = Math.floor(Number(s))
      if (!Number.isFinite(n)) {
        setCombinedMaxMessagesScrollDraft(String(combinedMaxMessagesScroll))
        return
      }
      const next = clamp(n, 50, 50000)
      setCombinedMaxMessagesScroll(next)
      setCombinedMaxMessagesScrollDraft(String(next))
      if (combinedMaxMessages > next) setCombinedMaxMessages(next)
    },
    [combinedMaxMessagesScroll, combinedMaxMessagesScrollDraft, combinedMaxMessages],
  )

  // Track available size for the embed grid so it can adapt to window resizing.
  useEffect(() => {
    const el = gridAreaRef.current
    if (!el) return

    let raf = 0
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setGridHostSize({
          width: Math.max(0, Math.floor(width)),
          height: Math.max(0, Math.floor(height)),
        })
      })
    })

    ro.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // Connect to live.destiny.gg websocket (via main process to avoid Origin restrictions)
  useEffect(() => {
    let alive = true

    const handleMessage = (_event: any, payload: any) => {
      if (!alive) return
      const parsed = payload as LiveWsMessage
      if (!parsed || typeof parsed.type !== 'string') return

      if (parsed.type === 'dggApi:embeds') {
        const next = new Map<string, LiveEmbed>()
        const legacyToCanonical = new Map<string, string>()
        const data = (parsed as { type: 'dggApi:embeds'; data: LiveEmbed[] }).data || []
        data.forEach((embed: LiveEmbed) => {
          if (!embed?.platform || !embed?.id) return
          const canonicalKey = makeEmbedKey(embed.platform, embed.id)
          next.set(canonicalKey, embed)

          const legacyKey = makeLegacyEmbedKey(embed.platform, embed.id)
          if (legacyKey !== canonicalKey) legacyToCanonical.set(legacyKey, canonicalKey)
        })

        const pinnedList = pinnedEmbedsRef.current
        const pinned = pinnedOriginatedEmbedsRef.current
        const combined = combinedAvailableEmbedsRef.current
        const watched = new Set([...selectedEmbedKeysRef.current, ...selectedEmbedChatKeysRef.current])
        const keysToPin = new Set<string>()
        watched.forEach((k) => {
          const c = canonicalEmbedKey(k)
          if (next.has(k) || next.has(c) || pinnedList.has(k) || pinnedList.has(c) || pinned.has(k) || pinned.has(c)) return
          const migrated = legacyToCanonical.get(k)
          if (migrated && (next.has(migrated) || pinnedList.has(migrated) || pinned.has(migrated))) return
          const embed = combined.get(k) || combined.get(c) || (migrated ? combined.get(migrated) : undefined)
          if (embed) keysToPin.add(c)
        })
        const pinnedListNext = new Map(pinnedList)
        keysToPin.forEach((c) => {
          const embed = combined.get(c)
          if (embed) pinnedListNext.set(c, embed)
        })
        const keepKey = (key: string) => {
          const c = canonicalEmbedKey(key)
          if (next.has(key) || next.has(c) || pinnedListNext.has(key) || pinnedListNext.has(c) || pinned.has(key) || pinned.has(c)) return true
          const migrated = legacyToCanonical.get(key)
          return Boolean(migrated && (next.has(migrated) || pinnedListNext.has(migrated) || pinned.has(migrated)))
        }
        startViewTransitionIfSupported(() => {
          if (keysToPin.size > 0) {
            setPinnedEmbeds((prev) => {
              const m = new Map(prev)
              keysToPin.forEach((c) => {
                const embed = combined.get(c)
                if (embed) m.set(c, embed)
              })
              return m
            })
          }
          setAvailableEmbeds(next)
          setSelectedEmbedKeys((prev) => new Set([...prev].filter(keepKey)))
          setSelectedEmbedChatKeys((prev) => new Set([...prev].filter(keepKey)))
        })
        return
      }

      if (parsed.type === 'dggApi:bannedEmbeds') {
        const next = new Map<string, BannedEmbed>()
        const data = (parsed as { type: 'dggApi:bannedEmbeds'; data: BannedEmbed[] | null }).data || []
        data.forEach((banned: BannedEmbed) => {
          if (!banned?.platform || !banned?.name) return
          next.set(makeEmbedKey(banned.platform, banned.name), banned)
        })
        setBannedEmbeds(next)
      }
    }

    window.ipcRenderer.invoke('live-websocket-connect').catch(() => {})
    window.ipcRenderer.on('live-websocket-message', handleMessage)

    return () => {
      alive = false
      window.ipcRenderer.off('live-websocket-message', handleMessage)
      window.ipcRenderer.invoke('live-websocket-disconnect').catch(() => {})
    }
  }, [])

  // Subscribe Kick chatrooms for "Combined chat" based on per-embed Chat toggles.
  useEffect(() => {
    const shouldRun = chatPaneOpen
    if (!shouldRun) {
      window.ipcRenderer.invoke('kick-chat-set-targets', { slugs: [] }).catch(() => {})
      return
    }

    const slugs: string[] = []
    selectedEmbedChatKeys.forEach((key) => {
      const parsed = parseEmbedKey(key)
      if (!parsed) return
      if (parsed.platform !== 'kick') return
      slugs.push(String(parsed.id))
    })

    // De-dupe and keep stable-ish order.
    const uniq = Array.from(new Set(slugs)).sort()
    window.ipcRenderer.invoke('kick-chat-set-targets', { slugs: uniq }).catch(() => {})
  }, [chatPaneOpen, selectedEmbedChatKeys])

  // Subscribe YouTube live chat for "Combined chat" based on per-embed Chat toggles.
  useEffect(() => {
    const shouldRun = chatPaneOpen
    if (!shouldRun) {
      window.ipcRenderer.invoke('youtube-chat-set-targets', { videoIds: [], opts: { delayMultiplier: youTubePollMultiplier } }).catch(() => {})
      return
    }

    const ids: string[] = []
    selectedEmbedChatKeys.forEach((key) => {
      const parsed = parseEmbedKey(key)
      if (!parsed) return
      if (parsed.platform !== 'youtube') return
      const direct = combinedAvailableEmbeds.get(key)
      if (direct?.id) {
        ids.push(String(direct.id))
        return
      }
      const want = String(parsed.id)
      for (const [k, e] of combinedAvailableEmbeds.entries()) {
        if (!k.startsWith('youtube:')) continue
        if (String(e?.id || '').toLowerCase() === want.toLowerCase()) {
          ids.push(String(e.id))
          return
        }
      }
    })

    const uniq = Array.from(new Set(ids)).sort()
    window.ipcRenderer.invoke('youtube-chat-set-targets', { videoIds: uniq, opts: { delayMultiplier: youTubePollMultiplier } }).catch(() => {})
  }, [combinedAvailableEmbeds, chatPaneOpen, selectedEmbedChatKeys, youTubePollMultiplier])

  // Subscribe Twitch IRC chat for "Combined chat" based on per-embed Chat toggles.
  useEffect(() => {
    const shouldRun = chatPaneOpen
    if (!shouldRun) {
      window.ipcRenderer.invoke('twitch-chat-set-targets', { channels: [] }).catch(() => {})
      return
    }

    const chans: string[] = []
    selectedEmbedChatKeys.forEach((key) => {
      const parsed = parseEmbedKey(key)
      if (!parsed) return
      if (parsed.platform !== 'twitch') return
      chans.push(String(parsed.id))
    })

    const uniq = Array.from(new Set(chans)).sort()
    window.ipcRenderer.invoke('twitch-chat-set-targets', { channels: uniq }).catch(() => {})
  }, [chatPaneOpen, selectedEmbedChatKeys])

  // Poll pinned streamers' YouTube channels: add live embeds and youtubeVideoToStreamerId for grouping. No DGG required.
  useEffect(() => {
    const withYt = pinnedStreamers.filter((s) => s.youtubeChannelId?.trim())
    logPinned('YT poll: pinnedStreamers with YT', { count: withYt.length, streamers: withYt.map((s) => ({ id: s.id, nickname: s.nickname, yt: s.youtubeChannelId })) })
    if (withYt.length === 0) {
      setYoutubeVideoToStreamerId((prev) => (prev.size === 0 ? prev : new Map()))
      setPinnedOriginatedEmbeds((prev) => {
        const next = new Map(prev)
        for (const k of next.keys()) if (k.startsWith('youtube:')) next.delete(k)
        return next.size === prev.size ? prev : next
      })
      return
    }
    const baseMs = 60_000
    const intervalMs = Math.max(15_000, Math.round(baseMs * pinnedYoutubeCheckMultiplier))
    let cancelled = false
    const run = async () => {
      /** key -> streamer ids that resolved to this video (multiple pinned can share same stream). */
      const nextMap = new Map<string, string[]>()
      const newEmbeds = new Map<string, LiveEmbed>()
      for (const s of withYt) {
        if (cancelled) return
        const channelId = (s.youtubeChannelId || '').trim()
        if (!channelId) continue
        try {
          const r = await window.ipcRenderer.invoke('youtube-live-or-latest', channelId, { streamerNickname: s.nickname, useDggFallback: false }) as { isLive?: boolean; videoId?: string; error?: string }
          if (cancelled) return
          logPinned('YT result', { nickname: s.nickname || s.id, channelId, isLive: r?.isLive, videoId: r?.videoId, error: r?.error })
          if (r?.isLive && r?.videoId) {
            const key = makeEmbedKey('youtube', r.videoId)
            const ids = nextMap.get(key) ?? []
            if (!ids.includes(s.id)) ids.push(s.id)
            nextMap.set(key, ids)
            newEmbeds.set(key, {
              platform: 'youtube',
              id: r.videoId,
              mediaItem: { metadata: { displayName: s.nickname || r.videoId, title: s.nickname || r.videoId } },
            })
          }
        } catch (e) {
          logPinned('YT error', { nickname: s.nickname || s.id, channelId, err: String(e) })
        }
      }
      if (cancelled) return
      logPinned('YT poll done', { youtubeVideoToStreamerId: Object.fromEntries(nextMap), newEmbedsCount: newEmbeds.size, newEmbedsKeys: Array.from(newEmbeds.keys()) })
      setYoutubeVideoToStreamerId((prev) => {
        if (prev.size !== nextMap.size) return nextMap
        for (const [k, nextIds] of nextMap) {
          const prevIds = prev.get(k)
          if (!prevIds || prevIds.length !== nextIds.length || nextIds.some((id) => !prevIds.includes(id))) return nextMap
        }
        return prev
      })
      setPinnedOriginatedEmbeds((prev) => {
        const next = new Map(prev)
        for (const k of next.keys()) if (k.startsWith('youtube:')) next.delete(k)
        newEmbeds.forEach((embed, key) => next.set(canonicalEmbedKey(key), embed))
        return next
      })
    }
    run()
    const t = setInterval(run, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pinnedStreamers, pinnedYoutubeCheckMultiplier, pinnedPollRefreshTrigger])

  // Poll pinned streamers' Kick channels: add live embeds when live (grouped by findStreamerForKey). No DGG required.
  useEffect(() => {
    const withKick = pinnedStreamers.filter((s) => s.kickSlug?.trim())
    logPinned('Kick poll: pinnedStreamers with Kick', { count: withKick.length, streamers: withKick.map((s) => ({ id: s.id, nickname: s.nickname, kick: s.kickSlug })) })
    if (withKick.length === 0) return
    const intervalMs = 60_000
    let cancelled = false
    const run = async () => {
      const newEmbeds = new Map<string, LiveEmbed>()
      for (const s of withKick) {
        if (cancelled) return
        const slug = (s.kickSlug || '').trim().toLowerCase()
        if (!slug) continue
        try {
          const r = await window.ipcRenderer.invoke('url-is-live', `https://kick.com/${slug}`) as { live?: boolean; error?: string }
          if (cancelled) return
          logPinned('Kick result', { nickname: s.nickname || s.id, slug, live: r?.live, error: r?.error })
          if (r?.live) {
            const key = makeEmbedKey('kick', slug)
            newEmbeds.set(key, {
              platform: 'kick',
              id: slug,
              mediaItem: { metadata: { displayName: s.nickname || slug, title: s.nickname || slug } },
            })
          }
        } catch (e) {
          logPinned('Kick error', { nickname: s.nickname || s.id, slug, err: String(e) })
        }
      }
      if (cancelled) return
      logPinned('Kick poll done', { newEmbedsCount: newEmbeds.size, newEmbedsKeys: Array.from(newEmbeds.keys()) })
      setPinnedOriginatedEmbeds((prev) => {
        const next = new Map(prev)
        for (const k of next.keys()) if (k.startsWith('kick:')) next.delete(k)
        newEmbeds.forEach((embed, key) => next.set(canonicalEmbedKey(key), embed))
        return next
      })
    }
    run()
    const t = setInterval(run, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pinnedStreamers, pinnedPollRefreshTrigger])

  // Poll pinned streamers' Twitch channels: add live embeds when live (grouped by findStreamerForKey). No DGG required.
  useEffect(() => {
    const withTwitch = pinnedStreamers.filter((s) => s.twitchLogin?.trim())
    logPinned('Twitch poll: pinnedStreamers with Twitch', { count: withTwitch.length, streamers: withTwitch.map((s) => ({ id: s.id, nickname: s.nickname, twitch: s.twitchLogin })) })
    if (withTwitch.length === 0) return
    const intervalMs = 60_000
    let cancelled = false
    const run = async () => {
      const newEmbeds = new Map<string, LiveEmbed>()
      for (const s of withTwitch) {
        if (cancelled) return
        const login = (s.twitchLogin || '').trim().toLowerCase()
        if (!login) continue
        try {
          const r = await window.ipcRenderer.invoke('url-is-live', `https://twitch.tv/${login}`) as { live?: boolean; error?: string }
          if (cancelled) return
          logPinned('Twitch result', { nickname: s.nickname || s.id, login, live: r?.live, error: r?.error })
          if (r?.live) {
            const key = makeEmbedKey('twitch', login)
            newEmbeds.set(key, {
              platform: 'twitch',
              id: login,
              mediaItem: { metadata: { displayName: s.nickname || login, title: s.nickname || login } },
            })
          }
        } catch (e) {
          logPinned('Twitch error', { nickname: s.nickname || s.id, login, err: String(e) })
        }
      }
      if (cancelled) return
      logPinned('Twitch poll done', { newEmbedsCount: newEmbeds.size, newEmbedsKeys: Array.from(newEmbeds.keys()) })
      setPinnedOriginatedEmbeds((prev) => {
        const next = new Map(prev)
        for (const k of next.keys()) if (k.startsWith('twitch:')) next.delete(k)
        newEmbeds.forEach((embed, key) => next.set(canonicalEmbedKey(key), embed))
        return next
      })
    }
    run()
    const t = setInterval(run, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pinnedStreamers, pinnedPollRefreshTrigger])

  const selectedEmbeds = useMemo(() => {
    const arr: { key: string; embed: LiveEmbed }[] = []
    selectedEmbedKeys.forEach((key) => {
      const embed = combinedAvailableEmbeds.get(key)
      if (embed) arr.push({ key, embed })
    })
    // stable order: higher count/viewers first
    arr.sort((a, b) => (Number(b.embed.count || 0) || 0) - (Number(a.embed.count || 0) || 0))
    return arr
  }, [combinedAvailableEmbeds, selectedEmbedKeys])

  const addEmbedFromUrl = useCallback(async (url: string): Promise<boolean> => {
    setPasteLinkError(null)
    const parsed = parseEmbedUrl(url)
    if (!parsed) {
      setPasteLinkError('Unsupported URL. Use YouTube, Kick, or Twitch link.')
      return false
    }
    const key = makeEmbedKey(parsed.platform, parsed.id)
    // Pinned add is temporary; no live check — add any valid embed URL.
    setPinnedEmbeds((prev) => {
      const next = new Map(prev)
      if (next.has(key)) return prev
      next.set(key, {
        platform: parsed.platform,
        id: parsed.id,
        mediaItem: { metadata: { displayName: parsed.id, title: parsed.id } },
      })
      return next
    })
    setSelectedEmbedKeys((prev) => new Set(prev).add(key))
    return true
  }, [])

  const toggleEmbed = useCallback((key: string) => {
    setSelectedEmbedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleEmbedChat = useCallback((key: string) => {
    setSelectedEmbedChatKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** Display names for combined chat channel labels; prefer pinned streamer nickname when available. */
  const embedDisplayNameByKey = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [key, e] of combinedAvailableEmbeds.entries()) {
      const streamers = findStreamersForKey(key, pinnedStreamers, youtubeVideoToStreamerId)
      const nickname = streamers.map((s) => s.nickname?.trim()).find(Boolean)
      if (nickname) {
        out[key] = nickname
      } else {
        const dn = e?.mediaItem?.metadata?.displayName || e?.mediaItem?.metadata?.title
        if (typeof dn === 'string' && dn.trim()) out[key] = dn.trim()
      }
    }
    return out
  }, [combinedAvailableEmbeds, pinnedStreamers, youtubeVideoToStreamerId])

  /** Lookup display name by message key (canonicalizes so youtube:rvijzhO5Shc matches youtube:rvijzho5shc). */
  const getEmbedDisplayName = useCallback(
    (key: string) => (embedDisplayNameByKey[canonicalEmbedKey(key)] ?? '').trim(),
    [embedDisplayNameByKey],
  )

  /** Destiny # link: add embed to split or shake if already selected. Used by combined chat and DGG embed IPC. */
  const handleDestinyLink = useCallback(
    (platform: string, id: string) => {
      const key = makeEmbedKey(platform, id)
      const canonical = canonicalEmbedKey(key)
      if (selectedEmbedKeysRef.current.has(canonical)) {
        setShakeEmbedKey(canonical)
        const t = setTimeout(() => setShakeEmbedKey(null), 500)
        return () => clearTimeout(t)
      }
      addEmbedFromUrl(buildEmbedUrl(platform, id))
    },
    [addEmbedFromUrl],
  )

  useEffect(() => {
    handleDestinyLinkRef.current = handleDestinyLink
  }, [handleDestinyLink])

  const handleChatOpenLink = useCallback(
    (url: string) => {
      const trimmed = String(url || '').trim()
      if (trimmed.startsWith('#')) {
        const parsed = parseDestinyHashLink(trimmed)
        if (parsed) {
          handleDestinyLink(parsed.platform, parsed.id)
          return
        }
      }
      if (chatLinkOpenAction === 'none') return
      window.ipcRenderer.invoke('link-scroller-handle-link', { url, action: chatLinkOpenAction }).catch(() => {})
    },
    [chatLinkOpenAction, handleDestinyLink],
  )

  const enabledKickSlugs = useMemo(() => {
    const slugs: string[] = []
    selectedEmbedChatKeys.forEach((k) => {
      const parsed = parseEmbedKey(k)
      if (parsed?.platform !== 'kick') return
      slugs.push(parsed.id)
    })
    return Array.from(new Set(slugs)).sort()
  }, [selectedEmbedChatKeys])

  const openKickHistorySetup = useCallback(() => {
    const slug = enabledKickSlugs[0] || ''
    window.ipcRenderer.invoke('kick-open-cookie-window', { slug }).catch(() => {})
  }, [enabledKickSlugs])

  const retryKickHistory = useCallback(() => {
    window.ipcRenderer.invoke('kick-chat-refetch-history', { slugs: enabledKickSlugs }).catch(() => {})
  }, [enabledKickSlugs])

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      if (!chatPaneOpen) return
      const startX = e.clientX
      const startWidth = chatPaneWidth
      const minW = 280
      const maxW = Math.max(320, Math.floor(window.innerWidth * 0.6))

      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const next = chatPaneSide === 'left' ? startWidth + dx : startWidth - dx
        setChatPaneWidth(clamp(next, minW, maxW))
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [chatPaneOpen, chatPaneSide, chatPaneWidth],
  )

  const renderEmbedTile = useCallback(
    (item: { key: string; embed: LiveEmbed }) => {
      const e = item.embed
      const platform = (e.platform || '').toLowerCase()
      const id = e.id

      const title = e.mediaItem?.metadata?.title || e.mediaItem?.metadata?.displayName || `${e.platform}/${e.id}`
      const viewers = e.mediaItem?.metadata?.viewers

      const banned = bannedEmbeds.get(item.key)
      const streamers = findStreamersForKey(item.key, pinnedStreamers, youtubeVideoToStreamerId)
      const streamerColor = streamers[0]?.color && /^#[0-9A-Fa-f]{6}$/.test(streamers[0].color) ? streamers[0].color : undefined
      const accent = streamerColor ?? (streamers.length > 0 ? COLOR_BOOKMARKED_DEFAULT : omniColorForKey(item.key, { displayName: e.mediaItem?.metadata?.displayName }))

      let content: JSX.Element
      if (platform === 'kick') {
        content = <KickEmbed url={`https://kick.com/${id}`} autoplay={autoplay} mute={mute} fit="fill" />
      } else if (platform === 'twitch') {
        content = <TwitchEmbed url={`https://www.twitch.tv/${id}`} autoplay={autoplay} mute={mute} fit="fill" />
      } else if (platform === 'youtube' && isLikelyYouTubeId(id)) {
        const yt = buildYouTubeEmbed(id)
        content = <YouTubeEmbed url={yt.url} embedUrl={yt.embedUrl} autoplay={autoplay} mute={mute} showLink={false} fit="fill" />
      } else {
        content = (
          <div className="bg-base-200 rounded-lg p-3">
            <div className="text-sm text-base-content/70">Unsupported embed: {platform}</div>
            <div className="text-xs text-base-content/50 break-all">{id}</div>
          </div>
        )
      }

      const isShaking = shakeEmbedKey != null && canonicalEmbedKey(item.key) === shakeEmbedKey
      // Single structure so toggling cinema mode only changes wrapper classes/header visibility; embed iframe does not remount.
      return (
        <div
          key={item.key}
          className={`${cinemaMode ? 'w-full h-full min-h-0 min-w-0 overflow-hidden' : 'card bg-base-200 shadow-md overflow-hidden flex flex-col min-h-0'} ${isShaking ? 'embed-tile-shake' : ''}`}
          style={{ borderTop: cinemaMode ? undefined : `4px solid ${accent}`, viewTransitionName: makeViewTransitionNameForKey(item.key) } as any}
        >
          {!cinemaMode && (
            <div className="p-2 flex items-center justify-between gap-2" style={{ background: withAlpha(accent, 0.08) }}>
              <div className="min-w-0">
                <div className="text-xs uppercase" style={{ color: accent }}>
                  {platform}
                </div>
                <div className="text-sm font-semibold truncate" title={title}>
                  {title}
                </div>
                <div className="text-xs text-base-content/60">
                  {typeof viewers === 'number' ? `${viewers.toLocaleString()} viewers` : null}
                  {typeof e.count === 'number' ? `  •  ${e.count} embeds` : null}
                  {banned ? `  •  BANNED` : null}
                </div>
              </div>
              <button className="btn btn-xs btn-ghost" onClick={() => toggleEmbed(item.key)} title="Remove from grid">
                ✕
              </button>
            </div>
          )}
          <div className={cinemaMode ? 'w-full h-full min-h-0' : 'px-2 pb-2 flex-1 min-h-0'}>
            <div className="w-full h-full min-h-0">{content}</div>
          </div>
        </div>
      )
    },
    [autoplay, bannedEmbeds, cinemaMode, mute, pinnedStreamers, shakeEmbedKey, toggleEmbed, youtubeVideoToStreamerId],
  )

  /** Dock item: merged pinned group (same keys = one button) or single embed. */
  type DockItem =
    | { type: 'group'; streamers: PinnedStreamer[]; keys: string[] }
    | { type: 'single'; key: string }

  const dockItems = useMemo((): DockItem[] => {
    const allKeys = Array.from(combinedAvailableEmbeds.keys())
    const streamerToKeys = new Map<string, string[]>()
    for (const s of pinnedStreamers) {
      streamerToKeys.set(s.id, [])
    }
    const ungrouped: string[] = []
    for (const key of allKeys) {
      const streamers = findStreamersForKey(key, pinnedStreamers, youtubeVideoToStreamerId)
      if (streamers.length > 0) {
        for (const streamer of streamers) {
          streamerToKeys.get(streamer.id)!.push(key)
        }
      } else {
        ungrouped.push(key)
      }
    }
    // Build per-streamer key sets, then merge: same key set = one dock button (avoid duplicate buttons for same stream)
    const keySetToStreamers = new Map<string, PinnedStreamer[]>()
    for (const s of pinnedStreamers) {
      const keys = [...streamerToKeys.get(s.id)!].filter((k) => combinedAvailableEmbeds.has(k)).sort()
      if (keys.length === 0) continue
      const sig = keys.join('\0')
      const list = keySetToStreamers.get(sig) ?? []
      list.push(s)
      keySetToStreamers.set(sig, list)
    }
    const result: DockItem[] = []
    // Preserve pinned streamer order: use first streamer's index for sort
    const pinnedIndex = new Map(pinnedStreamers.map((s, i) => [s.id, i]))
    const groups = Array.from(keySetToStreamers.entries()).map(([sig, streamers]) => ({
      streamers,
      keys: sig.split('\0'),
      minIndex: Math.min(...streamers.map((s) => pinnedIndex.get(s.id) ?? 9999)),
    }))
    groups.sort((a, b) => a.minIndex - b.minIndex)
    const keysInGroups = new Set<string>()
    for (const g of groups) {
      g.keys.forEach((k) => keysInGroups.add(k))
      result.push({ type: 'group', streamers: g.streamers, keys: g.keys })
    }
    for (const key of ungrouped) {
      if (keysInGroups.has(key)) continue
      result.push({ type: 'single', key })
    }
    result.sort((a, b) => {
      if (a.type === 'group' && b.type === 'single') return -1
      if (a.type === 'single' && b.type === 'group') return 1
      if (a.type === 'group' && b.type === 'group') {
        const aMin = Math.min(...a.streamers.map((s) => pinnedIndex.get(s.id) ?? 9999))
        const bMin = Math.min(...b.streamers.map((s) => pinnedIndex.get(s.id) ?? 9999))
        return aMin - bMin
      }
      const aKey = a.type === 'single' ? a.key : a.keys[0]
      const bKey = b.type === 'single' ? b.key : b.keys[0]
      const aEmb = combinedAvailableEmbeds.get(aKey)
      const bEmb = combinedAvailableEmbeds.get(bKey)
      const av = Number(aEmb?.count ?? aEmb?.mediaItem?.metadata?.viewers ?? 0) || 0
      const bv = Number(bEmb?.count ?? bEmb?.mediaItem?.metadata?.viewers ?? 0) || 0
      return bv - av
    })
    logPinned('dockItems', { resultCount: result.length, result: result.map((r) => (r.type === 'group' ? `group:${r.streamers.map((s) => s.nickname).join(',')}:${r.keys.length}` : `single:${r.key}`)) })
    return result
  }, [combinedAvailableEmbeds, pinnedStreamers, youtubeVideoToStreamerId])

  const dockRef = useRef<HTMLDivElement | null>(null)
  const dockBarRef = useRef<HTMLDivElement | null>(null)
  const dockButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const dockCloseTimerRef = useRef<number | null>(null)
  /** Right-click on dock bar: context menu position. */
  const [dockContextMenuAt, setDockContextMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [dockContextMenuHover, setDockContextMenuHover] = useState<'preferred' | 'dockPosition' | null>(null)
  const dockContextMenuRef = useRef<HTMLDivElement | null>(null)
  /** Which embed key is currently "watching" on live.destiny.gg (shows 👀 in dock). Only one at a time. */
  const [watchedEmbedKey, setWatchedEmbedKey] = useState<string | null>(null)
  /** Right-click on a dock item: context menu position and item. */
  const [dockItemContextMenu, setDockItemContextMenu] = useState<{ x: number; y: number; item: DockItem } | null>(null)
  const dockItemContextMenuRef = useRef<HTMLDivElement | null>(null)
  /** Dock item id: "group:"+streamer.id or "single:"+key */
  const [dockHoverItemId, setDockHoverItemId] = useState<string | null>(null)
  const [dockHoverPinned, setDockHoverPinned] = useState(false)
  const [dockHoverRect, setDockHoverRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const getDockItemId = useCallback((item: DockItem) => {
    return item.type === 'group' ? `group:${item.keys.join('\0')}` : `single:${item.key}`
  }, [])

  const updateDockHoverRect = useCallback((itemId: string) => {
    const el = dockButtonRefs.current.get(itemId)
    if (!el) return
    const r = el.getBoundingClientRect()
    setDockHoverRect({ left: r.left, top: r.top, width: r.width, height: r.height })
  }, [])

  const clearDockCloseTimer = useCallback(() => {
    if (dockCloseTimerRef.current) {
      window.clearTimeout(dockCloseTimerRef.current)
      dockCloseTimerRef.current = null
    }
  }, [])

  const openDockHover = useCallback(
    (itemId: string) => {
      clearDockCloseTimer()
      setDockHoverItemId(itemId)
      updateDockHoverRect(itemId)
    },
    [clearDockCloseTimer, updateDockHoverRect],
  )

  const scheduleCloseDockHover = useCallback(() => {
    clearDockCloseTimer()
    dockCloseTimerRef.current = window.setTimeout(() => {
      if (dockHoverPinned) return
      setDockHoverItemId(null)
    }, 120)
  }, [clearDockCloseTimer, dockHoverPinned])

  const onDockBarContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDockContextMenuAt({ x: e.clientX, y: e.clientY })
  }, [])

  const closeDockContextMenu = useCallback(() => {
    setDockContextMenuAt(null)
    setDockContextMenuHover(null)
  }, [])

  const closeDockItemContextMenu = useCallback(() => {
    setDockItemContextMenu(null)
  }, [])

  const bringPreferredPlatformToTop = useCallback((platform: 'youtube' | 'kick' | 'twitch') => {
    setPreferredPlatformOrder((prev) => {
      const rest = prev.filter((p) => p !== platform)
      return [platform, ...rest]
    })
    closeDockContextMenu()
  }, [closeDockContextMenu])

  const setDockPositionFromMenu = useCallback((atTop: boolean) => {
    setDockAtTop(atTop)
    closeDockContextMenu()
  }, [closeDockContextMenu])

  useEffect(() => {
    if (!dockContextMenuAt) return
    const onPointer = (e: PointerEvent) => {
      const el = dockContextMenuRef.current
      if (el && (el === e.target || el.contains(e.target as Node))) return
      closeDockContextMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDockContextMenu()
    }
    window.addEventListener('pointerdown', onPointer, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true })
      window.removeEventListener('keydown', onKey)
    }
  }, [dockContextMenuAt, closeDockContextMenu])

  useEffect(() => {
    if (!dockItemContextMenu) return
    const onPointer = (e: PointerEvent) => {
      const el = dockItemContextMenuRef.current
      if (el && (el === e.target || el.contains(e.target as Node))) return
      closeDockItemContextMenu()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDockItemContextMenu()
    }
    window.addEventListener('pointerdown', onPointer, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer, { capture: true })
      window.removeEventListener('keydown', onKey)
    }
  }, [dockItemContextMenu, closeDockItemContextMenu])

  useEffect(() => {
    if (!dockHoverItemId) return
    const el = dockRef.current
    const onUpdate = () => updateDockHoverRect(dockHoverItemId)
    window.addEventListener('resize', onUpdate)
    el?.addEventListener('scroll', onUpdate, { passive: true } as any)
    return () => {
      window.removeEventListener('resize', onUpdate)
      el?.removeEventListener('scroll', onUpdate as any)
    }
  }, [dockHoverItemId, updateDockHoverRect])

  useLayoutEffect(() => {
    if (!dockHoverItemId) return
    updateDockHoverRect(dockHoverItemId)
  }, [dockHoverItemId, dockItems.length, updateDockHoverRect])

  const onDockWheel = useCallback((e: React.WheelEvent) => {
    const el = dockRef.current
    if (!el) return
    if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
  }, [])

  const hoveredDockItem = useMemo((): DockItem | null => {
    if (!dockHoverItemId) return null
    return dockItems.find((it) => getDockItemId(it) === dockHoverItemId) ?? null
  }, [dockHoverItemId, dockItems, getDockItemId])

  /** Pie chart: one slice per embed; values from embeds websocket (count = people watching that embed). */
  const pieChartData = useMemo((): PieDatum[] => {
    const entries: PieDatum[] = []
    const maxLabelLen = 18
    for (const [key, embed] of combinedAvailableEmbeds) {
      const value: number =
        typeof (embed as LiveEmbed).count === 'number'
          ? (embed as LiveEmbed).count ?? 0
          : typeof embed.mediaItem?.metadata?.viewers === 'number'
            ? embed.mediaItem.metadata.viewers
            : 0
      if (value <= 0) continue
      const rawName =
        embed.mediaItem?.metadata?.displayName ||
        embed.mediaItem?.metadata?.title ||
        key
      const name = rawName.length > maxLabelLen ? rawName.slice(0, maxLabelLen - 1) + '…' : rawName
      const color = omniColorForKey(key, { displayName: embed.mediaItem?.metadata?.displayName })
      entries.push({ name, value, color })
    }
    return entries.sort((a, b) => b.value - a.value)
  }, [combinedAvailableEmbeds])

  const pieChartButtonRef = useRef<HTMLButtonElement>(null)
  const pieChartCloseTimerRef = useRef<number | null>(null)
  const [pieChartPinned, setPieChartPinned] = useState(false)
  const [pieChartHover, setPieChartHover] = useState(false)
  const [pieChartRect, setPieChartRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const showPiePopup = (pieChartPinned || pieChartHover) && pieChartRect

  const updatePieChartRect = useCallback(() => {
    const el = pieChartButtonRef.current
    if (!el) return
    setPieChartRect(el.getBoundingClientRect())
  }, [])

  const openPiePopup = useCallback(() => {
    if (pieChartCloseTimerRef.current) {
      window.clearTimeout(pieChartCloseTimerRef.current)
      pieChartCloseTimerRef.current = null
    }
    setPieChartHover(true)
    updatePieChartRect()
  }, [updatePieChartRect])

  const scheduleClosePiePopup = useCallback(() => {
    if (pieChartCloseTimerRef.current) window.clearTimeout(pieChartCloseTimerRef.current)
    pieChartCloseTimerRef.current = window.setTimeout(() => {
      if (pieChartPinned) return
      setPieChartHover(false)
    }, 120)
  }, [pieChartPinned])

  useEffect(() => {
    if (!showPiePopup) return
    window.addEventListener('resize', updatePieChartRect)
    return () => window.removeEventListener('resize', updatePieChartRect)
  }, [showPiePopup, updatePieChartRect])

  const toggleDockItemMaster = useCallback(
    (item: DockItem) => {
      const keys = item.type === 'group' ? item.keys : [item.key]
      const anyOn = keys.some((k) => selectedEmbedKeys.has(k) || selectedEmbedChatKeys.has(k))
      if (anyOn) {
        setSelectedEmbedKeys((prev) => {
          const next = new Set(prev)
          keys.forEach((k) => next.delete(k))
          return next
        })
        setSelectedEmbedChatKeys((prev) => {
          const next = new Set(prev)
          keys.forEach((k) => next.delete(k))
          return next
        })
      } else {
        // Prefer first key whose platform matches preferred order (so clicking the bar turns on preferred platform's video)
        const keyToAdd =
          keys.length === 1
            ? keys[0]
            : (() => {
                for (const platform of preferredPlatformOrder) {
                  const match = keys.find((k) => (k.split(':')[0] || '').toLowerCase() === platform)
                  if (match) return match
                }
                return keys[0]
              })()
        setSelectedEmbedKeys((prev) => new Set(prev).add(keyToAdd))
      }
    },
    [selectedEmbedKeys, selectedEmbedChatKeys, preferredPlatformOrder],
  )

  const gridCols = useMemo(() => {
    return getBestGridColumns({
      count: selectedEmbeds.length,
      width: gridHostSize.width,
      height: gridHostSize.height,
      gapPx: cinemaMode ? 0 : 12,
      headerHeightPx: cinemaMode ? 0 : 56,
    })
  }, [cinemaMode, gridHostSize.height, gridHostSize.width, selectedEmbeds.length])

  return (
    // Full-height layout; only the bottom embed bar is always visible.
    <div className="h-full min-h-0 bg-base-100 text-base-content flex flex-col overflow-hidden">
      {/* Main layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Single CombinedChat instance portaled into active container (avoids flash when toggling overlay) */}
        {chatPaneOpen &&
          chatPortalTarget &&
          createPortal(
            <CombinedChat
              enableDgg={combinedIncludeDgg}
              showDggInput={showDggInput}
              getEmbedDisplayName={getEmbedDisplayName}
              getEmbedColor={getEmbedColor}
              getEmbedLabelHidden={getEmbedLabelHidden}
              dggLabelColor={dggLabelColorOverride || undefined}
              dggLabelText={dggLabelText}
              onOpenLink={handleChatOpenLink}
              maxMessages={combinedMaxMessages}
              maxMessagesScroll={combinedMaxMessagesScroll}
              showTimestamps={combinedShowTimestamps}
              showSourceLabels={combinedShowLabels}
              showPlatformIcons={combinedShowPlatformIcons}
              sortMode={combinedSortMode}
              highlightTerms={combinedHighlightTerms}
              pauseEmoteAnimationsOffScreen={combinedPauseEmoteAnimationsOffScreen}
              showDggFlairsAndColors={!combinedDisableDggFlairsAndColors}
              contextMenuConfig={combinedChatContextMenuConfig}
              onCountChange={setCombinedMsgCount}
              onDggUserCountChange={setCombinedDggUserCount}
              dggInputRef={dggInputRef}
              dggChatActionsRef={dggChatActionsRef}
              focusShortcutLabel={formatDggFocusKeybind(dggFocusKeybind)}
              overlayMode={combinedChatOverlayMode}
              overlayOpacity={combinedChatOverlayOpacity}
              messagesClickThrough={combinedChatOverlayMode ? overlayMessagesClickThrough : false}
              inputContainerRef={combinedChatOverlayMode ? chatOverlayInputContainerRef : undefined}
              contextMenuRef={combinedChatContextMenuRef}
            />,
            chatPortalTarget
          )}
        {/* Lite link scroller on left when chat is on the right (opposite side of chat) */}
        {liteLinkScrollerOpen && chatPaneSide === 'right' && (
          <div className="flex-shrink-0 min-h-0 flex flex-col overflow-hidden border-r border-base-300" style={{ width: 380 }}>
            <LiteLinkScroller
              open={true}
              onClose={() => setLiteLinkScrollerOpen(false)}
              cards={liteLinkScrollerCards}
              settings={liteLinkScrollerSettings}
              onSettingsChange={(partial) => setLiteLinkScrollerSettings((prev) => ({ ...prev, ...partial }))}
              onOpenLink={(url) => {
                window.ipcRenderer.invoke('link-scroller-handle-link', { url, action: chatLinkOpenAction }).catch(() => {})
              }}
              getEmbedTheme={() => (document.documentElement?.getAttribute('data-theme') === 'light' ? 'light' : 'dark')}
              onOpenSettings={() => {
                setSettingsModalOpen(true)
                setSettingsTab('liteLinkScroller')
              }}
            />
          </div>
        )}

        {/* Left pane (hidden when chat overlay or side right; container kept in DOM for portal stability) */}
        {chatPaneOpen && (
          <>
            <div
              className="bg-base-200 border-r border-base-300 min-h-0 flex flex-col overflow-hidden"
              style={{
                width: chatPaneWidth,
                display: combinedChatOverlayMode || chatPaneSide !== 'left' ? 'none' : undefined,
              }}
            >
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <div
                  className="p-2 border-b border-base-300"
                  onContextMenu={(e) => {
                    if (combinedChatContextMenuConfig) {
                      e.preventDefault()
                      combinedChatContextMenuRef.current?.openContextMenu(e)
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-base-content/70 truncate flex-1 min-w-0">
                      {combinedHeaderText}
                    </div>
                    <div className="text-xs text-base-content/60 whitespace-nowrap flex items-center gap-1">
                      {combinedMsgCount} msgs · {combinedDggUserCount} users
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        title="Overlay on embeds"
                        onClick={() => setCombinedChatOverlayMode(true)}
                        aria-label="Overlay chat on embeds"
                      >
                        ⊞
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost btn-circle"
                        title="Close chat"
                        onClick={() => setChatPaneOpen(false)}
                        aria-label="Close chat"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                </div>
                <div ref={setLeftChatContainerRef} className="flex-1 min-h-0 overflow-hidden" />
              </div>
            </div>
            {!combinedChatOverlayMode && chatPaneSide === 'left' && (
              <div
                className="w-1 cursor-col-resize bg-transparent hover:bg-base-content/20 transition-colors"
                onPointerDown={startResize}
                title="Drag to resize"
              />
            )}
          </>
        )}

        {/* Center column: embeds grid + dock (dock order switches by dockAtTop) */}
        <div className={`flex-1 min-w-0 min-h-0 relative flex flex-col overflow-visible ${cinemaMode ? 'p-0' : 'p-3'}`}>
          {/* 50% transparent background behind embeds */}
          <div
            className="absolute inset-0 opacity-50 pointer-events-none bg-center bg-no-repeat bg-cover"
            style={{ backgroundImage: `url(${danTheBuilderBg})` }}
          />

          {/* Embed grid area (measured by ResizeObserver) */}
          <div ref={gridAreaRef} className={`relative z-10 flex-1 min-h-0 overflow-hidden ${dockAtTop ? 'order-1' : 'order-0'}`}>
            {selectedEmbeds.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-xl font-bold mb-2">No embeds selected</div>
                  <div className="text-base-content/70">Use the dock to toggle streams on.</div>
                </div>
              </div>
            ) : (
              (() => {
                const rows = Math.max(1, Math.ceil(selectedEmbeds.length / Math.max(1, gridCols)))
                return (
                  <div
                    className={`grid h-full min-h-0 ${cinemaMode ? 'gap-0' : 'gap-3'}`}
                    style={{
                      gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                    }}
                  >
                    {selectedEmbeds.map(renderEmbedTile)}
                  </div>
                )
              })()
            )}

            {/* Combined chat overlay (hidden when !overlay; container kept in DOM for portal stability). key keeps React from replacing this node when grid/embeds update. When click-through on: panel has pointer-events-none so all mouse goes to embeds; header and resize handle use pointer-events-auto to stay interactive. Header auto-hides after pointer leaves when click-through is off. */}
            {chatPaneOpen && (
              <div
                key="combined-chat-overlay"
                className={`absolute top-0 bottom-0 z-20 flex flex-col ${combinedChatOverlayMode && overlayMessagesClickThrough ? 'pointer-events-none' : ''} ${combinedChatOverlayMode ? '' : `border-base-300 shadow-lg ${chatPaneSide === 'right' ? 'border-l' : 'border-r'}`}`}
                style={{
                  width: chatPaneWidth,
                  ...(chatPaneSide === 'right' ? { right: 0 } : { left: 0 }),
                  display: combinedChatOverlayMode ? undefined : 'none',
                }}
                onPointerEnter={() => {
                  if (overlayHeaderHideTimeoutRef.current) {
                    clearTimeout(overlayHeaderHideTimeoutRef.current)
                    overlayHeaderHideTimeoutRef.current = null
                  }
                  setOverlayHeaderVisible(true)
                }}
                onPointerLeave={() => {
                  if (combinedChatOverlayMode && !overlayMessagesClickThrough) {
                    overlayHeaderHideTimeoutRef.current = setTimeout(() => {
                      setOverlayHeaderVisible(false)
                      overlayHeaderHideTimeoutRef.current = null
                    }, 2500)
                  }
                }}
              >
                {/* Resize handle on inner edge when overlay mode: grab to resize chat width. pointer-events-auto so it stays clickable when click-through is on. */}
                {combinedChatOverlayMode && (
                  <div
                    className={`absolute top-0 bottom-0 z-30 w-1 cursor-col-resize bg-transparent hover:bg-base-content/20 transition-colors pointer-events-auto ${chatPaneSide === 'right' ? 'left-0' : 'right-0'}`}
                    onPointerDown={startResize}
                    title="Drag to resize"
                    aria-label="Resize chat width"
                  />
                )}
                <div
                  className={`p-2 border-b border-base-300 flex items-center gap-2 flex-wrap bg-base-200 pointer-events-auto shrink-0 transition-opacity duration-200 ${combinedChatOverlayMode && !overlayHeaderVisible ? 'opacity-0' : 'opacity-100'}`}
                  onContextMenu={(e) => {
                    if (combinedChatContextMenuConfig) {
                      e.preventDefault()
                      combinedChatContextMenuRef.current?.openContextMenu(e)
                    }
                  }}
                >
                  <div className="text-xs text-base-content/70 truncate flex-1 min-w-0">
                    {combinedHeaderText}
                  </div>
                  <div className="text-xs text-base-content/60 whitespace-nowrap flex items-center gap-1 flex-wrap">
                    {combinedMsgCount} msgs · {combinedDggUserCount} users
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      title={combinedChatOverlayMode ? 'Switch to side panel' : 'Overlay on embeds'}
                      onClick={() => setCombinedChatOverlayMode((v) => !v)}
                      aria-label="Toggle overlay mode"
                    >
                      {combinedChatOverlayMode ? '📌' : '⊞'}
                    </button>
                    <div className="relative" ref={overlayOpacityDropdownRef}>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost text-base-content/60 min-w-0 p-0.5"
                        title="Chat overlay opacity"
                        aria-label="Overlay opacity"
                        aria-expanded={overlayOpacityDropdownOpen}
                        onClick={() => setOverlayOpacityDropdownOpen((v) => !v)}
                      >
                        ⬜
                      </button>
                      {overlayOpacityDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 py-1.5 px-1.5 rounded-lg border border-base-300 bg-base-200 shadow-lg z-[100] flex flex-col items-center gap-1 min-w-0 h-36">
                          <span className="text-[10px] text-base-content/50 shrink-0">{Math.round(combinedChatOverlayOpacity * 100)}%</span>
                          <div className="flex-1 min-h-0 w-6 flex items-center justify-center self-stretch">
                            <div className="h-full aspect-square flex items-center justify-center">
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={combinedChatOverlayOpacity}
                                onChange={(e) => setCombinedChatOverlayOpacity(Number(e.target.value))}
                                className="range range-xs origin-center -rotate-90 w-full h-4 max-w-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost text-base-content/60"
                      title={overlayMessagesClickThrough ? 'Click through to video (on) — click to disable' : 'Click through to video — click to allow interacting with video underneath'}
                      aria-label={overlayMessagesClickThrough ? 'Disable click through' : 'Enable click through'}
                      onClick={() => setOverlayMessagesClickThrough((v) => !v)}
                    >
                      {overlayMessagesClickThrough ? '🔓' : '🔒'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost btn-circle"
                      title="Close chat"
                      onClick={() => setChatPaneOpen(false)}
                      aria-label="Close chat"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div ref={setOverlayChatContainerRef} className="flex-1 min-h-0 overflow-hidden flex flex-col" />
              </div>
            )}
          </div>

          {/* Embeds dock (when overlay + chat open: dock and chat input in one row; input side matches chat side). z-20 so it paints above the grid (z-10) and we don't see the background image through the input strip. */}
          {combinedChatOverlayMode && chatPaneOpen ? (
            <div className={`relative z-20 flex flex-none items-stretch min-h-0 bg-base-200 ${dockAtTop ? 'order-0' : 'order-1'}`} style={{ minHeight: 'var(--embed-dock-height)' }}>
              <div className={`flex-1 min-w-0 min-h-0 flex ${chatPaneSide === 'left' ? 'flex-row-reverse' : ''}`}>
                <div
                  ref={dockBarRef}
                  className={[
                    'embed-dock-bar relative z-20 flex items-center flex-1 min-w-0',
                    cinemaMode ? `mt-0 bg-base-200 rounded-none gap-0 p-0 items-stretch ${dockAtTop ? 'border-b border-base-300 mb-0' : 'border-t border-base-300'}` : dockAtTop ? 'mb-3 bg-base-200 border border-base-300 rounded-lg gap-2 px-2 py-2' : 'mt-3 bg-base-200 border border-base-300 rounded-lg gap-2 px-2 py-2',
                  ].join(' ')}
                  onContextMenu={onDockBarContextMenu}
                >
                  <div className={`flex-1 min-w-0 min-h-0 ${cinemaMode ? 'self-stretch flex flex-col min-h-0' : ''}`}>
                    <div ref={dockRef} className={`overflow-x-auto overflow-y-hidden whitespace-nowrap embed-dock-scroll ${cinemaMode ? 'py-0 h-full min-h-0 flex-1' : ''}`} onWheel={onDockWheel} style={{ overscrollBehaviorX: 'contain' as any }}>
                      <div className={`flex items-center ${cinemaMode ? 'gap-0 h-full items-stretch' : 'gap-1'}`}>
                        {dockItems.length === 0 ? (
                          <div className={`text-xs text-base-content/60 ${cinemaMode ? 'px-0 py-0' : 'px-2 py-1'}`}>No embeds. Add a link or add a bookmarked streamer (when live).</div>
                        ) : (
                          dockItems.map((item) => {
                            const itemId = getDockItemId(item)
                            const keys = item.type === 'group' ? item.keys : [item.key]
                            const firstKey = keys[0]
                            const firstEmbed = combinedAvailableEmbeds.get(firstKey)
                            const anyBanned = keys.some((k) => bannedEmbeds.get(k))
                            const videoOn = keys.some((k) => selectedEmbedKeys.has(k))
                            const chatOn = keys.some((k) => selectedEmbedChatKeys.has(k))
                            const label = item.type === 'group' ? item.streamers.map((s) => s.nickname || 'Unnamed').join(', ') : (firstEmbed?.id ?? firstKey)
                            const streamersForAccent = item.type === 'group' ? item.streamers : findStreamersForKey(firstKey, pinnedStreamers, youtubeVideoToStreamerId)
                            const streamerColor = streamersForAccent[0]?.color && /^#[0-9A-Fa-f]{6}$/.test(streamersForAccent[0].color) ? streamersForAccent[0].color : undefined
                            const accent = streamerColor ?? (streamersForAccent.length > 0 ? COLOR_BOOKMARKED_DEFAULT : omniColorForKey(firstKey, { displayName: firstEmbed?.mediaItem?.metadata?.displayName }))
                            const active = videoOn || chatOn
                            const activeText = textColorOn(accent)
                            const isWatching = watchedEmbedKey != null && keys.includes(watchedEmbedKey)
                            return (
                              <div key={itemId} className={`flex items-center ${cinemaMode ? 'self-stretch' : ''}`}>
                                <button
                                  type="button"
                                  ref={(el) => { const map = dockButtonRefs.current; if (el) map.set(itemId, el); else map.delete(itemId) }}
                                  className={`btn btn-sm ${active ? '' : 'btn-ghost'} ${anyBanned ? 'btn-disabled' : 'btn-outline'} ${cinemaMode ? 'rounded-none border-0 self-stretch h-full min-h-0' : ''}`}
                                  title={item.type === 'group' ? `${label} (${keys.length} embed${keys.length !== 1 ? 's' : ''})` : `${(firstEmbed?.platform || '').toLowerCase()}: ${firstEmbed?.mediaItem?.metadata?.title || firstKey}`}
                                  onClick={() => toggleDockItemMaster(item)}
                                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setDockHoverItemId(null); setDockHoverPinned(false); setDockItemContextMenu({ x: e.clientX, y: e.clientY, item }) }}
                                  onMouseEnter={() => openDockHover(itemId)}
                                  onMouseLeave={scheduleCloseDockHover}
                                  style={active ? { backgroundColor: accent, borderColor: accent, color: activeText } : { borderColor: accent, color: accent }}
                                >
                                  {label}{isWatching ? ' 👀' : ''}
                                </button>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Same fixed controls as non-overlay dock - reusing same refs (pieChartButtonRef etc.) */}
                  <div className={`embed-dock-controls flex-none flex items-center ${cinemaMode ? 'gap-0 border-l border-base-300 pl-1 self-stretch' : 'gap-2'}`}>
                    <button type="button" ref={pieChartButtonRef} className={`btn btn-sm btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="What's being watched (by platform)" aria-label="Show watch proportions" onMouseEnter={openPiePopup} onMouseLeave={scheduleClosePiePopup} onClick={() => setPieChartPinned((p) => !p)}>🥧</button>
                    <div className={`dropdown dropdown-top dropdown-end ${cinemaMode ? 'self-stretch h-full min-h-0 flex' : ''}`}>
                      <label tabIndex={0} className={`btn btn-sm btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Add embed from link (YouTube, Kick, Twitch)">➕</label>
                      <div tabIndex={0} className="dropdown-content z-[90] p-2 shadow bg-base-100 rounded-box border border-base-300 mt-1 w-64 right-0">
                        <input type="text" placeholder="Paste link or YouTube channel" className="input input-sm input-bordered w-full" id="omni-add-embed-input" disabled={ytChannelLoading} autoComplete="off" onKeyDown={async (e) => { if (e.key !== 'Enter') return; const el = document.getElementById('omni-add-embed-input') as HTMLInputElement | null; const raw = el?.value?.trim(); if (!raw) return; setPasteLinkError(null); setYtChannelError(null); const parsed = parseEmbedUrl(raw); if (parsed) { if ((await addEmbedFromUrl(raw)) && el) el.value = ''; return }; setYtChannelLoading(true); window.ipcRenderer.invoke('youtube-live-or-latest', raw).then(async (r: { error?: string; videoId?: string; isLive?: boolean }) => { if (r?.error) { if (r.error.includes('not currently live')) { const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'; setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }]); if (el) el.value = ''; setYtChannelError(null); setPinnedPollRefreshTrigger((t) => t + 1); return }; setYtChannelError(r.error ?? 'Failed'); return }; if (!r?.isLive) { const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'; setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }]); if (el) el.value = ''; setYtChannelError(null); setPinnedPollRefreshTrigger((t) => t + 1); return }; if (r?.videoId && (await addEmbedFromUrl(`https://www.youtube.com/watch?v=${r.videoId}`)) && el) el.value = ''; setYtChannelError(null); }).finally(() => setYtChannelLoading(false)) }} />
                        <button type="button" className="btn btn-sm btn-primary" title="Add embed" disabled={ytChannelLoading} onClick={async () => { const el = document.getElementById('omni-add-embed-input') as HTMLInputElement | null; const raw = el?.value?.trim(); if (!raw) return; setPasteLinkError(null); setYtChannelError(null); const parsed = parseEmbedUrl(raw); if (parsed) { if ((await addEmbedFromUrl(raw)) && el) el.value = ''; return }; setYtChannelLoading(true); window.ipcRenderer.invoke('youtube-live-or-latest', raw).then(async (r: { error?: string; videoId?: string; isLive?: boolean }) => { if (r?.error) { if (r.error.includes('not currently live')) { const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'; setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }]); if (el) el.value = ''; setYtChannelError(null); setPinnedPollRefreshTrigger((t) => t + 1); return }; setYtChannelError(r.error ?? 'Failed'); return }; if (!r?.isLive) { const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'; setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }]); if (el) el.value = ''; setYtChannelError(null); setPinnedPollRefreshTrigger((t) => t + 1); return }; if (r?.videoId && (await addEmbedFromUrl(`https://www.youtube.com/watch?v=${r.videoId}`)) && el) el.value = ''; setYtChannelError(null); }).finally(() => setYtChannelLoading(false)) }}>{ytChannelLoading ? '…' : 'Add'}</button>
                        {(pasteLinkError || ytChannelError) ? <div className="text-xs text-error">{pasteLinkError || ytChannelError}</div> : null}
                      </div>
                    </div>
                    {!chatPaneOpen && <button type="button" className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Chat pane" onClick={() => setChatPaneOpen(true)} aria-label="Show chat pane">💬</button>}
                    {!liteLinkScrollerOpen && <button type="button" className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Lite link scroller (links from chat)" onClick={() => setLiteLinkScrollerOpen(true)} aria-label="Open lite link scroller">📜</button>}
                    <button type="button" className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 ${autoplay ? 'btn-primary' : ''} ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Autoplay" onClick={() => setAutoplay((v) => !v)} aria-label="Toggle autoplay"><span className="inline-block bg-base-content w-[2.1rem] h-[2.1rem]" style={{ maskImage: `url(${autoplay ? autoplayIcon : autoplayPausedIcon})`, WebkitMaskImage: `url(${autoplay ? autoplayIcon : autoplayPausedIcon})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskSize: 'contain', WebkitMaskRepeat: 'no-repeat', WebkitMaskPosition: 'center' }} aria-hidden /></button>
                    <button type="button" className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${mute ? 'btn-primary' : ''} ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Mute" onClick={() => setMute((v) => !v)} aria-label="Toggle mute">{mute ? '🔇' : '🔉'}</button>
                    <button type="button" className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'btn-primary rounded-none self-stretch h-full min-h-0' : ''}`} title="Cinema mode" onClick={() => setCinemaMode((v) => !v)} aria-label="Toggle cinema mode">📽️</button>
                    <button type="button" className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Settings" onClick={() => setSettingsModalOpen(true)} aria-label="Open settings">⚙️</button>
                    <button className={`btn btn-sm btn-primary ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} onClick={onBackToMenu}>Back</button>
                  </div>
                </div>
                <div
                  ref={chatOverlayInputContainerRef}
                  className={`chat-overlay-input-strip chat-overlay-input-strip-host flex-shrink-0 border-base-300 flex flex-col overflow-hidden min-h-0 ${chatPaneSide === 'left' ? 'border-r' : 'border-l'}`}
                  style={{ width: chatPaneWidth, height: 'var(--embed-dock-height)', backgroundColor: 'var(--color-base-200)' }}
                  data-omni-debug="overlay-input-strip"
                />
              </div>
            </div>
          ) : (
          <div
            ref={dockBarRef}
            className={[
              'embed-dock-bar relative z-20 flex items-center',
              dockAtTop ? 'order-0' : 'order-1',
              cinemaMode
                ? `embed-dock-cinema mt-0 bg-base-200 rounded-none gap-0 p-0 items-stretch ${dockAtTop ? 'border-b border-base-300 mb-0' : 'border-t border-base-300'}`
                : dockAtTop
                  ? 'mb-3 bg-base-200 border border-base-300 rounded-lg gap-2 px-2 py-2'
                  : 'mt-3 bg-base-200 border border-base-300 rounded-lg gap-2 px-2 py-2',
            ].join(' ')}
            onContextMenu={onDockBarContextMenu}
          >
            {/* Scrollable embeds list */}
            <div className={`flex-1 min-w-0 min-h-0 ${cinemaMode ? 'self-stretch flex flex-col min-h-0' : ''}`}>
              <div
                ref={dockRef}
                className={`overflow-x-auto overflow-y-hidden whitespace-nowrap embed-dock-scroll ${cinemaMode ? 'py-0 h-full min-h-0 flex-1' : ''}`}
                onWheel={onDockWheel}
                style={{ overscrollBehaviorX: 'contain' as any }}
              >
                <div className={`flex items-center ${cinemaMode ? 'gap-0 h-full items-stretch' : 'gap-1'}`}>
                  {dockItems.length === 0 ? (
                    <div className={`text-xs text-base-content/60 ${cinemaMode ? 'px-0 py-0' : 'px-2 py-1'}`}>No embeds. Add a link or add a bookmarked streamer (when live).</div>
                  ) : (
                    dockItems.map((item) => {
                      const itemId = getDockItemId(item)
                      const keys = item.type === 'group' ? item.keys : [item.key]
                      const firstKey = keys[0]
                      const firstEmbed = combinedAvailableEmbeds.get(firstKey)
                      const anyBanned = keys.some((k) => bannedEmbeds.get(k))
                      const videoOn = keys.some((k) => selectedEmbedKeys.has(k))
                      const chatOn = keys.some((k) => selectedEmbedChatKeys.has(k))
                      const label = item.type === 'group'
                        ? item.streamers.map((s) => s.nickname || 'Unnamed').join(', ')
                        : (firstEmbed?.id ?? firstKey)
                      const streamersForAccent = item.type === 'group' ? item.streamers : findStreamersForKey(firstKey, pinnedStreamers, youtubeVideoToStreamerId)
                      const streamerColor = streamersForAccent[0]?.color && /^#[0-9A-Fa-f]{6}$/.test(streamersForAccent[0].color) ? streamersForAccent[0].color : undefined
                      const accent = streamerColor ?? (streamersForAccent.length > 0 ? COLOR_BOOKMARKED_DEFAULT : omniColorForKey(firstKey, { displayName: firstEmbed?.mediaItem?.metadata?.displayName }))
                      const active = videoOn || chatOn
                      const activeText = textColorOn(accent)
                      const isWatching = watchedEmbedKey != null && keys.includes(watchedEmbedKey)

                      return (
                        <div key={itemId} className={`flex items-center ${cinemaMode ? 'self-stretch' : ''}`}>
                          <button
                            type="button"
                            ref={(el) => {
                              const map = dockButtonRefs.current
                              if (el) map.set(itemId, el)
                              else map.delete(itemId)
                            }}
                            className={`btn btn-sm ${active ? '' : 'btn-ghost'} ${anyBanned ? 'btn-disabled' : 'btn-outline'} ${cinemaMode ? 'rounded-none border-0 self-stretch h-full min-h-0' : ''}`}
                            title={item.type === 'group' ? `${label} (${keys.length} embed${keys.length !== 1 ? 's' : ''})` : `${(firstEmbed?.platform || '').toLowerCase()}: ${firstEmbed?.mediaItem?.metadata?.title || firstKey}`}
                            onClick={() => toggleDockItemMaster(item)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setDockHoverItemId(null)
                              setDockHoverPinned(false)
                              setDockItemContextMenu({ x: e.clientX, y: e.clientY, item })
                            }}
                            onMouseEnter={() => openDockHover(itemId)}
                            onMouseLeave={scheduleCloseDockHover}
                            style={
                              active
                                ? { backgroundColor: accent, borderColor: accent, color: activeText }
                                : { borderColor: accent, color: accent }
                            }
                          >
                            {label}{isWatching ? ' 👀' : ''}
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Fixed controls (right side): Pie chart, +, Chat pane, Autoplay, Mute, Cinema, Settings, Back */}
            <div className={`embed-dock-controls flex-none flex items-center ${cinemaMode ? 'gap-0 border-l border-base-300 pl-1 self-stretch' : 'gap-2'}`}>
              <button
                type="button"
                ref={pieChartButtonRef}
                className={`btn btn-sm btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`}
                title="What's being watched (by platform)"
                aria-label="Show watch proportions"
                onMouseEnter={openPiePopup}
                onMouseLeave={scheduleClosePiePopup}
                onClick={() => setPieChartPinned((p) => !p)}
              >
                🥧
              </button>
              <div className={`dropdown dropdown-top dropdown-end ${cinemaMode ? 'self-stretch h-full min-h-0 flex' : ''}`}>
                <label tabIndex={0} className={`btn btn-sm btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} title="Add embed from link (YouTube, Kick, Twitch)">
                  ➕
                </label>
                <div tabIndex={0} className="dropdown-content z-[90] p-2 shadow bg-base-100 rounded-box border border-base-300 mt-1 w-64 right-0">
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      placeholder="Paste link or YouTube channel"
                      className="input input-sm input-bordered w-full"
                      id="omni-add-embed-input"
                      disabled={ytChannelLoading}
                      autoComplete="off"
                      onKeyDown={async (e) => {
                        if (e.key !== 'Enter') return
                        const el = document.getElementById('omni-add-embed-input') as HTMLInputElement | null
                        const raw = el?.value?.trim()
                        if (!raw) return
                        setPasteLinkError(null)
                        setYtChannelError(null)
                        const parsed = parseEmbedUrl(raw)
                        if (parsed) {
                          if ((await addEmbedFromUrl(raw)) && el) el.value = ''
                          return
                        }
                        setYtChannelLoading(true)
                        window.ipcRenderer
                          .invoke('youtube-live-or-latest', raw)
                          .then(async (r: { error?: string; videoId?: string; isLive?: boolean }) => {
                            if (r?.error) {
                              if (r.error.includes('not currently live')) {
                                const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'
                                setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }])
                                if (el) el.value = ''
                                setYtChannelError(null)
                                setPinnedPollRefreshTrigger((t) => t + 1)
                                return
                              }
                              setYtChannelError(r.error ?? 'Failed')
                              return
                            }
                            if (!r?.isLive) {
                              const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'
                              setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }])
                              if (el) el.value = ''
                              setYtChannelError(null)
                              setPinnedPollRefreshTrigger((t) => t + 1)
                              return
                            }
                            if (r?.videoId && (await addEmbedFromUrl(`https://www.youtube.com/watch?v=${r.videoId}`)) && el) el.value = ''
                            setYtChannelError(null)
                          })
                          .finally(() => setYtChannelLoading(false))
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      title="Add embed: direct link (YouTube/Kick/Twitch) or YouTube channel (live or add as bookmarked)"
                      disabled={ytChannelLoading}
                      onClick={async () => {
                        const el = document.getElementById('omni-add-embed-input') as HTMLInputElement | null
                        const raw = el?.value?.trim()
                        if (!raw) return
                        setPasteLinkError(null)
                        setYtChannelError(null)
                        const parsed = parseEmbedUrl(raw)
                        if (parsed) {
                          if ((await addEmbedFromUrl(raw)) && el) el.value = ''
                          return
                        }
                        setYtChannelLoading(true)
                        window.ipcRenderer
                          .invoke('youtube-live-or-latest', raw)
                          .then(async (r: { error?: string; videoId?: string; isLive?: boolean }) => {
                            if (r?.error) {
                              if (r.error.includes('not currently live')) {
                                const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'
                                setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }])
                                if (el) el.value = ''
                                setYtChannelError(null)
                                setPinnedPollRefreshTrigger((t) => t + 1)
                                return
                              }
                              setYtChannelError(r.error ?? 'Failed')
                              return
                            }
                            if (!r?.isLive) {
                              const nickname = raw.replace(/^https?:\/\/(www\.)?youtube\.com\//i, '').replace(/^@/, '') || 'YouTube'
                              setPinnedStreamers((prev) => [...prev, { id: `streamer-${Date.now()}`, nickname, youtubeChannelId: raw }])
                              if (el) el.value = ''
                              setYtChannelError(null)
                              setPinnedPollRefreshTrigger((t) => t + 1)
                              return
                            }
                            if (r?.videoId && (await addEmbedFromUrl(`https://www.youtube.com/watch?v=${r.videoId}`)) && el) el.value = ''
                            setYtChannelError(null)
                          })
                          .finally(() => setYtChannelLoading(false))
                      }}
                    >
                      {ytChannelLoading ? '…' : 'Add'}
                    </button>
                    {(pasteLinkError || ytChannelError) ? (
                      <div className="text-xs text-error">{pasteLinkError || ytChannelError}</div>
                    ) : null}
                  </div>
                </div>
              </div>
              {!chatPaneOpen && (
                <button
                  type="button"
                  className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`}
                  title="Chat pane"
                  onClick={() => setChatPaneOpen(true)}
                  aria-label="Show chat pane"
                >
                  💬
                </button>
              )}
              {!liteLinkScrollerOpen && (
                <button
                  type="button"
                  className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`}
                  title="Lite link scroller (links from chat)"
                  onClick={() => setLiteLinkScrollerOpen(true)}
                  aria-label="Open lite link scroller"
                >
                  📜
                </button>
              )}
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 ${autoplay ? 'btn-primary' : ''} ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`}
                title="Autoplay"
                onClick={() => setAutoplay((v) => !v)}
                aria-label="Toggle autoplay"
              >
                <span
                  className="inline-block bg-base-content w-[2.1rem] h-[2.1rem]"
                  style={{
                    maskImage: `url(${autoplay ? autoplayIcon : autoplayPausedIcon})`,
                    WebkitMaskImage: `url(${autoplay ? autoplayIcon : autoplayPausedIcon})`,
                    maskSize: 'contain',
                    maskRepeat: 'no-repeat',
                    maskPosition: 'center',
                    WebkitMaskSize: 'contain',
                    WebkitMaskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                  }}
                  aria-hidden
                />
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${mute ? 'btn-primary' : ''} ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`}
                title="Mute"
                onClick={() => setMute((v) => !v)}
                aria-label="Toggle mute"
              >
                {mute ? '🔇' : '🔉'}
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'btn-primary rounded-none self-stretch h-full min-h-0' : ''}`}
                title="Cinema mode"
                onClick={() => setCinemaMode((v) => !v)}
                aria-label="Toggle cinema mode"
              >
                📽️
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`}
                title="Settings"
                onClick={() => setSettingsModalOpen(true)}
                aria-label="Open settings"
              >
                ⚙️
              </button>

              <button className={`btn btn-sm btn-primary ${cinemaMode ? 'rounded-none self-stretch h-full min-h-0' : ''}`} onClick={onBackToMenu}>
                Back
              </button>
            </div>
          </div>
          )}

          {/* Dock bar right-click context menu (above bar when bar at bottom, below when bar at top) */}
          {dockContextMenuAt && (() => {
            const menuW = 180
            const submenuW = 200
            const pad = 8
            let left = Math.max(pad, Math.min(dockContextMenuAt.x, window.innerWidth - menuW - pad))
            const submenuOnRight = left + menuW + submenuW + pad <= window.innerWidth
            const showSubmenuLeft = dockContextMenuHover && !submenuOnRight
            if (showSubmenuLeft) left = Math.max(pad, left - submenuW)
            return (
              <div
                ref={dockContextMenuRef}
                className="fixed z-[9999] flex rounded-lg border border-base-300 bg-base-200 shadow-xl py-1 text-sm"
                style={{
                  left,
                  ...(dockAtTop
                    ? { top: dockContextMenuAt.y + 8 }
                    : { top: dockContextMenuAt.y - 4, transform: 'translateY(-100%)' }),
                  flexDirection: showSubmenuLeft ? 'row-reverse' : 'row',
                }}
                role="menu"
                onContextMenu={(e) => e.preventDefault()}
                onMouseLeave={() => setDockContextMenuHover(null)}
              >
                <div className="w-[180px] shrink-0 flex flex-col py-0.5">
                  <div
                    className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                    onMouseEnter={() => setDockContextMenuHover('preferred')}
                    role="menuitem"
                  >
                    <span>Preferred platforms</span>
                    <span aria-hidden className="text-base-content/50">▸</span>
                  </div>
                  <div
                    className="px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2 cursor-default"
                    onMouseEnter={() => setDockContextMenuHover('dockPosition')}
                    role="menuitem"
                  >
                    <span>Dock position</span>
                    <span aria-hidden className="text-base-content/50">▸</span>
                  </div>
                </div>
                {dockContextMenuHover === 'preferred' && (
                  <div
                    className={`w-[200px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                    onMouseEnter={() => setDockContextMenuHover('preferred')}
                  >
                    <div className="px-3 py-1 text-xs text-base-content/50 border-b border-base-300 mb-1">Click to bring to top</div>
                    {preferredPlatformOrder.map((platform, index) => (
                      <button
                        key={platform}
                        type="button"
                        role="menuitem"
                        className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2"
                        onClick={() => bringPreferredPlatformToTop(platform)}
                      >
                        <span className="capitalize">{platform === 'youtube' ? 'YouTube' : platform}</span>
                        <span className="text-base-content/50">{index + 1}.</span>
                      </button>
                    ))}
                  </div>
                )}
                {dockContextMenuHover === 'dockPosition' && (
                  <div
                    className={`w-[200px] shrink-0 bg-base-200 py-1 ${showSubmenuLeft ? 'border-r border-base-300 rounded-l-lg' : 'border-l border-base-300 rounded-r-lg'}`}
                    onMouseEnter={() => setDockContextMenuHover('dockPosition')}
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={dockAtTop}
                      className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2"
                      onClick={() => setDockPositionFromMenu(true)}
                    >
                      <span>Top</span>
                      {dockAtTop && <span aria-hidden>✓</span>}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={!dockAtTop}
                      className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center justify-between gap-2"
                      onClick={() => setDockPositionFromMenu(false)}
                    >
                      <span>Bottom</span>
                      {!dockAtTop && <span aria-hidden>✓</span>}
                    </button>
                  </div>
                )}
              </div>
            )
          })()}
          {/* Dock item right-click context menu (per-embed: watching, copy link, pin, add to bookmarks) */}
          {dockItemContextMenu && (() => {
            const { item } = dockItemContextMenu
            const keys = item.type === 'group' ? item.keys : [item.key]
            const firstKey = keys[0]
            const firstEmbed = combinedAvailableEmbeds.get(firstKey)
            const parsed = parseEmbedKey(firstKey)
            const platform = parsed?.platform ?? firstEmbed?.platform ?? ''
            const id = parsed?.id ?? firstEmbed?.id ?? ''
            const isBookmarked = findStreamersForKey(firstKey, pinnedStreamers, youtubeVideoToStreamerId).length > 0
            const isPinned = isPinnedEmbedKey(firstKey)
            const isWatching = watchedEmbedKey != null && keys.includes(watchedEmbedKey)
            const menuW = 220
            const pad = 8
            const left = Math.max(pad, Math.min(dockItemContextMenu.x, window.innerWidth - menuW - pad))
            const top = dockAtTop
              ? dockItemContextMenu.y + 8
              : dockItemContextMenu.y - 4
            const transform = dockAtTop ? undefined : 'translateY(-100%)'
            return (
              <div
                ref={dockItemContextMenuRef}
                className="fixed z-[10000] rounded-lg border border-base-300 bg-base-200 shadow-xl py-1 text-sm min-w-[200px]"
                style={{ left, top: top as number, transform }}
                role="menu"
                onContextMenu={(e) => e.preventDefault()}
              >
                {firstEmbed && (
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center gap-2"
                    onClick={() => {
                      if (isWatching) {
                        window.ipcRenderer?.invoke('live-websocket-send', { type: 'watching', data: null }).catch(() => {})
                        setWatchedEmbedKey(null)
                      } else {
                        window.ipcRenderer?.invoke('live-websocket-send', { type: 'watching', data: { platform: firstEmbed.platform, id: firstEmbed.id } }).catch(() => {})
                        setWatchedEmbedKey(firstKey)
                      }
                      closeDockItemContextMenu()
                    }}
                  >
                    <span aria-hidden>👀</span>
                    <span>{isWatching ? 'Unmark watching' : 'Mark as watching'}</span>
                  </button>
                )}
                {platform && id && (
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center gap-2"
                    onClick={() => {
                      const link = `#${platform}/${id}`
                      dggChatActionsRef.current?.appendToInput(link)
                      dggInputRef.current?.focus()
                      closeDockItemContextMenu()
                    }}
                  >
                    <span>Copy #{platform}/{id} to chat input</span>
                  </button>
                )}
                {!isPinned && firstEmbed && (
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center gap-2"
                    onClick={() => {
                      setPinnedEmbeds((prev) => {
                        const next = new Map(prev)
                        if (Array.from(next.keys()).some((k) => canonicalEmbedKey(k) === canonicalEmbedKey(firstKey))) return prev
                        next.set(firstKey, { ...firstEmbed })
                        return next
                      })
                      closeDockItemContextMenu()
                    }}
                  >
                    <span>Pin (temporary)</span>
                  </button>
                )}
                {!isBookmarked && firstEmbed && (
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full px-3 py-1.5 text-left hover:bg-base-300 flex items-center gap-2"
                    onClick={() => {
                      const displayName = firstEmbed?.mediaItem?.metadata?.displayName ?? firstEmbed?.id ?? id
                      const p = (firstEmbed?.platform ?? platform ?? '').toLowerCase()
                      const newStreamer: PinnedStreamer = {
                        id: `streamer-${Date.now()}`,
                        nickname: displayName || id || firstKey,
                        ...(p === 'kick' && { kickSlug: id }),
                        ...(p === 'twitch' && { twitchLogin: id }),
                        ...(p === 'youtube' && { youtubeChannelId: buildEmbedUrl('youtube', id) }),
                      }
                      setPinnedStreamers((prev) => [...prev, newStreamer])
                      setPinnedPollRefreshTrigger((t) => t + 1)
                      closeDockItemContextMenu()
                    }}
                  >
                    <span>Add to bookmarks</span>
                  </button>
                )}
              </div>
            )
          })()}

          {/* Dock hover popup (rendered outside scroll container so it won't be clipped) */}
          {dockHoverItemId && hoveredDockItem && dockHoverRect ? (() => {
            const popupW = 260
            const preferredLeft = dockHoverRect.left + dockHoverRect.width / 2 - popupW / 2
            // Keep popup in embed area so it doesn't render under the Destiny chat (BrowserView layer).
            const margin = 8
            let minLeft = margin
            let maxLeft = window.innerWidth - popupW - margin
            if (chatPaneOpen && chatPaneWidth > 0) {
              if (chatPaneSide === 'left') {
                minLeft = chatPaneWidth + margin
              } else {
                maxLeft = window.innerWidth - chatPaneWidth - popupW - margin
              }
            }
            const left = Math.max(minLeft, Math.min(maxLeft, preferredLeft))
            const aboveBar = !dockAtTop
            const top = aboveBar
              ? Math.max(8, dockHoverRect.top - 8)
              : (() => {
                  const barRect = dockBarRef.current?.getBoundingClientRect()
                  const barBottom = barRect ? barRect.bottom : dockHoverRect.top + dockHoverRect.height
                  return barBottom + 12
                })()
            const isGroup = hoveredDockItem.type === 'group'
            const keys = isGroup ? hoveredDockItem.keys : [hoveredDockItem.key]
            const streamers = isGroup ? hoveredDockItem.streamers : []
            const firstKey = keys[0]
            const firstEmbed = combinedAvailableEmbeds.get(firstKey)
            const accent = omniColorForKey(firstKey, { displayName: firstEmbed?.mediaItem?.metadata?.displayName })
            return (
              <div
                className="fixed z-[9999] p-3 shadow bg-base-100 rounded-box border border-base-300"
                style={{ width: popupW, left, top, ...(aboveBar ? { transform: 'translateY(-100%)' } : {}) }}
                onMouseEnter={() => {
                  clearDockCloseTimer()
                  setDockHoverPinned(true)
                }}
                onMouseLeave={() => {
                  setDockHoverPinned(false)
                  setDockHoverItemId(null)
                }}
              >
                {isGroup && streamers.length > 0 ? (
                  <>
                    <div className="text-xs text-base-content/60 mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="font-semibold shrink-0" style={{ color: accent }}>
                          {streamers.map((s) => s.nickname || 'Unnamed').join(', ')}
                        </span>
                        <span className="text-base-content/50 shrink-0">{keys.length} platform{keys.length !== 1 ? 's' : ''}</span>
                      </div>
                      <span className="flex items-center gap-0.5 shrink-0" title={keys.map((k) => embedSourceIcons(embedSourcesByKey.get(k) ?? { pinned: false, dgg: false, pinnedToList: false }).map((x) => x.title).join(', ')).join('; ')}>
                        {(() => {
                          const src = keys.reduce<{ pinned: boolean; dgg: boolean; pinnedToList: boolean }>(
                            (acc, k) => {
                              const s = embedSourcesByKey.get(k)
                              if (s) {
                                acc.pinned = acc.pinned || s.pinned
                                acc.dgg = acc.dgg || s.dgg
                                acc.pinnedToList = acc.pinnedToList || s.pinnedToList
                              }
                              return acc
                            },
                            { pinned: false, dgg: false, pinnedToList: false },
                          )
                          return embedSourceIcons(src).map(({ icon, title }) => (
                            <span key={icon} title={title} aria-hidden>{icon}</span>
                          ))
                        })()}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {keys.map((key) => {
                        const embed = combinedAvailableEmbeds.get(key)
                        const banned = bannedEmbeds.get(key)
                        const videoOn = selectedEmbedKeys.has(key)
                        const chatOn = selectedEmbedChatKeys.has(key)
                        const platform = (embed?.platform || '').toLowerCase()
                        const title = embed?.mediaItem?.metadata?.title || embed?.mediaItem?.metadata?.displayName || key
                        return (
                          <div key={key} className="border border-base-300 rounded p-2 flex flex-col gap-1">
                            <div className="text-xs font-medium" style={{ color: omniColorForKey(key) }}>{platform}</div>
                            <div className="truncate text-xs text-base-content/60" title={title}>{title}</div>
                            <div className="text-xs text-base-content/50">
                              {typeof embed?.count === 'number' ? `${embed.count} embeds` : '—'}
                              {typeof embed?.mediaItem?.metadata?.viewers === 'number' ? ` • ${embed.mediaItem.metadata.viewers.toLocaleString()} viewers` : ' • — viewers'}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs">Video</span>
                              <input
                                type="checkbox"
                                className="toggle toggle-sm"
                                checked={videoOn}
                                disabled={Boolean(banned)}
                                onChange={() => toggleEmbed(key)}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs">Chat</span>
                              <input
                                type="checkbox"
                                className="toggle toggle-sm"
                                checked={chatOn}
                                disabled={Boolean(banned)}
                                onChange={() => toggleEmbedChat(key)}
                              />
                            </div>
                          </div>
                        )
                      })}
                      {keys.some((k) => isPinnedEmbedKey(k)) ? (
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost text-error"
                          onClick={() => {
                            keys.filter((k) => isPinnedEmbedKey(k)).forEach((k) => removePinnedEmbedsWithCanonicalKey(k))
                            setDockHoverItemId(null)
                          }}
                        >
                          Unpin
                        </button>
                      ) : null}
                      <div className="text-xs text-base-content/50">Click dock button to toggle all.</div>
                    </div>
                  </>
                ) : (
                  (() => {
                    const key = hoveredDockItem.type === 'single' ? hoveredDockItem.key : firstKey
                    const embed = combinedAvailableEmbeds.get(key)
                    if (!embed) return <div className="text-xs text-base-content/50">Embed no longer available.</div>
                    const banned = bannedEmbeds.get(key)
                    const videoOn = selectedEmbedKeys.has(key)
                    const chatOn = selectedEmbedChatKeys.has(key)
                    const platform = (embed.platform || '').toLowerCase()
                    const title =
                      embed.mediaItem?.metadata?.title ||
                      embed.mediaItem?.metadata?.displayName ||
                      `${embed.platform}/${embed.id}`
                    return (
                      <>
                        <div className="text-xs text-base-content/60 mb-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold" style={{ color: accent }}>{platform}</div>
                            <div className="truncate" title={title}>{title}</div>
                            <div>
                              {typeof embed?.count === 'number' ? `${embed.count} embeds` : null}
                              {typeof embed?.mediaItem?.metadata?.viewers === 'number' ? ` • ${embed.mediaItem.metadata.viewers.toLocaleString()} viewers` : null}
                              {banned ? ` • banned` : null}
                            </div>
                          </div>
                          <span className="flex items-center gap-0.5 shrink-0" title={embedSourceIcons(embedSourcesByKey.get(key) ?? { pinned: false, dgg: false, pinnedToList: false }).map((x) => x.title).join(', ')}>
                            {embedSourceIcons(embedSourcesByKey.get(key) ?? { pinned: false, dgg: false, pinnedToList: false }).map(({ icon, title: t }) => (
                              <span key={icon} title={t} aria-hidden>{icon}</span>
                            ))}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center justify-between gap-2 text-sm">
                            <span>Video</span>
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={videoOn}
                              disabled={Boolean(banned)}
                              onChange={() => toggleEmbed(key)}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-2 text-sm">
                            <span>Chat</span>
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={chatOn}
                              disabled={Boolean(banned)}
                              onChange={() => toggleEmbedChat(key)}
                            />
                          </label>
                          {isPinnedEmbedKey(key) ? (
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost text-error"
                              onClick={() => {
                                removePinnedEmbedsWithCanonicalKey(key)
                                setDockHoverItemId(null)
                              }}
                            >
                              Unpin
                            </button>
                          ) : null}
                          <div className="text-xs text-base-content/60">Click name to toggle (master).</div>
                        </div>
                      </>
                    )
                  })()
                )}
              </div>
            )
          })() : null}
        </div>

        {/* Lite link scroller on right when chat is on the left (opposite side of chat) */}
        {liteLinkScrollerOpen && chatPaneSide === 'left' && (
          <div className="flex-shrink-0 min-h-0 flex flex-col overflow-hidden border-l border-base-300" style={{ width: 380 }}>
            <LiteLinkScroller
              open={true}
              onClose={() => setLiteLinkScrollerOpen(false)}
              cards={liteLinkScrollerCards}
              settings={liteLinkScrollerSettings}
              onSettingsChange={(partial) => setLiteLinkScrollerSettings((prev) => ({ ...prev, ...partial }))}
              onOpenLink={(url) => {
                window.ipcRenderer.invoke('link-scroller-handle-link', { url, action: chatLinkOpenAction }).catch(() => {})
              }}
              getEmbedTheme={() => (document.documentElement?.getAttribute('data-theme') === 'light' ? 'light' : 'dark')}
              onOpenSettings={() => {
                setSettingsModalOpen(true)
                setSettingsTab('liteLinkScroller')
              }}
            />
          </div>
        )}

        {/* Pie chart popup (what's being watched by platform) */}
        {showPiePopup && pieChartRect && (() => {
          const popupW = 380
          const preferredLeft = pieChartRect.left + pieChartRect.width / 2 - popupW / 2
          const margin = 8
          let minLeft = margin
          let maxLeft = window.innerWidth - popupW - margin
          if (chatPaneOpen && chatPaneWidth > 0) {
            if (chatPaneSide === 'left') minLeft = chatPaneWidth + margin
            else maxLeft = window.innerWidth - chatPaneWidth - popupW - margin
          }
          const left = Math.max(minLeft, Math.min(maxLeft, preferredLeft))
          const pieAboveBar = !dockAtTop
          const top = pieAboveBar ? Math.max(8, pieChartRect.top - 8) : pieChartRect.top + pieChartRect.height + 8
          return (
          <div
            className="fixed z-[9999] p-3 shadow bg-base-100 rounded-box border border-base-300"
            style={{
              width: popupW,
              left,
              top,
              ...(pieAboveBar ? { transform: 'translateY(-100%)' } : {}),
            }}
            onMouseEnter={() => {
              if (pieChartCloseTimerRef.current) {
                window.clearTimeout(pieChartCloseTimerRef.current)
                pieChartCloseTimerRef.current = null
              }
              setPieChartHover(true)
            }}
            onMouseLeave={() => {
              setPieChartHover(false)
              if (!pieChartPinned) setPieChartRect(null)
            }}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="font-semibold text-sm">What&apos;s being watched</span>
              {pieChartPinned ? (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => setPieChartPinned(false)}
                  title="Unpin"
                >
                  Unpin
                </button>
              ) : null}
            </div>
            {pieChartData.length === 0 ? (
              <div className="text-xs text-base-content/50 py-4 text-center">No embed data yet.</div>
            ) : (
              <div className="flex flex-col items-center w-full">
                <PieChartSvg data={pieChartData} fallbackColor="#888" size={200} outerRadius={70} />
                <div className="text-xs text-base-content/60 text-center mt-1">
                  Total: {pieChartData.reduce((s, d) => s + d.value, 0).toLocaleString()} watching
                </div>
              </div>
            )}
          </div>
          )
        })()}

        {/* Right pane */}
{chatPaneOpen && chatPaneSide === 'right' && !combinedChatOverlayMode && (
          <div
            className="w-1 cursor-col-resize bg-transparent hover:bg-base-content/20 transition-colors"
            onPointerDown={startResize}
            title="Drag to resize"
          />
        )}
        {chatPaneOpen && (
          <div
            className="bg-base-200 border-l border-base-300 min-h-0 flex flex-col overflow-hidden"
            style={{
              width: chatPaneWidth,
              display: combinedChatOverlayMode || chatPaneSide !== 'right' ? 'none' : undefined,
            }}
          >
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              <div
                className="p-2 border-b border-base-300"
                onContextMenu={(e) => {
                  if (combinedChatContextMenuConfig) {
                    e.preventDefault()
                    combinedChatContextMenuRef.current?.openContextMenu(e)
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="text-xs text-base-content/70 truncate flex-1 min-w-0">
                    {combinedHeaderText}
                  </div>
                  <div className="text-xs text-base-content/60 whitespace-nowrap flex items-center gap-1">
                    {combinedMsgCount} msgs · {combinedDggUserCount} users
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      title="Overlay on embeds"
                      onClick={() => setCombinedChatOverlayMode(true)}
                      aria-label="Overlay chat on embeds"
                    >
                      ⊞
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost btn-circle"
                      title="Close chat"
                      onClick={() => setChatPaneOpen(false)}
                      aria-label="Close chat"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
              <div ref={setRightChatContainerRef} className="flex-1 min-h-0 overflow-hidden" />
            </div>
          </div>
        )}
      </div>

      {/* Unified Settings modal (portal so embed/live updates don't cause flicker) */}
      {settingsModalOpen && createPortal(
        <div className="modal modal-open z-[100]" role="dialog" aria-modal="true">
          <div className="modal-box max-w-4xl h-[90vh] max-h-[90vh] overflow-hidden flex flex-col w-11/12">
            <h3 className="font-bold text-lg mb-2">Settings</h3>
            <div className="tabs tabs-bordered mb-3 flex-shrink-0">
              <button
                type="button"
                className={`tab ${settingsTab === 'pinned' ? 'tab-active' : ''}`}
                onClick={() => setSettingsTab('pinned')}
              >
                Bookmarked streamers
              </button>
              <button
                type="button"
                className={`tab ${settingsTab === 'chat' ? 'tab-active' : ''}`}
                onClick={() => setSettingsTab('chat')}
              >
                Chat
              </button>
              <button
                type="button"
                className={`tab ${settingsTab === 'liteLinkScroller' ? 'tab-active' : ''}`}
                onClick={() => setSettingsTab('liteLinkScroller')}
              >
                📜 Lite link scroller
              </button>
              <button
                type="button"
                className={`tab ${settingsTab === 'keybinds' ? 'tab-active' : ''}`}
                onClick={() => setSettingsTab('keybinds')}
              >
                Keybinds
              </button>
            </div>
            <div
              ref={settingsTabContentRef}
              className="flex-1 min-h-0 overflow-y-auto"
            >
              {settingsTab === 'pinned' && (
                <div className="space-y-4">
                  <div className="border-b border-base-300 pb-4">
                    <div className="text-sm font-semibold text-base-content/70 mb-2">Dock bar position</div>
                    <p className="text-xs text-base-content/60 mb-2">Place the embed dock at the top or bottom of the embed area. Hover menus open in the correct direction.</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`btn btn-sm ${dockAtTop ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setDockAtTop(true)}
                      >
                        Top
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${!dockAtTop ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setDockAtTop(false)}
                      >
                        Bottom
                      </button>
                    </div>
                  </div>
                  <div className="border-b border-base-300 pb-4">
                    <div className="text-sm font-semibold text-base-content/70 mb-2">Preferred platforms</div>
                    <p className="text-xs text-base-content/60 mb-3">
                      When an embed is off, clicking its dock button turns on the video for your preferred platform first. Drag to reorder; you can also right‑click the dock bar for a quick menu.
                    </p>
                    <div className="flex flex-col gap-1">
                      {preferredPlatformOrder.map((platform, index) => (
                        <div
                          key={platform}
                          draggable
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            const from = Number(e.dataTransfer.getData('text/plain'))
                            if (!Number.isFinite(from) || from === index) return
                            setPreferredPlatformOrder((prev) => {
                              const next = [...prev]
                              const [removed] = next.splice(from, 1)
                              next.splice(index, 0, removed)
                              return next
                            })
                          }}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', String(index))
                            e.dataTransfer.effectAllowed = 'move'
                          }}
                          className="flex items-center gap-2 border border-base-300 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing touch-none"
                        >
                          <span className="text-base-content/50 select-none" title="Drag to reorder">⋮⋮</span>
                          <span className="font-medium capitalize">{platform === 'youtube' ? 'YouTube' : platform}</span>
                          <span className="text-xs text-base-content/50 ml-auto">{index + 1}.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-base-content/70 mb-2">Bookmarked streamers</div>
                    <p className="text-sm text-base-content/60 mb-2">
                      Drag to reorder (order on the bar). Color sets the dock button. Each can link YouTube, Kick, and Twitch.
                    </p>
                  <div className="flex flex-col gap-2">
                    {pinnedStreamers.map((s, index) => (
                      <div
                        key={s.id}
                        onDragOver={(e) => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          const from = Number(e.dataTransfer.getData('text/plain'))
                          if (!Number.isFinite(from) || from === index) return
                          setPinnedStreamers((prev) => {
                            const next = [...prev]
                            const [removed] = next.splice(from, 1)
                            next.splice(index, 0, removed)
                            return next
                          })
                        }}
                        className="border border-base-300 rounded-lg p-3 flex flex-col gap-2"
                      >
                        <div className="flex flex-row items-center gap-2 flex-wrap min-w-0">
                          <span
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', String(index))
                              e.dataTransfer.effectAllowed = 'move'
                            }}
                            className="text-base-content/50 select-none cursor-grab active:cursor-grabbing touch-none shrink-0"
                            title="Drag to reorder"
                          >
                            ⋮⋮
                          </span>
                          <label className="flex items-center gap-1.5 shrink-0" title="Dock button color (empty = auto)">
                            <input
                              type="color"
                              className="w-7 h-7 rounded border border-base-300 cursor-pointer"
                              value={s.color && /^#[0-9A-Fa-f]{6}$/.test(s.color) ? s.color : '#888888'}
                              onChange={(e) => {
                                const hex = e.target.value
                                setPinnedStreamers((prev) => prev.map((x) => (x.id === s.id ? { ...x, color: hex } : x)))
                              }}
                            />
                          </label>
                          <span className="font-medium truncate min-w-0 flex-1" title={s.nickname || 'Unnamed'}>
                            {s.nickname || 'Unnamed'}
                          </span>
                          <label className="flex items-center gap-1.5 shrink-0 cursor-pointer" title="Auto-open preferred video when this streamer comes live">
                            <input
                              type="checkbox"
                              className="toggle toggle-xs"
                              checked={s.openWhenLive === true}
                              onChange={(e) => setPinnedStreamers((prev) => prev.map((x) => (x.id === s.id ? { ...x, openWhenLive: e.target.checked } : x)))}
                            />
                            <span className="text-xs text-base-content/60">Auto-open</span>
                          </label>
                          <div className="text-xs text-base-content/60 flex items-center gap-x-1.5 shrink-0 flex-wrap">
                            {[
                              s.youtubeChannelId && {
                                platform: 'YT',
                                label: shortChannelLabel(s.youtubeChannelId, 'yt'),
                                url: platformChannelUrl(s.youtubeChannelId, 'yt'),
                                title: s.youtubeChannelId,
                              },
                              s.kickSlug && {
                                platform: 'Kick',
                                label: shortChannelLabel(s.kickSlug, 'kick'),
                                url: platformChannelUrl(s.kickSlug, 'kick'),
                                title: s.kickSlug,
                              },
                              s.twitchLogin && {
                                platform: 'Twitch',
                                label: shortChannelLabel(s.twitchLogin, 'twitch'),
                                url: platformChannelUrl(s.twitchLogin, 'twitch'),
                                title: s.twitchLogin,
                              },
                            ]
                              .filter(Boolean)
                              .map((item, i) => (
                                <span key={i} className="inline-flex items-center">
                                  {i > 0 && <span className="text-base-content/40 mx-0.5">·</span>}
                                  <a
                                    href={(item as { url: string }).url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="link link-hover text-inherit"
                                    title={(item as { title: string }).title}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      const url = (item as { url: string }).url
                                      if (window.ipcRenderer) {
                                        window.ipcRenderer.invoke('open-external-url', url).catch(() => {
                                          window.open(url, '_blank', 'noopener,noreferrer')
                                        })
                                      } else {
                                        window.open(url, '_blank', 'noopener,noreferrer')
                                      }
                                    }}
                                  >
                                    <span className="font-medium text-base-content/70">{(item as { platform: string }).platform}:</span>{' '}
                                    {(item as { label: string }).label}
                                  </a>
                                </span>
                              ))}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost"
                              onClick={() => setEditingStreamerId(editingStreamerId === s.id ? null : s.id)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost text-error"
                              onClick={() => {
                                setPinnedStreamers((prev) => prev.filter((x) => x.id !== s.id))
                                if (editingStreamerId === s.id) setEditingStreamerId(null)
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        {editingStreamerId === s.id && (
                          <PinnedStreamerForm
                            streamer={s}
                            onSave={(next) => {
                              setPinnedStreamers((prev) => prev.map((x) => (x.id === s.id ? next : x)))
                              setEditingStreamerId(null)
                            }}
                            onCancel={() => setEditingStreamerId(null)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {editingStreamerId === '__new__' ? (
                    <div className="border border-base-300 rounded-lg p-3">
                      <div className="text-sm font-medium mb-2">New streamer</div>
                      <PinnedStreamerForm
                        streamer={{
                          id: '__new__',
                          nickname: '',
                          youtubeChannelId: undefined,
                          kickSlug: undefined,
                          twitchLogin: undefined,
                          color: undefined,
                          openWhenLive: false,
                        }}
                        onSave={(next) => {
                          setPinnedStreamers((prev) => [...prev, { ...next, id: `streamer-${Date.now()}` }])
                          setEditingStreamerId(null)
                        }}
                        onCancel={() => setEditingStreamerId(null)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost btn-outline"
                      onClick={() => setEditingStreamerId('__new__')}
                    >
                      + Add streamer
                    </button>
                  )}
                  </div>
                  <div className="border-t border-base-300 pt-4">
                    <div className="text-sm font-semibold text-base-content/70 mb-2">Bookmarked streamers: live check</div>
                    <p className="text-xs text-base-content/60 mb-2">
                      When live, bookmarked streamers appear in the dock. YouTube poll and chat delay are in the Chat tab.
                    </p>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>YouTube live check ×</span>
                      <input
                        type="number"
                        step={0.25}
                        className="input input-sm w-20"
                        value={pinnedYoutubeCheckMultiplier}
                        min={0.25}
                        max={5}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (Number.isFinite(v)) setPinnedYoutubeCheckMultiplier(Math.max(0.25, Math.min(5, v)))
                        }}
                      />
                    </label>
                    <div className="text-xs text-base-content/50 mt-1">Interval = 60s × this (min 15s). Kick/Twitch: 60s.</div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost btn-outline mt-2"
                      title="Check bookmarked streamers for live now"
                      onClick={() => setPinnedPollRefreshTrigger((n) => n + 1)}
                    >
                      Check now
                    </button>
                  </div>
                </div>
              )}
              {settingsTab === 'chat' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">Chat pane side</span>
                    <button
                      type="button"
                      className={`btn btn-xs ${chatPaneSide === 'left' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setChatPaneSide('left')}
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      className={`btn btn-xs ${chatPaneSide === 'right' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setChatPaneSide('right')}
                    >
                      Right
                    </button>
                  </div>
                  <div className="border-t border-base-300 pt-4">
                    <div className="text-sm font-semibold text-base-content/80 mb-2">Combined chat</div>

                    {/* General */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">General</div>
                      <div className="space-y-2 pl-0">
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Max messages</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="input input-sm w-24"
                            value={combinedMaxMessagesDraft}
                            onChange={(e) => {
                              const next = e.target.value
                              if (!/^\d*$/.test(next)) return
                              setCombinedMaxMessagesDraft(next)
                            }}
                            onBlur={(e) => commitCombinedMaxMessages(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                            }}
                          />
                        </label>
                        <span className="label-text-alt text-base-content/60 block">When at bottom, keep at most this many messages. Must be ≤ scroll limit.</span>
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Max messages (when scrolled)</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="input input-sm w-24"
                            value={combinedMaxMessagesScrollDraft}
                            onChange={(e) => {
                              const next = e.target.value
                              if (!/^\d*$/.test(next)) return
                              setCombinedMaxMessagesScrollDraft(next)
                            }}
                            onBlur={(e) => commitCombinedMaxMessagesScroll(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                            }}
                          />
                        </label>
                        <span className="label-text-alt text-base-content/60 block">When scrolled up, keep at most this many. Reduces memory use.</span>
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span>Order</span>
                          <div className="join">
                            <button
                              type="button"
                              className={`btn btn-xs join-item ${combinedSortMode === 'timestamp' ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={() => setCombinedSortMode('timestamp')}
                            >
                              Timestamp
                            </button>
                            <button
                              type="button"
                              className={`btn btn-xs join-item ${combinedSortMode === 'arrival' ? 'btn-primary' : 'btn-ghost'}`}
                              onClick={() => setCombinedSortMode('arrival')}
                            >
                              Arrival
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Display */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">Display</div>
                      <div className="space-y-2 pl-0">
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Show timestamps</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={combinedShowTimestamps}
                            onChange={(e) => setCombinedShowTimestamps(e.target.checked)}
                          />
                        </label>
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Source labels</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={combinedShowLabels}
                            onChange={(e) => setCombinedShowLabels(e.target.checked)}
                          />
                        </label>
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Platform icons</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={combinedShowPlatformIcons}
                            onChange={(e) => setCombinedShowPlatformIcons(e.target.checked)}
                          />
                        </label>
                      </div>
                    </div>

                    {/* DGG */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">DGG</div>
                      <div className="space-y-2 pl-0">
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Include DGG</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={combinedIncludeDgg}
                            onChange={(e) => setCombinedIncludeDgg(e.target.checked)}
                          />
                        </label>
                        {combinedIncludeDgg && (
                          <label className="flex items-center justify-between gap-2 text-sm">
                            <span>Show DGG chat input</span>
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={showDggInput}
                              onChange={(e) => setShowDggInput(e.target.checked)}
                            />
                          </label>
                        )}
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>DGG flairs and colors</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={!combinedDisableDggFlairsAndColors}
                            onChange={(e) => setCombinedDisableDggFlairsAndColors(!e.target.checked)}
                          />
                        </label>
                        <span className="label-text-alt text-base-content/60 block">When off, DGG nicks use a single color and no flair icons.</span>
                        <label className="flex flex-col gap-0.5 text-sm" title="Badge/label color in combined chat. Clear = theme default.">
                          <span>DGG label color</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="color"
                              className="w-7 h-7 rounded border border-base-300 cursor-pointer"
                              value={dggLabelColorOverride && /^#[0-9A-Fa-f]{6}$/.test(dggLabelColorOverride) ? dggLabelColorOverride : '#ffffff'}
                              onChange={(e) => setDggLabelColorOverride(e.target.value)}
                            />
                            <input
                              type="text"
                              className="input input-sm input-bordered w-20 font-mono"
                              placeholder="#ffffff"
                              value={dggLabelColorOverride}
                              onChange={(e) => setDggLabelColorOverride(e.target.value)}
                            />
                            <button type="button" className="btn btn-ghost btn-xs" title="Clear (theme default)" onClick={() => setDggLabelColorOverride('')}>✕</button>
                          </div>
                        </label>
                        <label className="flex flex-col gap-0.5 text-sm">
                          <span>DGG label text</span>
                          <input
                            type="text"
                            className="input input-sm input-bordered w-32"
                            placeholder="dgg"
                            value={dggLabelText}
                            onChange={(e) => setDggLabelText(e.target.value)}
                          />
                          <span className="label-text-alt text-base-content/60">Text shown in the source badge for DGG messages.</span>
                        </label>
                      </div>
                    </div>

                    {/* Filter */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">Highlight terms</div>
                      <p className="text-xs text-base-content/60 mb-1">Right-click selected text in chat to add; right-click a highlighted message to remove a term.</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {combinedHighlightTerms.map((t) => (
                          <span
                            key={t}
                            className="badge badge-sm badge-ghost gap-1 pr-1"
                          >
                            {t}
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs p-0 min-h-0 h-4 w-4 rounded-full"
                              onClick={() => setCombinedHighlightTerms((prev) => prev.filter((x) => x !== t))}
                              aria-label={`Remove ${t}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          className="input input-sm flex-1"
                          placeholder="Add term..."
                          value={combinedHighlightTermDraft}
                          onChange={(e) => setCombinedHighlightTermDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              const v = combinedHighlightTermDraft.trim()
                              if (v && !combinedHighlightTerms.includes(v)) {
                                setCombinedHighlightTerms((prev) => [...prev, v])
                                setCombinedHighlightTermDraft('')
                              }
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            const v = combinedHighlightTermDraft.trim()
                            if (v && !combinedHighlightTerms.includes(v)) {
                              setCombinedHighlightTerms((prev) => [...prev, v])
                              setCombinedHighlightTermDraft('')
                            }
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Emotes */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">Emotes</div>
                      <label className="flex items-center justify-between gap-2 text-sm">
                        <span>Pause animations when off-screen</span>
                        <input
                          type="checkbox"
                          className="toggle toggle-sm"
                          checked={combinedPauseEmoteAnimationsOffScreen}
                          onChange={(e) => setCombinedPauseEmoteAnimationsOffScreen(e.target.checked)}
                        />
                      </label>
                      <span className="label-text-alt text-base-content/60 block">Reduces DGG emote animation restarts when scrolling.</span>
                    </div>

                    {/* Links */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">Links</div>
                      <label className="flex flex-col gap-1 text-sm">
                        <span>Link click behavior</span>
                        <select
                          className="select select-bordered select-sm w-full"
                          value={chatLinkOpenAction}
                          onChange={(e) => setChatLinkOpenAction(e.target.value as typeof chatLinkOpenAction)}
                        >
                          <option value="none">Don&apos;t open the link</option>
                          <option value="clipboard">Copy link to clipboard</option>
                          <option value="browser">Open in default browser</option>
                          <option value="viewer">Open in Viewer window</option>
                        </select>
                        <span className="label-text-alt text-base-content/60">Applies to links in Destiny embed chat and combined chat.</span>
                      </label>
                    </div>

                    {/* YouTube / Kick */}
                    <div className="mb-4">
                      <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">YouTube / Kick</div>
                      <label className="flex items-center justify-between gap-2 text-sm" title="Unitless multiplier. Effective delay ≈ YouTube-provided timeout × multiplier.">
                        <span>YT chat poll ×</span>
                        <input
                          type="number"
                          step={0.25}
                          className="input input-sm w-24"
                          value={youTubePollMultiplier}
                          min={0.25}
                          max={5}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            if (!Number.isFinite(v)) return
                            setYouTubePollMultiplier(Math.max(0.25, Math.min(5, v)))
                          }}
                        />
                      </label>
                      <div className="text-xs text-base-content/60 mt-1 mb-2">Chat fetch delay multiplier. Bookmarked live check: Settings → Bookmarked streamers.</div>
                      <div className="flex flex-wrap gap-2 mb-2">
                        <button type="button" className="btn btn-xs btn-ghost" onClick={openKickHistorySetup} title="Open Kick in-app to establish Cloudflare/Kick cookies for history requests">
                          Kick history: open Kick
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost"
                          onClick={retryKickHistory}
                          disabled={enabledKickSlugs.length === 0}
                          title={enabledKickSlugs.length === 0 ? 'Enable at least one Kick chat toggle first' : 'Retry history fetch for enabled Kick chats'}
                        >
                          Retry history
                        </button>
                      </div>
                      <div className="text-xs text-base-content/60">If Kick history fails, open Kick once (Cloudflare may appear), then retry.</div>
                    </div>
                  </div>
                </div>
              )}
              {settingsTab === 'liteLinkScroller' && (
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-base-content/80 mb-2">Lite link scroller</div>
                  <p className="text-xs text-base-content/60 mb-3">
                    Saves messages that contain links from combined chat (DGG, YouTube, Kick, Twitch) and shows them in a scrollable panel. Open with the 📜 button in the embed dock. Autoplay and mute are toggled in the panel&apos;s top bar.
                  </p>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>Max messages to save</span>
                    <input
                      type="number"
                      min={10}
                      max={2000}
                      className="input input-sm w-24"
                      value={liteLinkScrollerSettings.maxMessages}
                      onChange={(e) => {
                        const n = Math.floor(Number(e.target.value))
                        if (Number.isFinite(n) && n >= 10) setLiteLinkScrollerSettings((prev) => ({ ...prev, maxMessages: Math.min(2000, n) }))
                      }}
                    />
                  </label>
                  <span className="label-text-alt text-base-content/60 block">Keep at most this many link messages (oldest dropped when over limit).</span>
                  <label className="flex items-center justify-between gap-2 text-sm">
                    <span>Auto-scroll</span>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm"
                      checked={liteLinkScrollerSettings.autoScroll}
                      onChange={(e) => setLiteLinkScrollerSettings((prev) => ({ ...prev, autoScroll: e.target.checked }))}
                    />
                  </label>
                  <span className="label-text-alt text-base-content/60 block">When on, with autoplay: play newest link first, then older as each finishes (one column, top = old, bottom = new).</span>
                  <label className="flex items-center justify-between gap-2 text-sm mt-3">
                    <span>Auto-advance timer (seconds)</span>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      className="input input-sm w-24"
                      value={liteLinkScrollerSettings.autoAdvanceSeconds}
                      onChange={(e) => {
                        const n = Math.floor(Number(e.target.value))
                        if (Number.isFinite(n) && n >= 1) setLiteLinkScrollerSettings((prev) => ({ ...prev, autoAdvanceSeconds: Math.min(120, n) }))
                      }}
                    />
                  </label>
                  <span className="label-text-alt text-base-content/60 block">For embeds that don&apos;t fire an end event (YouTube, TikTok, etc.), advance to the next card after this many seconds.</span>
                </div>
              )}
              {settingsTab === 'keybinds' && (
                <div className="space-y-4">
                  <p className="text-sm text-base-content/60 mb-4">
                    Focus DGG chat input when the chat pane is open.
                  </p>
                  <div className="flex items-center gap-4">
                    <label className="text-sm font-medium shrink-0">Focus DGG chat input</label>
                    <input
                      type="text"
                      readOnly
                      className="input input-bordered input-sm w-40 font-mono"
                      value={formatDggFocusKeybind(dggFocusKeybind)}
                      title="Click then press the keys you want"
                      onKeyDown={(e) => {
                        e.preventDefault()
                        const key = e.key === ' ' ? ' ' : e.key
                        setDggFocusKeybind({
                          key,
                          ctrl: e.ctrlKey,
                          shift: e.shiftKey,
                          alt: e.altKey,
                        })
                      }}
                      onClick={(e) => (e.currentTarget as HTMLInputElement).focus()}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-action mt-4 flex-shrink-0">
              <button className="btn btn-primary" onClick={() => setSettingsModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setSettingsModalOpen(false)} aria-hidden="true" />
        </div>,
        document.body
      )}

    </div>
  )
}

/** Inline form for add/edit pinned streamer (nickname + YT/Kick/Twitch + color). */
function PinnedStreamerForm({
  streamer,
  onSave,
  onCancel,
}: {
  streamer: PinnedStreamer
  onSave: (next: PinnedStreamer) => void
  onCancel: () => void
}) {
  const [nickname, setNickname] = useState(streamer.nickname)
  const [youtubeChannelId, setYoutubeChannelId] = useState(streamer.youtubeChannelId ?? '')
  const [kickSlug, setKickSlug] = useState(streamer.kickSlug ?? '')
  const [twitchLogin, setTwitchLogin] = useState(streamer.twitchLogin ?? '')
  const [color, setColor] = useState(streamer.color && /^#[0-9A-Fa-f]{6}$/.test(streamer.color) ? streamer.color : '')
  const [youtubeColor, setYoutubeColor] = useState(streamer.youtubeColor && /^#[0-9A-Fa-f]{6}$/.test(streamer.youtubeColor) ? streamer.youtubeColor : '')
  const [kickColor, setKickColor] = useState(streamer.kickColor && /^#[0-9A-Fa-f]{6}$/.test(streamer.kickColor) ? streamer.kickColor : '')
  const [twitchColor, setTwitchColor] = useState(streamer.twitchColor && /^#[0-9A-Fa-f]{6}$/.test(streamer.twitchColor) ? streamer.twitchColor : '')
  const [openWhenLive, setOpenWhenLive] = useState(streamer.openWhenLive === true)
  const [hideLabelInCombinedChat, setHideLabelInCombinedChat] = useState(streamer.hideLabelInCombinedChat === true)

  useEffect(() => {
    setNickname(streamer.nickname)
    setYoutubeChannelId(streamer.youtubeChannelId ?? '')
    setKickSlug(streamer.kickSlug ?? '')
    setTwitchLogin(streamer.twitchLogin ?? '')
    setColor(streamer.color && /^#[0-9A-Fa-f]{6}$/.test(streamer.color) ? streamer.color : '')
    setYoutubeColor(streamer.youtubeColor && /^#[0-9A-Fa-f]{6}$/.test(streamer.youtubeColor) ? streamer.youtubeColor : '')
    setKickColor(streamer.kickColor && /^#[0-9A-Fa-f]{6}$/.test(streamer.kickColor) ? streamer.kickColor : '')
    setTwitchColor(streamer.twitchColor && /^#[0-9A-Fa-f]{6}$/.test(streamer.twitchColor) ? streamer.twitchColor : '')
    setOpenWhenLive(streamer.openWhenLive === true)
    setHideLabelInCombinedChat(streamer.hideLabelInCombinedChat === true)
  }, [streamer.id, streamer.nickname, streamer.youtubeChannelId, streamer.kickSlug, streamer.twitchLogin, streamer.color, streamer.youtubeColor, streamer.kickColor, streamer.twitchColor, streamer.openWhenLive, streamer.hideLabelInCombinedChat])

  const handleSave = () => {
    const nick = nickname.trim() || 'Unnamed'
    const yt = youtubeChannelId.trim() || undefined
    const kick = kickSlug.trim().toLowerCase() || undefined
    const twitch = twitchLogin.trim().toLowerCase() || undefined
    const hex = color.trim()
    const ytHex = youtubeColor.trim()
    const kickHex = kickColor.trim()
    const twitchHex = twitchColor.trim()
    onSave({
      ...streamer,
      nickname: nick,
      youtubeChannelId: yt || undefined,
      kickSlug: kick,
      twitchLogin: twitch,
      color: /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : undefined,
      youtubeColor: /^#[0-9A-Fa-f]{6}$/.test(ytHex) ? ytHex : undefined,
      kickColor: /^#[0-9A-Fa-f]{6}$/.test(kickHex) ? kickHex : undefined,
      twitchColor: /^#[0-9A-Fa-f]{6}$/.test(twitchHex) ? twitchHex : undefined,
      openWhenLive: openWhenLive,
      hideLabelInCombinedChat: hideLabelInCombinedChat,
    })
  }

  return (
    <div className="flex flex-col gap-2 mt-2 p-2 bg-base-200 rounded">
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-0.5 text-xs flex-1 min-w-[120px]">
          <span>Nickname</span>
          <input
            type="text"
            className="input input-sm input-bordered"
            placeholder="e.g. Destiny"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs shrink-0" title="Dock button (empty = auto color)">
          <span>Dock color</span>
          <div className="flex items-center gap-1">
            <input
              type="color"
              className="w-7 h-7 rounded border border-base-300 cursor-pointer"
              value={color || '#888888'}
              onChange={(e) => setColor(e.target.value)}
            />
            <input
              type="text"
              className="input input-sm input-bordered w-20 font-mono"
              placeholder="No color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <button type="button" className="btn btn-ghost btn-xs" title="Clear (auto color)" onClick={() => setColor('')}>✕</button>
          </div>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" className="toggle toggle-sm" checked={openWhenLive} onChange={(e) => setOpenWhenLive(e.target.checked)} />
        <span>Auto-open preferred video when this streamer comes live</span>
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" className="toggle toggle-sm" checked={hideLabelInCombinedChat} onChange={(e) => setHideLabelInCombinedChat(e.target.checked)} />
        <span>Hide source label in combined chat</span>
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex flex-col gap-0.5 text-xs flex-1 min-w-[140px]">
          <span>YouTube channel</span>
          <input type="text" className="input input-sm input-bordered" placeholder="URL or @Handle" value={youtubeChannelId} onChange={(e) => setYoutubeChannelId(e.target.value)} />
        </label>
        <div className="flex items-center gap-1 shrink-0">
          <input type="color" className="w-6 h-6 rounded border border-base-300 cursor-pointer" value={youtubeColor || '#888888'} onChange={(e) => setYoutubeColor(e.target.value)} title="Chat color" />
          <button type="button" className="btn btn-ghost btn-xs" title="Clear" onClick={() => setYoutubeColor('')}>✕</button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex flex-col gap-0.5 text-xs flex-1 min-w-[140px]">
          <span>Kick slug</span>
          <input type="text" className="input input-sm input-bordered" placeholder="e.g. destiny" value={kickSlug} onChange={(e) => setKickSlug(e.target.value)} />
        </label>
        <div className="flex items-center gap-1 shrink-0">
          <input type="color" className="w-6 h-6 rounded border border-base-300 cursor-pointer" value={kickColor || '#888888'} onChange={(e) => setKickColor(e.target.value)} title="Chat color" />
          <button type="button" className="btn btn-ghost btn-xs" title="Clear" onClick={() => setKickColor('')}>✕</button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex flex-col gap-0.5 text-xs flex-1 min-w-[140px]">
          <span>Twitch handle</span>
          <input type="text" className="input input-sm input-bordered" placeholder="e.g. destiny" value={twitchLogin} onChange={(e) => setTwitchLogin(e.target.value)} />
        </label>
        <div className="flex items-center gap-1 shrink-0">
          <input type="color" className="w-6 h-6 rounded border border-base-300 cursor-pointer" value={twitchColor || '#888888'} onChange={(e) => setTwitchColor(e.target.value)} title="Chat color" />
          <button type="button" className="btn btn-ghost btn-xs" title="Clear" onClick={() => setTwitchColor('')}>✕</button>
        </div>
      </div>
      <div className="flex gap-2 mt-1">
        <button type="button" className="btn btn-sm btn-primary" onClick={handleSave}>
          Save
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

