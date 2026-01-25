import { useEffect, useState } from 'react'
import LinkScroller from './components/LinkScroller'
import Menu from './components/Menu'
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
    // Placeholder for future Omni Screen features
    return (
      <div className="min-h-screen bg-base-100 text-base-content flex flex-col items-center justify-center p-8">
        <h1 className="text-5xl font-bold text-center mb-8 text-primary">Omni Screen</h1>
        <p className="text-base-content/70 mb-8">Coming soon...</p>
        <button className="btn btn-primary" onClick={handleBackToMenu}>
          Back to Menu
        </button>
      </div>
    )
  }

  return <Menu onNavigate={handleNavigate} />
}

export default App
