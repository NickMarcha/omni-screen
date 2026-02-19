import { useState, useEffect } from 'react'

export interface CharityRaffleCredentials {
  googleServiceAccountEmail: string
  googlePrivateKey: string
  sheetsDbId: string
  fundraiserId: string
  processedSheetOffset: number
}

interface CharityRafflePageProps {
  onBackToMenu: () => void
}

export default function CharityRafflePage({ onBackToMenu }: CharityRafflePageProps) {
  const [creds, setCreds] = useState<CharityRaffleCredentials>({
    googleServiceAccountEmail: '',
    googlePrivateKey: '',
    sheetsDbId: '',
    fundraiserId: '8960',
    processedSheetOffset: 2,
  })
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; message?: string } | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<{ ok: boolean; donationsCount?: number; error?: string; message?: string } | null>(null)

  useEffect(() => {
    window.ipcRenderer
      ?.invoke('charity-raffle-get-credentials')
      ?.then((c: CharityRaffleCredentials) => setCreds((prev) => ({ ...prev, ...c })))
      ?.catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaveStatus(null)
    const result = (await window.ipcRenderer?.invoke('charity-raffle-save-credentials', creds)) as { ok?: boolean }
    setSaveStatus({ ok: !!result?.ok, message: result?.ok ? 'Saved' : 'Failed' })
  }

  const handleScrape = async () => {
    setScrapeResult(null)
    setScraping(true)
    try {
      const result = (await window.ipcRenderer?.invoke('charity-raffle-run-scrape')) as {
        ok?: boolean
        donationsCount?: number
        error?: string
        message?: string
      }
      setScrapeResult({
        ok: !!result?.ok,
        donationsCount: result?.donationsCount,
        error: result?.error,
        message: result?.message,
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

      <div className="space-y-6 max-w-2xl">
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Google Sheets credentials</h2>
            <p className="text-sm text-base-content/70">
              Service account with access to your spreadsheets. Get keys from Google Cloud Console.
            </p>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Service account email</span>
              </label>
              <input
                type="text"
                className="input input-bordered"
                placeholder="...@....iam.gserviceaccount.com"
                value={creds.googleServiceAccountEmail}
                onChange={(e) => setCreds((p) => ({ ...p, googleServiceAccountEmail: e.target.value }))}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Private key (from JSON key file)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type={showPrivateKey ? 'text' : 'password'}
                  className="input input-bordered flex-1 font-mono text-sm"
                  placeholder="-----BEGIN PRIVATE KEY-----..."
                  value={creds.googlePrivateKey}
                  onChange={(e) => setCreds((p) => ({ ...p, googlePrivateKey: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowPrivateKey((v) => !v)}
                >
                  {showPrivateKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <label className="label">
                <span className="label-text-alt">
                  Paste the entire key including -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY-----. From JSON, use the private_key value as-is (with \n).
                </span>
              </label>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Sheets DB ID (main doc)</span>
              </label>
              <input
                type="text"
                className="input input-bordered font-mono"
                placeholder="1abc... (from URL: /d/THIS_PART/edit)"
                value={creds.sheetsDbId}
                onChange={(e) => setCreds((p) => ({ ...p, sheetsDbId: e.target.value }))}
              />
              <label className="label">
                <span className="label-text-alt">
                  Spreadsheet ID from the URL: docs.google.com/spreadsheets/d/<strong>ID_HERE</strong>/edit — not the sheet tab number (gid).
                </span>
              </label>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Fundraiser ID</span>
              </label>
              <input
                type="text"
                className="input input-bordered w-32"
                value={creds.fundraiserId}
                onChange={(e) => setCreds((p) => ({ ...p, fundraiserId: e.target.value }))}
              />
              <label className="label">
                <span className="label-text-alt">Default: 8960 (DGG)</span>
              </label>
            </div>

            <div className="flex gap-2 mt-2">
              <button type="button" className="btn btn-primary" onClick={handleSave}>
                Save credentials
              </button>
              {saveStatus && (
                <span className={`text-sm ${saveStatus.ok ? 'text-success' : 'text-error'}`}>
                  {saveStatus.message}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Scrape Charity Donation list</h2>
            <p className="text-sm text-base-content/70">
              Scrapes againstmalaria.com and writes donations to the RawData sheet.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={scraping}
              onClick={handleScrape}
            >
              {scraping ? 'Scraping...' : 'Run scrape'}
            </button>
            {scrapeResult && (
              <div
                className={`alert ${scrapeResult.ok ? 'alert-success' : 'alert-error'}`}
              >
                <span>
                  {scrapeResult.ok
                    ? `Done. ${scrapeResult.donationsCount ?? 0} donations added. ${scrapeResult.message ?? ''}`
                    : scrapeResult.error ?? 'Scrape failed'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
