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

const CONNECTIONS_PLATFORMS: Array<{
  id: string
  label: string
  loginUrl: string
  /** Service name for open-login-window (opens in-app browser to log in). */
  loginService: string
  description: string
  cookieNames: string[]
  namePrefix?: string
  snippet: string
  httpOnlyNote?: string
  /** When set, show one input per cookie (for httpOnly); user can paste from DevTools or use Log in in browser. */
  manualCookieNames?: string[]
}> = [
  {
    id: 'dgg',
    label: 'Destiny.gg (DGG)',
    loginUrl: 'https://www.destiny.gg/login',
    loginService: 'destiny',
    description: 'Used for DGG chat (combined chat), whispers, and DGG API.',
    cookieNames: ['sid', 'rememberme'],
    snippet: `(function(){var n=['sid','rememberme'];var c=document.cookie.split(';').map(function(s){var i=s.indexOf('=');return i>=0?[s.slice(0,i).trim(),s.slice(i+1).trim()]:null}).filter(Boolean);var o=c.filter(function(p){return n.indexOf(p[0])>=0}).map(function(p){return p[0]+'='+p[1]}).join('; ');console.log('Paste this into Omni Screen:',o);try{copy(JSON.stringify(o))}catch(e){}return o;})()`,
    httpOnlyNote: "DGG session cookies (sid, rememberme) are httpOnly. Use \"Log in in browser\" below or fill the fields manually (copy from DevTools → Application → Cookies).",
    manualCookieNames: ['sid', 'rememberme'],
  },
  {
    id: 'youtube',
    label: 'YouTube',
    loginUrl: 'https://www.youtube.com',
    loginService: 'youtube',
    description: 'Used for YouTube embeds (including age-restricted) and YouTube live chat in combined chat.',
    cookieNames: ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'SIDCC', 'NID', 'LOGIN_INFO'],
    namePrefix: '__Secure-',
    snippet: `(function(){var n=['SID','HSID','SSID','APISID','SAPISID','SIDCC','NID','LOGIN_INFO'];var c=document.cookie.split(';').map(function(s){var i=s.indexOf('=');return i>=0?[s.slice(0,i).trim(),s.slice(i+1).trim()]:null}).filter(Boolean);var o=c.filter(function(p){return n.indexOf(p[0])>=0||(p[0].indexOf&&p[0].indexOf('__Secure-')===0)}).map(function(p){return p[0]+'='+p[1]}).join('; ');console.log('Paste this into Omni Screen:',o);try{copy(JSON.stringify(o))}catch(e){}return o;})()`,
  },
  {
    id: 'kick',
    label: 'Kick',
    loginUrl: 'https://kick.com',
    loginService: 'kick',
    description: 'Used for Kick embeds and Kick chat in combined chat.',
    cookieNames: [],
    snippet: `(function(){var o=document.cookie;console.log('Paste this into Omni Screen:',o);try{copy(JSON.stringify(o))}catch(e){}return o;})()`,
  },
  {
    id: 'twitch',
    label: 'Twitch',
    loginUrl: 'https://www.twitch.tv',
    loginService: 'twitch',
    description: 'Used for Twitch embeds and Twitch chat in combined chat.',
    cookieNames: ['auth-token', 'unique_id'],
    snippet: `(function(){var n=['auth-token','unique_id'];var c=document.cookie.split(';').map(function(s){var i=s.indexOf('=');return i>=0?[s.slice(0,i).trim(),s.slice(i+1).trim()]:null}).filter(Boolean);var o=c.filter(function(p){return n.indexOf(p[0])>=0}).map(function(p){return p[0]+'='+p[1]}).join('; ');console.log('Paste this into Omni Screen:',o);try{copy(JSON.stringify(o))}catch(e){}return o;})()`,
  },
  {
    id: 'twitter',
    label: 'Twitter / X',
    loginUrl: 'https://twitter.com/i/flow/login',
    loginService: 'twitter',
    description: 'Used for Twitter/X tweet embeds (e.g. in Link Scroller).',
    cookieNames: ['auth_token', 'ct0'],
    snippet: `(function(){var n=['auth_token','ct0'];var c=document.cookie.split(';').map(function(s){var i=s.indexOf('=');return i>=0?[s.slice(0,i).trim(),s.slice(i+1).trim()]:null}).filter(Boolean);var o=c.filter(function(p){return n.indexOf(p[0])>=0}).map(function(p){return p[0]+'='+p[1]}).join('; ');console.log('Paste this into Omni Screen:',o);try{copy(JSON.stringify(o))}catch(e){}return o;})()`,
    httpOnlyNote: 'Twitter auth cookies are often httpOnly. Use "Log in in browser" below or fill the fields manually.',
    manualCookieNames: ['auth_token', 'ct0'],
  },
  {
    id: 'reddit',
    label: 'Reddit',
    loginUrl: 'https://www.reddit.com/login',
    loginService: 'reddit',
    description: 'Used for Reddit post embeds (e.g. in Link Scroller).',
    cookieNames: ['reddit_session'],
    snippet: `(function(){var n=['reddit_session'];var c=document.cookie.split(';').map(function(s){var i=s.indexOf('=');return i>=0?[s.slice(0,i).trim(),s.slice(i+1).trim()]:null}).filter(Boolean);var o=c.filter(function(p){return n.indexOf(p[0])>=0}).map(function(p){return p[0]+'='+p[1]}).join('; ');console.log('Paste this into Omni Screen:',o);try{copy(JSON.stringify(o))}catch(e){}return o;})()`,
    httpOnlyNote: 'Reddit session cookie is often httpOnly. Use "Log in in browser" below or fill the field manually.',
    manualCookieNames: ['reddit_session'],
  },
]

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
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [prefsDraft, setPrefsDraft] = useState<AppPreferences>(() => getAppPreferences())

  // Connections: pasted cookie strings per platform (local state only; Save sends to main)
  const [connectionsDraft, setConnectionsDraft] = useState<Record<string, string>>({
    dgg: '',
    youtube: '',
    kick: '',
    twitch: '',
    twitter: '',
    reddit: '',
  })
  // Manual cookie fields for httpOnly platforms: platformId -> { cookieName: value }
  const [connectionsManualCookies, setConnectionsManualCookies] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {}
    CONNECTIONS_PLATFORMS.forEach((p) => {
      if (p.manualCookieNames?.length) {
        init[p.id] = Object.fromEntries(p.manualCookieNames.map((n) => [n, '']))
      }
    })
    return init
  })
  const [connectionsShowValues, setConnectionsShowValues] = useState<Record<string, boolean>>({})
  const [connectionsSaveStatus, setConnectionsSaveStatus] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [connectionsParanoidMode, setConnectionsParanoidMode] = useState(false)
  const [connectionsLoggedIn, setConnectionsLoggedIn] = useState<Record<string, boolean>>({})

  const refreshConnectionsLoggedIn = useCallback(() => {
    CONNECTIONS_PLATFORMS.forEach((p) => {
      window.ipcRenderer.invoke('connections-has-cookies', p.id).then((has: boolean) => {
        setConnectionsLoggedIn((prev) => (prev[p.id] === has ? prev : { ...prev, [p.id]: has }))
      })
    })
  }, [])

  const refreshConnectionsManualCookies = useCallback(() => {
    const platforms = CONNECTIONS_PLATFORMS.filter((p) => p.manualCookieNames?.length)
    if (platforms.length === 0) return
    Promise.all(
      platforms.map(async (p) => {
        const cookies = await window.ipcRenderer.invoke('connections-get-cookies', {
          platformId: p.id,
          cookieNames: p.manualCookieNames!,
        })
        return { platformId: p.id, cookies } as const
      })
    ).then((results) => {
      setConnectionsManualCookies((prev) => {
        const next = { ...prev }
        for (const { platformId, cookies } of results) {
          const existing = next[platformId] ?? {}
          next[platformId] = { ...existing, ...cookies }
        }
        return next
      })
    })
  }, [])

  const refreshConnectionsAll = useCallback(() => {
    refreshConnectionsManualCookies()
    refreshConnectionsLoggedIn()
  }, [refreshConnectionsManualCookies, refreshConnectionsLoggedIn])

  // When Connections modal opens, load current session cookies and logged-in state (from persist:main)
  useEffect(() => {
    if (!connectionsOpen) return
    refreshConnectionsAll()
  }, [connectionsOpen, refreshConnectionsAll])

  // When login window closes, refresh so manual fields and logged-in state stay in sync
  useEffect(() => {
    const handler = () => refreshConnectionsAll()
    window.ipcRenderer.on('connections-refresh-cookies', handler)
    return () => {
      window.ipcRenderer.off('connections-refresh-cookies', handler)
    }
  }, [refreshConnectionsAll])

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
          <div className="flex gap-2 w-full">
            <button className="btn btn-outline flex-1" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <button className="btn btn-outline flex-1" onClick={() => setConnectionsOpen(true)}>
              Connections
            </button>
          </div>
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

      {/* Connections Modal.
          Clear messages don't show cookie counts: the same number often reappears because embeds/loaded content
          immediately set cookies again (session is persist:main); clearing still logs out DGG and wipes session cookies. */}
      {connectionsOpen && (
        <div className="modal modal-open">
          <div className="modal-box bg-base-300 text-base-content max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <h3 className="font-bold text-lg mb-2">Connections</h3>
            <p className="text-sm text-base-content/70 mb-3">
              Add cookies per platform to use embeds and chat.
            </p>
            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="toggle toggle-sm"
                  checked={connectionsParanoidMode}
                  onChange={(e) => setConnectionsParanoidMode(e.target.checked)}
                />
                <span className="text-sm">Paranoid mode</span>
              </label>
              {connectionsParanoidMode && (
                <p className="text-xs text-base-content/50 mt-2">
                  Paste cookies only—you never type your password in this app.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                type="button"
                className="btn btn-sm btn-error btn-outline"
                onClick={async () => {
                  const result = await window.ipcRenderer.invoke('connections-clear-all-sessions')
                  if (result?.success) {
                    setConnectionsSaveStatus((s) => ({ ...s, _clear: { ok: true, message: 'Sessions cleared.' } }))
                    setConnectionsDraft((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, ''])))
                    setConnectionsManualCookies((prev) => {
                      const next = { ...prev }
                      CONNECTIONS_PLATFORMS.forEach((p) => {
                        if (p.manualCookieNames?.length) {
                          next[p.id] = Object.fromEntries(p.manualCookieNames.map((n) => [n, '']))
                        }
                      })
                      return next
                    })
                  } else {
                    setConnectionsSaveStatus((s) => ({ ...s, _clear: { ok: false, message: result?.error ?? 'Failed' } }))
                  }
                }}
              >
                Delete all sessions
              </button>
              <button
                type="button"
                className="btn btn-sm btn-error btn-outline"
                onClick={async () => {
                  const result = await window.ipcRenderer.invoke('connections-clear-entire-cookie-store')
                  if (result?.success) {
                    setConnectionsSaveStatus((s) => ({ ...s, _clear: { ok: true, message: 'Cookie store cleared.' } }))
                    setConnectionsDraft((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, ''])))
                    setConnectionsManualCookies((prev) => {
                      const next = { ...prev }
                      CONNECTIONS_PLATFORMS.forEach((p) => {
                        if (p.manualCookieNames?.length) {
                          next[p.id] = Object.fromEntries(p.manualCookieNames.map((n) => [n, '']))
                        }
                      })
                      return next
                    })
                  } else {
                    setConnectionsSaveStatus((s) => ({ ...s, _clear: { ok: false, message: result?.error ?? 'Failed' } }))
                  }
                }}
              >
                Clear entire cookie store
              </button>
              {connectionsSaveStatus._clear && (
                <span className={`text-xs ${connectionsSaveStatus._clear.ok ? 'text-success' : 'text-error'}`}>
                  {connectionsSaveStatus._clear.message}
                </span>
              )}
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 space-y-6 pr-2">
              {CONNECTIONS_PLATFORMS.map((platform) => {
                const showValues = connectionsShowValues[platform.id] ?? false
                const manualCookies = connectionsManualCookies[platform.id] ?? {}
                const hasManualValues = platform.manualCookieNames?.some((n) => (manualCookies[n] ?? '').trim())
                const blobValue = (connectionsDraft[platform.id] ?? '').trim()
                return (
                  <div key={platform.id} className="border border-base-200 rounded-lg p-4">
                    <div className="font-medium mb-1">{platform.label}</div>
                    <p className="text-xs text-base-content/60 mb-3">{platform.description}</p>
                    {!connectionsParanoidMode && (
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        {!(connectionsLoggedIn[platform.id] ?? false) && (
                          <button
                            type="button"
                            className="btn btn-xs btn-primary"
                            onClick={() => window.ipcRenderer.invoke('open-login-window', platform.loginService).catch(() => {})}
                          >
                            Log in
                          </button>
                        )}
                        {(connectionsLoggedIn[platform.id] ?? false) && (
                          <span className="text-xs text-base-content/60">Logged in.</span>
                        )}
                        <button
                          type="button"
                          className="btn btn-xs btn-ghost btn-error"
                          onClick={async () => {
                            const result = await window.ipcRenderer.invoke('connections-clear-platform', platform.id)
                            if (result?.success) {
                              setConnectionsSaveStatus((s) => ({ ...s, [platform.id]: { ok: true, message: 'Cookies cleared.' } }))
                              setConnectionsDraft((prev) => ({ ...prev, [platform.id]: '' }))
                              setConnectionsManualCookies((prev) => {
                                const next = { ...prev }
                                if (platform.manualCookieNames?.length) {
                                  next[platform.id] = Object.fromEntries(platform.manualCookieNames.map((n) => [n, '']))
                                }
                                return next
                              })
                              refreshConnectionsLoggedIn()
                            } else {
                              setConnectionsSaveStatus((s) => ({ ...s, [platform.id]: { ok: false, message: result?.error ?? 'Failed' } }))
                            }
                          }}
                        >
                          Delete cookies
                        </button>
                      </div>
                    )}
                    {connectionsParanoidMode && (
                      <>
                        {platform.httpOnlyNote && (
                          <p className="text-xs text-warning/90 mb-3 p-2 bg-warning/10 rounded">{platform.httpOnlyNote}</p>
                        )}
                        {platform.manualCookieNames && platform.manualCookieNames.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-base-content/50 mb-2">Fill manually (from DevTools → Application → Cookies):</p>
                            <div className="space-y-2">
                              {platform.manualCookieNames.map((name) => (
                                <div key={name} className="flex items-center gap-2">
                                  <label className="text-xs font-mono w-32 shrink-0">{name}</label>
                                  <input
                                    type={showValues ? 'text' : 'password'}
                                    className="input input-bordered input-sm flex-1 font-mono text-xs"
                                    placeholder="value"
                                    value={manualCookies[name] ?? ''}
                                    onChange={(e) =>
                                      setConnectionsManualCookies((prev) => ({
                                        ...prev,
                                        [platform.id]: { ...(prev[platform.id] ?? {}), [name]: e.target.value },
                                      }))
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-ghost"
                                    title={showValues ? 'Hide value' : 'Show value'}
                                    onClick={() =>
                                      setConnectionsShowValues((s) => ({ ...s, [platform.id]: !(s[platform.id] ?? false) }))
                                    }
                                  >
                                    {showValues ? 'Hide' : 'Show'}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="text-xs text-base-content/50 mb-2">Or paste full cookie string below:</p>
                        {showValues ? (
                          <>
                            <textarea
                              className="textarea textarea-bordered textarea-sm w-full font-mono text-xs min-h-[60px]"
                              placeholder='e.g. name1=value1; name2=value2'
                              value={connectionsDraft[platform.id] ?? ''}
                              onChange={(e) =>
                                setConnectionsDraft((prev) => ({ ...prev, [platform.id]: e.target.value }))
                              }
                            />
                            {(blobValue.length > 0 || hasManualValues) && (
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost mt-1"
                                onClick={() => setConnectionsShowValues((s) => ({ ...s, [platform.id]: false }))}
                              >
                                Hide values
                              </button>
                            )}
                          </>
                        ) : (
                          <div
                            className="border border-base-300 rounded-lg min-h-[60px] flex items-center justify-center bg-base-200/50 cursor-pointer"
                            onClick={() => setConnectionsShowValues((s) => ({ ...s, [platform.id]: true }))}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && setConnectionsShowValues((s) => ({ ...s, [platform.id]: true }))}
                          >
                            <span className="text-xs text-base-content/60">
                              {blobValue.length > 0
                                ? `Hidden (${blobValue.length} characters). Click to show or edit.`
                                : 'Click to show and paste cookie string.'}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {connectionsParanoidMode && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          if (hasManualValues) {
                            const cookies: Record<string, string> = {}
                            platform.manualCookieNames?.forEach((n) => {
                              const v = (manualCookies[n] ?? '').trim()
                              if (v) cookies[n] = v
                            })
                            if (Object.keys(cookies).length === 0) {
                              setConnectionsSaveStatus((s) => ({
                                ...s,
                                [platform.id]: { ok: false, message: 'Fill at least one field.' },
                              }))
                              return
                            }
                            const result = await window.ipcRenderer.invoke('connections-set-cookies', {
                              platform: platform.id,
                              cookies,
                            })
                            setConnectionsSaveStatus((s) => ({
                              ...s,
                              [platform.id]: {
                                ok: !!result?.success,
                                message: result?.success ? `Saved ${result.count ?? 0} cookies.` : result?.error ?? 'Failed',
                              },
                            }))
                            return
                          }
                          if (!blobValue) {
                            setConnectionsSaveStatus((s) => ({
                              ...s,
                              [platform.id]: { ok: false, message: 'Paste cookies or fill the fields above.' },
                            }))
                            return
                          }
                          const result = await window.ipcRenderer.invoke('connections-set-cookies', {
                            platform: platform.id,
                            cookieString: blobValue,
                          })
                          setConnectionsSaveStatus((s) => ({
                            ...s,
                            [platform.id]: {
                              ok: !!result?.success,
                              message: result?.success
                                ? `Saved ${result.count ?? 0} cookies.`
                                : result?.error ?? 'Failed',
                            },
                          }))
                        }}
                      >
                        Save cookies
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-error"
                        onClick={async () => {
                          const result = await window.ipcRenderer.invoke('connections-clear-platform', platform.id)
                          if (result?.success) {
                            setConnectionsSaveStatus((s) => ({ ...s, [platform.id]: { ok: true, message: 'Cookies cleared.' } }))
                            setConnectionsDraft((prev) => ({ ...prev, [platform.id]: '' }))
                            setConnectionsManualCookies((prev) => {
                              const next = { ...prev }
                              if (platform.manualCookieNames?.length) {
                                next[platform.id] = Object.fromEntries(platform.manualCookieNames.map((n) => [n, '']))
                              }
                              return next
                            })
                            refreshConnectionsLoggedIn()
                          } else {
                            setConnectionsSaveStatus((s) => ({ ...s, [platform.id]: { ok: false, message: result?.error ?? 'Failed' } }))
                          }
                        }}
                      >
                        Delete cookies
                      </button>
                      {connectionsSaveStatus[platform.id] && (
                        <span
                          className={`text-xs ${connectionsSaveStatus[platform.id].ok ? 'text-success' : 'text-error'}`}
                        >
                          {connectionsSaveStatus[platform.id].message}
                        </span>
                      )}
                    </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="modal-action mt-4 flex-shrink-0">
              <button className="btn btn-ghost" onClick={() => setConnectionsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Menu
