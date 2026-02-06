import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import * as d3 from 'd3'
import KickEmbed from './embeds/KickEmbed'
import TwitchEmbed from './embeds/TwitchEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import CombinedChat, { type CombinedChatContextMenuConfig } from './CombinedChat'
import danTheBuilderBg from '../assets/media/DanTheBuilder.png'
import autoplayIcon from '../assets/icons/autoplay.png'
import autoplayPausedIcon from '../assets/icons/autoplay-paused.png'
import { omniColorForKey, textColorOn, withAlpha } from '../utils/omniColors'

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

  // ---- Manual embeds (from pasted links) ----
  const [manualEmbeds, setManualEmbeds] = useState<Map<string, LiveEmbed>>(() => {
    try {
      const raw = localStorage.getItem('omni-screen:manual-embeds')
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
  const handleDestinyLinkRef = useRef<(platform: string, id: string) => void>(() => {})
  useEffect(() => {
    selectedEmbedKeysRef.current = selectedEmbedKeys
  }, [selectedEmbedKeys])

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
    return Number.isFinite(saved) && saved >= 50 ? Math.floor(saved) : 600
  }, [])
  const [combinedMaxMessages, setCombinedMaxMessages] = useState<number>(initialCombinedMaxMessages)
  const [combinedMaxMessagesDraft, setCombinedMaxMessagesDraft] = useState<string>(() => String(initialCombinedMaxMessages))
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
    if (saved === '0' || saved === 'false') return false
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
  const dggInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [chatPaneSide, setChatPaneSide] = useState<ChatPaneSide>(() => {
    const saved = localStorage.getItem('omni-screen:chat-pane-side')
    return saved === 'right' ? 'right' : 'left'
  })
  const [chatPaneWidth, setChatPaneWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:chat-pane-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 420
  })
  const [combinedMsgCount, setCombinedMsgCount] = useState(0)
  const [combinedDggUserCount, setCombinedDggUserCount] = useState(0)
  const manualEmbedsRef = useRef<Map<string, LiveEmbed>>(manualEmbeds)
  manualEmbedsRef.current = manualEmbeds
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
      })) as PinnedStreamer[]
    } catch {
      return []
    }
  })
  type SettingsTab = 'pinned' | 'chat' | 'keybinds'
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('pinned')
  const settingsTabContentRef = useRef<HTMLDivElement>(null)
  const [editingStreamerId, setEditingStreamerId] = useState<string | null>(null)
  /** YouTube embed key -> pinned streamer ids that resolved to this video (multiple streamers can share same stream). */
  const [youtubeVideoToStreamerId, setYoutubeVideoToStreamerId] = useState<Map<string, string[]>>(() => new Map())
  /** Embeds from pinned streamer poll only (not manual, not persisted). So "Remove from list" does not apply to pinned-only. */
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
  /** Permanently remove embed(s) from manual list (and selection). Use for manual-added / pinned-added embeds you want gone. */
  const removeManualEmbed = useCallback((key: string) => {
    setManualEmbeds((prev) => {
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

  /** True if this canonical key has an entry in manualEmbeds (any manual key that canonicalizes to this). */
  const isManualEmbedKey = useCallback(
    (canonicalKey: string) => Array.from(manualEmbeds.keys()).some((k) => canonicalEmbedKey(k) === canonicalKey),
    [manualEmbeds],
  )
  /** Remove all manual embed entries that canonicalize to this key. */
  const removeManualEmbedsWithCanonicalKey = useCallback(
    (canonicalKey: string) => {
      Array.from(manualEmbeds.keys())
        .filter((k) => canonicalEmbedKey(k) === canonicalKey)
        .forEach((k) => removeManualEmbed(k))
    },
    [manualEmbeds, removeManualEmbed],
  )

  // Merge manual (pasted link), pinned-originated (poll only, not persisted), and DGG embeds. Pinned-originated are not "manual" so no "Remove from list".
  const combinedAvailableEmbeds = useMemo(() => {
    const m = new Map<string, LiveEmbed>()
    manualEmbeds.forEach((v, k) => {
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
    logPinned('combinedAvailableEmbeds', { manualCount: manualEmbeds.size, pinnedOriginatedCount: pinnedOriginatedEmbeds.size, dggCount: availableEmbeds.size, combinedCount: m.size })
    return m
  }, [availableEmbeds, manualEmbeds, pinnedOriginatedEmbeds])

  /** Why each embed is in the list: Bookmarked (bookmarked streamer), DGG (websocket), Manual (pasted/pinned poll). */
  const embedSourcesByKey = useMemo(() => {
    const out = new Map<string, { pinned: boolean; dgg: boolean; manual: boolean }>()
    for (const key of combinedAvailableEmbeds.keys()) {
      const pinned = findStreamersForKey(key, pinnedStreamers, youtubeVideoToStreamerId).length > 0
      const dgg = availableEmbeds.has(key)
      const manual = isManualEmbedKey(key)
      out.set(key, { pinned, dgg, manual })
    }
    return out
  }, [combinedAvailableEmbeds, pinnedStreamers, youtubeVideoToStreamerId, availableEmbeds, isManualEmbedKey])

  function formatEmbedSource(s: { pinned: boolean; dgg: boolean; manual: boolean }): string {
    const parts: string[] = []
    if (s.pinned) parts.push('Bookmarked')
    if (s.dgg) parts.push('DGG embed')
    if (s.manual) parts.push('Manually added')
    return parts.length ? parts.join(' • ') : 'Unknown'
  }

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:selected-embeds', JSON.stringify(Array.from(selectedEmbedKeys.values())))
    } catch {
      // ignore
    }
  }, [selectedEmbedKeys])

  useEffect(() => {
    try {
      const arr = Array.from(manualEmbeds.entries()).map(([key, e]) => ({
        key,
        platform: e.platform,
        id: e.id,
        title: e.mediaItem?.metadata?.displayName || e.mediaItem?.metadata?.title,
      }))
      localStorage.setItem('omni-screen:manual-embeds', JSON.stringify(arr))
    } catch {
      // ignore
    }
  }, [manualEmbeds])

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

  // Persist all combined chat and chat pane settings in one place so none are missed on restart.
  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:combined-include-dgg', combinedIncludeDgg ? '1' : '0')
      localStorage.setItem('omni-screen:combined-max-messages', String(combinedMaxMessages))
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
      localStorage.setItem('omni-screen:chat-pane-width', String(chatPaneWidth))
      localStorage.setItem('omni-screen:chat-pane-side', chatPaneSide)
    } catch {
      // ignore
    }
  }, [
    combinedIncludeDgg,
    combinedMaxMessages,
    combinedShowTimestamps,
    combinedShowLabels,
    combinedShowPlatformIcons,
    combinedSortMode,
    combinedHighlightTerms,
    combinedPauseEmoteAnimationsOffScreen,
    combinedDisableDggFlairsAndColors,
    chatLinkOpenAction,
    showDggInput,
    dggFocusKeybind,
    chatPaneWidth,
    chatPaneSide,
  ])

  useEffect(() => {
    window.ipcRenderer?.invoke('set-chat-link-open-action', chatLinkOpenAction).catch(() => {})
  }, [chatLinkOpenAction])

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
      const next = clamp(n, 50, 5000)
      setCombinedMaxMessages(next)
      setCombinedMaxMessagesDraft(String(next))
    },
    [combinedMaxMessages, combinedMaxMessagesDraft],
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

        startViewTransitionIfSupported(() => {
          setAvailableEmbeds(next)

          setSelectedEmbedKeys((prev) => {
            const manual = manualEmbedsRef.current
            const pinned = pinnedOriginatedEmbedsRef.current
            const pruned = new Set<string>()
            prev.forEach((k) => {
              if (next.has(k) || manual.has(k) || pinned.has(k)) {
                pruned.add(k)
                return
              }
              const migrated = legacyToCanonical.get(k)
              if (migrated && (next.has(migrated) || manual.has(migrated) || pinned.has(migrated))) pruned.add(migrated)
            })
            return pruned
          })

          setSelectedEmbedChatKeys((prev) => {
            const manual = manualEmbedsRef.current
            const pinned = pinnedOriginatedEmbedsRef.current
            const pruned = new Set<string>()
            prev.forEach((k) => {
              if (next.has(k) || manual.has(k) || pinned.has(k)) {
                pruned.add(k)
                return
              }
              const migrated = legacyToCanonical.get(k)
              if (migrated && (next.has(migrated) || manual.has(migrated) || pinned.has(migrated))) pruned.add(migrated)
            })
            return pruned
          })
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
    // Manual add is temporary; no live check — add any valid embed URL.
    setManualEmbeds((prev) => {
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
      const accent = omniColorForKey(item.key, { displayName: e.mediaItem?.metadata?.displayName })

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
    [autoplay, bannedEmbeds, cinemaMode, mute, shakeEmbedKey, toggleEmbed],
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
        {/* Left pane */}
        {chatPaneOpen && chatPaneSide === 'left' && (
          <>
            <div className="bg-base-200 border-r border-base-300 min-h-0 flex flex-col overflow-hidden" style={{ width: chatPaneWidth }}>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {/* Chat settings pane */}
                <div className="p-2 border-b border-base-300">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-base-content/70 truncate flex-1 min-w-0">
                      {combinedHeaderText}
                    </div>
                    <div className="text-xs text-base-content/60 whitespace-nowrap flex items-center gap-1">
                      {combinedMsgCount} msgs · {combinedDggUserCount} users
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

                <div className="flex-1 min-h-0 overflow-hidden">
                  <CombinedChat
                    enableDgg={combinedIncludeDgg}
                    showDggInput={showDggInput}
                    getEmbedDisplayName={getEmbedDisplayName}
                    onOpenLink={handleChatOpenLink}
                    maxMessages={combinedMaxMessages}
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
                    focusShortcutLabel={formatDggFocusKeybind(dggFocusKeybind)}
                  />
                </div>
              </div>
            </div>
            <div
              className="w-1 cursor-col-resize bg-base-300 hover:bg-base-content/20 transition-colors"
              onPointerDown={startResize}
              title="Drag to resize"
            />
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
          </div>

          {/* Embeds dock (inside center column; position by dockAtTop) */}
          <div
            ref={dockBarRef}
            className={[
              'relative z-20 flex items-center',
              dockAtTop ? 'order-0' : 'order-1',
              cinemaMode
                ? `mt-0 bg-base-200 rounded-none gap-0 p-0 ${dockAtTop ? 'border-b border-base-300 mb-0' : 'border-t border-base-300'}`
                : dockAtTop
                  ? 'mb-3 bg-base-200 border border-base-300 rounded-lg gap-2 px-2 py-2'
                  : 'mt-3 bg-base-200 border border-base-300 rounded-lg gap-2 px-2 py-2',
            ].join(' ')}
            onContextMenu={onDockBarContextMenu}
          >
            {/* Scrollable embeds list */}
            <div className="flex-1 min-w-0 min-h-0">
              <div
                ref={dockRef}
                className={`overflow-x-auto overflow-y-hidden whitespace-nowrap embed-dock-scroll ${cinemaMode ? 'py-0' : ''}`}
                onWheel={onDockWheel}
                style={{ overscrollBehaviorX: 'contain' as any }}
              >
                <div className={`flex items-center ${cinemaMode ? 'gap-0' : 'gap-1'}`}>
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
                      const groupColor = item.type === 'group' && item.streamers[0]?.color && /^#[0-9A-Fa-f]{6}$/.test(item.streamers[0].color)
                        ? item.streamers[0].color
                        : omniColorForKey(firstKey, { displayName: firstEmbed?.mediaItem?.metadata?.displayName })
                      const accent = item.type === 'group' ? groupColor : omniColorForKey(firstKey, { displayName: firstEmbed?.mediaItem?.metadata?.displayName })
                      const active = videoOn || chatOn
                      const activeText = textColorOn(accent)

                      return (
                        <div key={itemId} className="flex items-center">
                          <button
                            type="button"
                            ref={(el) => {
                              const map = dockButtonRefs.current
                              if (el) map.set(itemId, el)
                              else map.delete(itemId)
                            }}
                            className={`btn btn-sm ${active ? '' : 'btn-ghost'} ${anyBanned ? 'btn-disabled' : 'btn-outline'} ${cinemaMode ? 'rounded-none border-0 border-r border-base-300 first:border-l-0' : ''}`}
                            title={item.type === 'group' ? `${label} (${keys.length} embed${keys.length !== 1 ? 's' : ''})` : `${(firstEmbed?.platform || '').toLowerCase()}: ${firstEmbed?.mediaItem?.metadata?.title || firstKey}`}
                            onClick={() => toggleDockItemMaster(item)}
                            onMouseEnter={() => openDockHover(itemId)}
                            onMouseLeave={scheduleCloseDockHover}
                            style={
                              active
                                ? { backgroundColor: accent, borderColor: accent, color: activeText }
                                : { borderColor: accent, color: accent }
                            }
                          >
                            {label}
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Fixed controls (right side): Pie chart, +, Chat pane, Autoplay, Mute, Cinema, Settings, Back */}
            <div className={`flex-none flex items-center ${cinemaMode ? 'gap-0 border-l border-base-300 pl-1' : 'gap-2'}`}>
              <button
                type="button"
                ref={pieChartButtonRef}
                className={`btn btn-sm btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none' : ''}`}
                title="What's being watched (by platform)"
                aria-label="Show watch proportions"
                onMouseEnter={openPiePopup}
                onMouseLeave={scheduleClosePiePopup}
                onClick={() => setPieChartPinned((p) => !p)}
              >
                🥧
              </button>
              <div className="dropdown dropdown-top dropdown-end">
                <label tabIndex={0} className={`btn btn-sm btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none' : ''}`} title="Add embed from link (YouTube, Kick, Twitch)">
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
                  className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none' : ''}`}
                  title="Chat pane"
                  onClick={() => setChatPaneOpen(true)}
                  aria-label="Show chat pane"
                >
                  💬
                </button>
              )}
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 ${autoplay ? 'btn-primary' : ''} ${cinemaMode ? 'rounded-none' : ''}`}
                title="Autoplay"
                onClick={() => setAutoplay((v) => !v)}
                aria-label="Toggle autoplay"
              >
                <span
                  className="w-6 h-6 inline-block bg-base-content"
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
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${mute ? 'btn-primary' : ''} ${cinemaMode ? 'rounded-none' : ''}`}
                title="Mute"
                onClick={() => setMute((v) => !v)}
                aria-label="Toggle mute"
              >
                {mute ? '🔇' : '🔉'}
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'btn-primary rounded-none' : ''}`}
                title="Cinema mode"
                onClick={() => setCinemaMode((v) => !v)}
                aria-label="Toggle cinema mode"
              >
                📽️
              </button>
              <button
                type="button"
                className={`btn btn-sm btn-square btn-ghost min-h-0 p-0 text-xl ${cinemaMode ? 'rounded-none' : ''}`}
                title="Settings"
                onClick={() => setSettingsModalOpen(true)}
                aria-label="Open settings"
              >
                ⚙️
              </button>

              <button className={`btn btn-sm btn-primary ${cinemaMode ? 'rounded-none' : ''}`} onClick={onBackToMenu}>
                Back
              </button>
            </div>
          </div>

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
                    <div className="text-xs text-base-content/60 mb-2">
                      <div className="font-semibold" style={{ color: accent }}>
                        {streamers.map((s) => s.nickname || 'Unnamed').join(', ')}
                      </div>
                      <div className="text-base-content/50">{keys.length} platform{keys.length !== 1 ? 's' : ''}</div>
                      <div className="text-base-content/50 mt-1">
                        Why it&apos;s here: {formatEmbedSource(
                          keys.reduce<{ pinned: boolean; dgg: boolean; manual: boolean }>(
                            (acc, k) => {
                              const s = embedSourcesByKey.get(k)
                              if (s) {
                                acc.pinned = acc.pinned || s.pinned
                                acc.dgg = acc.dgg || s.dgg
                                acc.manual = acc.manual || s.manual
                              }
                              return acc
                            },
                            { pinned: false, dgg: false, manual: false },
                          ),
                        )}
                      </div>
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
                      {keys.some((k) => isManualEmbedKey(k)) ? (
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost text-error"
                          onClick={() => {
                            keys.filter((k) => isManualEmbedKey(k)).forEach((k) => removeManualEmbedsWithCanonicalKey(k))
                            setDockHoverItemId(null)
                          }}
                        >
                          Remove from list
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
                        <div className="text-xs text-base-content/60 mb-2">
                          <div className="font-semibold" style={{ color: accent }}>{platform}</div>
                          <div className="truncate" title={title}>{title}</div>
                          <div>
                            {typeof embed?.count === 'number' ? `${embed.count} embeds` : null}
                            {typeof embed?.mediaItem?.metadata?.viewers === 'number' ? ` • ${embed.mediaItem.metadata.viewers.toLocaleString()} viewers` : null}
                            {banned ? ` • banned` : null}
                          </div>
                          <div className="text-base-content/50 mt-1">
                            Why it&apos;s here: {formatEmbedSource(embedSourcesByKey.get(key) ?? { pinned: false, dgg: false, manual: false })}
                          </div>
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
                          {isManualEmbedKey(key) ? (
                            <button
                              type="button"
                              className="btn btn-xs btn-ghost text-error"
                              onClick={() => {
                                removeManualEmbedsWithCanonicalKey(key)
                                setDockHoverItemId(null)
                              }}
                            >
                              Remove from list
                            </button>
                          ) : null}
                          <div className="text-xs text-base-content/60">Hover to adjust. Click name to toggle (master).</div>
                        </div>
                      </>
                    )
                  })()
                )}
              </div>
            )
          })() : null}
        </div>

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
        {chatPaneOpen && chatPaneSide === 'right' && (
          <>
            <div
              className="w-1 cursor-col-resize bg-base-300 hover:bg-base-content/20 transition-colors"
              onPointerDown={startResize}
              title="Drag to resize"
            />
            <div className="bg-base-200 border-l border-base-300 min-h-0 flex flex-col overflow-hidden" style={{ width: chatPaneWidth }}>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {/* Chat settings pane */}
                <div className="p-2 border-b border-base-300">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-base-content/70 truncate flex-1 min-w-0">
                      {combinedHeaderText}
                    </div>
                    <div className="text-xs text-base-content/60 whitespace-nowrap flex items-center gap-1">
                      {combinedMsgCount} msgs · {combinedDggUserCount} users
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

                <div className="flex-1 min-h-0 overflow-hidden">
                  <CombinedChat
                    enableDgg={combinedIncludeDgg}
                    showDggInput={showDggInput}
                    getEmbedDisplayName={getEmbedDisplayName}
                    onOpenLink={handleChatOpenLink}
                    maxMessages={combinedMaxMessages}
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
                    focusShortcutLabel={formatDggFocusKeybind(dggFocusKeybind)}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Unified Settings modal */}
      {settingsModalOpen && (
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
                          <label className="flex items-center gap-1.5 shrink-0" title="Dock button color">
                            <input
                              type="color"
                              className="w-7 h-7 rounded border border-base-300 cursor-pointer"
                              value={s.color && /^#[0-9A-Fa-f]{6}$/.test(s.color) ? s.color : '#7dcf67'}
                              onChange={(e) => {
                                const hex = e.target.value
                                setPinnedStreamers((prev) => prev.map((x) => (x.id === s.id ? { ...x, color: hex } : x)))
                              }}
                            />
                          </label>
                          <span className="font-medium truncate min-w-0 flex-1" title={s.nickname || 'Unnamed'}>
                            {s.nickname || 'Unnamed'}
                          </span>
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
                          <span>Include DGG</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={combinedIncludeDgg}
                            onChange={(e) => setCombinedIncludeDgg(e.target.checked)}
                          />
                        </label>
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

                    {/* DGG (when included) */}
                    {combinedIncludeDgg && (
                      <div className="mb-4">
                        <div className="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2">DGG</div>
                        <label className="flex items-center justify-between gap-2 text-sm">
                          <span>Show DGG chat input</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm"
                            checked={showDggInput}
                            onChange={(e) => setShowDggInput(e.target.checked)}
                          />
                        </label>
                      </div>
                    )}

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
        </div>
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

  useEffect(() => {
    setNickname(streamer.nickname)
    setYoutubeChannelId(streamer.youtubeChannelId ?? '')
    setKickSlug(streamer.kickSlug ?? '')
    setTwitchLogin(streamer.twitchLogin ?? '')
    setColor(streamer.color && /^#[0-9A-Fa-f]{6}$/.test(streamer.color) ? streamer.color : '')
  }, [streamer.id, streamer.nickname, streamer.youtubeChannelId, streamer.kickSlug, streamer.twitchLogin, streamer.color])

  const handleSave = () => {
    const nick = nickname.trim() || 'Unnamed'
    const yt = youtubeChannelId.trim() || undefined
    const kick = kickSlug.trim().toLowerCase() || undefined
    const twitch = twitchLogin.trim().toLowerCase() || undefined
    const hex = color.trim()
    onSave({
      ...streamer,
      nickname: nick,
      youtubeChannelId: yt || undefined,
      kickSlug: kick,
      twitchLogin: twitch,
      color: /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : undefined,
    })
  }

  return (
    <div className="flex flex-col gap-2 mt-2 p-2 bg-base-200 rounded">
      <label className="flex flex-col gap-0.5 text-xs">
        <span>Nickname</span>
        <input
          type="text"
          className="input input-sm input-bordered"
          placeholder="e.g. Destiny"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs">
        <span>Dock color</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="w-8 h-8 rounded border border-base-300 cursor-pointer"
            value={color || '#7dcf67'}
            onChange={(e) => setColor(e.target.value)}
          />
          <input
            type="text"
            className="input input-sm input-bordered flex-1 font-mono"
            placeholder="#7dcf67"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
      </label>
      <label className="flex flex-col gap-0.5 text-xs">
        <span>YouTube channel (full URL e.g. youtube.com/destiny, or @Handle)</span>
        <input
          type="text"
          className="input input-sm input-bordered"
          placeholder="Optional"
          value={youtubeChannelId}
          onChange={(e) => setYoutubeChannelId(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs">
        <span>Kick slug</span>
        <input
          type="text"
          className="input input-sm input-bordered"
          placeholder="e.g. destiny (optional)"
          value={kickSlug}
          onChange={(e) => setKickSlug(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-xs">
        <span>Twitch login</span>
        <input
          type="text"
          className="input input-sm input-bordered"
          placeholder="e.g. destiny (optional)"
          value={twitchLogin}
          onChange={(e) => setTwitchLogin(e.target.value)}
        />
      </label>
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

