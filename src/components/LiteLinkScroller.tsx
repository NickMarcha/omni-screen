import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { LinkCardOverviewCard, LinkCardExpandedContent } from './LinkScroller'
import type { LinkCard } from './LinkScroller'
import type { PlatformDisplayMode } from './LinkScroller'
import autoplayIcon from '../assets/icons/autoplay.png'
import autoplayPausedIcon from '../assets/icons/autoplay-paused.png'

const LOG_PREFIX = '[LiteLinkScroller]'

const DEFAULT_PLATFORM_SETTINGS: Record<string, PlatformDisplayMode> = {
  YouTube: 'embed',
  Twitter: 'embed',
  TikTok: 'embed',
  Reddit: 'embed',
  Kick: 'embed',
  Twitch: 'embed',
  Streamable: 'embed',
  Imgur: 'embed',
  Wikipedia: 'embed',
  Bluesky: 'embed',
  LSF: 'embed',
}

export interface LiteLinkScrollerSettings {
  maxMessages: number
  autoScroll: boolean
  autoplay: boolean
  mute: boolean
  /** Seconds before auto-advancing to next card when current card has no end event (e.g. YouTube, TikTok). Default 10. */
  autoAdvanceSeconds: number
}

interface LiteLinkScrollerProps {
  open: boolean
  onClose: () => void
  cards: LinkCard[]
  settings: LiteLinkScrollerSettings
  onSettingsChange?: (partial: Partial<LiteLinkScrollerSettings>) => void
  onOpenLink?: (url: string) => void
  getEmbedTheme: () => 'light' | 'dark'
  onOpenSettings?: () => void
}

