import { useEffect, useRef, useState } from 'react'
import LinkScroller from './components/LinkScroller'
import Menu from './components/Menu'
import OmniScreen from './components/OmniScreen'
import DebugPage from './components/DebugPage'
import TitleBar from './components/TitleBar'
import { applyThemeToDocument, getAppPreferences } from './utils/appPreferences'
import './App.css'

type Page = 'menu' | 'link-scroller' | 'omni-screen' | 'debug'

const TOAST_DURATION_MS = 4000

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('menu')
  const [titleBarVisible, setTitleBarVisible] = useState(true)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Alt or View → Hide title bar: toggle title bar visibility.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !e.repeat) {
        e.preventDefault()
        setTitleBarVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    const unsub = window.ipcRenderer?.on?.('title-bar-toggle', () => setTitleBarVisible((v) => !v)) as unknown as (() => void) | undefined
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unsub?.()
    }
  }, [])

  // Apply persisted theme on app load (Menu can edit it).
  useEffect(() => {
    const prefs = getAppPreferences()
    applyThemeToDocument(prefs.theme)

    // If using system mode, re-apply on system theme changes
    if (prefs.theme.mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => applyThemeToDocument(getAppPreferences().theme)
      mediaQuery.addEventListener?.('change', handler)
      return () => mediaQuery.removeEventListener?.('change', handler)
    }
  }, [])

  // Protocol add-streamer: merge into bookmarked streamers, notify OmniScreen, show toast
  useEffect(() => {
    const showToast = (type: 'success' | 'error', message: string) => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
      setToast({ type, message })
      toastTimeoutRef.current = setTimeout(() => {
        setToast(null)
        toastTimeoutRef.current = null
      }, TOAST_DURATION_MS)
    }
    const handler = (
      _event: unknown,
      result: { operation?: string; ok?: boolean; message?: string; streamer?: Record<string, unknown> }
    ) => {
      if (result?.operation !== 'add-streamer') return
      if (result.ok === false) {
        showToast('error', result.message || 'Failed to add bookmark')
        return
      }
      if (!result.streamer) return
      try {
        const key = 'omni-screen:bookmarked-streamers'
        const raw = localStorage.getItem(key)
        const list: unknown[] = raw ? JSON.parse(raw) : []
        if (!Array.isArray(list)) {
          showToast('error', 'Failed to add bookmark')
          return
        }
        const streamer = result.streamer as Record<string, unknown>
        if (typeof streamer.id !== 'string' || typeof streamer.nickname !== 'string') {
          showToast('error', 'Invalid bookmark data')
          return
        }
        list.push(streamer)
        localStorage.setItem(key, JSON.stringify(list))
        window.dispatchEvent(new CustomEvent('bookmarked-streamers-changed'))
        showToast('success', 'Bookmark saved')
      } catch (e) {
        console.error('[App] protocol add-streamer failed:', e)
        showToast('error', 'Failed to save bookmark')
      }
    }
    window.ipcRenderer?.on?.('protocol-result', handler)
    return () => {
      window.ipcRenderer?.off?.('protocol-result', handler)
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    }
  }, [])

  // File → Copy config: gather localStorage and copy to clipboard
  useEffect(() => {
    const handler = () => {
      try {
        const config: Record<string, string> = {}
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('omni-screen')) {
            const value = localStorage.getItem(key)
            if (value != null) config[key] = value
          }
        }
        const json = JSON.stringify(config, null, 2)
        window.ipcRenderer?.invoke('copy-config-to-clipboard', json)
      } catch (e) {
        console.error('[App] Copy config failed:', e)
      }
    }
    window.ipcRenderer?.on('config-copy-request', handler)
    return () => {
      window.ipcRenderer?.off('config-copy-request', handler)
    }
  }, [])

  const handleNavigate = (page: 'link-scroller' | 'omni-screen' | 'debug') => {
    setCurrentPage(page)
  }

  const handleBackToMenu = () => {
    setCurrentPage('menu')
  }

  const pageContent =
    currentPage === 'link-scroller' ? (
      <LinkScroller onBackToMenu={handleBackToMenu} />
    ) : currentPage === 'omni-screen' ? (
      <OmniScreen onBackToMenu={handleBackToMenu} />
    ) : currentPage === 'debug' ? (
      <DebugPage onBackToMenu={handleBackToMenu} />
    ) : (
      <Menu onNavigate={handleNavigate} />
    )

  return (
    <div className="flex flex-col h-full min-h-0 bg-base-100 text-base-content">
      {titleBarVisible && <TitleBar />}
      {/* pt-1 gives a small gap so DevTools or first row of content isn't covered by the title bar */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden pt-1 relative z-0">{pageContent}</main>
      {/* Toast for protocol add-streamer result (DaisyUI toast + alert) */}
      <div className="fixed inset-0 pointer-events-none z-[9999]" aria-hidden>
        <div className="absolute bottom-4 right-4 toast toast-end toast-bottom">
          {toast && (
            <div
              className={`alert ${toast.type === 'success' ? 'alert-success' : 'alert-error'} pointer-events-auto shadow-lg`}
            >
              <span>{toast.message}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
