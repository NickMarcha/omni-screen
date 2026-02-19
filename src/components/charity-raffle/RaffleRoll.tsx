import { useState } from 'react'
import DonationPane from './DonationPane'
import { FindYoutubeVideoIdFromParagraph } from './utils'
import type { ProcessedDonation } from './types'

interface Totals {
  raffleDonationCount: number
  raffleTotal: number
}

export default function RaffleRoll() {
  const [modalOpen, setModalOpen] = useState(false)
  const [item, setItem] = useState<ProcessedDonation | null>(null)
  const [raffling, setRaffling] = useState(false)
  const [suggestedSkipGoal, setSuggestedSkipGoal] = useState(0)
  const aFactor = 15

  const handleRoll = async () => {
    setItem(null)
    setSuggestedSkipGoal(0)
    setRaffling(true)
    try {
      const result = (await window.ipcRenderer?.invoke('charity-raffle-roll')) as { ok?: boolean; winner?: ProcessedDonation }
      if (result?.ok && result.winner) {
        const w = { ...result.winner, lastUpdated: undefined }
        setItem(w)
        const totals = (await window.ipcRenderer?.invoke('charity-raffle-fetch-total')) as Totals | null
        if (totals) {
          const suggestion = 20 + (250 - 20) / Math.pow(1.01, totals.raffleDonationCount)
          setSuggestedSkipGoal(Math.max(w.amount + aFactor, Math.round(suggestion)))
        }
      }
    } finally {
      setRaffling(false)
    }
  }

  const handleRemoveFromRaffle = async () => {
    if (!item) return
    await window.ipcRenderer?.invoke('charity-raffle-set-entry-played', item.NR, false)
    setModalOpen(false)
    setItem(null)
  }

  const handleAnnounce = async () => {
    if (!item) return
    let emote = 'WEOW'
    if (item.yeeOrPepe === 'YEE') emote = 'comfYEE'
    else if (item.yeeOrPepe === 'PEPE') emote = 'PepoComfy'
    else emote = ['ComfyAYA', 'ComfyCat', 'ComfyDan', 'ComfyDog'][Math.floor(Math.random() * 4)]
    const msg = `Up next ${emote} ${item.sponsor} won the raffle with: ${item.message}`
    await navigator.clipboard?.writeText(msg)
  }

  const ytId = item ? FindYoutubeVideoIdFromParagraph(item.message) : null

  return (
    <div>
      <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
        Raffle
      </button>
      {modalOpen && (
        <dialog open className="modal modal-open">
          <div className="modal-box">
            <div className="flex gap-2 mb-4">
              <button type="button" className="btn btn-primary" onClick={handleRoll} disabled={raffling}>
                {raffling ? 'Rolling...' : 'doRaffleRoll'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { setModalOpen(false); setItem(null) }}>
                Close
              </button>
            </div>
            {item && (
              <div className="flex flex-wrap gap-4">
                <div>
                  <DonationPane donation={item} />
                  <p className="text-sm opacity-70 mt-2">Suggested min skip goal: ${suggestedSkipGoal}</p>
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="btn btn-warning btn-sm" onClick={handleRemoveFromRaffle}>
                      Remove From Raffle
                    </button>
                    <button type="button" className="btn btn-sm" onClick={handleAnnounce}>
                      Copy Announce (clipboard)
                    </button>
                  </div>
                </div>
                {ytId && (
                  <iframe
                    title="yt"
                    width="560"
                    height="315"
                    src={`https://www.youtube.com/embed/${ytId}`}
                    allowFullScreen
                    className="rounded"
                  />
                )}
              </div>
            )}
          </div>
          <form method="dialog" className="modal-backdrop" onClick={() => setModalOpen(false)}>
            <button type="button">close</button>
          </form>
        </dialog>
      )}
    </div>
  )
}
