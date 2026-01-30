import { useState, useCallback, useMemo } from 'react'
import PollView from './PollView'
import type { PollData as PollViewPollData } from './PollView'
import {
  LinkCardOverviewCard,
  LinkCardExpandedContent,
  getPlatformLabel,
  getPlatformFooterColor,
  type LinkCard,
} from './LinkScroller'
import { getAppPreferences } from '../utils/appPreferences'

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
  url: string
}

const defaultCardData: DebugCardData = {
  messageText: 'Check out this link https://example.com',
  nick: 'ViewerName',
  platform: 'dgg',
  url: 'https://example.com',
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

  const savePoll = useCallback(() => {
    saveOnBlur(STORAGE_KEY_POLL, pollData)
  }, [pollData])

  const saveCard = useCallback(() => {
    saveOnBlur(STORAGE_KEY_CARD, cardData)
  }, [cardData])

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
  const getEmbedTheme = useCallback(() => (getAppPreferences().theme.mode === 'dark' ? 'dark' : 'light'), [])
  const syntheticCard: LinkCard = useMemo(() => ({
    id: 'debug-card',
    messageId: `debug:channel:${cardDate}:${cardData.nick}`,
    url: cardData.url,
    text: cardData.messageText,
    nick: cardData.nick,
    date: cardDate,
    isDirectMedia: false,
    platform: cardData.platform as 'dgg' | 'kick',
    channel: cardData.platform === 'kick' ? 'channel' : 'Destinygg',
    isTrusted: false,
    isStreaming: false,
  }), [cardData, cardDate])

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
                  <label className="label label-text">Link URL (optional)</label>
                  <input
                    type="text"
                    className="input input-bordered w-full text-sm"
                    value={cardData.url}
                    onChange={(e) => setCardData((c) => ({ ...c, url: e.target.value }))}
                    onBlur={saveCard}
                  />
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
        </div>
      </div>
    </div>
  )
}
