import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import KickEmbed from './embeds/KickEmbed'
import TwitchEmbed from './embeds/TwitchEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import CombinedChat from './CombinedChat'
import danTheBuilderBg from '../assets/media/DanTheBuilder.png'
import { omniColorForKey, textColorOn, withAlpha } from '../utils/omniColors'
import { getAppPreferences } from '../utils/appPreferences'

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

function makeEmbedKey(platform: string, id: string) {
  const p = String(platform || '').toLowerCase()
  const rawId = String(id || '')
  // YouTube video IDs are case-sensitive; preserve casing.
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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function getBestGridColumns(opts: { count: number; width: number; height: number; gapPx?: number; headerHeightPx?: number }): number {
  const { count, width, height } = opts
  if (count <= 1) return 1
  if (width <= 0 || height <= 0) return Math.min(count, 2)

  // Tailwind gap-3 = 0.75rem = 12px
  const gap = Number.isFinite(opts.gapPx) ? Math.max(0, Math.floor(opts.gapPx as number)) : 12
  // Our cards have a small header; approximate so we don't overflow vertically.
  const headerHeight = Number.isFinite(opts.headerHeightPx) ? Math.max(0, Math.floor(opts.headerHeightPx as number)) : 56
  const aspectW = 16
  const aspectH = 9

  const maxCols = Math.min(count, 6) // cap so it doesn't get silly
  let bestCols = 1
  let bestArea = 0

  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(count / cols)
    const colW = (width - gap * (cols - 1)) / cols
    const rowH = (height - gap * (rows - 1)) / rows

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
      return new Set(arr.filter((x) => typeof x === 'string'))
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
      return new Set(arr.filter((x) => typeof x === 'string'))
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
  const destinyEmbedResizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const destinyEmbedRafRef = useRef<number | null>(null)
  const destinyEmbedLayoutTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const manualEmbedsRef = useRef<Map<string, LiveEmbed>>(manualEmbeds)
  manualEmbedsRef.current = manualEmbeds
  const [ytChannelLoading, setYtChannelLoading] = useState(false)
  const [ytChannelError, setYtChannelError] = useState<string | null>(null)

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
  // Merge DGG websocket embeds with manual (pasted link) embeds for the dock and grid
  const combinedAvailableEmbeds = useMemo(() => {
    const m = new Map<string, LiveEmbed>(availableEmbeds)
    manualEmbeds.forEach((v, k) => m.set(k, v))
    return m
  }, [availableEmbeds, manualEmbeds])

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
    } catch {
      // ignore
    }
  }, [combinedShowLabels, combinedShowTimestamps, combinedSortMode])

  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:youtube-poll-multiplier', String(youTubePollMultiplier))
    } catch {
      // ignore
    }
  }, [youTubePollMultiplier])

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
            const pruned = new Set<string>()
            prev.forEach((k) => {
              if (next.has(k) || manual.has(k)) {
                pruned.add(k)
                return
              }
              const migrated = legacyToCanonical.get(k)
              if (migrated && (next.has(migrated) || manual.has(migrated))) pruned.add(migrated)
            })
            return pruned
          })

          setSelectedEmbedChatKeys((prev) => {
            const manual = manualEmbedsRef.current
            const pruned = new Set<string>()
            prev.forEach((k) => {
              if (next.has(k) || manual.has(k)) {
                pruned.add(k)
                return
              }
              const migrated = legacyToCanonical.get(k)
              if (migrated && (next.has(migrated) || manual.has(migrated))) pruned.add(migrated)
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

  const addEmbedFromUrl = useCallback((url: string) => {
    const parsed = parseEmbedUrl(url)
    if (!parsed) return false
    const key = makeEmbedKey(parsed.platform, parsed.id)
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

  const toggleEmbedMaster = useCallback(
    (key: string) => {
      const videoOn = selectedEmbedKeys.has(key)
      const chatOn = selectedEmbedChatKeys.has(key)

      if (videoOn || chatOn) {
        // Master OFF: disable both
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
        return
      }

      // Master ON: enable video only (chat stays off until explicitly enabled)
      setSelectedEmbedKeys((prev) => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
      setSelectedEmbedChatKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    },
    [selectedEmbedChatKeys, selectedEmbedKeys],
  )

  const embedDisplayNameByKey = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [key, e] of combinedAvailableEmbeds.entries()) {
      const dn = e?.mediaItem?.metadata?.displayName || e?.mediaItem?.metadata?.title
      if (typeof dn === 'string' && dn.trim()) out[key] = dn.trim()
    }
    return out
  }, [combinedAvailableEmbeds])

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

      if (cinemaMode) {
        // Edge-to-edge embeds: no card chrome, no header, no padding, no gaps.
        return (
          <div
            key={item.key}
            className="w-full h-full min-h-0 min-w-0 overflow-hidden"
            style={{ viewTransitionName: makeViewTransitionNameForKey(item.key) } as any}
          >
            {content}
          </div>
        )
      }

      return (
        <div
          key={item.key}
          className="card bg-base-200 shadow-md overflow-hidden flex flex-col min-h-0"
          style={{ borderTop: `4px solid ${accent}`, viewTransitionName: makeViewTransitionNameForKey(item.key) } as any}
        >
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
          <div className="px-2 pb-2 flex-1 min-h-0">
            <div className="w-full h-full min-h-0">{content}</div>
          </div>
        </div>
      )
    },
    [autoplay, bannedEmbeds, cinemaMode, mute, toggleEmbed],
  )

  const embedsList = useMemo(() => {
    const items = Array.from(combinedAvailableEmbeds.entries()).map(([key, embed]) => ({ key, embed }))
    items.sort((a, b) => {
      // Sort by number of embeds (count) first; fall back to viewers if count is missing.
      const av = Number(a.embed.count ?? a.embed.mediaItem?.metadata?.viewers ?? 0) || 0
      const bv = Number(b.embed.count ?? b.embed.mediaItem?.metadata?.viewers ?? 0) || 0
      return bv - av
    })
    return items
  }, [combinedAvailableEmbeds])

  const dockRef = useRef<HTMLDivElement | null>(null)
  const dockButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const dockCloseTimerRef = useRef<number | null>(null)
  const [dockHoverKey, setDockHoverKey] = useState<string | null>(null)
  const [dockHoverPinned, setDockHoverPinned] = useState(false)
  const [dockHoverRect, setDockHoverRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const updateDockHoverRect = useCallback((key: string) => {
    const el = dockButtonRefs.current.get(key)
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
    (key: string) => {
      clearDockCloseTimer()
      setDockHoverKey(key)
      updateDockHoverRect(key)
    },
    [clearDockCloseTimer, updateDockHoverRect],
  )

  const scheduleCloseDockHover = useCallback(() => {
    clearDockCloseTimer()
    dockCloseTimerRef.current = window.setTimeout(() => {
      if (dockHoverPinned) return
      setDockHoverKey(null)
    }, 120)
  }, [clearDockCloseTimer, dockHoverPinned])

  // Keep the hover popup positioned correctly as the dock scrolls.
  useEffect(() => {
    if (!dockHoverKey) return
    const el = dockRef.current
    const onUpdate = () => updateDockHoverRect(dockHoverKey)
    window.addEventListener('resize', onUpdate)
    el?.addEventListener('scroll', onUpdate, { passive: true } as any)
    return () => {
      window.removeEventListener('resize', onUpdate)
      el?.removeEventListener('scroll', onUpdate as any)
    }
  }, [dockHoverKey, updateDockHoverRect])

  useLayoutEffect(() => {
    if (!dockHoverKey) return
    updateDockHoverRect(dockHoverKey)
  }, [dockHoverKey, embedsList.length, updateDockHoverRect])

  const onDockWheel = useCallback((e: React.WheelEvent) => {
    const el = dockRef.current
    if (!el) return
    // If user scrolls vertically over the dock, convert to horizontal scrolling.
    if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
  }, [])

  const hoveredDockItem = useMemo(() => {
    if (!dockHoverKey) return null
    return embedsList.find((x) => x.key === dockHoverKey) || null
  }, [dockHoverKey, embedsList])

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
                              <span>YT poll delay ×</span>
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
                      embedDisplayNameByKey={embedDisplayNameByKey}
                      maxMessages={combinedMaxMessages}
                      showTimestamps={combinedShowTimestamps}
                      showSourceLabels={combinedShowLabels}
                      sortMode={combinedSortMode}
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
                  {embedsList.length === 0 ? (
                    <div className="text-xs text-base-content/60 px-2 py-1">No embeds. Paste a link or wait for DGG list.</div>
                  ) : (
                    embedsList.map(({ key, embed }, idx) => {
                      const banned = bannedEmbeds.get(key)
                      const videoOn = selectedEmbedKeys.has(key)
                      const chatOn = selectedEmbedChatKeys.has(key)

                      const label = embed.id
                      const platform = (embed.platform || '').toLowerCase()
                      const title =
                        embed.mediaItem?.metadata?.title ||
                        embed.mediaItem?.metadata?.displayName ||
                        `${embed.platform}/${embed.id}`
                      const accent = omniColorForKey(key, { displayName: embed.mediaItem?.metadata?.displayName })
                      const active = videoOn || chatOn
                      const activeText = textColorOn(accent)

                      return (
                        <div key={key} className="flex items-center">
                          <button
                            type="button"
                            ref={(el) => {
                              const map = dockButtonRefs.current
                              if (el) map.set(key, el)
                              else map.delete(key)
                            }}
                            className={`btn btn-sm ${active ? '' : 'btn-ghost'} ${banned ? 'btn-disabled' : 'btn-outline'}`}
                            title={`${platform}: ${title}`}
                            onClick={() => toggleEmbedMaster(key)}
                            onMouseEnter={() => openDockHover(key)}
                            onMouseLeave={scheduleCloseDockHover}
                            style={
                              active
                                ? { backgroundColor: accent, borderColor: accent, color: activeText }
                                : { borderColor: accent, color: accent }
                            }
                          >
                            {label}
                          </button>

                          {idx < embedsList.length - 1 ? <span className="px-1 text-base-content/40">|</span> : null}
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
                      placeholder="Paste YouTube/Kick/Twitch link"
                      className="input input-sm input-bordered w-full"
                      id="omni-paste-embed-url"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        const el = document.getElementById('omni-paste-embed-url') as HTMLInputElement | null
                        const url = el?.value?.trim()
                        if (url && addEmbedFromUrl(url)) {
                          el.value = ''
                          ;(document.activeElement as HTMLElement)?.blur?.()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      title="Add embed from pasted link"
                      onClick={() => {
                        const el = document.getElementById('omni-paste-embed-url') as HTMLInputElement | null
                        const url = el?.value?.trim()
                        if (url && addEmbedFromUrl(url)) el.value = ''
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="border-t border-base-300 pt-2 mt-1 flex flex-col gap-2">
                    <div className="text-xs font-semibold text-base-content/70">YouTube channel (live or latest)</div>
                    <input
                      type="text"
                      placeholder="Channel ID, youtube.com/channel/UC..., or @Handle"
                      className="input input-sm input-bordered w-full"
                      id="omni-youtube-channel-input"
                      disabled={ytChannelLoading}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return
                        const el = document.getElementById('omni-youtube-channel-input') as HTMLInputElement | null
                        const v = el?.value?.trim()
                        if (!v) return
                        setYtChannelError(null)
                        setYtChannelLoading(true)
                        window.ipcRenderer
                          .invoke('youtube-live-or-latest', v)
                          .then((r: { error?: string; videoId?: string }) => {
                            if (r?.error) {
                              setYtChannelError(r.error)
                              return
                            }
                            if (r?.videoId && addEmbedFromUrl(`https://www.youtube.com/watch?v=${r.videoId}`)) {
                              el!.value = ''
                              setYtChannelError(null)
                            }
                          })
                          .finally(() => setYtChannelLoading(false))
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-outline"
                    title="Resolve channel to live stream or latest video, then add embed"
                    disabled={ytChannelLoading}
                    onClick={() => {
                      const el = document.getElementById('omni-youtube-channel-input') as HTMLInputElement | null
                      const v = el?.value?.trim()
                      if (!v) return
                      setYtChannelError(null)
                      setYtChannelLoading(true)
                      window.ipcRenderer
                        .invoke('youtube-live-or-latest', v)
                        .then((r: { error?: string; videoId?: string }) => {
                          if (r?.error) {
                            setYtChannelError(r.error)
                            return
                          }
                          if (r?.videoId && addEmbedFromUrl(`https://www.youtube.com/watch?v=${r.videoId}`)) {
                            el!.value = ''
                            setYtChannelError(null)
                          }
                        })
                        .finally(() => setYtChannelLoading(false))
                    }}
                  >
                    {ytChannelLoading ? '…' : 'Add live/latest'}
                  </button>
                  {ytChannelError ? <div className="text-xs text-error">{ytChannelError}</div> : null}
                </div>
              </div>
              </div>
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
                      <div className="text-xs font-semibold text-base-content/70 mb-1">Poll / refresh</div>
                      <label className="flex items-center justify-between gap-2 text-sm">
                        <span>YT poll ×</span>
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
                      <div className="text-xs text-base-content/50 mt-0.5">Live-detection poll multiplier. Chat → Settings for more.</div>
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
          {dockHoverKey && hoveredDockItem && dockHoverRect ? (() => {
            const { key, embed } = hoveredDockItem
            const banned = bannedEmbeds.get(key)
            const videoOn = selectedEmbedKeys.has(key)
            const chatOn = selectedEmbedChatKeys.has(key)
            const platform = (embed.platform || '').toLowerCase()
            const title =
              embed.mediaItem?.metadata?.title ||
              embed.mediaItem?.metadata?.displayName ||
              `${embed.platform}/${embed.id}`
            const accent = omniColorForKey(key, { displayName: embed.mediaItem?.metadata?.displayName })
            const popupW = 240
            const left = Math.max(8, Math.min(window.innerWidth - popupW - 8, dockHoverRect.left + dockHoverRect.width / 2 - popupW / 2))
            const top = Math.max(8, dockHoverRect.top - 8)
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
                  setDockHoverKey(null)
                }}
              >
                <div className="text-xs text-base-content/60 mb-2">
                  <div className="font-semibold" style={{ color: accent }}>
                    {platform}
                  </div>
                  <div className="truncate" title={title}>
                    {title}
                  </div>
                  <div>
                    {typeof embed.count === 'number' ? `${embed.count} embeds` : null}
                    {typeof embed.mediaItem?.metadata?.viewers === 'number' ? ` • ${embed.mediaItem.metadata.viewers.toLocaleString()} viewers` : null}
                    {banned ? ` • banned` : null}
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
                  <div className="text-xs text-base-content/60">
                    Hover to adjust toggles. Click the name to toggle (master).
                  </div>
                </div>
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
                              <span>YT poll delay ×</span>
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
                      embedDisplayNameByKey={embedDisplayNameByKey}
                      maxMessages={combinedMaxMessages}
                      showTimestamps={combinedShowTimestamps}
                      showSourceLabels={combinedShowLabels}
                      sortMode={combinedSortMode}
                      onCountChange={setCombinedMsgCount}
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  )
}

