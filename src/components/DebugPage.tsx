import { useState, useCallback, useMemo, useEffect, Fragment } from 'react'
import PollView from './PollView'
import type { PollData as PollViewPollData } from './PollView'
import {
  LinkCardOverviewCard,
  LinkCardExpandedContent,
  getPlatformLabel,
  getPlatformFooterColor,
  getLinkCardEmbedFieldsFromUrl,
  extractUrls,
  type LinkCard,
} from './LinkScroller'
import { getAppPreferences } from '../utils/appPreferences'
import { renderPrimaryChatMessageContent, renderTextWithLinks, escapeRegexLiteral, type ChatFormattingOptions } from '../utils/chatFormatting'
import { renderKickContent, type KickChatMessage } from './CombinedChat'
import { loadCSSNoCache } from '../utils/loadCss'
import { chatWsOn, CHAT_HTTP_PROXY_BASE } from '../utils/chatWsClient'
import {
  getPrimaryChatRendererCounters,
  resetPrimaryChatRendererCounters,
  type PrimaryChatRendererCounters,
} from '../utils/primaryChatDebugCounters'

const STORAGE_KEY_POLL = 'omni-screen:debug-poll'
const STORAGE_KEY_POLL_OVER = 'omni-screen:debug-poll-over'
const STORAGE_KEY_CARD = 'omni-screen:debug-card'

export interface DebugPollData extends PollViewPollData {}

const defaultPollData: DebugPollData = {
  canvote: true,
  myvote: 0,
  nick: 'Streamer',
  weighted: false,
  start: new Date().toISOString(),
  now: new Date().toISOString(),
  time: 15000, // duration in ms (15 s), matches POLLSTART
  question: 'Sample poll question?',
  options: ['Option A', 'Option B', 'Option C'],
  totals: [10, 25, 5],
  totalvotes: 40,
}

export interface DebugCardData {
  messageText: string
  nick: string
  platform: string
  /** @deprecated URL is now derived from message text; kept for localStorage backward compat */
  url?: string
}

const defaultCardData: DebugCardData = {
  messageText: 'Check out this link https://example.com',
  nick: 'ViewerName',
  platform: 'dgg',
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const parsed = JSON.parse(raw) as T
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

function saveOnBlur(key: string, data: object) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ignore
  }
}

function getSampleRawPreview(source: string, type: string, s: unknown): string {
  if (source === 'primary-chat' && type === 'MSG') {
    const m = s as { data?: string; nick?: string }
    return String(m?.data ?? '').slice(0, 120) || '(empty)'
  }
  if (source === 'primary-chat' && type === 'HISTORY') {
    const h = s as { type?: string; raw?: { data?: string }; rawStr?: string }
    if (h?.raw?.data) return String(h.raw.data).slice(0, 120)
    return h?.rawStr ?? JSON.stringify(h).slice(0, 120)
  }
  if (source === 'kick' && type === 'ChatMessageEvent') {
    const k = s as { content?: string }
    return String(k?.content ?? '').slice(0, 120) || '(empty)'
  }
  if (source === 'youtube' && type === 'liveChatTextMessageRenderer') {
    const y = s as { message?: { runs?: Array<{ text?: string }> }; runs?: Array<{ text?: string }> }
    const runs = y?.runs ?? y?.message?.runs ?? []
    const text = runs.map((r) => r?.text ?? '').join('')
    return text.slice(0, 120) || '(empty)'
  }
  if (source === 'twitch' && type === 'PRIVMSG') {
    const t = s as { raw?: string; preview?: string }
    const raw = t?.raw ?? t?.preview ?? ''
    const msg = raw.includes(' :') ? raw.split(' :').slice(1).join(' :') : raw
    return String(msg).slice(0, 120) || raw.slice(0, 120)
  }
  return JSON.stringify(s).slice(0, 120)
}

