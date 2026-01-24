import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})

// Suppress TikTok SDK errors globally to reduce console noise
const originalError = console.error
const originalWarn = console.warn

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
  if (!shouldSuppress(args)) {
    originalError.apply(console, args)
  }
}

console.warn = (...args: any[]) => {
  if (!shouldSuppress(args)) {
    originalWarn.apply(console, args)
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