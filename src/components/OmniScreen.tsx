import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import KickEmbed from './embeds/KickEmbed'
import TwitchEmbed from './embeds/TwitchEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import CombinedChat from './CombinedChat'
import danTheBuilderBg from '../assets/media/DanTheBuilder.png'
import { omniColorForKey, textColorOn, withAlpha } from '../utils/omniColors'
import { getAppPreferences } from '../utils/appPreferences'

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
type ChatMode = 'embedded' | 'combined'
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

/** Pinned streamer: up to 3 platforms (YouTube channel, Kick, Twitch); optional nickname and accent color. */
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

/** Parse supported embed URLs into platform + id. Returns null if not supported. */
function parseEmbedUrl(url: string): { platform: string; id: string } | null {
  const s = String(url || '').trim()
  if (!s) return null
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

  const [autoplay, setAutoplay] = useState(true)
  const [mute, setMute] = useState(true)
  const [cinemaMode, setCinemaMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('omni-screen:cinema-mode')
    if (saved === '1' || saved === 'true') return true
    return false
  })

  // ---- Chat pane ----
  const [chatPaneOpen, setChatPaneOpen] = useState(true)
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    const saved = localStorage.getItem('omni-screen:chat-mode')
    return saved === 'combined' ? 'combined' : 'embedded'
  })
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
  const [combinedSortMode, setCombinedSortMode] = useState<CombinedSortMode>(() => {
    const saved = localStorage.getItem('omni-screen:combined-sort-mode')
    return saved === 'arrival' ? 'arrival' : 'timestamp'
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
  const [combinedHighlightTerm, setCombinedHighlightTerm] = useState<string>(() => {
    return localStorage.getItem('omni-screen:combined-highlight-term') ?? ''
  })
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false)
  const [chatPaneSide, setChatPaneSide] = useState<ChatPaneSide>(() => {
    const saved = localStorage.getItem('omni-screen:chat-pane-side')
    return saved === 'right' ? 'right' : 'left'
  })
  const [chatPaneWidth, setChatPaneWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:chat-pane-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 420
  })
  const [chatEmbedReload, setChatEmbedReload] = useState(0)
  const [combinedMsgCount, setCombinedMsgCount] = useState(0)
  const [destinyEmbedDetached, setDestinyEmbedDetached] = useState(false)
  const destinyEmbedSlotRef = useRef<HTMLDivElement | null>(null)
  const destinyEmbedResizeObserverRef = useRef<ResizeObserver | null>(null)
  const destinyEmbedResizeHandlerRef = useRef<(() => void) | null>(null)
  const destinyEmbedResizeTimeoutRef = useRef<number | null>(null)
  const destinyEmbedRafRef = useRef<number | null>(null)
  const destinyEmbedLayoutTimeoutsRef = useRef<number[]>([])
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
  const [pinnedStreamersModalOpen, setPinnedStreamersModalOpen] = useState(false)
  const [editingStreamerId, setEditingStreamerId] = useState<string | null>(null)
  /** YouTube embed key -> pinned streamer ids that resolved to this video (multiple streamers can share same stream). */
  const [youtubeVideoToStreamerId, setYoutubeVideoToStreamerId] = useState<Map<string, string[]>>(() => new Map())
  /** Embeds from pinned streamer poll only (not manual, not persisted). So "Remove from list" does not apply to pinned-only. */
  const [pinnedOriginatedEmbeds, setPinnedOriginatedEmbeds] = useState<Map<string, LiveEmbed>>(() => new Map())
  pinnedOriginatedEmbedsRef.current = pinnedOriginatedEmbeds
  /** Increment to trigger one immediate run of pinned streamer polls (e.g. Refresh button). */
  const [pinnedPollRefreshTrigger, setPinnedPollRefreshTrigger] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:pinned-streamers', JSON.stringify(pinnedStreamers))
    } catch {
      // ignore
    }
  }, [pinnedStreamers])

  const dggUtilitiesEnabled = (() => {
    try {
      return getAppPreferences().userscripts.dggUtilities
    } catch {
      return false
    }
  })()

  const chatEmbedSrc = useMemo(() => {
    // cache-buster so we can reload after login
    return `https://www.destiny.gg/embed/chat?omni=1&t=${chatEmbedReload}`
  }, [chatEmbedReload])

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

  useEffect(() => {
    const handler = (_event: any, service: any) => {
      if (service === 'destiny') {
        setChatEmbedReload((v) => v + 1)
      }
    }
    window.ipcRenderer.on('login-success', handler)
    return () => {
      window.ipcRenderer.off('login-success', handler)
    }
  }, [])

  // When not showing the Destiny embed slot (BrowserView), hide the view so it doesn't cover the iframe or combined chat.
  useEffect(() => {
    if (!(chatPaneOpen && chatMode === 'embedded' && dggUtilitiesEnabled)) {
      window.ipcRenderer.invoke('destiny-embed-hide').catch(() => {})
    }
  }, [chatPaneOpen, chatMode, dggUtilitiesEnabled])

  useEffect(() => {
    const handler = () => setDestinyEmbedDetached(false)
    window.ipcRenderer.on('destiny-embed-reattached', handler)
    return () => {
      window.ipcRenderer.off('destiny-embed-reattached', handler)
    }
  }, [])

  const destinyEmbedSlotRefCallback = useCallback((el: HTMLDivElement | null) => {
    destinyEmbedSlotRef.current = el
    destinyEmbedResizeObserverRef.current?.disconnect()
    destinyEmbedResizeObserverRef.current = null
    if (destinyEmbedResizeHandlerRef.current) {
      window.removeEventListener('resize', destinyEmbedResizeHandlerRef.current)
      destinyEmbedResizeHandlerRef.current = null
    }
    if (destinyEmbedResizeTimeoutRef.current != null) {
      clearTimeout(destinyEmbedResizeTimeoutRef.current)
      destinyEmbedResizeTimeoutRef.current = null
    }
    if (destinyEmbedRafRef.current != null) {
      cancelAnimationFrame(destinyEmbedRafRef.current)
      destinyEmbedRafRef.current = null
    }
    if (!el) {
      destinyEmbedLayoutTimeoutsRef.current.forEach((t) => clearTimeout(t))
      destinyEmbedLayoutTimeoutsRef.current = []
      window.ipcRenderer.invoke('destiny-embed-hide').catch(() => {})
      return
    }
    const lastLoggedRef = { rect: { left: -1, top: -1, width: -1, height: -1 } }
    const sendBounds = () => {
      const rect = el.getBoundingClientRect()
      const x = Math.round(rect.left)
      const y = Math.round(rect.top)
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      const changed =
        lastLoggedRef.rect.left !== x ||
        lastLoggedRef.rect.top !== y ||
        lastLoggedRef.rect.width !== w ||
        lastLoggedRef.rect.height !== h
      const viewportW = window.innerWidth
      const viewportH = window.innerHeight
      if (changed) lastLoggedRef.rect = { left: x, top: y, width: w, height: h }
      // Must send viewport size so main can scale bounds: renderer viewport (CSS) often differs from getContentSize() on Windows/DPI.
      window.ipcRenderer
        .invoke('destiny-embed-set-bounds', { x, y, width: w, height: h, viewportWidth: viewportW, viewportHeight: viewportH })
        .catch(() => {})
    }
    // Throttle: at most one bounds update per animation frame so resizing the pane isn't choppy.
    const sendBoundsThrottled = () => {
      if (destinyEmbedRafRef.current != null) return
      destinyEmbedRafRef.current = requestAnimationFrame(() => {
        destinyEmbedRafRef.current = null
        sendBounds()
      })
    }
    // Defer bounds after window resize so layout has settled (e.g. DevTools dock).
    const sendBoundsAfterResize = () => {
      if (destinyEmbedResizeTimeoutRef.current != null) clearTimeout(destinyEmbedResizeTimeoutRef.current)
      destinyEmbedRafRef.current = requestAnimationFrame(() => {
        destinyEmbedRafRef.current = requestAnimationFrame(() => {
          destinyEmbedRafRef.current = null
          sendBounds()
          destinyEmbedResizeTimeoutRef.current = window.setTimeout(() => {
            destinyEmbedResizeTimeoutRef.current = null
            sendBounds()
          }, 120)
        })
      })
    }
    sendBounds()
    // Re-send after layout settles (flex/chat pane can have delayed size)
    const t1 = window.setTimeout(sendBounds, 50)
    const t2 = window.setTimeout(sendBounds, 200)
    destinyEmbedLayoutTimeoutsRef.current = [t1, t2]
    const ro = new ResizeObserver(sendBoundsThrottled)
    ro.observe(el)
    destinyEmbedResizeObserverRef.current = ro
    window.addEventListener('resize', sendBoundsAfterResize)
    destinyEmbedResizeHandlerRef.current = sendBoundsAfterResize
  }, [])

  const openDestinyLogin = useCallback(() => {
    window.ipcRenderer.invoke('open-login-window', 'destiny').catch(() => {})
  }, [])

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

  /** Why each embed is in the list: Pinned (pinned streamer), DGG (websocket), Manual (pasted/pinned poll). */
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
    if (s.pinned) parts.push('Pinned')
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

  // Persist chat pane prefs
  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:chat-pane-width', String(chatPaneWidth))
      localStorage.setItem('omni-screen:chat-pane-side', chatPaneSide)
    } catch {
      // ignore
    }
  }, [chatPaneWidth, chatPaneSide])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:chat-mode', chatMode)
    } catch {
      // ignore
    }
  }, [chatMode])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:combined-include-dgg', combinedIncludeDgg ? '1' : '0')
    } catch {
      // ignore
    }
  }, [combinedIncludeDgg])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:combined-max-messages', String(combinedMaxMessages))
    } catch {
      // ignore
    }
  }, [combinedMaxMessages])

  useEffect(() => {
    setCombinedMaxMessagesDraft(String(combinedMaxMessages))
  }, [combinedMaxMessages])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:combined-show-timestamps', combinedShowTimestamps ? '1' : '0')
      localStorage.setItem('omni-screen:combined-show-labels', combinedShowLabels ? '1' : '0')
      localStorage.setItem('omni-screen:combined-sort-mode', combinedSortMode)
      localStorage.setItem('omni-screen:combined-highlight-term', combinedHighlightTerm)
    } catch {
      // ignore
    }
  }, [combinedShowLabels, combinedShowTimestamps, combinedSortMode, combinedHighlightTerm])

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
    } catch {
      // ignore
    }
  }, [cinemaMode])

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
    const shouldRun = chatPaneOpen && chatMode === 'combined'
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
  }, [chatMode, chatPaneOpen, selectedEmbedChatKeys])

  // Subscribe YouTube live chat for "Combined chat" based on per-embed Chat toggles.
  useEffect(() => {
    const shouldRun = chatPaneOpen && chatMode === 'combined'
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
  }, [combinedAvailableEmbeds, chatMode, chatPaneOpen, selectedEmbedChatKeys, youTubePollMultiplier])

  // Subscribe Twitch IRC chat for "Combined chat" based on per-embed Chat toggles.
  useEffect(() => {
    const shouldRun = chatPaneOpen && chatMode === 'combined'
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
  }, [chatMode, chatPaneOpen, selectedEmbedChatKeys])

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

      // Single structure so toggling cinema mode only changes wrapper classes/header visibility; embed iframe does not remount.
      return (
        <div
          key={item.key}
          className={cinemaMode ? 'w-full h-full min-h-0 min-w-0 overflow-hidden' : 'card bg-base-200 shadow-md overflow-hidden flex flex-col min-h-0'}
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
    [autoplay, bannedEmbeds, cinemaMode, mute, toggleEmbed],
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
  const dockButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const dockCloseTimerRef = useRef<number | null>(null)
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
        setSelectedEmbedKeys((prev) => new Set(prev).add(keys[0]))
      }
    },
    [selectedEmbedKeys, selectedEmbedChatKeys],
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
                      {chatMode === 'embedded' ? 'Chat (embedded)' : combinedHeaderText}
                    </div>
                    {chatMode === 'combined' ? (
                      <div className="text-xs text-base-content/60 whitespace-nowrap">{combinedMsgCount} msgs</div>
                    ) : null}
                    <button className="btn btn-xs btn-ghost" onClick={() => setChatSettingsOpen((v) => !v)}>
                      Settings
                    </button>
                  </div>
                  {chatSettingsOpen ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="join">
                        <button
                          className={`btn btn-xs join-item ${chatMode === 'embedded' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setChatMode('embedded')}
                        >
                          Embedded
                        </button>
                        <button
                          className={`btn btn-xs join-item ${chatMode === 'combined' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setChatMode('combined')}
                        >
                          Combined
                        </button>
                      </div>
                      <button
                        className="btn btn-xs btn-ghost"
                        onClick={() => setChatPaneSide((s) => (s === 'left' ? 'right' : 'left'))}
                        title="Move chat pane"
                      >
                        Side: Left
                      </button>

                      {chatMode === 'embedded' ? (
                        <>
                          <button className="btn btn-xs btn-primary" onClick={openDestinyLogin}>
                            Login
                          </button>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() =>
                              dggUtilitiesEnabled
                                ? window.ipcRenderer.invoke('destiny-embed-reload')
                                : setChatEmbedReload((v) => v + 1)
                            }
                          >
                            Reload
                          </button>
                          {dggUtilitiesEnabled ? (
                            <>
                              <button
                                className="btn btn-xs btn-ghost"
                                title="Open DevTools for the chat embed (inspect when docked)"
                                onClick={() => window.ipcRenderer.invoke('destiny-embed-open-devtools').catch(() => {})}
                              >
                                Inspect
                              </button>
                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={() => {
                                  setDestinyEmbedDetached(true)
                                  window.ipcRenderer.invoke('destiny-embed-detach').catch(() => {})
                                }}
                              >
                                Detach
                              </button>
                            </>
                          ) : null}
                          <div className="text-xs text-base-content/60">Discord can’t auth inside an iframe.</div>
                        </>
                      ) : (
                        <>
                          <label className="btn btn-xs btn-ghost gap-2" title="Include Destiny.gg chat in combined view">
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={combinedIncludeDgg}
                              onChange={(e) => setCombinedIncludeDgg(e.target.checked)}
                            />
                            DGG
                          </label>

                          <div className="w-full mt-2 flex flex-col gap-2">
                            <label className="flex items-center justify-between gap-2 text-sm">
                              <span>Max msgs</span>
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

                            <label className="flex items-center justify-between gap-2 text-sm">
                              <span>Timestamps</span>
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

                            <label className="flex flex-col gap-1 text-sm">
                              <span>Highlight term</span>
                              <input
                                type="text"
                                className="input input-sm w-full"
                                placeholder="e.g. username"
                                value={combinedHighlightTerm}
                                onChange={(e) => setCombinedHighlightTerm(e.target.value)}
                              />
                            </label>

                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span>Order</span>
                              <div className="join">
                                <button
                                  className={`btn btn-xs join-item ${combinedSortMode === 'timestamp' ? 'btn-primary' : 'btn-ghost'}`}
                                  onClick={() => setCombinedSortMode('timestamp')}
                                >
                                  Timestamp
                                </button>
                                <button
                                  className={`btn btn-xs join-item ${combinedSortMode === 'arrival' ? 'btn-primary' : 'btn-ghost'}`}
                                  onClick={() => setCombinedSortMode('arrival')}
                                >
                                  Arrival
                                </button>
                              </div>
                            </div>

                            <label
                              className="flex items-center justify-between gap-2 text-sm"
                              title="Unitless multiplier. Effective delay ≈ YouTube-provided timeout × multiplier."
                            >
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
                            <div className="text-xs text-base-content/60">
                              Unitless multiplier. Example: if YouTube says wait 1000ms, 1.5× → ~1500ms.
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={openKickHistorySetup}
                                title="Open Kick in-app to establish Cloudflare/Kick cookies for history requests"
                              >
                                Kick history: open Kick
                              </button>
                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={retryKickHistory}
                                disabled={enabledKickSlugs.length === 0}
                                title={enabledKickSlugs.length === 0 ? 'Enable at least one Kick chat toggle first' : 'Retry history fetch for enabled Kick chats'}
                              >
                                Retry history
                              </button>
                            </div>
                            <div className="text-xs text-base-content/60">
                              If Kick history fails, open Kick once (Cloudflare may appear), then retry.
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                  {chatMode === 'embedded' ? (
                    dggUtilitiesEnabled ? (
                      destinyEmbedDetached ? (
                        <div className="w-full h-full flex items-center justify-center bg-base-200 text-base-content/70 text-sm p-4 text-center">
                          Chat detached. Close the chat window to re-attach.
                        </div>
                      ) : (
                        <div
                          ref={destinyEmbedSlotRefCallback}
                          className="w-full h-full min-w-0 min-h-0"
                          style={{ backgroundColor: 'transparent' }}
                        />
                      )
                    ) : (
                      <iframe
                        src={chatEmbedSrc}
                        title="Destiny.gg Chat"
                        className="w-full h-full"
                        style={{ border: 'none' }}
                        allow="clipboard-read; clipboard-write"
                      />
                    )
                  ) : (
                    <CombinedChat
                      enableDgg={combinedIncludeDgg}
                      getEmbedDisplayName={getEmbedDisplayName}
                      maxMessages={combinedMaxMessages}
                      showTimestamps={combinedShowTimestamps}
                      showSourceLabels={combinedShowLabels}
                      sortMode={combinedSortMode}
                      highlightTerm={combinedHighlightTerm || undefined}
                      onCountChange={setCombinedMsgCount}
                    />
                  )}
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

        {/* Center column: embeds grid + bottom dock (width stops at chat pane) */}
        <div className={`flex-1 min-w-0 min-h-0 relative flex flex-col overflow-visible ${cinemaMode ? 'p-0' : 'p-3'}`}>
          {/* 50% transparent background behind embeds */}
          <div
            className="absolute inset-0 opacity-50 pointer-events-none bg-center bg-no-repeat bg-cover"
            style={{ backgroundImage: `url(${danTheBuilderBg})` }}
          />

          {/* Embed grid area (measured by ResizeObserver) */}
          <div ref={gridAreaRef} className="relative z-10 flex-1 min-h-0 overflow-hidden">
            {selectedEmbeds.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-xl font-bold mb-2">No embeds selected</div>
                  <div className="text-base-content/70">Use the dock below to toggle streams on.</div>
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

          {/* Bottom embeds dock (inside center column) */}
          <div
            className={[
              'relative z-20 flex items-center gap-2',
              cinemaMode ? 'mt-0 bg-base-200 border-t border-base-300 rounded-none px-2 py-2' : 'mt-3 bg-base-200 border border-base-300 rounded-lg px-2 py-2',
            ].join(' ')}
          >
            {/* Scrollable embeds list */}
            <div className="flex-1 min-w-0">
              <div
                ref={dockRef}
                className="overflow-x-auto overflow-y-hidden whitespace-nowrap embed-dock-scroll"
                onWheel={onDockWheel}
                style={{ overscrollBehaviorX: 'contain' as any }}
              >
                <div className="flex items-center gap-1">
                  {dockItems.length === 0 ? (
                    <div className="text-xs text-base-content/60 px-2 py-1">No embeds. Add a link or add a pinned streamer (when live).</div>
                  ) : (
                    dockItems.map((item, idx) => {
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
                            className={`btn btn-sm ${active ? '' : 'btn-ghost'} ${anyBanned ? 'btn-disabled' : 'btn-outline'}`}
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

                          {idx < dockItems.length - 1 ? <span className="px-1 text-base-content/40">|</span> : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Fixed controls (right side): + Link, cinema, settings, Back */}
            <div className="flex-none flex items-center gap-2">
              <div className="dropdown dropdown-top dropdown-end">
                <label tabIndex={0} className="btn btn-sm btn-ghost btn-outline" title="Add embed from link (YouTube, Kick, Twitch)">
                  + Link
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
                      title="Add embed: direct link (YouTube/Kick/Twitch) or YouTube channel (live or add as pinned)"
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
              <button
                type="button"
                className="btn btn-sm btn-ghost btn-outline"
                title="Manage pinned streamers"
                onClick={() => setPinnedStreamersModalOpen(true)}
              >
                📌
              </button>
              <button
                type="button"
                className={`btn btn-sm ${cinemaMode ? 'btn-primary' : 'btn-ghost btn-outline'}`}
                title="Cinema mode"
                onClick={() => setCinemaMode((v) => !v)}
              >
                📽️
              </button>
              <div className="dropdown dropdown-top dropdown-hover dropdown-end">
                <button type="button" tabIndex={0} className="btn btn-sm btn-ghost btn-outline" title="Settings">
                  ⚙
                </button>
                <div tabIndex={0} className="dropdown-content z-[90] p-3 shadow bg-base-100 rounded-box w-56 border border-base-300">
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Chat</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={chatPaneOpen}
                        onChange={(e) => setChatPaneOpen(e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Autoplay</span>
                      <input
                        type="checkbox"
                        className="toggle toggle-sm"
                        checked={autoplay}
                        onChange={(e) => setAutoplay(e.target.checked)}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Mute</span>
                      <input type="checkbox" className="toggle toggle-sm" checked={mute} onChange={(e) => setMute(e.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-sm">
                      <span>Cinema mode</span>
                      <input type="checkbox" className="toggle toggle-sm" checked={cinemaMode} onChange={(e) => setCinemaMode(e.target.checked)} />
                    </label>
                    <div className="border-t border-base-300 pt-2 mt-1">
                      <div className="text-xs font-semibold text-base-content/70 mb-1">Combined chat: YouTube</div>
                      <label className="flex items-center justify-between gap-2 text-sm">
                        <span>YT chat poll ×</span>
                        <input
                          type="number"
                          step={0.25}
                          className="input input-sm w-20"
                          value={youTubePollMultiplier}
                          min={0.25}
                          max={5}
                          onChange={(e) => {
                            const v = Number(e.target.value)
                            if (Number.isFinite(v)) setYouTubePollMultiplier(Math.max(0.25, Math.min(5, v)))
                          }}
                        />
                      </label>
                      <div className="text-xs text-base-content/50 mt-0.5">Chat fetch delay. Pinned live check: 📌 on the bar.</div>
                    </div>
                  </div>
                </div>
              </div>

              <button className="btn btn-sm btn-primary" onClick={onBackToMenu}>
                Back
              </button>
            </div>
          </div>

          {/* Dock hover popup (rendered outside scroll container so it won't be clipped) */}
          {dockHoverItemId && hoveredDockItem && dockHoverRect ? (() => {
            const popupW = 260
            const left = Math.max(8, Math.min(window.innerWidth - popupW - 8, dockHoverRect.left + dockHoverRect.width / 2 - popupW / 2))
            const top = Math.max(8, dockHoverRect.top - 8)
            const isGroup = hoveredDockItem.type === 'group'
            const keys = isGroup ? hoveredDockItem.keys : [hoveredDockItem.key]
            const streamers = isGroup ? hoveredDockItem.streamers : []
            const firstKey = keys[0]
            const firstEmbed = combinedAvailableEmbeds.get(firstKey)
            const accent = omniColorForKey(firstKey, { displayName: firstEmbed?.mediaItem?.metadata?.displayName })
            return (
              <div
                className="fixed z-[200] p-3 shadow bg-base-100 rounded-box border border-base-300"
                style={{ width: popupW, left, top, transform: 'translateY(-100%)' }}
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
                      {chatMode === 'embedded' ? 'Chat (embedded)' : combinedHeaderText}
                    </div>
                    {chatMode === 'combined' ? (
                      <div className="text-xs text-base-content/60 whitespace-nowrap">{combinedMsgCount} msgs</div>
                    ) : null}
                    <button className="btn btn-xs btn-ghost" onClick={() => setChatSettingsOpen((v) => !v)}>
                      Settings
                    </button>
                  </div>
                  {chatSettingsOpen ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="join">
                        <button
                          className={`btn btn-xs join-item ${chatMode === 'embedded' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setChatMode('embedded')}
                        >
                          Embedded
                        </button>
                        <button
                          className={`btn btn-xs join-item ${chatMode === 'combined' ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setChatMode('combined')}
                        >
                          Combined
                        </button>
                      </div>
                      <button
                        className="btn btn-xs btn-ghost"
                        onClick={() => setChatPaneSide((s) => (s === 'left' ? 'right' : 'left'))}
                        title="Move chat pane"
                      >
                        Side: Right
                      </button>

                      {chatMode === 'embedded' ? (
                        <>
                          <button className="btn btn-xs btn-primary" onClick={openDestinyLogin}>
                            Login
                          </button>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() =>
                              dggUtilitiesEnabled
                                ? window.ipcRenderer.invoke('destiny-embed-reload')
                                : setChatEmbedReload((v) => v + 1)
                            }
                          >
                            Reload
                          </button>
                          {dggUtilitiesEnabled ? (
                            <>
                              <button
                                className="btn btn-xs btn-ghost"
                                title="Open DevTools for the chat embed (inspect when docked)"
                                onClick={() => window.ipcRenderer.invoke('destiny-embed-open-devtools').catch(() => {})}
                              >
                                Inspect
                              </button>
                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={() => {
                                  setDestinyEmbedDetached(true)
                                  window.ipcRenderer.invoke('destiny-embed-detach').catch(() => {})
                                }}
                              >
                                Detach
                              </button>
                            </>
                          ) : null}
                          <div className="text-xs text-base-content/60">Discord can’t auth inside an iframe.</div>
                        </>
                      ) : (
                        <>
                          <label className="btn btn-xs btn-ghost gap-2" title="Include Destiny.gg chat in combined view">
                            <input
                              type="checkbox"
                              className="toggle toggle-sm"
                              checked={combinedIncludeDgg}
                              onChange={(e) => setCombinedIncludeDgg(e.target.checked)}
                            />
                            DGG
                          </label>

                          <div className="w-full mt-2 flex flex-col gap-2">
                            <label className="flex items-center justify-between gap-2 text-sm">
                              <span>Max msgs</span>
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

                            <label className="flex items-center justify-between gap-2 text-sm">
                              <span>Timestamps</span>
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

                            <label className="flex flex-col gap-1 text-sm">
                              <span>Highlight term</span>
                              <input
                                type="text"
                                className="input input-sm w-full"
                                placeholder="e.g. username"
                                value={combinedHighlightTerm}
                                onChange={(e) => setCombinedHighlightTerm(e.target.value)}
                              />
                            </label>

                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span>Order</span>
                              <div className="join">
                                <button
                                  className={`btn btn-xs join-item ${combinedSortMode === 'timestamp' ? 'btn-primary' : 'btn-ghost'}`}
                                  onClick={() => setCombinedSortMode('timestamp')}
                                >
                                  Timestamp
                                </button>
                                <button
                                  className={`btn btn-xs join-item ${combinedSortMode === 'arrival' ? 'btn-primary' : 'btn-ghost'}`}
                                  onClick={() => setCombinedSortMode('arrival')}
                                >
                                  Arrival
                                </button>
                              </div>
                            </div>

                            <label
                              className="flex items-center justify-between gap-2 text-sm"
                              title="Unitless multiplier. Effective delay ≈ YouTube-provided timeout × multiplier."
                            >
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
                            <div className="text-xs text-base-content/60">
                              Unitless multiplier. Example: if YouTube says wait 1000ms, 1.5× → ~1500ms.
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={openKickHistorySetup}
                                title="Open Kick in-app to establish Cloudflare/Kick cookies for history requests"
                              >
                                Kick history: open Kick
                              </button>
                              <button
                                className="btn btn-xs btn-ghost"
                                onClick={retryKickHistory}
                                disabled={enabledKickSlugs.length === 0}
                                title={enabledKickSlugs.length === 0 ? 'Enable at least one Kick chat toggle first' : 'Retry history fetch for enabled Kick chats'}
                              >
                                Retry history
                              </button>
                            </div>
                            <div className="text-xs text-base-content/60">
                              If Kick history fails, open Kick once (Cloudflare may appear), then retry.
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="flex-1 min-h-0 overflow-hidden">
                  {chatMode === 'embedded' ? (
                    dggUtilitiesEnabled ? (
                      destinyEmbedDetached ? (
                        <div className="w-full h-full flex items-center justify-center bg-base-200 text-base-content/70 text-sm p-4 text-center">
                          Chat detached. Close the chat window to re-attach.
                        </div>
                      ) : (
                        <div
                          ref={destinyEmbedSlotRefCallback}
                          className="w-full h-full min-w-0 min-h-0"
                          style={{ backgroundColor: 'transparent' }}
                        />
                      )
                    ) : (
                      <iframe
                        src={chatEmbedSrc}
                        title="Destiny.gg Chat"
                        className="w-full h-full"
                        style={{ border: 'none' }}
                        allow="clipboard-read; clipboard-write"
                      />
                    )
                  ) : (
                    <CombinedChat
                      enableDgg={combinedIncludeDgg}
                      getEmbedDisplayName={getEmbedDisplayName}
                      maxMessages={combinedMaxMessages}
                      showTimestamps={combinedShowTimestamps}
                      showSourceLabels={combinedShowLabels}
                      sortMode={combinedSortMode}
                      highlightTerm={combinedHighlightTerm || undefined}
                      onCountChange={setCombinedMsgCount}
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Pinned streamers modal */}
      {pinnedStreamersModalOpen && (
        <div className="modal modal-open z-[100]">
          <div className="modal-box max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg">Manage pinned streamers</h3>
            <p className="text-sm text-base-content/60 mt-1">
              Drag to reorder (order on the bar). Color sets the dock button. Each can link YouTube, Kick, and Twitch.
            </p>

            <div className="mt-4 flex flex-col gap-2">
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', String(index))
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      className="text-base-content/50 select-none cursor-grab active:cursor-grabbing touch-none"
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
                    <span className="font-medium truncate flex-1 min-w-0">{s.nickname || 'Unnamed'}</span>
                    <div className="flex gap-1">
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
                  <div className="text-xs text-base-content/60 flex flex-wrap gap-x-3 gap-y-0">
                    {s.youtubeChannelId ? <span>YT: {s.youtubeChannelId.slice(0, 12)}…</span> : null}
                    {s.kickSlug ? <span>Kick: {s.kickSlug}</span> : null}
                    {s.twitchLogin ? <span>Twitch: {s.twitchLogin}</span> : null}
                    {!s.youtubeChannelId && !s.kickSlug && !s.twitchLogin ? <span>No platforms</span> : null}
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
              <div className="border border-base-300 rounded-lg p-3 mt-3">
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
                className="btn btn-sm btn-ghost btn-outline mt-3"
                onClick={() => setEditingStreamerId('__new__')}
              >
                + Add streamer
              </button>
            )}

            <div className="border-t border-base-300 pt-4 mt-4">
              <div className="text-sm font-semibold text-base-content/70 mb-2">Pinned streamers: live check</div>
              <p className="text-xs text-base-content/60 mb-2">
                When live, pinned streamers appear in the dock (no DGG list required). YouTube chat poll is in Combined chat → Settings.
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
                title="Check all pinned streamers for live now"
                onClick={() => setPinnedPollRefreshTrigger((n) => n + 1)}
              >
                Check now
              </button>
            </div>

            <div className="modal-action mt-4">
              <button className="btn btn-primary" onClick={() => setPinnedStreamersModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setPinnedStreamersModalOpen(false)} aria-hidden="true" />
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

