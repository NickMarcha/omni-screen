/**
 * Shared poll UI for POLLSTART/POLLSTOP data.
 * Active poll (POLLSTART): timer bar at top, countdown text, option rows as buttons.
 * Finished poll (POLLSTOP): no timer, losing options greyed out.
 * VOTECAST events update totals; this component just renders the current state.
 */
import { useState, useEffect, useMemo } from 'react'

export interface PollData {
  canvote: boolean
  myvote: number
  nick: string
  weighted: boolean
  start: string
  now: string
  /** Duration in milliseconds (e.g. 15000 = 15s). */
  time: number
  question: string
  options: string[]
  totals: number[]
  totalvotes: number
}

/** How long to show results after poll ends before calling onDismiss. Matches upstream chat-gui POLL_END_TIME (7000). */
export const POLL_RESULTS_VISIBLE_MS = 7000

export interface PollViewProps {
  /** POLLSTART/POLLSTOP poll payload */
  poll: PollData
  /** True when POLLSTOP has been received (poll ended). No timer; losing options greyed out. */
  pollOver: boolean
  /** Server time offset (serverNow - clientNow) at POLLSTART; used so timer matches server. */
  serverOffsetMs?: number | null
  /** Called when user clicks an option (1-based index). Omit or no-op in debug. */
  onVote?: (optionIndex: number) => void
  /** Called after poll is over and POLL_RESULTS_VISIBLE_MS has elapsed. Parent can clear poll and unmount. */
  onDismiss?: () => void
  /** Called once when timer reaches 0 (poll end time) so parent can set pollOver if POLLSTOP was missed. */
  onPollTimeExpired?: () => void
  /** When true, vote buttons are disabled (e.g. vote in flight). */
  votePending?: boolean
}

/** Parse poll start or now: ISO string or Unix seconds (number). Returns ms. */
function parsePollTime(value: string | number | undefined): number {
  if (value == null) return NaN
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : NaN
}

/** Compute time left in ms using server time (poll.start + poll.time) and optional server offset. */
function getTimeLeftMs(poll: PollData, serverOffsetMs: number | null | undefined): number {
  const startMs = parsePollTime(poll.start)
  if (!Number.isFinite(startMs) || !poll.time || poll.time <= 0) return 0
  const endMs = startMs + poll.time
  const offset = typeof serverOffsetMs === 'number' && Number.isFinite(serverOffsetMs) ? serverOffsetMs : 0
  return Math.max(0, endMs - (Date.now() + offset))
}

