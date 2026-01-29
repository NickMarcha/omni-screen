import { useEffect, useState } from 'react'
import LinkScroller from './components/LinkScroller'
import Menu from './components/Menu'
import OmniScreen from './components/OmniScreen'
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

  // Render based on current page
  if (currentPage === 'link-scroller') {
    return <LinkScroller onBackToMenu={handleBackToMenu} />
  }

  if (currentPage === 'omni-screen') {
    return <OmniScreen onBackToMenu={handleBackToMenu} />
  }

  return <Menu onNavigate={handleNavigate} />
}

export default App
