import { useState, useEffect, useCallback, useRef } from 'react'
import yeeCharmGif from '../assets/media/YeeCharm.gif'
import logoPng from '../assets/logo.png'
import abaGrinchPng from '../assets/media/AbaGrinch.png'
import achshullyRetardedPng from '../assets/media/ACHshullyRetarded.png'
import bennyLovePng from '../assets/media/BennyLove.png'
import donaldSmadgePng from '../assets/media/DonaldSmadge.png'
import mehdiAwarePng from '../assets/media/mehdiAware.png'
import manHoldsCatPng from '../assets/media/ManHoldsCat.png'
import noHopePng from '../assets/media/NoHope.png'
import whickedSteinPng from '../assets/media/WhickedStein.png'
import {
  applyThemeToDocument,
  darkThemes,
  defaultPreferences,
  getAppPreferences,
  lightThemes,
  setAppPreferences,
  type AppPreferences,
} from '../utils/appPreferences'

const STORAGE_KEY_UPDATE_LAST_CHECKED = 'omni-screen:update-last-checked'

function formatLastCheckedAgo(ts: number): string {
  const now = Date.now()
  const d = Math.floor((now - ts) / 1000)
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`
  if (d < 604800) return `${Math.floor(d / 86400)} days ago`
  return `${Math.floor(d / 86400)} days ago`
}

interface MenuProps {
  onNavigate: (page: 'link-scroller' | 'omni-screen' | 'debug') => void
}

function Menu({ onNavigate }: MenuProps) {
  // Random icon for Link Scroller
  const linkScrollerIcons = [
    abaGrinchPng,
    achshullyRetardedPng,
    bennyLovePng,
    donaldSmadgePng,
    mehdiAwarePng,
    manHoldsCatPng,
    noHopePng,
    whickedSteinPng
  ]
  const [randomIcon] = useState(() => 
    linkScrollerIcons[Math.floor(Math.random() * linkScrollerIcons.length)]
  )

  // Update UI state
  const [checking, setChecking] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [versionInfo, setVersionInfo] = useState<any>()
  const [updateError, setUpdateError] = useState<any>()
  const [progressInfo, setProgressInfo] = useState<any>()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalBtn, setModalBtn] = useState({
    cancelText: 'Close',
    okText: 'Update',
    onCancel: () => setModalOpen(false),
    onOk: () => window.ipcRenderer.invoke('start-download'),
  })

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prefsDraft, setPrefsDraft] = useState<AppPreferences>(() => getAppPreferences())

  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_UPDATE_LAST_CHECKED)
      if (raw == null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  })
  const [, setTick] = useState(0)

  // Spam-click "StrawWaffle" 10 times in 5 seconds to open debug page
  const debugClickTimesRef = useRef<number[]>([])
  const handleStrawWaffleClick = useCallback(() => {
    const now = Date.now()
    const cutoff = now - 5000
    debugClickTimesRef.current = [...debugClickTimesRef.current.filter(t => t > cutoff), now]
    if (debugClickTimesRef.current.length >= 10) {
      debugClickTimesRef.current = []
      onNavigate('debug')
    }
  }, [onNavigate])

  const checkUpdate = async (silent = false) => {
    setChecking(true)
    const result = await window.ipcRenderer.invoke('check-update')
    setProgressInfo({ percent: 0 })
    setChecking(false)
    if (!silent) setModalOpen(true)
    if (result?.error) {
      setUpdateAvailable(false)
      setUpdateError(result?.error)
    }
  }

  const onUpdateCanAvailable = useCallback((_event: any, arg1: any) => {
    setVersionInfo(arg1)
    setUpdateError(undefined)
    const now = Date.now()
    setLastCheckedAt(now)
    try {
      localStorage.setItem(STORAGE_KEY_UPDATE_LAST_CHECKED, String(now))
    } catch {
      // ignore
    }
    if (arg1.update) {
      setModalBtn(state => ({
        ...state,
        cancelText: 'Cancel',
        okText: 'Update',
        onOk: () => window.ipcRenderer.invoke('start-download'),
      }))
      setUpdateAvailable(true)
    } else {
      setUpdateAvailable(false)
    }
  }, [])

  const onUpdateError = useCallback((_event: any, arg1: any) => {
    setUpdateAvailable(false)
    setUpdateError(arg1)
  }, [])

  const onDownloadProgress = useCallback((_event: any, arg1: any) => {
    setProgressInfo(arg1)
  }, [])

  const onUpdateDownloaded = useCallback((_event: any) => {
    setProgressInfo({ percent: 100 })
    setModalBtn(state => ({
      ...state,
      cancelText: 'Later',
      okText: 'Install now',
      onOk: () => window.ipcRenderer.invoke('quit-and-install'),
    }))
  }, [])

  useEffect(() => {
    window.ipcRenderer.on('update-can-available', onUpdateCanAvailable)
    window.ipcRenderer.on('update-error', onUpdateError)
    window.ipcRenderer.on('download-progress', onDownloadProgress)
    window.ipcRenderer.on('update-downloaded', onUpdateDownloaded)
    return () => {
      window.ipcRenderer.off('update-can-available', onUpdateCanAvailable)
      window.ipcRenderer.off('update-error', onUpdateError)
      window.ipcRenderer.off('download-progress', onDownloadProgress)
      window.ipcRenderer.off('update-downloaded', onUpdateDownloaded)
    }
  }, [onUpdateCanAvailable, onUpdateError, onDownloadProgress, onUpdateDownloaded])

  useEffect(() => {
    checkUpdate(true)
  }, [])

  useEffect(() => {
    if (lastCheckedAt == null) return
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [lastCheckedAt])

  useEffect(() => {
    if (!settingsOpen) return
    setPrefsDraft(getAppPreferences())
  }, [settingsOpen])

  const saveSettings = useCallback(() => {
    setAppPreferences(prefsDraft)
    applyThemeToDocument(prefsDraft.theme)
    setSettingsOpen(false)
  }, [prefsDraft])

  const resetSettings = useCallback(() => {
    setPrefsDraft(defaultPreferences)
  }, [])

  return (
    <div className="min-h-full flex-1 bg-base-100 text-base-content flex flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-bold text-center mb-2 text-primary flex items-center justify-center gap-3">
        <img src={yeeCharmGif} alt="" className="w-12 h-12 object-contain" />
        Omni Screen
        <img src={yeeCharmGif} alt="" className="w-12 h-12 object-contain" />
      </h1>
      <p
        role="button"
        tabIndex={0}
        className="text-base-content/60 text-sm mb-12 cursor-default select-none"
        onClick={handleStrawWaffleClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleStrawWaffleClick() }}
      >
        Vibed by StrawWaffle
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl w-full mb-8">
        {/* Link Scroller - Active */}
        <button
          className="card bg-base-200 shadow-xl p-8 hover:shadow-2xl transition-shadow cursor-pointer"
          onClick={() => onNavigate('link-scroller')}
        >
          <div className="card-body flex-row items-center gap-6">
            <img src={randomIcon} alt="" className="w-32 h-32 object-contain flex-shrink-0" />
            <div className="flex flex-col text-left">
              <h2 className="card-title text-2xl mb-2">Link Scroller</h2>
              <p className="text-base-content/70">
                Browse and filter messages with embedded media from various platforms
              </p>
            </div>
          </div>
        </button>

        {/* Omni Screen */}
        <button
          className="card bg-base-200 shadow-xl p-8 hover:shadow-2xl transition-shadow cursor-pointer"
          onClick={() => onNavigate('omni-screen')}
        >
          <div className="card-body flex-row items-center gap-6">
            <img src={logoPng} alt="" className="w-32 h-32 object-contain flex-shrink-0" />
            <div className="flex flex-col text-left">
              <h2 className="card-title text-2xl mb-2">Omni Screen</h2>
              <p className="text-base-content/70">
                Split-screen embeds + live chat
              </p>
            </div>
          </div>
        </button>
      </div>

      {/* Update Button */}
      <div className="card bg-base-200 shadow-xl p-6 max-w-md w-full">
        <div className="flex flex-col gap-3">
          <button className="btn btn-secondary w-full" disabled={checking} onClick={() => checkUpdate(false)}>
            {checking ? 'Checking...' : updateAvailable ? 'Update available' : 'Check for Updates'}
          </button>
          <p className="text-base-content/50 text-xs text-center">
            {lastCheckedAt == null ? 'Last checked: never' : `Last checked: ${formatLastCheckedAgo(lastCheckedAt)}`}
          </p>
          <button className="btn btn-outline w-full" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </div>

      {/* Acknowledgements */}
      <p className="text-base-content/50 text-xs text-center mt-8 max-w-md">
        Thanks to polecat.me, Rustlesearch, d.gg utilities (vyneer), and Kickstiny for (unwittingly) tolerating my abuse of their APIs and scripts.
      </p>

      {/* Update Modal */}
      {modalOpen && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-300 text-base-content max-w-md">
            <h3 className="font-bold text-lg mb-4">Update Status</h3>
            <div className="mb-4">
              {updateError ? (
                <div>
                  <p className="text-error mb-2">Error downloading the latest version.</p>
                  <p className="text-error text-sm">{updateError.message}</p>
                </div>
              ) : updateAvailable ? (
                <div>
                  <div className="text-success mb-2">The latest version is: v{versionInfo?.newVersion}</div>
                  <div className="text-base-content/70 text-sm mb-4">Current: v{versionInfo?.version} → v{versionInfo?.newVersion}</div>
                  <div className="mb-4">
                    <div className="text-sm mb-2">Update progress:</div>
                    <div className="bg-base-200 rounded-full h-4 w-full overflow-hidden">
                      <div 
                        className="bg-success h-full transition-all duration-300" 
                        style={{width: `${progressInfo?.percent||0}%`}}
                      ></div>
                    </div>
                    <div className="text-xs mt-2 text-base-content/70">{progressInfo?.percent ? `${progressInfo.percent.toFixed(1)}%` : '0%'}</div>
                  </div>
                </div>
              ) : (
                <div className="text-base-content/50">
                  No update available.<br/>
                  <pre className="text-xs mt-2 bg-base-200 p-2 rounded overflow-auto">
                    {JSON.stringify(versionInfo ?? {}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button className="btn btn-outline" onClick={modalBtn.onCancel}>
                {modalBtn.cancelText||'Close'}
              </button>
              {updateAvailable && (
                <button className="btn btn-primary" onClick={modalBtn.onOk}>
                  {modalBtn.okText||'Update'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-300 text-base-content max-w-lg p-6">
            <h3 className="font-bold text-lg mb-6">App Settings</h3>

            <div className="space-y-6">
              <div className="border border-base-200 rounded-lg p-5">
                <div className="font-semibold mb-4">Theme</div>

                <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
                  <label className="label py-0 pr-0">
                    <span className="label-text">Mode</span>
                  </label>
                  <select
                    className="select select-bordered w-48"
                    value={prefsDraft.theme.mode}
                    onChange={(e) =>
                      setPrefsDraft((p) => ({
                        ...p,
                        theme: { ...p.theme, mode: e.target.value as any },
                      }))
                    }
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>

                  <label className="label py-0 pr-0">
                    <span className="label-text">Light theme</span>
                  </label>
                  <select
                    className="select select-bordered w-48"
                    value={prefsDraft.theme.lightTheme}
                    disabled={prefsDraft.theme.mode === 'dark'}
                    onChange={(e) =>
                      setPrefsDraft((p) => ({
                        ...p,
                        theme: { ...p.theme, lightTheme: e.target.value as any },
                      }))
                    }
                  >
                    {lightThemes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  <label className="label py-0 pr-0">
                    <span className="label-text">Dark theme</span>
                  </label>
                  <select
                    className="select select-bordered w-48"
                    value={prefsDraft.theme.darkTheme}
                    disabled={prefsDraft.theme.mode === 'light'}
                    onChange={(e) =>
                      setPrefsDraft((p) => ({
                        ...p,
                        theme: { ...p.theme, darkTheme: e.target.value as any },
                      }))
                    }
                  >
                    {darkThemes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  <label className="label py-0 pr-0">
                    <span className="label-text">Embed theme</span>
                  </label>
                  <select
                    className="select select-bordered w-48"
                    value={prefsDraft.theme.embedTheme}
                    onChange={(e) =>
                      setPrefsDraft((p) => ({
                        ...p,
                        theme: { ...p.theme, embedTheme: e.target.value as any },
                      }))
                    }
                  >
                    <option value="follow">Follow app theme</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>
              </div>

              <div className="border border-base-200 rounded-lg p-5">
                <div className="font-semibold mb-4">Userscripts</div>

                <div className="space-y-4">
                  <label className="flex items-start justify-between gap-4 py-1">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">Destiny chat: d.gg utilities</div>
                      <div className="text-xs text-base-content/60 mt-1">
                        Injects d.gg utilities into embedded chat (BrowserView). Off = iframe only.
                      </div>
                      <a
                        href="https://vyneer.me/utilities"
                        target="_blank"
                        rel="noreferrer"
                        className="link link-primary text-xs mt-0.5 inline-block"
                      >
                        vyneer.me/utilities
                      </a>
                    </div>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm flex-shrink-0 mt-0.5"
                      checked={prefsDraft.userscripts.dggUtilities}
                      onChange={(e) =>
                        setPrefsDraft((p) => ({
                          ...p,
                          userscripts: { ...p.userscripts, dggUtilities: e.target.checked },
                        }))
                      }
                    />
                  </label>

                  <div className="divider my-1" />

                  <label className="flex items-start justify-between gap-4 py-1">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">Kick embeds: Kickstiny</div>
                      <div className="text-xs text-base-content/60 mt-1">
                        Injects kickstiny.user.js into Kick player embeds.
                      </div>
                      <a
                        href="https://github.com/destinygg/kickstiny"
                        target="_blank"
                        rel="noreferrer"
                        className="link link-primary text-xs mt-0.5 inline-block"
                      >
                        github.com/destinygg/kickstiny
                      </a>
                    </div>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm flex-shrink-0 mt-0.5"
                      checked={prefsDraft.userscripts.kickstiny}
                      onChange={(e) =>
                        setPrefsDraft((p) => ({
                          ...p,
                          userscripts: { ...p.userscripts, kickstiny: e.target.checked },
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="modal-action mt-6 pt-4 border-t border-base-200">
              <button className="btn btn-ghost" onClick={resetSettings}>
                Reset
              </button>
              <button className="btn btn-outline" onClick={() => setSettingsOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveSettings}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Menu
