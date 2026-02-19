import { useRef, useState } from 'react'
import RaffleMoreCardV2 from './RaffleMoreCardV2'
import { useArray } from './hooks/useArray'
import CountdownTimer from './CountdownTimer'
import { RenderClickableMessage, sendToClip } from './utils'
import { createPoll, getPollResultsArray, type ResultEntry } from './StrawPollAPI'
import type { ProcessedDonation } from './types'

interface Props {
  strawPollApiKey: string
  raffleAmount: number
  deadline: number
}

export default function RaffleMoreV2({ strawPollApiKey, raffleAmount, deadline }: Props) {
  const { array: donos, set: setDonos, update: updateDonos, clear: clearDonos } = useArray<ProcessedDonation>([])
  const { array: toggleArray, set: setToggleArray, update: updateToggle, clear: clearToggle } = useArray<boolean>([])

  const [pollID, setPollID] = useState('')
  const [pollWinner, setPollWinner] = useState<ResultEntry | null>(null)
  const [pollResults, setPollResults] = useState<ResultEntry[]>([])
  const [removingEntries, setRemovingEntries] = useState(false)
  const [raffling, setRaffling] = useState(false)
  const [countDownDate, setCountDownDate] = useState(new Date())
  const [hasSentResults, setHasSentResults] = useState(false)
  const getResultsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRaffleMore = async () => {
    setRaffling(true)
    clearDonos()
    clearToggle()
    setPollWinner(null)
    setPollID('')
    setPollResults([])
    try {
      const result = (await window.ipcRenderer?.invoke('charity-raffle-roll-more', raffleAmount)) as { ok?: boolean; winners?: ProcessedDonation[] }
      if (result?.ok && result.winners) {
        setDonos(result.winners)
        setToggleArray(result.winners.map(() => false))
      }
    } finally {
      setRaffling(false)
    }
  }

  const handleCreatePoll = async () => {
    if (!strawPollApiKey) return
    setPollWinner(null)
    setPollResults([])
    try {
      const newPollID = await createPoll(strawPollApiKey, deadline, donos)
      setCountDownDate(new Date(Date.now() + deadline * 1000))
      setPollID(newPollID)
      setHasSentResults(false)
      if (getResultsTimer.current) clearTimeout(getResultsTimer.current)
      getResultsTimer.current = setTimeout(async () => {
        const results = await getPollResultsArray(strawPollApiKey, newPollID)
        setPollResults(results)
        const winner = results?.sort((a, b) => b.vote_points - a.vote_points)[0]
        setPollWinner(winner ?? null)
      }, deadline * 1000 + 10000)
    } catch (err) {
      console.error(err)
    }
  }

  const countToggles = () => toggleArray.filter(Boolean).length

  const handleRemoveEntries = async () => {
    setRemovingEntries(true)
    const c = countToggles()
    const ps = toggleArray.map((t, i) => (t ? window.ipcRenderer?.invoke('charity-raffle-set-entry-played', donos[i].NR, true) : null)).filter(Boolean)
    await Promise.all(ps)
    await window.ipcRenderer?.invoke('charity-raffle-save-updated')
    const result = (await window.ipcRenderer?.invoke('charity-raffle-roll-more', c)) as { ok?: boolean; winners?: ProcessedDonation[] }
    if (result?.ok && result.winners) {
      for (let i = 0; i < toggleArray.length; i++) {
        if (toggleArray[i]) updateDonos(i, result.winners!.pop()!)
        updateToggle(i, false)
      }
    }
    setRemovingEntries(false)
  }

  const handleAnnounce = async () => {
    if (!pollWinner) return
    const item = donos.find((pd) => pd.message === pollWinner.value)
    if (!item) return
    setHasSentResults(true)
    let emote = 'WEOW'
    if (item.yeeOrPepe === 'YEE') emote = 'comfYEE'
    else if (item.yeeOrPepe === 'PEPE') emote = 'PepoComfy'
    else emote = ['ComfyAYA', 'ComfyCat', 'ComfyDan', 'ComfyDog'][Math.floor(Math.random() * 4)]
    const msg = `Up next ${emote} ${item.sponsor} won the raffle with: ${item.message}`
    await sendToClip(msg)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn btn-primary" onClick={handleRaffleMore} disabled={raffling}>
          Rafflemore
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleCreatePoll} disabled={raffling || donos.length === 0 || !strawPollApiKey}>
          Create Poll
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!pollID}
          onClick={() => window.open(`https://strawpoll.com/${pollID}`)}
          onContextMenu={(e) => { e.preventDefault(); sendToClip(`https://strawpoll.com/${pollID}`) }}
        >
          Open Poll
        </button>
        <button
          type="button"
          className="btn btn-warning"
          disabled={countToggles() < 1 || removingEntries}
          onClick={handleRemoveEntries}
        >
          Remove Entries {removingEntries && '...'}
        </button>
        <button type="button" className="btn" disabled={!pollWinner || hasSentResults} onClick={handleAnnounce}>
          Copy Announce
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          {donos.map((dono, i) => (
            <RaffleMoreCardV2
              key={dono.NR}
              dono={dono}
              isChecked={toggleArray[i] ?? false}
              setToggleState={(v) => updateToggle(i, v)}
              disabled={removingEntries}
              removing={removingEntries && (toggleArray[i] ?? false)}
            />
          ))}
        </div>

        {countDownDate > new Date() && (
          <div className="border-2 border-primary rounded-lg p-6 min-w-[200px]">
            <h3 className="font-bold mb-2">Voting closes in:</h3>
            <CountdownTimer targetDate={countDownDate} />
          </div>
        )}

        {pollWinner && (
          <div className="border-2 border-primary rounded-lg p-6 min-w-[200px]">
            <h3 className="font-bold mb-2">
              Winner: {donos.find((d) => d.message === pollWinner.value)?.sponsor}
            </h3>
            <RenderClickableMessage message={pollWinner.value} />
            <hr className="my-2" />
            {pollResults.sort((a, b) => b.vote_points - a.vote_points).map((r, i) => (
              <div key={i}>[{r.vote_points}] <RenderClickableMessage message={r.value} /></div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