export function LiteLinkScroller({
  open,
  onClose,
  cards,
  settings,
  onSettingsChange,
  onOpenLink,
  getEmbedTheme,
  onOpenSettings,
}: LiteLinkScrollerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const programmaticScrollRef = useRef(false)
  /** Timestamp (ms) when we last started a programmatic scroll. Scroll events are ignored for a while after this. */
  const programmaticScrollStartedAtRef = useRef<number>(0)
  const timerEndsAtRef = useRef<number | null>(null)
  const prevCardsLengthRef = useRef(0)
  const [autoAdvanceTimeLeft, setAutoAdvanceTimeLeft] = useState<number | null>(null)
  const [autoAdvanceProgress, setAutoAdvanceProgress] = useState<number | null>(null)

  // Cards are ordered old to new (index 0 = oldest, last = newest). Track by card id (from messageId + url) so position survives list changes and autoplay toggle.
  const [currentPlayingCardId, setCurrentPlayingCardId] = useState<string | null>(null)
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; card: LinkCard } | null>(null)

  const currentPlayingIndex = currentPlayingCardId != null ? cards.findIndex((c) => c.id === currentPlayingCardId) : -1
  const currentCard = currentPlayingIndex >= 0 ? cards[currentPlayingIndex] ?? null : null

  // When autoplay + autoScroll: init or resume by id. When off, keep id so toggling back on continues from same card.
  useEffect(() => {
    if (cards.length === 0) {
      console.log(LOG_PREFIX, 'init/resume: cards empty -> set currentPlayingCardId to null')
      setCurrentPlayingCardId(null)
      prevCardsLengthRef.current = 0
      return
    }
    if (!settings.autoplay || !settings.autoScroll) return
    const prevLen = prevCardsLengthRef.current
    prevCardsLengthRef.current = cards.length
    setCurrentPlayingCardId((prevId) => {
      if (prevId != null) {
        const idx = cards.findIndex((c) => c.id === prevId)
        if (idx >= 0) {
          console.log(LOG_PREFIX, 'init/resume: keeping current card', { prevId: prevId.slice(0, 40), index: idx, cardsLength: cards.length })
          return prevId
        }
        if (cards.length > 0) {
          const fallback = cards[cards.length - 1].id
          console.log(LOG_PREFIX, 'init/resume: prevId not in list -> clamp to last', { prevId: prevId.slice(0, 40), newId: fallback.slice(0, 40), cardsLength: cards.length })
          return fallback
        }
      }
      if (cards.length > prevLen) {
        const newId = cards[cards.length - 1].id
        console.log(LOG_PREFIX, 'init/resume: new link arrived (waiting) -> play newest', { prevLen, cardsLength: cards.length, newId: newId.slice(0, 40) })
        return newId
      }
      const startId = cards[0].id
      console.log(LOG_PREFIX, 'init/resume: start from oldest', { startId: startId.slice(0, 40), cardsLength: cards.length })
      return startId
    })
  }, [settings.autoplay, settings.autoScroll, cards])

  // Advance to next card (down the list = newer). When at end, go to waiting.
  const advanceToNext = useCallback(() => {
    setCurrentPlayingCardId((prevId) => {
      if (prevId == null) {
        console.log(LOG_PREFIX, 'advanceToNext: already null, no-op')
        return null
      }
      const idx = cards.findIndex((c) => c.id === prevId)
      if (idx < 0) {
        console.log(LOG_PREFIX, 'advanceToNext: prevId not in list -> waiting', { prevId: prevId.slice(0, 40), cardsLength: cards.length })
        return null
      }
      if (idx >= cards.length - 1) {
        console.log(LOG_PREFIX, 'advanceToNext: at last card -> waiting for next link', { prevId: prevId.slice(0, 40), index: idx, cardsLength: cards.length })
        return null
      }
      const nextId = cards[idx + 1].id
      console.log(LOG_PREFIX, 'advanceToNext: next card', { fromIndex: idx, toIndex: idx + 1, nextId: nextId.slice(0, 40), cardsLength: cards.length })
      return nextId
    })
  }, [cards])

  // Scroll the given card into view. Use block: 'center' so the active card is centered and scroll direction is consistent.
  const PROGRAMMATIC_SCROLL_IGNORE_MS = 1500
  const scrollCardIntoView = useCallback((card: LinkCard | null, smooth = true) => {
    if (!card) return
    programmaticScrollRef.current = true
    programmaticScrollStartedAtRef.current = Date.now()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = cardRefs.current.get(card.id)
        if (el) {
          el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center', inline: 'nearest' })
        }
        setTimeout(() => {
          programmaticScrollRef.current = false
        }, 500)
      })
    })
  }, [])

  // Whenever the playing card changes (or when autoplay turns on), scroll that card into view.
  useEffect(() => {
    if (!settings.autoplay || !settings.autoScroll || !currentCard) return
    scrollCardIntoView(currentCard, true)
  }, [currentPlayingCardId, settings.autoplay, settings.autoScroll, currentCard, scrollCardIntoView])

  // When the active card's height changes (e.g. Twitter/Reddit embed finishes loading), re-scroll it into view.
  useEffect(() => {
    if (!settings.autoplay || !settings.autoScroll || !currentCard) return
    const el = cardRefs.current.get(currentCard.id)
    if (!el) return
    let scrollTimeout: ReturnType<typeof setTimeout> | null = null
    const ro = new ResizeObserver(() => {
      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        scrollTimeout = null
        programmaticScrollRef.current = true
        programmaticScrollStartedAtRef.current = Date.now()
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        setTimeout(() => {
          programmaticScrollRef.current = false
        }, 500)
      }, 150)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [currentPlayingCardId, settings.autoplay, settings.autoScroll, currentCard])

  // If user scrolls up while autoplay/autoScroll is on, disable both (user interrupted).
  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return
    const elapsed = Date.now() - programmaticScrollStartedAtRef.current
    if (elapsed < PROGRAMMATIC_SCROLL_IGNORE_MS) return
    const el = scrollRef.current
    if (!el || (!settings.autoplay && !settings.autoScroll)) return
    const threshold = 24
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold
    if (!atBottom) {
      console.log(LOG_PREFIX, 'handleScroll: user scrolled up -> turning off autoplay and autoScroll', {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        distanceFromBottom: el.scrollHeight - el.clientHeight - el.scrollTop,
        threshold,
      })
      onSettingsChange?.({ autoScroll: false, autoplay: false })
    }
  }, [settings.autoplay, settings.autoScroll, onSettingsChange])

  const handleCardEnded = useCallback(() => {
    console.log(LOG_PREFIX, 'handleCardEnded: video ended -> advanceToNext', { currentPlayingCardId: currentPlayingCardId?.slice(0, 40) })
    advanceToNext()
  }, [advanceToNext, currentPlayingCardId])

  const handleSkip = useCallback(() => {
    setCurrentPlayingCardId((prevId) => {
      if (prevId == null) return null
      const idx = cards.findIndex((c) => c.id === prevId)
      if (idx < 0 || idx >= cards.length - 1) {
        console.log(LOG_PREFIX, 'handleSkip: at last or not in list -> waiting', { prevId: prevId.slice(0, 40), index: idx, cardsLength: cards.length })
        return null
      }
      const nextId = cards[idx + 1].id
      console.log(LOG_PREFIX, 'handleSkip: skip to next', { fromIndex: idx, toIndex: idx + 1, nextId: nextId.slice(0, 40) })
      return nextId
    })
  }, [cards])

  const handleContextMenu = useCallback((e: React.MouseEvent, card: LinkCard) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, card })
  }, [])
  const handleStartAutoscrollFromHere = useCallback((card: LinkCard) => {
    setCurrentPlayingCardId(card.id)
    onSettingsChange?.({ autoplay: true, autoScroll: true })
    scrollCardIntoView(card, true)
    setContextMenu(null)
  }, [onSettingsChange, scrollCardIntoView])

  // For cards without end event (YouTube, TikTok, etc.): auto-advance after autoAdvanceSeconds. Also tick progress for the bar.
  useEffect(() => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current)
      autoAdvanceTimerRef.current = null
      console.log(LOG_PREFIX, 'timer effect: cleared previous timeout (effect re-run)')
    }
    timerEndsAtRef.current = null
    setAutoAdvanceTimeLeft(null)
    setAutoAdvanceProgress(null)
    if (!settings.autoplay || !settings.autoScroll || !currentCard) {
      if (settings.autoplay && settings.autoScroll && !currentCard) console.log(LOG_PREFIX, 'timer effect: no currentCard, not starting timer', { currentPlayingCardId: currentPlayingCardId?.slice(0, 40), cardsLength: cards.length })
      return
    }
    const hasNativeEndEvent = currentCard.isDirectMedia && currentCard.mediaType === 'video'
    if (hasNativeEndEvent) return
    const sec = Math.max(1, Math.min(120, settings.autoAdvanceSeconds ?? 10))
    const durationMs = sec * 1000
    const endsAt = Date.now() + durationMs
    timerEndsAtRef.current = endsAt
    setAutoAdvanceTimeLeft(sec)
    setAutoAdvanceProgress(1)
    console.log(LOG_PREFIX, 'timer effect: started auto-advance timer', { cardId: currentCard.id.slice(0, 40), seconds: sec })
    autoAdvanceTimerRef.current = setTimeout(() => {
      console.log(LOG_PREFIX, 'auto-advance timer fired -> advanceToNext', { cardId: currentCard.id.slice(0, 40), cardsLength: cards.length })
      autoAdvanceTimerRef.current = null
      timerEndsAtRef.current = null
      setAutoAdvanceTimeLeft(null)
      setAutoAdvanceProgress(null)
      advanceToNext()
    }, durationMs)
    const intervalId = setInterval(() => {
      const remaining = Math.max(0, (timerEndsAtRef.current ?? 0) - Date.now())
      const progress = durationMs > 0 ? remaining / durationMs : 0
      setAutoAdvanceProgress(progress)
      setAutoAdvanceTimeLeft(Math.ceil(remaining / 1000))
    }, 200)
    return () => {
      clearInterval(intervalId)
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current)
        autoAdvanceTimerRef.current = null
      }
      timerEndsAtRef.current = null
    }
  }, [settings.autoplay, settings.autoScroll, currentPlayingCardId, currentCard, settings.autoAdvanceSeconds, advanceToNext])

  // If current card id is no longer in the list (e.g. max messages reduced), clear or clamp to last.
  useEffect(() => {
    if (currentPlayingCardId == null) return
    const idx = cards.findIndex((c) => c.id === currentPlayingCardId)
    if (idx >= 0) return
    if (cards.length > 0) {
      const newId = cards[cards.length - 1].id
      console.log(LOG_PREFIX, 'card no longer in list: clamp to last', { oldId: currentPlayingCardId.slice(0, 40), newId: newId.slice(0, 40), cardsLength: cards.length })
      setCurrentPlayingCardId(newId)
    } else {
      console.log(LOG_PREFIX, 'card no longer in list: no cards -> null', { oldId: currentPlayingCardId.slice(0, 40) })
      setCurrentPlayingCardId(null)
    }
  }, [cards, currentPlayingCardId])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const onPointer = () => setContextMenu(null)
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('scroll', onPointer, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('scroll', onPointer, true)
    }
  }, [contextMenu])

  if (!open) return null

  const emotesMap = new Map<string, string>()
  const footerDisplay = { showPlatformLabel: true, platformColorStyle: 'tint' as const, timestampDisplay: 'timestamp' as const }

  return (
    <div className="flex flex-col h-full w-full min-w-0 bg-base-200">
      {/* Top bar: Settings, card count, Close */}
      <div className="flex-none flex items-center justify-between gap-2 px-2 py-1.5 border-b border-base-300">
        <div className="flex items-center gap-1">
          {onOpenSettings && (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              title="Lite link scroller settings"
              onClick={onOpenSettings}
            >
              <Icon name="settings" size={16} />
            </button>
          )}
        </div>
        <span className="text-xs text-base-content/60 truncate flex-1 min-w-0 text-center">
          {cards.length} link{cards.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="btn btn-xs btn-ghost btn-square"
          title="Close"
          onClick={onClose}
          aria-label="Close lite link scroller"
        >
          ×
        </button>
      </div>

      {/* One-column scrollable list: old to new (top to bottom). Scroll up disables autoplay/auto-scroll. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2" onScroll={handleScroll}>
        <div className="flex flex-col gap-3 max-w-full">
          {cards.length === 0 ? (
            <div className="text-sm text-base-content/50 text-center py-8">No links yet. Links from chat will appear here.</div>
          ) : (
            cards.map((card) => {
              const isActive = settings.autoplay && settings.autoScroll && card.id === currentPlayingCardId
              const cardEmbedOverrides =
                settings.autoplay && settings.autoScroll
                  ? {
                      autoplay: isActive,
                      muted: isActive ? settings.mute : true,
                      onEnded: isActive && card.isDirectMedia && card.mediaType === 'video' ? handleCardEnded : undefined,
                    }
                  : undefined

              return (
                <div
                  key={card.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(card.id, el)
                    else cardRefs.current.delete(card.id)
                  }}
                  className={`flex-shrink-0 rounded-lg transition-[box-shadow] ${isActive ? 'ring-2 ring-primary ring-offset-2 ring-offset-base-200' : ''}`}
                >
                  <LinkCardOverviewCard
                    card={card}
                    onCardClick={(cardId) => setExpandedCardId(cardId)}
                    onOpenLink={onOpenLink}
                    onContextMenu={handleContextMenu}
                    getEmbedTheme={getEmbedTheme}
                    platformSettings={DEFAULT_PLATFORM_SETTINGS}
                    emotesMap={emotesMap}
                    footerDisplay={footerDisplay}
                    cardEmbedOverrides={cardEmbedOverrides}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Bottom bar: fixed height. Autoplay, Mute, Skip, timer input; one status line (left-aligned); progress bar. */}
      <div className="flex-none border-t border-base-300 px-2 py-2 flex flex-col gap-2 min-h-[72px]">
        <div className="flex items-center gap-2 flex-wrap min-h-6">
          <button
            type="button"
            className={`btn btn-xs btn-square btn-ghost min-h-0 p-0 ${settings.autoplay ? 'btn-primary' : ''}`}
            title="Autoplay: enables auto-scroll and plays from oldest downward. Scroll up to pause."
            onClick={() => {
              if (settings.autoplay) {
                onSettingsChange?.({ autoplay: false })
              } else {
                onSettingsChange?.({ autoplay: true, autoScroll: true })
              }
            }}
            aria-label="Toggle autoplay"
          >
            <span
              className="w-5 h-5 inline-block bg-base-content"
              style={{
                maskImage: `url(${settings.autoplay ? autoplayIcon : autoplayPausedIcon})`,
                WebkitMaskImage: `url(${settings.autoplay ? autoplayIcon : autoplayPausedIcon})`,
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
            className={`btn btn-xs btn-ghost ${settings.mute ? 'btn-primary' : ''}`}
            title="Mute"
            onClick={() => onSettingsChange?.({ mute: !settings.mute })}
          >
            <Icon name={settings.mute ? 'volume-x' : 'volume-2'} size={16} />
          </button>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            title={currentCard && currentPlayingIndex >= cards.length - 1 && cards.length > 0 ? 'End current and wait for next link' : 'Skip to next'}
            onClick={handleSkip}
            disabled={currentPlayingCardId == null && cards.length > 0}
            aria-label="Skip to next"
          >
            Skip
          </button>
          {settings.autoplay && settings.autoScroll && (
            <>
              <label className="text-xs text-base-content/60 shrink-0">Timer (s)</label>
              <input
                type="number"
                min={1}
                max={120}
                className="input input-xs w-14 text-center"
                value={settings.autoAdvanceSeconds}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value))
                  if (Number.isFinite(n) && n >= 1) onSettingsChange?.({ autoAdvanceSeconds: Math.min(120, n) })
                }}
                title="Seconds before advancing to next card (for embeds without end event)"
              />
            </>
          )}
        </div>
        <div className="min-h-[1.25rem] flex items-center text-left text-xs text-base-content/60">
          {settings.autoplay && settings.autoScroll && currentPlayingCardId === null && cards.length > 0
            ? 'Waiting for next link…'
            : autoAdvanceProgress != null && autoAdvanceTimeLeft != null && settings.autoplay && settings.autoScroll && currentCard
              ? `Next in ${autoAdvanceTimeLeft}s`
              : '\u00A0'}
        </div>
        <progress
          className="progress progress-primary w-full h-2 flex-shrink-0"
          value={autoAdvanceProgress != null && settings.autoplay && settings.autoScroll && currentCard ? (autoAdvanceProgress ?? 0) : 1}
          max={1}
          title={autoAdvanceTimeLeft != null ? `Time until next card: ${autoAdvanceTimeLeft}s` : 'No timer running'}
        />
      </div>

      {/* Context menu: Start autoscroll from here */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-base-200 border border-base-300 rounded-lg shadow-xl py-2 min-w-[200px]"
          style={{ left: contextMenu.x, top: contextMenu.y, zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
            onClick={() => handleStartAutoscrollFromHere(contextMenu.card)}
          >
            Start autoscroll from here
          </button>
        </div>
      )}

      {/* Expand modal (same as LinkScroller) */}
      {expandedCardId && (() => {
        const card = cards.find((c) => c.id === expandedCardId)
        if (!card) return null
        return createPortal(
          <div className="modal modal-open z-[100]" role="dialog" aria-modal="true">
            <div className="modal-box max-w-6xl w-11/12 max-h-[90vh] overflow-hidden flex flex-col p-0">
              <div className="flex flex-1 min-h-0 overflow-hidden">
                <LinkCardExpandedContent
                  card={card}
                  getEmbedTheme={getEmbedTheme}
                  emotesMap={emotesMap}
                  onOpenLink={onOpenLink}
                  footerDisplay={footerDisplay}
                />
              </div>
              <div className="modal-action flex-shrink-0 p-4">
                <button type="button" className="btn btn-primary" onClick={() => setExpandedCardId(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="modal-backdrop" onClick={() => setExpandedCardId(null)} aria-hidden="true" />
          </div>,
          document.body
        )
      })()}
    </div>
  )
}
