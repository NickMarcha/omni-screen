import { useEffect, useState } from 'react'
import LinkScroller from './components/LinkScroller'
import Menu from './components/Menu'
import OmniScreen from './components/OmniScreen'
import './App.css'

type Page = 'menu' | 'link-scroller' | 'omni-screen'

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('menu')

  // Ensure theme is applied to root div as well
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) {
      const htmlTheme = document.documentElement.getAttribute('data-theme')
      if (htmlTheme) {
        root.setAttribute('data-theme', htmlTheme)
      }
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