function collectNicksFromSamples(samples: Record<string, Record<string, unknown[]>>): string[] {
  const nicks = new Set<string>()
  const pc = samples['primary-chat']
  if (pc?.MSG) {
    for (const m of pc.MSG as { nick?: string }[]) {
      if (m?.nick) nicks.add(String(m.nick))
    }
  }
  if (pc?.NAMES) {
    for (const n of pc.NAMES as { raw?: { users?: { nick?: string }[] } }[]) {
      const users = n?.raw?.users ?? []
      for (const u of users) {
        if (u?.nick) nicks.add(String(u.nick))
      }
    }
  }
  return Array.from(nicks)
}

function renderSample(
  source: string,
  type: string,
  s: unknown,
  ctx: {
    debugEmotePattern: RegExp | null
    debugEmotesMap: Map<string, string>
    chatFormattingOptions: ChatFormattingOptions
    primaryChatNicks: string[]
  },
): React.ReactNode {
  const linkOpts = {
    emotePattern: ctx.debugEmotePattern,
    emotesMap: ctx.debugEmotesMap,
    options: ctx.chatFormattingOptions,
  }
  if (source === 'primary-chat' && type === 'MSG') {
    const m = s as { data?: string; nick?: string }
    const content = String(m?.data ?? '')
    return (
      <span className="whitespace-pre-wrap break-words">
        {renderPrimaryChatMessageContent({
          content,
          primaryChatNicks: ctx.primaryChatNicks,
          ...linkOpts,
        })}
      </span>
    )
  }
  if (source === 'primary-chat' && type === 'HISTORY') {
    const h = s as { type?: string; raw?: { data?: string } }
    if (h?.type === 'MSG' || h?.type === 'BROADCAST') {
      const content = String(h?.raw?.data ?? '')
      return (
        <span className="whitespace-pre-wrap break-words">
          {renderPrimaryChatMessageContent({ content, primaryChatNicks: ctx.primaryChatNicks, ...linkOpts })}
        </span>
      )
    }
    return <span className="text-base-content/50">—</span>
  }
  if (source === 'kick' && type === 'ChatMessageEvent') {
    const k = s as { content?: string; raw?: KickChatMessage }
    const msg = (k?.raw ?? k) as KickChatMessage
    const parts = renderKickContent(msg).map((node, i) => (
      <Fragment key={i}>{node}</Fragment>
    ))
    return <span className="whitespace-pre-wrap break-words">{parts}</span>
  }
  if (source === 'youtube' && type === 'liveChatTextMessageRenderer') {
    const y = s as { runs?: Array<{ text?: string; emojiId?: string; imageUrl?: string }>; message?: { runs?: Array<{ text?: string }> } }
    const runs = y?.runs ?? y?.message?.runs ?? []
    if (runs.length === 0) {
      return <span className="text-base-content/50">(no runs)</span>
    }
    const parts = runs.map((r, i) => {
      const run = r as { text?: string; emojiId?: string; imageUrl?: string }
      if (run.text) {
        return (
          <Fragment key={i}>
            {renderTextWithLinks({ text: run.text, ...linkOpts })}
          </Fragment>
        )
      }
      if (run.imageUrl) {
        return (
          <img
            key={i}
            src={run.imageUrl}
            alt={String(run.emojiId ?? '')}
            className="inline-block align-middle mx-0.5"
            style={{ height: 20, width: 'auto' }}
          />
        )
      }
      return null
    })
    return <span className="whitespace-pre-wrap break-words">{parts}</span>
  }
  if (source === 'twitch' && type === 'PRIVMSG') {
    const t = s as { raw?: string; preview?: string }
    const raw = t?.raw ?? t?.preview ?? ''
    const msg = raw.includes(' :') ? raw.split(' :').slice(1).join(' :') : raw
    return (
      <span className="whitespace-pre-wrap break-words">
        {renderTextWithLinks({ text: msg, ...linkOpts })}
      </span>
    )
  }
  return <span className="text-base-content/50">—</span>
}