export default function PollView({ poll, pollOver, serverOffsetMs, onVote, onDismiss, onPollTimeExpired, votePending }: PollViewProps) {
  const options = poll.options.length > 0 ? poll.options : ['']
  const totals =
    poll.totals.length >= options.length
      ? poll.totals
      : [...poll.totals, ...Array(options.length - poll.totals.length).fill(0)]
  const totalvotes =
    poll.totalvotes > 0 ? poll.totalvotes : Math.max(1, totals.reduce((a: number, b: number) => a + b, 0))
  const maxTot = options.length > 0 ? Math.max(...options.map((_, idx) => totals[idx] ?? 0)) : 0

  const [timeLeftMs, setTimeLeftMs] = useState(() => getTimeLeftMs(poll, serverOffsetMs))
  const showTimer = !pollOver && poll.time > 0 && timeLeftMs > 0

  /* Bar: one CSS animation from start→end; elapsed uses server offset so bar matches server time. */
  const barAnimationVars = useMemo(() => {
    if (!poll.time || pollOver) return { duration: 0, elapsed: 0 }
    const startMs = parsePollTime(poll.start)
    if (!Number.isFinite(startMs)) return { duration: 0, elapsed: 0 }
    const offset = typeof serverOffsetMs === 'number' && Number.isFinite(serverOffsetMs) ? serverOffsetMs : 0
    const elapsed = Math.min(poll.time, Math.max(0, Date.now() + offset - startMs))
    return { duration: poll.time, elapsed }
  }, [poll.start, poll.time, pollOver, serverOffsetMs])

  useEffect(() => {
    if (pollOver || !poll.time) return
    let expiredFired = false
    const tick = () => {
      const next = getTimeLeftMs(poll, serverOffsetMs)
      if (next <= 0) {
        if (!expiredFired && onPollTimeExpired) {
          expiredFired = true
          onPollTimeExpired()
        }
        setTimeLeftMs(0)
      } else {
        setTimeLeftMs(next)
      }
    }
    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [pollOver, poll.start, poll.time, serverOffsetMs, onPollTimeExpired])

  // After poll is over, keep results visible for POLL_RESULTS_VISIBLE_MS then call onDismiss
  useEffect(() => {
    if (!pollOver || !onDismiss) return
    const id = setTimeout(onDismiss, POLL_RESULTS_VISIBLE_MS)
    return () => clearTimeout(id)
  }, [pollOver, onDismiss])

  // Full seconds when >= 10 s; under 10 s show 9.9, 9.8 … 0.1 (every 0.1 s), then 0
  const timeLeftText =
    timeLeftMs >= 10000
      ? `${Math.floor(timeLeftMs / 1000)} s`
      : timeLeftMs >= 100
        ? `${(timeLeftMs / 1000).toFixed(1)} s`
        : '0 s'
  const pollDurationSec = poll.time > 0 ? (poll.time / 1000).toFixed(1) : '0'

  return (
    <div className="bg-base-300 rounded-lg p-4 flex-1 flex flex-col">
      {showTimer && (
        <div className="flex-shrink-0 -mx-4 -mt-4 mb-3 rounded-t-lg overflow-hidden">
          <div className="relative h-9 w-full bg-base-200">
            {/* Single CSS animation: blue bar shrinks over full duration, no JS updates = smooth */}
            <div
              className="absolute top-0 bottom-0 bg-primary poll-timer-bar"
              style={
                {
                  '--poll-duration': `${barAnimationVars.duration}ms`,
                  '--poll-elapsed': `${barAnimationVars.elapsed}ms`,
                } as React.CSSProperties
              }
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-xs font-medium text-base-content drop-shadow-sm">{timeLeftText} left</span>
            </div>
          </div>
        </div>
      )}
      {pollOver && (
        <div className="text-sm font-medium text-base-content/80 mb-2">
          Poll ended! {totalvotes} vote{totalvotes !== 1 ? 's' : ''} cast.
          {poll.time > 0 && ` (Lasted ${pollDurationSec} s)`}
        </div>
      )}
      <div className="text-sm text-base-content/60 mb-1">Poll by {poll.nick}</div>
      <div className="font-semibold mb-3">{poll.question}</div>
      {poll.weighted && (
        <p className="text-xs text-base-content/50 mb-2">Sub-weighted (higher tier subs count more)</p>
      )}
      <div className="space-y-2">
        {options.map((opt, i) => {
          const tot = totals[i] ?? 0
          const pct = totalvotes > 0 ? (tot / totalvotes) * 100 : 0
          const isLoser = pollOver && tot < maxTot
          const isWinner = pollOver && tot === maxTot && maxTot > 0
          const isVoted = poll.myvote === i + 1
          const optionContent = (
            <>
              <div className="flex items-end justify-between gap-2 mb-0.5">
                <span className="text-xs break-words min-w-0 flex-1">{opt || `Option ${i + 1}`}</span>
                <span className="text-xs flex-shrink-0">{tot} ({pct.toFixed(0)}%)</span>
              </div>
              <div className="w-full h-2 rounded-full bg-base-content/20 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300 ease-in"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          )
          const baseClass = 'w-full flex flex-col text-left rounded-lg p-2 -m-2'
          const borderClass = isWinner ? 'border-2 border-yellow-500' : isVoted ? 'border-2 border-white' : ''
          const className = `${baseClass} ${isLoser ? 'opacity-50' : ''} ${borderClass}`

          if (!pollOver && poll.canvote && onVote) {
            return (
              <button
                key={i}
                type="button"
                disabled={votePending}
                className={`${className} hover:bg-base-content/10 transition-colors disabled:opacity-60 disabled:pointer-events-none`}
                onClick={() => onVote(i + 1)}
              >
                {optionContent}
              </button>
            )
          }
          return (
            <div key={i} className={className}>
              {optionContent}
            </div>
          )
        })}
      </div>
    </div>
  )
}
