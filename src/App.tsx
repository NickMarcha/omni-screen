import { useEffect } from 'react'
import LinkScroller from './components/LinkScroller'
import './App.css'

function App() {
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
  
  return <LinkScroller />
}

export default App