interface DebugPageProps {
  onBackToMenu: () => void
}

export default function DebugPage({ onBackToMenu }: DebugPageProps) {
  const [pollData, setPollData] = useState<DebugPollData>(() => loadJson(STORAGE_KEY_POLL, defaultPollData))
  const [pollOver, setPollOver] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_POLL_OVER) === 'true'
    } catch {
      return false
    }
  })
  const [secondsLeftInput, setSecondsLeftInput] = useState('')
  const [cardData, setCardData] = useState<DebugCardData>(() => loadJson(STORAGE_KEY_CARD, defaultCardData))
  const [chatSamples, setChatSamples] = useState<Record<string, Record<string, unknown[]>> | null>(null)
  const [prettifiedRawKeys, setPrettifiedRawKeys] = useState<Set<string>>(new Set())
  const [customMessage, setCustomMessage] = useState('')
  const [mainCounters, setMainCounters] = useState<{ mainReceived: number; mainBroadcastDroppedNoClients: number; mainBroadcastSent: number } | null>(null)
  const [rendererCounters, setRendererCounters] = useState<PrimaryChatRendererCounters | null>(null)

  const savePoll = useCallback(() => {
    saveOnBlur(STORAGE_KEY_POLL, pollData)
  }, [pollData])

  const saveCard = useCallback(() => {
    saveOnBlur(STORAGE_KEY_CARD, cardData)
  }, [cardData])

  useEffect(() => {
    const load = async () => {
      if (window.ipcRenderer?.invoke) {
        const data = await window.ipcRenderer.invoke('get-chat-samples').catch(() => null)
        if (data) {
          setChatSamples(data)
          return
        }
      }
      try {
        const res = await fetch('/chat-samples.json')
        if (res.ok) {
          const data = await res.json()
          setChatSamples(data)
        }
      } catch {
        // fallback: use embedded minimal samples
        setChatSamples({
          'primary-chat': {
            MSG: [
              { data: 'hello world', nick: 'User', subtype: 'plain' },
              { data: 'check https://youtube.com/watch?v=dQw4w9WgXcQ', nick: 'User', subtype: 'link' },
              { data: '>greentext line', nick: 'User', subtype: 'greentext' },
              { data: '\u0D9Esuspost line', nick: 'User', subtype: 'suspost' },
            ],
          },
        })
      }
    }
    load()
  }, [])

  const refreshPrimaryChatCounters = useCallback(async () => {
    const main = await window.ipcRenderer?.invoke?.('get-primary-chat-debug-counters').catch(() => null)
    if (main) setMainCounters(main)
    setRendererCounters(getPrimaryChatRendererCounters())
  }, [])

  useEffect(() => {
    const interval = setInterval(refreshPrimaryChatCounters, 1000)
    refreshPrimaryChatCounters()
    return () => clearInterval(interval)
  }, [refreshPrimaryChatCounters])

  const resetPrimaryChatCounters = useCallback(async () => {
    await window.ipcRenderer?.invoke?.('reset-primary-chat-debug-counters').catch(() => {})
    resetPrimaryChatRendererCounters()
    refreshPrimaryChatCounters()
  }, [refreshPrimaryChatCounters])

  const cardDate = Date.now()
  const pollOptions = pollData.options.length > 0 ? pollData.options : ['']
  const pollTotals = pollData.totals.length >= pollOptions.length
    ? pollData.totals
    : [...pollData.totals, ...Array(pollOptions.length - pollData.totals.length).fill(0)]
  const defaultPlatformSettings: Record<string, 'embed' | 'text' | 'filter'> = {
    YouTube: 'embed', Twitter: 'embed', TikTok: 'embed', Reddit: 'embed', Kick: 'embed', Twitch: 'embed',
    Streamable: 'embed', Imgur: 'embed', Wikipedia: 'embed', Bluesky: 'embed', LSF: 'embed',
  }
  const defaultFooterDisplay = { showPlatformLabel: true, platformColorStyle: 'tint' as const, timestampDisplay: 'datetimestamp' as const }
  const emotesMap = useMemo(() => new Map<string, string>(), [])
  const [debugEmotesMap, setDebugEmotesMap] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>()
    for (const e of ['LULW', 'dinkDonk', 'SWEATSTINY', 'OMEGALUL', 'POGGERS', 'KEK']) m.set(e, '')
    return m
  })
  const [debugEmotesConfigFromWs, setDebugEmotesConfigFromWs] = useState<{
    emotesJsonUrl: string
    emotesCssUrl: string
  } | null>(null)
  useEffect(() => {
    const handler = (_e: unknown, payload: unknown) => {
      const p = payload as { emotesJsonUrl?: string; emotesCssUrl?: string }
      if (p?.emotesJsonUrl && p?.emotesCssUrl) {
        setDebugEmotesConfigFromWs({ emotesJsonUrl: p.emotesJsonUrl, emotesCssUrl: p.emotesCssUrl })
      }
    }
    const unsub = chatWsOn('chat-emotes-config', handler)
    return () => unsub()
  }, [])
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      let emotesJsonUrl: string | undefined
      let emotesCssUrl: string | undefined
      if (debugEmotesConfigFromWs) {
        emotesJsonUrl = debugEmotesConfigFromWs.emotesJsonUrl
        emotesCssUrl = debugEmotesConfigFromWs.emotesCssUrl
      } else {
        const config = (await window.ipcRenderer?.invoke?.('get-app-config').catch(() => null)) as {
          chatSources?: Record<string, { emotesJsonUrl?: string; emotesCssUrl?: string }>
        } | null
        const primary = config?.chatSources ? Object.values(config.chatSources)[0] : undefined
        if (primary?.emotesJsonUrl && primary?.emotesCssUrl) {
          emotesJsonUrl = `${CHAT_HTTP_PROXY_BASE}/emotes.json`
          emotesCssUrl = `${CHAT_HTTP_PROXY_BASE}/emotes.css`
        }
      }
      if (!emotesJsonUrl || !emotesCssUrl) return
      const cacheKey = Date.now()
      try {
        const existing = document.getElementById('debug-chat-emotes-css')
        if (existing) existing.remove()
        await loadCSSNoCache(`${emotesCssUrl}?_=${cacheKey}`, 'debug-chat-emotes-css')
        const emotesRes = await fetch(`${emotesJsonUrl}?_=${cacheKey}`, { cache: 'no-store' })
        if (!emotesRes.ok) throw new Error(`Failed to fetch emotes: ${emotesRes.status}`)
        const emotesData: Array<{ prefix?: string; image?: unknown[] }> = await emotesRes.json()
        if (cancelled) return
        const map = new Map<string, string>()
        emotesData.forEach((emote) => {
          if (emote.image && emote.image.length > 0 && emote.prefix) map.set(emote.prefix, '')
        })
        setDebugEmotesMap(map)
      } catch {
        // Fallback: keep minimal emotesMap for common emotes (no images, but at least structure)
      }
    }
    run()
    return () => { cancelled = true }
  }, [debugEmotesConfigFromWs])
  const debugEmotePattern = useMemo(() => {
    if (debugEmotesMap.size === 0) return null
    const sorted = Array.from(debugEmotesMap.keys()).sort((a, b) => b.length - a.length)
    const pattern = `\\b(${sorted.map(escapeRegexLiteral).join('|')})\\b`
    try {
      return new RegExp(pattern, 'gi')
    } catch {
      return null
    }
  }, [debugEmotesMap])
  const chatFormattingOptions: ChatFormattingOptions = useMemo(
    () => ({ styleSensitiveLinks: true, normalizeUrls: true }),
    [],
  )
  const getEmbedTheme = useCallback(() => (getAppPreferences().theme.mode === 'dark' ? 'dark' : 'light'), [])
  const derivedUrl = useMemo(() => extractUrls(cardData.messageText)[0] ?? '', [cardData.messageText])
  const syntheticCard: LinkCard = useMemo(() => {
    const embedFields = getLinkCardEmbedFieldsFromUrl(derivedUrl)
    return {
      id: 'debug-card',
      messageId: `debug:channel:${cardDate}:${cardData.nick}`,
      text: cardData.messageText,
      nick: cardData.nick,
      date: cardDate,
      platform: cardData.platform as 'dgg' | 'kick',
      channel: cardData.platform === 'kick' ? 'channel' : 'Redacted',
      isTrusted: false,
      isStreaming: false,
      ...embedFields,
    }
  }, [cardData, cardDate, derivedUrl])

  return (
    <div className="min-h-full flex-1 bg-base-100 text-base-content flex flex-col overflow-hidden">
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-base-300">
        <h1 className="text-xl font-bold">Debug – Test renderings</h1>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onBackToMenu}>
          ← Back to menu
        </button>
      </div>
      <div className="flex-shrink-0 bg-warning/10 border-b border-warning/30 px-4 py-3">
        <p className="text-sm font-medium text-base-content">
          This page must not render any original components. Every preview uses shared components imported from other pages (PollView, LinkCardOverviewCard, LinkCardExpandedContent, getPlatformLabel, getPlatformFooterColor). Layout: <strong>settings/properties on the left</strong>, <strong>render on the right</strong>.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-12">
          {/* Poll test */}
          <section className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-lg">Poll (POLLSTART / POLLSTOP data)</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Settings / properties</p>
                  <p className="text-sm text-base-content/70">Edit fields (saved on blur, persisted across restarts).</p>
                  <label className="label label-text">Question</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={pollData.question}
                    onChange={(e) => setPollData((p) => ({ ...p, question: e.target.value }))}
                    onBlur={savePoll}
                  />
                  <label className="label label-text">Options (one per line)</label>
                  <textarea
                    className="textarea textarea-bordered w-full font-mono text-sm"
                    rows={4}
                    value={pollOptions.join('\n')}
                    onChange={(e) =>
                      setPollData((p) => ({
                        ...p,
                        options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    onBlur={savePoll}
                  />
                  <label className="label label-text">Totals (comma-separated numbers)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full font-mono"
                    value={pollTotals.join(', ')}
                    onChange={(e) =>
                      setPollData((p) => ({
                        ...p,
                        totals: e.target.value.split(',').map((s) => Math.max(0, parseInt(s.trim(), 10) || 0)),
                      }))
                    }
                    onBlur={savePoll}
                  />
                  <label className="label label-text">Total votes</label>
                  <input
                    type="number"
                    min={0}
                    className="input input-bordered w-full"
                    value={pollData.totalvotes}
                    onChange={(e) => setPollData((p) => ({ ...p, totalvotes: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                    onBlur={savePoll}
                  />
                  <label className="label label-text">Nick (poll creator)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={pollData.nick}
                    onChange={(e) => setPollData((p) => ({ ...p, nick: e.target.value }))}
                    onBlur={savePoll}
                  />
                  <label className="label label-text">Duration (s)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="input input-bordered w-full font-mono"
                    value={pollData.time / 1000}
                    onChange={(e) =>
                      setPollData((p) => ({ ...p, time: Math.max(0, parseFloat(e.target.value) || 0) * 1000 }))
                    }
                    onBlur={savePoll}
                  />
                  <label className="label label-text">Seconds left (for testing)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="input input-bordered w-full font-mono"
                    placeholder="e.g. 10"
                    value={secondsLeftInput}
                    onChange={(e) => setSecondsLeftInput(e.target.value)}
                    onBlur={() => {
                      const s = parseFloat(secondsLeftInput)
                      if (!Number.isFinite(s) || s < 0) return
                      setPollData((p) => {
                        const next = { ...p, start: new Date(Date.now() + s * 1000 - p.time).toISOString() }
                        saveOnBlur(STORAGE_KEY_POLL, next)
                        return next
                      })
                      setSecondsLeftInput('')
                    }}
                  />
                  <p className="text-xs text-base-content/50">Set and blur to show this many seconds left. All times in seconds.</p>
                  <div className="flex flex-wrap gap-4">
                    <label className="label cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={pollOver}
                        onChange={(e) => setPollOver(e.target.checked)}
                        onBlur={() => {
                        try {
                          localStorage.setItem(STORAGE_KEY_POLL_OVER, pollOver ? 'true' : 'false')
                        } catch {
                          // ignore
                        }
                      }}
                      />
                      <span className="label-text">Poll over (POLLSTOP received)</span>
                    </label>
                    <label className="label cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={pollData.canvote}
                        onChange={(e) => setPollData((p) => ({ ...p, canvote: e.target.checked }))}
                        onBlur={savePoll}
                      />
                      <span className="label-text">canvote</span>
                    </label>
                    <label className="label label-text">myvote</label>
                    <input
                      type="number"
                      min={0}
                      className="input input-bordered input-sm w-20"
                      value={pollData.myvote}
                      onChange={(e) => setPollData((p) => ({ ...p, myvote: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                      onBlur={savePoll}
                    />
                    <label className="label cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={pollData.weighted}
                        onChange={(e) => setPollData((p) => ({ ...p, weighted: e.target.checked }))}
                        onBlur={savePoll}
                      />
                      <span className="label-text">weighted</span>
                    </label>
                  </div>
                </div>
                <div className="flex flex-col">
                  <p className="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-2">Render</p>
                  <p className="text-xs text-base-content/50 mb-2 font-mono">PollView — src/components/PollView.tsx</p>
                  <PollView
                    poll={pollData}
                    pollOver={pollOver}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Link scroller cards test */}
          <section className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-lg">Link scroller cards</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Settings / properties</p>
                  <p className="text-sm text-base-content/70">Paste message text and set user/platform (saved on blur).</p>
                  <label className="label label-text">Message text</label>
                  <textarea
                    className="textarea textarea-bordered w-full text-sm"
                    rows={4}
                    value={cardData.messageText}
                    onChange={(e) => setCardData((c) => ({ ...c, messageText: e.target.value }))}
                    onBlur={saveCard}
                  />
                  <label className="label label-text">User (nick)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full"
                    value={cardData.nick}
                    onChange={(e) => setCardData((c) => ({ ...c, nick: e.target.value }))}
                    onBlur={saveCard}
                  />
                  <label className="label label-text">Platform</label>
                  <select
                    className="select select-bordered w-full"
                    value={cardData.platform}
                    onChange={(e) => setCardData((c) => ({ ...c, platform: e.target.value }))}
                    onBlur={saveCard}
                  >
                    <option value="dgg">dgg</option>
                    <option value="kick">kick</option>
                    <option value="youtube">youtube</option>
                    <option value="twitch">twitch</option>
                  </select>
                  {derivedUrl ? (
                    <p className="text-xs text-base-content/60 font-mono truncate" title={derivedUrl}>
                      Link derived from message: {derivedUrl}
                    </p>
                  ) : (
                    <p className="text-xs text-base-content/50">No link in message text (add a URL to test embeds).</p>
                  )}
                </div>
                <div className="space-y-6">
                  <p className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Render</p>
                  <div>
                    <p className="text-xs text-base-content/50 mb-2 font-mono">LinkCardOverviewCard — src/components/LinkScroller.tsx</p>
                    <div className="card shadow-xl flex flex-col border-2 border-base-content/20 bg-base-200 p-0 max-w-md">
                      <LinkCardOverviewCard
                        card={syntheticCard}
                        onCardClick={() => {}}
                        onOpenLink={undefined}
                        getEmbedTheme={getEmbedTheme}
                        platformSettings={defaultPlatformSettings}
                        emotesMap={emotesMap}
                        footerDisplay={defaultFooterDisplay}
                        embedReloadKey={0}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-base-content/50 mb-2 font-mono">getPlatformLabel, getPlatformFooterColor — src/components/LinkScroller.tsx</p>
                    <div
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-base-content/20 ${getPlatformFooterColor(syntheticCard.platform, 'subtle')}`}
                    >
                      <span className="text-xs text-base-content/50 flex-shrink-0">{getPlatformLabel(syntheticCard)}</span>
                      <span className="text-sm font-semibold text-primary flex-shrink-0">{cardData.nick}</span>
                      <span className="text-base-content/40 flex-shrink-0">—</span>
                      <span className="text-sm text-base-content/80 truncate">
                        {cardData.messageText.trim().slice(0, 80) || '—'}
                        {cardData.messageText.length > 80 ? '…' : ''}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-base-content/50 mb-2 font-mono">LinkCardExpandedContent — src/components/LinkScroller.tsx</p>
                    <div className="border border-base-300 rounded-lg overflow-hidden flex min-h-[240px]">
                      <LinkCardExpandedContent
                        card={syntheticCard}
                        getEmbedTheme={getEmbedTheme}
                        emotesMap={emotesMap}
                        footerDisplay={defaultFooterDisplay}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Primary chat message flow */}
          <section className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-lg">Primary chat message flow</h2>
              <p className="text-sm text-base-content/70">
                Diagnostic counters for MSG pipeline. Compare stages to find where messages are dropped. Reset and watch during a busy chat period.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="stats shadow bg-base-300">
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">Main received</div>
                    <div className="stat-value text-lg font-mono">{mainCounters?.mainReceived ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">Broadcast sent</div>
                    <div className="stat-value text-lg font-mono">{mainCounters?.mainBroadcastSent ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">Dropped (no clients)</div>
                    <div className="stat-value text-lg font-mono text-warning">{mainCounters?.mainBroadcastDroppedNoClients ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">WsClient dispatched</div>
                    <div className="stat-value text-lg font-mono">{rendererCounters?.wsClientDispatched ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">No handler</div>
                    <div className="stat-value text-lg font-mono text-warning">{rendererCounters?.wsClientNoHandler ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">CombinedChat received</div>
                    <div className="stat-value text-lg font-mono">{rendererCounters?.combinedChatReceived ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">Appended</div>
                    <div className="stat-value text-lg font-mono">{rendererCounters?.combinedChatAppended ?? '—'}</div>
                  </div>
                  <div className="stat place-items-center place-content-center py-2 px-4">
                    <div className="stat-title text-xs">Rejected (duplicate)</div>
                    <div className="stat-value text-lg font-mono text-warning">{rendererCounters?.combinedChatRejectedDuplicate ?? '—'}</div>
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-outline" onClick={resetPrimaryChatCounters}>
                  Reset counters
                </button>
              </div>
              <p className="text-xs text-base-content/50 mt-2">
                Flow: ChatWebSocket → broadcast → chatWsClient → CombinedChat. CombinedChat counters only increment when chat is visible (OmniScreen or chat window).
              </p>
            </div>
          </section>

          {/* Primary chat message formatting */}
          <section className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-lg">Primary chat message formatting</h2>
              <p className="text-sm text-base-content/70">
                Samples from <code className="font-mono text-xs">logs/chat-samples.json</code> (run{' '}
                <code className="font-mono text-xs">node scripts/extract-chat-samples.mjs</code> to generate). Custom message renders live below.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="label label-text">Custom message (paste/type to see rendering)</label>
                  <textarea
                    className="textarea textarea-bordered w-full font-mono text-sm"
                    rows={3}
                    placeholder="e.g. >greentext or https://youtube.com/watch?v=..."
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                  />
                  {customMessage ? (
                    <div className="mt-2 p-3 rounded-lg bg-base-300 text-sm">
                      <div className="msg-chat msg-chat-content">
                        <span className="msg-chat msg-chat-inner whitespace-pre-wrap break-words">
                          {renderPrimaryChatMessageContent({
                        content: customMessage,
                        primaryChatNicks: [],
                        emotePattern: debugEmotePattern,
                        emotesMap: debugEmotesMap,
                        options: chatFormattingOptions,
                      })}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-6 overflow-x-auto">
                  {chatSamples ? (
                    Object.entries(chatSamples).map(([source, types]) => (
                      <div key={source}>
                        <h3 className="font-semibold text-base mb-2 font-mono">{source}</h3>
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Sample raw</th>
                              <th>Render / Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(types).flatMap(([type, arr]) => {
                              const notApplicable =
                                (source === 'primary-chat' && ['ME', 'NAMES', 'PAIDEVENTS', 'UPDATEUSER', 'QUIT', 'JOIN', 'VOTECAST'].includes(type)) ||
                                source === 'primary-live'
                              // Not applicable types (non-message events) only need 1 sample; no point showing multiple.
                              const sampleLimit = notApplicable ? 1 : 2
                              const samples = Array.isArray(arr) ? arr.slice(0, sampleLimit) : []
                              const supported =
                                (source === 'primary-chat' && (type === 'MSG' || type === 'HISTORY')) ||
                                (source === 'kick' && type === 'ChatMessageEvent') ||
                                (source === 'youtube' && type === 'liveChatTextMessageRenderer') ||
                                (source === 'twitch' && type === 'PRIVMSG')
                              return samples.map((s, i) => {
                                const rawPreview = getSampleRawPreview(source, type, s)
                                const rawKey = `${source}-${type}-${i}`
                                const isPrettified = prettifiedRawKeys.has(rawKey)
                                const toggleRawPrettify = () => {
                                  setPrettifiedRawKeys((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(rawKey)) next.delete(rawKey)
                                    else next.add(rawKey)
                                    return next
                                  })
                                }
                                const rendered = notApplicable
                                  ? null
                                  : renderSample(source, type, s, {
                                      debugEmotePattern,
                                      debugEmotesMap,
                                      chatFormattingOptions,
                                      primaryChatNicks: collectNicksFromSamples(chatSamples),
                                    })
                                return (
                                  <tr key={`${source}-${type}-${i}`}>
                                    <td className="font-mono text-xs">
                                      {type}
                                      {type === 'MSG' && (s as { subtype?: string }).subtype
                                        ? ` (${(s as { subtype: string }).subtype})`
                                        : ''}
                                    </td>
                                    <td
                                      className={`font-mono text-xs cursor-pointer select-none ${isPrettified ? 'whitespace-pre-wrap break-all align-top max-w-[400px]' : 'max-w-[200px] truncate'}`}
                                      title={isPrettified ? 'Click to collapse' : 'Click to expand (prettified JSON)'}
                                      onClick={toggleRawPrettify}
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault()
                                          toggleRawPrettify()
                                        }
                                      }}
                                    >
                                      {isPrettified ? JSON.stringify(s, null, 2) : rawPreview}
                                    </td>
                                    <td className="text-sm max-w-[300px]">
                                      {notApplicable ? (
                                        <span className="text-base-content/50 italic">not applicable</span>
                                      ) : supported ? (
                                        <div className="msg-chat msg-chat-content">
                                          <span className="msg-chat msg-chat-inner whitespace-pre-wrap break-words">
                                            {rendered}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className="text-base-content/50 italic">not implemented</span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })
                            })}
                          </tbody>
                        </table>
                      </div>
                    ))
                  ) : (
                    <p className="text-base-content/50">Loading samples…</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
