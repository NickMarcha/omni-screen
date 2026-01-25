import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { logger } from './utils/logger'

// Apply theme immediately on load (before React renders)
function applyInitialTheme() {
  try {
    const saved = localStorage.getItem('omni-screen-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      const theme = parsed.theme || { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' }
      const html = document.documentElement
      const body = document.body
      
      let themeToApply: string
      if (theme.mode === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        themeToApply = mediaQuery.matches ? (theme.darkTheme || 'business') : (theme.lightTheme || 'retro')
      } else if (theme.mode === 'light') {
        themeToApply = theme.lightTheme || 'retro'
      } else {
        themeToApply = theme.darkTheme || 'business'
      }
      html.setAttribute('data-theme', themeToApply)
      body.setAttribute('data-theme', themeToApply)
    } else {
      // Default to business theme
      document.documentElement.setAttribute('data-theme', 'business')
      document.body.setAttribute('data-theme', 'business')
    }
    } catch (e) {
      console.error('Failed to apply initial theme:', e)
      // Fallback to business
      document.documentElement.setAttribute('data-theme', 'business')
      document.body.setAttribute('data-theme', 'business')
      logger.theme('Applied fallback theme: business')
    }
  }

// Apply theme before React renders
applyInitialTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})

// Intercept console methods in renderer to send to main process for file logging
// This must be done before other console overrides
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const originalConsoleInfo = console.info
const originalConsoleDebug = console.debug

const sendToFile = (level: string, ...args: any[]) => {
  try {
    if (typeof window !== 'undefined' && window.ipcRenderer) {
      const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
      window.ipcRenderer.invoke('log-to-file', level, message, args).catch(() => {
        // Silently fail if IPC is not available
      })
    }
  } catch (e) {
    // Silently fail
  }
}

// Override console methods to send to file (but preserve original behavior)
console.log = (...args: any[]) => {
  sendToFile('info', ...args)
  originalConsoleLog.apply(console, args)
}

console.info = (...args: any[]) => {
  sendToFile('info', ...args)
  originalConsoleInfo.apply(console, args)
}

console.debug = (...args: any[]) => {
  sendToFile('debug', ...args)
  originalConsoleDebug.apply(console, args)
}

// Suppress TikTok SDK errors globally to reduce console noise
// Note: These overrides will also send to file before suppressing

// Suppress specific TikTok/Chrome cookie warnings
const shouldSuppress = (args: any[]): boolean => {
  const msg = args[0]?.toString() || ''
  return (
    msg.includes('Chrome is moving towards a new experience') ||
    msg.includes('webmssdk') ||
    msg.includes('Cannot read properties of undefined') && msg.includes('prod') ||
    msg.includes('tiktok_web_embed') ||
    msg.includes('webmssdk_ex.js')
  )
}

console.error = (...args: any[]) => {
  sendToFile('error', ...args)
  if (!shouldSuppress(args)) {
    originalConsoleError.apply(console, args)
  }
}

console.warn = (...args: any[]) => {
  sendToFile('warn', ...args)
  if (!shouldSuppress(args)) {
    originalConsoleWarn.apply(console, args)
  }
}

// Override window.onerror to catch uncaught exceptions from TikTok scripts
const originalOnError = window.onerror
window.onerror = (message, source, lineno, colno, error) => {
  const errorMsg = message?.toString() || error?.toString() || ''
  const sourceFile = source?.toString() || ''
  
  if (
    errorMsg.includes('webmssdk') ||
    errorMsg.includes('Cannot read properties of undefined') ||
    errorMsg.includes('prod') ||
    sourceFile.includes('webmssdk') ||
    sourceFile.includes('webmssdk_ex') ||
    sourceFile.includes('tiktok')
  ) {
    return true // Suppress the error
  }
  
  // Call original handler for other errors
  if (originalOnError) {
    return originalOnError.call(window, message, source, lineno, colno, error)
  }
  return false
}

// Also catch errors via addEventListener as backup
window.addEventListener('error', (event) => {
  const errorMsg = event.message || event.error?.toString() || ''
  const source = event.filename || ''
  
  if (
    errorMsg.includes('webmssdk') ||
    errorMsg.includes('Cannot read properties of undefined') ||
    errorMsg.includes('prod') ||
    source.includes('webmssdk') ||
    source.includes('webmssdk_ex') ||
    source.includes('tiktok')
  ) {
    event.preventDefault() // Suppress the error
    event.stopPropagation() // Stop event propagation
  }
}, true) // Use capture phase to catch errors early

// Also catch unhandled promise rejections from TikTok scripts
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.toString() || ''
  if (
    reason.includes('webmssdk') ||
    reason.includes('tiktok_web_embed') ||
    reason.includes('Cannot read properties of undefined') ||
    reason.includes('prod')
  ) {
    event.preventDefault() // Suppress the error
  }
})