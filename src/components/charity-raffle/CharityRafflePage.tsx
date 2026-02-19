import { useState, useEffect } from 'react'
import RaffleRoll from './RaffleRoll'
import RaffleMoreV2 from './RaffleMoreV2'

export interface CharityRaffleCredentials {
  googleServiceAccountEmail: string
  googlePrivateKey: string
  sheetsDbId: string
  fundraiserId: string
  processedSheetOffset: number
  conductorName: string
  strawPollApiKey?: string
  raffleAmount?: number
  raffleDeadline?: number
}

interface CharityRafflePageProps {
  onBackToMenu: () => void
}

type Tab = 'settings' | 'strawpoll' | 'raffle'

export default function CharityRafflePage({ onBackToMenu }: CharityRafflePageProps) {
  const [tab, setTab] = useState<Tab>('settings')
  const [creds, setCreds] = useState<CharityRaffleCredentials>({
    googleServiceAccountEmail: '',
    googlePrivateKey: '',
    sheetsDbId: '',
    fundraiserId: '8960',
    processedSheetOffset: 2,
    conductorName: '',
    strawPollApiKey: '',
  })
  const [raffleAmount, setRaffleAmount] = useState(creds.raffleAmount ?? 3)
  const [deadline, setDeadline] = useState(creds.raffleDeadline ?? 150)
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; message?: string } | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<{ ok: boolean; donationsCount?: number; error?: string; message?: string } | null>(null)
  const [totals, setTotals] = useState<{ donationCount: number; donationTotal: number; raffleTotal: number; raffleDonationCount: number } | null>(null)

  useEffect(() => {
    window.ipcRenderer
      ?.invoke('charity-raffle-get-credentials')
      ?.then((c: CharityRaffleCredentials) => {
        setCreds((prev) => ({ ...prev, ...c }))
        setRaffleAmount(c.raffleAmount ?? 3)
        setDeadline(c.raffleDeadline ?? 150)
      })
      ?.catch(() => {})
  }, [])

  useEffect(() => {
    const load = async () => {
      const t = await window.ipcRenderer?.invoke('charity-raffle-instantiate')
      if (t?.ok) {
        const tot = await window.ipcRenderer?.invoke('charity-raffle-fetch-total')
        setTotals(tot)
      }
    }
    if (tab === 'raffle') load()
  }, [tab])

  const handleSave = async () => {
    setSaveStatus(null)
    const toSave = { ...creds, raffleAmount, raffleDeadline: deadline }
    const result = (await window.ipcRenderer?.invoke('charity-raffle-save-credentials', toSave)) as { ok?: boolean }
    setSaveStatus({ ok: !!result?.ok, message: result?.ok ? 'Saved' : 'Failed' })
  }

  const runScrape = async (mode: 'single' | 'full') => {
    setScrapeResult(null)
    setScraping(true)
    try {
      const channel = mode === 'single' ? 'charity-raffle-run-scrape-single' : 'charity-raffle-run-scrape-full'
      const result = (await window.ipcRenderer?.invoke(channel)) as { ok?: boolean; donationsCount?: number; error?: string }
      setScrapeResult({
        ok: !!result?.ok,
        donationsCount: result?.donationsCount,
        error: result?.error,
      })
    } finally {
      setScraping(false)
    }
  }

  return (
    <div className="flex flex-col h-full p-6 overflow-auto">
      <div className="flex items-center gap-4 mb-6">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBackToMenu}>
          Back
        </button>
        <h1 className="text-2xl font-bold">DGG Against Malaria</h1>
      </div>

      <div role="tablist" className="tabs tabs-boxed mb-4">
        <button type="button" role="tab" className={`tab ${tab === 'settings' ? 'tab-active' : ''}`} onClick={() => setTab('settings')}>
          Settings
        </button>
        <button type="button" role="tab" className={`tab ${tab === 'strawpoll' ? 'tab-active' : ''}`} onClick={() => setTab('strawpoll')}>
          StrawPoll
        </button>
        <button type="button" role="tab" className={`tab ${tab === 'raffle' ? 'tab-active' : ''}`} onClick={() => setTab('raffle')}>
          Raffle
        </button>
      </div>

      {tab === 'settings' && (
        <div className="space-y-6 max-w-2xl">
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">Google Sheets credentials</h2>
              <p className="text-sm text-base-content/70">
                Service account with access to your spreadsheets. Get keys from Google Cloud Console.
              </p>
              <div className="form-control">
                <label className="label"><span className="label-text">Service account email</span></label>
                <input type="text" className="input input-bordered" placeholder="...@....iam.gserviceaccount.com" value={creds.googleServiceAccountEmail} onChange={(e) => setCreds((p) => ({ ...p, googleServiceAccountEmail: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text">Private key</span></label>
                <div className="flex gap-2">
                  <input type={showPrivateKey ? 'text' : 'password'} className="input input-bordered flex-1 font-mono text-sm" placeholder="-----BEGIN PRIVATE KEY-----..." value={creds.googlePrivateKey} onChange={(e) => setCreds((p) => ({ ...p, googlePrivateKey: e.target.value }))} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowPrivateKey((v) => !v)}>{showPrivateKey ? 'Hide' : 'Show'}</button>
                </div>
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text">Sheets DB ID</span></label>
                <input type="text" className="input input-bordered font-mono" placeholder="1abc..." value={creds.sheetsDbId} onChange={(e) => setCreds((p) => ({ ...p, sheetsDbId: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text">Fundraiser ID</span></label>
                <input type="text" className="input input-bordered w-32" value={creds.fundraiserId} onChange={(e) => setCreds((p) => ({ ...p, fundraiserId: e.target.value }))} />
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text">Conductor name</span></label>
                <input type="text" className="input input-bordered" placeholder="Your alias for raffle timestamps" value={creds.conductorName} onChange={(e) => setCreds((p) => ({ ...p, conductorName: e.target.value }))} />
                <label className="label"><span className="label-text-alt">Written to Processed sheet (lastUpdated, updatedBy) when rolling or removing entries</span></label>
              </div>
              <div className="form-control">
                <label className="label"><span className="label-text">Processed sheet offset</span></label>
                <input type="number" className="input input-bordered w-24" value={creds.processedSheetOffset} onChange={(e) => setCreds((p) => ({ ...p, processedSheetOffset: parseInt(e.target.value, 10) || 2 }))} />
              </div>
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn btn-primary" onClick={handleSave}>Save credentials</button>
                {saveStatus && <span className={`text-sm ${saveStatus.ok ? 'text-success' : 'text-error'}`}>{saveStatus.message}</span>}
              </div>
            </div>
          </div>

          <div className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title">Scrape Charity Donation list</h2>
              <p className="text-sm text-base-content/70">
                Single-page: status updates (distribution status changes; run every 15 min). Full: loops until sheet catches up.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-secondary" disabled={scraping} onClick={() => runScrape('single')}>
                  {scraping ? 'Scraping...' : 'Scrape latest page (status updates)'}
                </button>
                <button type="button" className="btn btn-primary" disabled={scraping} onClick={() => runScrape('full')}>
                  {scraping ? 'Scraping...' : 'Scrape all pages (catch up)'}
                </button>
              </div>
              {scrapeResult && (
                <div className={`alert ${scrapeResult.ok ? 'alert-success' : 'alert-error'}`}>
                  <span>{scrapeResult.ok ? `Done. ${scrapeResult.donationsCount ?? 0} donations.` : scrapeResult.error ?? 'Scrape failed'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'strawpoll' && (
        <div className="card bg-base-200 shadow-xl max-w-2xl">
          <div className="card-body">
            <h2 className="card-title">StrawPoll settings</h2>
            <p className="text-sm text-base-content/70">Used by RaffleMore for creating polls. Get API key from strawpoll.com/account</p>
            <div className="form-control">
              <label className="label"><span className="label-text">StrawPoll API key</span></label>
              <input type="password" className="input input-bordered font-mono" placeholder="..." value={creds.strawPollApiKey ?? ''} onChange={(e) => setCreds((p) => ({ ...p, strawPollApiKey: e.target.value }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Raffle count (RaffleMore)</span></label>
              <input type="number" className="input input-bordered w-24" value={raffleAmount} onChange={(e) => setRaffleAmount(parseInt(e.target.value, 10) || 3)} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Poll deadline (seconds)</span></label>
              <input type="number" className="input input-bordered w-24" value={deadline} onChange={(e) => setDeadline(parseInt(e.target.value, 10) || 150)} />
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" className="btn btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'raffle' && (
        <div className="space-y-8">
          {totals && (
            <div className="stats shadow">
              <div className="stat">
                <div className="stat-title">Raffle pool</div>
                <div className="stat-value">${Math.round(totals.raffleTotal)}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Raffle donos</div>
                <div className="stat-value">{totals.raffleDonationCount}/{totals.donationCount}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Total</div>
                <div className="stat-value text-secondary">${Math.round(totals.donationTotal)}</div>
              </div>
            </div>
          )}

          <div>
            <h3 className="font-bold text-lg mb-2">Single roll</h3>
            <RaffleRoll />
          </div>

          <div>
            <h3 className="font-bold text-lg mb-2">RaffleMore (multi-roll + StrawPoll)</h3>
            <RaffleMoreV2 strawPollApiKey={creds.strawPollApiKey ?? ''} raffleAmount={raffleAmount} deadline={deadline} />
          </div>
        </div>
      )}
    </div>
  )
}