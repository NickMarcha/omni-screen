import { useEffect, useState } from 'react'
import LinkScroller from './components/LinkScroller'
import Menu from './components/Menu'
import OmniScreen from './components/OmniScreen'
import TitleBar from './components/TitleBar'
import { applyThemeToDocument, getAppPreferences } from './utils/appPreferences'
import './App.css'

type Page = 'menu' | 'link-scroller' | 'omni-screen'

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('menu')

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

  const handleNavigate = (page: 'link-scroller' | 'omni-screen') => {
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
    ) : (
      <Menu onNavigate={handleNavigate} />
    )

  return (
    <div className="flex flex-col h-full min-h-0 bg-base-100 text-base-content">
      <TitleBar />
      {/* pt-1 gives a small gap so DevTools or first row of content isn't covered by the title bar */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden pt-1 relative z-0">{pageContent}</main>
    </div>
  )
}

export default App
