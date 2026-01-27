import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import KickEmbed from './embeds/KickEmbed'
import TwitchEmbed from './embeds/TwitchEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import danTheBuilderBg from '../assets/media/DanTheBuilder.png'

type ChatPaneSide = 'left' | 'right'
type SideTab = 'chat' | 'embeds'

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
  return `${platform.toLowerCase()}:${id.toLowerCase()}`
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function getBestGridColumns(opts: { count: number; width: number; height: number }): number {
  const { count, width, height } = opts
  if (count <= 1) return 1
  if (width <= 0 || height <= 0) return Math.min(count, 2)

  // Tailwind gap-3 = 0.75rem = 12px
  const gap = 12
  // Our cards have a small header; approximate so we don't overflow vertically.
  const headerHeight = 56
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

export default function OmniScreen({ onBackToMenu }: { onBackToMenu?: () => void }) {
  // ---- Live WS (embeds list) ----
  const [liveConnected, setLiveConnected] = useState(false)
  const [liveLastError, setLiveLastError] = useState<string | null>(null)

  const [availableEmbeds, setAvailableEmbeds] = useState<Map<string, LiveEmbed>>(new Map())
  const [bannedEmbeds, setBannedEmbeds] = useState<Map<string, BannedEmbed>>(new Map())

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

  const [autoplay, setAutoplay] = useState(true)
  const [mute, setMute] = useState(true)

  // ---- Chat pane ----
  const [chatPaneOpen, setChatPaneOpen] = useState(true)
  const [chatPaneSide, setChatPaneSide] = useState<ChatPaneSide>(() => {
    const saved = localStorage.getItem('omni-screen:chat-pane-side')
    return saved === 'right' ? 'right' : 'left'
  })
  const [chatPaneWidth, setChatPaneWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('omni-screen:chat-pane-width'))
    return Number.isFinite(saved) && saved > 0 ? saved : 420
  })
  const [sideTab, setSideTab] = useState<SideTab>('chat')
  const [chatEmbedReload, setChatEmbedReload] = useState(0)

  const chatEmbedSrc = useMemo(() => {
    // cache-buster so we can reload after login
    return `https://www.destiny.gg/embed/chat?omni=1&t=${chatEmbedReload}`
  }, [chatEmbedReload])

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

  const openDestinyLogin = useCallback(() => {
    window.ipcRenderer.invoke('open-login-window', 'destiny').catch(() => {})
  }, [])

  // ---- Center grid sizing (responsive to window size) ----
  const gridHostRef = useRef<HTMLDivElement | null>(null)
  const [gridHostSize, setGridHostSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // Persist selection
  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:selected-embeds', JSON.stringify(Array.from(selectedEmbedKeys.values())))
    } catch {
      // ignore
    }
  }, [selectedEmbedKeys])

  // Persist chat pane prefs
  useEffect(() => {
    try {
      localStorage.setItem('omni-screen:chat-pane-width', String(chatPaneWidth))
      localStorage.setItem('omni-screen:chat-pane-side', chatPaneSide)
    } catch {
      // ignore
    }
  }, [chatPaneWidth, chatPaneSide])

  // Track available size for the embed grid so it can adapt to window resizing.
  useEffect(() => {
    const el = gridHostRef.current
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

    const handleConnected = () => alive && setLiveConnected(true)
    const handleDisconnected = () => alive && setLiveConnected(false)
    const handleError = (_event: any, err: any) => {
      if (!alive) return
      setLiveLastError(err?.message || 'WebSocket error')
    }

    const handleMessage = (_event: any, payload: any) => {
      if (!alive) return
      const parsed = payload as LiveWsMessage
      if (!parsed || typeof parsed.type !== 'string') return

      if (parsed.type === 'dggApi:embeds') {
        const next = new Map<string, LiveEmbed>()
        const data = (parsed as { type: 'dggApi:embeds'; data: LiveEmbed[] }).data || []
        data.forEach((embed: LiveEmbed) => {
          if (!embed?.platform || !embed?.id) return
          next.set(makeEmbedKey(embed.platform, embed.id), embed)
        })
        setAvailableEmbeds(next)

        setSelectedEmbedKeys((prev) => {
          const pruned = new Set<string>()
          prev.forEach((k) => {
            if (next.has(k)) pruned.add(k)
          })
          return pruned
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

    setLiveLastError(null)

    window.ipcRenderer.invoke('live-websocket-connect').catch((err) => {
      setLiveLastError(err instanceof Error ? err.message : String(err) || 'Failed to connect')
    })

    window.ipcRenderer.on('live-websocket-connected', handleConnected)
    window.ipcRenderer.on('live-websocket-disconnected', handleDisconnected)
    window.ipcRenderer.on('live-websocket-error', handleError)
    window.ipcRenderer.on('live-websocket-message', handleMessage)

    window.ipcRenderer
      .invoke('live-websocket-status')
      .then((res: any) => alive && setLiveConnected(Boolean(res?.connected)))
      .catch(() => {})

    return () => {
      alive = false
      window.ipcRenderer.off('live-websocket-connected', handleConnected)
      window.ipcRenderer.off('live-websocket-disconnected', handleDisconnected)
      window.ipcRenderer.off('live-websocket-error', handleError)
      window.ipcRenderer.off('live-websocket-message', handleMessage)
      window.ipcRenderer.invoke('live-websocket-disconnect').catch(() => {})
    }
  }, [])


  const selectedEmbeds = useMemo(() => {
    const arr: { key: string; embed: LiveEmbed }[] = []
    selectedEmbedKeys.forEach((key) => {
      const embed = availableEmbeds.get(key)
      if (embed) arr.push({ key, embed })
    })
    // stable order: higher count/viewers first
    arr.sort((a, b) => (Number(b.embed.count || 0) || 0) - (Number(a.embed.count || 0) || 0))
    return arr
  }, [availableEmbeds, selectedEmbedKeys])

  const toggleEmbed = useCallback((key: string) => {
    setSelectedEmbedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

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

      return (
        <div key={item.key} className="card bg-base-200 shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="p-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-base-content/60 uppercase">{platform}</div>
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
    [autoplay, bannedEmbeds, mute, toggleEmbed],
  )

  const embedsList = useMemo(() => {
    const items = Array.from(availableEmbeds.entries()).map(([key, embed]) => ({ key, embed }))
    items.sort((a, b) => {
      // Sort by number of embeds (count) first; fall back to viewers if count is missing.
      const av = Number(a.embed.count ?? a.embed.mediaItem?.metadata?.viewers ?? 0) || 0
      const bv = Number(b.embed.count ?? b.embed.mediaItem?.metadata?.viewers ?? 0) || 0
      return bv - av
    })
    return items
  }, [availableEmbeds])

  const gridCols = useMemo(() => {
    return getBestGridColumns({
      count: selectedEmbeds.length,
      width: gridHostSize.width,
      height: gridHostSize.height,
    })
  }, [gridHostSize.height, gridHostSize.width, selectedEmbeds.length])

  return (
    // Use viewport height and prevent page-level scrolling. All scrolling happens inside panes.
    <div className="h-screen bg-base-100 text-base-content flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="navbar bg-base-200 border-b border-base-300">
        <div className="flex-1 gap-2">
          <button className="btn btn-ghost btn-sm" onClick={onBackToMenu}>
            Back
          </button>
          <div className="font-bold">Omni Screen</div>
          <div className="text-xs text-base-content/60">
            live:{' '}
            <span className={liveConnected ? 'text-success' : 'text-warning'}>
              {liveConnected ? 'connected' : 'disconnected'}
            </span>
            {liveLastError ? ` (${liveLastError})` : ''}
            {'  •  '}chat: <span className="text-success">embedded</span>
          </div>
        </div>
        <div className="flex-none gap-2">
          <button className={`btn btn-sm ${chatPaneOpen ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setChatPaneOpen(v => !v)}>
            {chatPaneOpen ? 'Hide Chat' : 'Show Chat'}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setChatPaneSide((s) => (s === 'left' ? 'right' : 'left'))}
            disabled={!chatPaneOpen}
            title="Move chat pane"
          >
            Chat: {chatPaneSide === 'left' ? 'Left' : 'Right'}
          </button>
          <label className="btn btn-sm btn-ghost gap-2">
            <input type="checkbox" className="toggle toggle-sm" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} />
            Autoplay
          </label>
          <label className="btn btn-sm btn-ghost gap-2">
            <input type="checkbox" className="toggle toggle-sm" checked={mute} onChange={(e) => setMute(e.target.checked)} />
            Mute
          </label>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left pane */}
        {chatPaneOpen && chatPaneSide === 'left' && (
          <>
            <div className="bg-base-200 border-r border-base-300 min-h-0 flex flex-col overflow-hidden" style={{ width: chatPaneWidth }}>
              <div className="p-2 border-b border-base-300 flex items-center gap-2">
                <div className="tabs tabs-boxed">
                  <button className={`tab ${sideTab === 'chat' ? 'tab-active' : ''}`} onClick={() => setSideTab('chat')}>
                    Chat
                  </button>
                  <button className={`tab ${sideTab === 'embeds' ? 'tab-active' : ''}`} onClick={() => setSideTab('embeds')}>
                    Embeds ({embedsList.length})
                  </button>
                </div>
              </div>

              {sideTab === 'chat' ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className="p-2 border-b border-base-300 flex items-center gap-2">
                    <button className="btn btn-xs btn-primary" onClick={openDestinyLogin}>
                      Login
                    </button>
                    <button className="btn btn-xs btn-ghost" onClick={() => setChatEmbedReload((v) => v + 1)}>
                      Reload
                    </button>
                    <div className="text-xs text-base-content/60">
                      Use the Login button (Discord can’t auth inside an iframe).
                    </div>
                  </div>
                  <iframe
                    src={chatEmbedSrc}
                    title="Destiny.gg Chat"
                    className="w-full h-full"
                    style={{ border: 'none' }}
                    allow="clipboard-read; clipboard-write"
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                  {embedsList.map(({ key, embed }) => {
                    const banned = bannedEmbeds.get(key)
                    const selected = selectedEmbedKeys.has(key)
                    const platform = embed.platform?.toLowerCase() || ''
                    const title = embed.mediaItem?.metadata?.title || embed.mediaItem?.metadata?.displayName || `${embed.platform}/${embed.id}`
                    const viewers = embed.mediaItem?.metadata?.viewers
                    const preview = embed.mediaItem?.metadata?.previewUrl
                    return (
                      <div key={key} className="card bg-base-100 shadow-sm">
                        <div className="card-body p-3">
                          <div className="flex items-center gap-3">
                            {preview ? (
                              <img src={preview} alt="" className="w-20 h-12 object-cover rounded" />
                            ) : (
                              <div className="w-20 h-12 bg-base-300 rounded" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs uppercase text-base-content/60">{platform}</div>
                              <div className="text-sm font-semibold truncate" title={title}>
                                {title}
                              </div>
                              <div className="text-xs text-base-content/60">
                                {typeof viewers === 'number' ? `${viewers.toLocaleString()} viewers` : null}
                                {typeof embed.count === 'number' ? `  •  ${embed.count} embeds` : null}
                                {banned ? `  •  banned` : null}
                              </div>
                            </div>
                            <button
                              className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-outline'}`}
                              onClick={() => toggleEmbed(key)}
                              disabled={Boolean(banned)}
                              title={banned ? `Banned: ${banned.reason || 'no reason'}` : ''}
                            >
                              {selected ? 'On' : 'Off'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div
              className="w-1 cursor-col-resize bg-base-300 hover:bg-base-content/20 transition-colors"
              onPointerDown={startResize}
              title="Drag to resize"
            />
          </>
        )}

        {/* Center grid */}
        <div ref={gridHostRef} className="flex-1 min-w-0 min-h-0 p-3 overflow-hidden relative">
          {/* 50% transparent background behind embeds */}
          <div
            className="absolute inset-0 opacity-50 pointer-events-none bg-center bg-no-repeat bg-cover"
            style={{ backgroundImage: `url(${danTheBuilderBg})` }}
          />
          <div className="relative z-10 h-full min-h-0">
          {selectedEmbeds.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-xl font-bold mb-2">No embeds selected</div>
                <div className="text-base-content/70">Open the Embeds tab and toggle streams on.</div>
              </div>
            </div>
          ) : (
            (() => {
              const rows = Math.max(1, Math.ceil(selectedEmbeds.length / Math.max(1, gridCols)))
              return (
            <div
              className="grid gap-3 h-full min-h-0"
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
              <div className="p-2 border-b border-base-300 flex items-center gap-2">
                <div className="tabs tabs-boxed">
                  <button className={`tab ${sideTab === 'chat' ? 'tab-active' : ''}`} onClick={() => setSideTab('chat')}>
                    Chat
                  </button>
                  <button className={`tab ${sideTab === 'embeds' ? 'tab-active' : ''}`} onClick={() => setSideTab('embeds')}>
                    Embeds ({embedsList.length})
                  </button>
                </div>
              </div>

              {sideTab === 'chat' ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <div className="p-2 border-b border-base-300 flex items-center gap-2">
                    <button className="btn btn-xs btn-primary" onClick={openDestinyLogin}>
                      Login
                    </button>
                    <button className="btn btn-xs btn-ghost" onClick={() => setChatEmbedReload((v) => v + 1)}>
                      Reload
                    </button>
                    <div className="text-xs text-base-content/60">
                      Use the Login button (Discord can’t auth inside an iframe).
                    </div>
                  </div>
                  <iframe
                    src={chatEmbedSrc}
                    title="Destiny.gg Chat"
                    className="w-full h-full"
                    style={{ border: 'none' }}
                    allow="clipboard-read; clipboard-write"
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                  {embedsList.map(({ key, embed }) => {
                    const banned = bannedEmbeds.get(key)
                    const selected = selectedEmbedKeys.has(key)
                    const platform = embed.platform?.toLowerCase() || ''
                    const title = embed.mediaItem?.metadata?.title || embed.mediaItem?.metadata?.displayName || `${embed.platform}/${embed.id}`
                    const viewers = embed.mediaItem?.metadata?.viewers
                    const preview = embed.mediaItem?.metadata?.previewUrl
                    return (
                      <div key={key} className="card bg-base-100 shadow-sm">
                        <div className="card-body p-3">
                          <div className="flex items-center gap-3">
                            {preview ? (
                              <img src={preview} alt="" className="w-20 h-12 object-cover rounded" />
                            ) : (
                              <div className="w-20 h-12 bg-base-300 rounded" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs uppercase text-base-content/60">{platform}</div>
                              <div className="text-sm font-semibold truncate" title={title}>
                                {title}
                              </div>
                              <div className="text-xs text-base-content/60">
                                {typeof viewers === 'number' ? `${viewers.toLocaleString()} viewers` : null}
                                {typeof embed.count === 'number' ? `  •  ${embed.count} embeds` : null}
                                {banned ? `  •  banned` : null}
                              </div>
                            </div>
                            <button
                              className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-outline'}`}
                              onClick={() => toggleEmbed(key)}
                              disabled={Boolean(banned)}
                              title={banned ? `Banned: ${banned.reason || 'no reason'}` : ''}
                            >
                              {selected ? 'On' : 'Off'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

