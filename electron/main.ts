import { app, BrowserWindow, ipcMain, Menu, clipboard, session, BrowserView, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer } from 'http'
import { readFileSync, statSync } from 'fs'
import { update } from './update'
import { fileLogger } from './fileLogger'
import { ChatWebSocket } from './chatWebSocket'
import { LiveWebSocket } from './liveWebSocket'
import { mentionCache } from './mentionCache'
import { KickChatManager } from './kickChatManager'
import { YouTubeChatManager } from './youtubeChatManager'
import { TwitchChatManager } from './twitchChatManager'
import * as destinyEmbedView from './destinyEmbedView'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
// Set APP_ROOT to project root (one level up from dist-electron)
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let viewerWin: BrowserWindow | null = null

// Chat WebSocket instance
let chatWebSocket: ChatWebSocket | null = null
let liveWebSocket: LiveWebSocket | null = null
let kickChatManager: KickChatManager | null = null
let youTubeChatManager: YouTubeChatManager | null = null
let twitchChatManager: TwitchChatManager | null = null

// Update transparency menu to reflect current opacity
function updateTransparencyMenu(opacity: number) {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  
  const windowMenu = menu.items.find(item => item.label === 'Window')
  if (!windowMenu || !windowMenu.submenu) return
  
  const transparencySubmenu = (windowMenu.submenu as Electron.Menu).items.find(
    item => item.label === 'Transparency'
  )
  if (!transparencySubmenu || !transparencySubmenu.submenu) return
  
  const submenu = transparencySubmenu.submenu as Electron.Menu
  submenu.items.forEach((item) => {
    if (item.type === 'radio') {
      item.checked = false
      // Match based on label
      if (opacity === 1.0 && item.label === '100% (Opaque)') {
        item.checked = true
      } else if (opacity === 0.75 && item.label === '75%') {
        item.checked = true
      } else if (opacity === 0.5 && item.label === '50%') {
        item.checked = true
      } else if (opacity === 0.25 && item.label === '25%') {
        item.checked = true
      }
    }
  })
}

// Get the persistent session (shared across all windows and persists between restarts)
function getDefaultSession() {
  // Use the persistent session partition
  return session.fromPartition('persist:main')
}

// Helper function to get cookies for a URL and format them for fetch
async function getCookiesForUrl(url: string): Promise<string> {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    
    // For Twitter/X, get ALL cookies (not just for specific domain)
    // Twitter uses cookies across multiple subdomains and we need them all
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      // Get all cookies and filter for Twitter-related ones
      const allCookies = await getDefaultSession().cookies.get({})
      const twitterCookies = allCookies.filter(cookie => 
        cookie.domain && (
          cookie.domain.includes('twitter.com') || 
          cookie.domain.includes('x.com') ||
          cookie.domain.includes('twimg.com')
        )
      )
      
      // Sort by domain specificity (more specific first)
      twitterCookies.sort((a, b) => {
        const aDomain = a.domain || ''
        const bDomain = b.domain || ''
        const aSpecificity = aDomain.split('.').length
        const bSpecificity = bDomain.split('.').length
        return bSpecificity - aSpecificity
      })
      
      // Remove duplicates (prefer more specific domain cookies)
      const uniqueCookies = new Map<string, Electron.Cookie>()
      for (const cookie of twitterCookies) {
        if (!cookie.domain) continue
        const key = cookie.name
        const existingCookie = uniqueCookies.get(key)
        if (!existingCookie || 
            cookie.domain.split('.').length > (existingCookie.domain?.split('.').length || 0)) {
          uniqueCookies.set(key, cookie)
        }
      }
      
      const cookieString = Array.from(uniqueCookies.values())
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ')
      
      if (cookieString) {
        console.log(`Found ${uniqueCookies.size} Twitter cookies (auth_token, ct0, etc.)`)
        // Log key cookie names for debugging
        const keyNames = Array.from(uniqueCookies.keys()).filter(name => 
          name.includes('auth') || name.includes('token') || name === 'ct0'
        )
        if (keyNames.length > 0) {
          console.log(`Key cookies found: ${keyNames.join(', ')}`)
        }
      }
      
      return cookieString
    }
    
    // For other domains, use domain-specific approach
    const domains = [hostname]
    const parts = hostname.split('.')
    if (parts.length > 2) {
      domains.push('.' + parts.slice(-2).join('.'))
    }
    
    const allCookies: Electron.Cookie[] = []
    for (const domain of domains) {
      try {
        const cookies = await getDefaultSession().cookies.get({ domain })
        allCookies.push(...cookies)
      } catch {
        // Ignore errors for specific domains
      }
    }
    
    const uniqueCookies = new Map<string, Electron.Cookie>()
    for (const cookie of allCookies) {
      if (!cookie.domain) continue
      const key = `${cookie.domain}:${cookie.name}`
      if (!uniqueCookies.has(key)) {
        uniqueCookies.set(key, cookie)
      }
    }
    
    const cookieString = Array.from(uniqueCookies.values())
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ')
    
    if (cookieString) {
      console.log(`Found ${uniqueCookies.size} cookies for ${hostname}`)
    }
    
    return cookieString
  } catch (error) {
    console.error('Error getting cookies:', error)
    return ''
  }
}

// Helper function to make a fetch request with cookies from the session
async function fetchWithCookies(url: string, options: RequestInit = {}): Promise<Response> {
  const cookieHeader = await getCookiesForUrl(url)
  const headers = new Headers(options.headers)
  
  if (cookieHeader) {
    headers.set('Cookie', cookieHeader)
    // Debug: log first 100 chars of cookie string
    console.log(`Sending cookies: ${cookieHeader.substring(0, 100)}...`)
  } else {
    console.log('No cookies found for URL:', url)
  }
  
  // Set User-Agent to match browser
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
  }
  
  // Add other headers - set appropriate Referer/Origin based on URL
  headers.set('Accept', 'application/json, text/javascript, */*; q=0.01')
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  
  // Set Referer and Origin based on the URL domain
  if (url.includes('reddit.com')) {
    headers.set('Referer', 'https://www.reddit.com/')
    headers.set('Origin', 'https://www.reddit.com')
  } else if (url.includes('twitter.com') || url.includes('x.com')) {
    headers.set('Referer', 'https://twitter.com/')
    headers.set('Origin', 'https://twitter.com')
  } else {
    // Default to no specific origin
    if (!headers.has('Referer')) {
      headers.set('Referer', url)
    }
  }
  
  return fetch(url, {
    ...options,
    headers,
    // Important: include credentials
    credentials: 'include',
  })
}

// Create application menu
function createApplicationMenu() {
  const isProduction = app.isPackaged
  const githubUrl = 'https://github.com/NickMarcha/omni-screen'
  
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { role: 'quit', label: 'Quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'forceReload', label: 'Force Reload' },
        { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Fullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Always On Top',
          type: 'checkbox',
          checked: false,
          click: (menuItem) => {
            if (win) {
              win.setAlwaysOnTop(menuItem.checked)
            }
          }
        },
        {
          label: 'Transparency',
          submenu: [
            {
              label: '100% (Opaque)',
              type: 'radio',
              checked: true,
              click: () => {
                if (win) {
                  win.setOpacity(1.0)
                  updateTransparencyMenu(1.0)
                }
              }
            },
            {
              label: '75%',
              type: 'radio',
              checked: false,
              click: () => {
                if (win) {
                  win.setOpacity(0.75)
                  updateTransparencyMenu(0.75)
                }
              }
            },
            {
              label: '50%',
              type: 'radio',
              checked: false,
              click: () => {
                if (win) {
                  win.setOpacity(0.5)
                  updateTransparencyMenu(0.5)
                }
              }
            },
            {
              label: '25%',
              type: 'radio',
              checked: false,
              click: () => {
                if (win) {
                  win.setOpacity(0.25)
                  updateTransparencyMenu(0.25)
                }
              }
            }
          ]
        },
        { type: 'separator' },
        { role: 'minimize', label: 'Minimize' },
        { role: 'close', label: 'Close' }
      ]
    },
    {
      label: 'Help',
      submenu: isProduction
        ? [
            {
              label: 'About Omni Screen',
              click: () => {
                shell.openExternal(githubUrl)
              }
            },
            {
              label: 'GitHub Repository',
              click: () => {
                shell.openExternal(githubUrl)
              }
            },
            {
              label: 'Report Issue',
              click: () => {
                shell.openExternal(`${githubUrl}/issues`)
              }
            }
          ]
        : [
            {
              label: 'About Electron',
              click: () => {
                shell.openExternal('https://www.electronjs.org')
              }
            },
            {
              label: 'Electron Documentation',
              click: () => {
                shell.openExternal('https://www.electronjs.org/docs')
              }
            },
            { type: 'separator' },
            {
              label: 'About Omni Screen',
              click: () => {
                shell.openExternal(githubUrl)
              }
            },
            {
              label: 'GitHub Repository',
              click: () => {
                shell.openExternal(githubUrl)
              }
            }
          ]
    }
  ]

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: 'About ' + app.getName() },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide ' + app.getName() },
        { role: 'hideOthers', label: 'Hide Others' },
        { role: 'unhide', label: 'Show All' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit ' + app.getName() }
      ]
    })

    // Update Window menu for macOS
    const windowMenu = template.find(menu => menu.label === 'Window')
    if (windowMenu && 'submenu' in windowMenu && Array.isArray(windowMenu.submenu)) {
      windowMenu.submenu = [
        ...(windowMenu.submenu as Electron.MenuItemConstructorOptions[]),
        { type: 'separator' },
        { role: 'front', label: 'Bring All to Front' }
      ]
    }
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  // Handle external links - open in default browser
  // This will be set on the window after it's created
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(process.env.VITE_PUBLIC, 'feelswierdman.png'),
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Use persistent session partition to save cookies between restarts
      partition: 'persist:main',
      // Disable web security to allow cross-origin requests with credentials
      // This is needed for Twitter oEmbed API which doesn't allow CORS with credentials
      webSecurity: false,
      // Enable transparency for window transparency option
      transparent: true,
      // Needed for <webview> (userscript injection into embeds)
      webviewTag: true,
    },
  })

  destinyEmbedView.setMainWindowRef(win)
  win.setMaxListeners(20) // avoid MaxListenersExceededWarning when multiple listeners attach (e.g. closed, webRequest)
  win.on('closed', () => {
    destinyEmbedView.setMainWindowRef(null)
  })

  // Configure webRequest handlers for YouTube and Reddit embeds
  const session = win.webContents.session
  
  // Log environment info for debugging - helps identify dev vs production differences
  const isProduction = app.isPackaged
  const pageOrigin = VITE_DEV_SERVER_URL || 'file://'
  console.log(`[Main Process] Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}, Page origin: ${pageOrigin}`)
  
  // Set Referer header for YouTube embeds (required by YouTube API)
  // App ID from electron-builder.json: com.nickmarcha.omni-screen
  const appId = 'com.nickmarcha.omni-screen'
  const refererUrl = `https://${appId}`
  
  // Set Referer header for YouTube requests (required by YouTube API)
  // According to YouTube's Required Minimum Functionality documentation:
  // - Referer header must be set to identify the API client
  // - Format: HTTPS protocol with app ID as domain (reversed domain name format)
  // - Must match the widget_referrer parameter in the embed URL
  session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://www.youtube.com/*',
        'https://youtube.com/*',
        'https://*.youtube.com/*',
        'https://www.youtube-nocookie.com/*',
        'https://youtube-nocookie.com/*',
        'https://*.youtube-nocookie.com/*',
        'https://youtu.be/*',
        'https://*.ytimg.com/*',
        'https://*.googlevideo.com/*'
      ]
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      
      // Set Referer header according to YouTube's Required Minimum Functionality documentation
      // YouTube requires HTTP Referer header to identify the API client
      // Format: HTTPS protocol with app ID as domain (reversed domain name format)
      // App ID from electron-builder.json: com.nickmarcha.omni-screen
      const appId = 'com.nickmarcha.omni-screen'
      const refererUrl = `https://${appId}`
      
      // CRITICAL FIX FOR PRODUCTION BUILDS:
      // In production, the page loads from file:// which doesn't send Referer by default
      // We MUST explicitly set Referer header for ALL YouTube requests
      // This includes the initial iframe load and all subsequent requests
      requestHeaders['Referer'] = refererUrl
      
      // Also set Origin header - YouTube may check both Referer and Origin
      // Setting both ensures compatibility in both dev (http://localhost) and prod (file://)
      requestHeaders['Origin'] = refererUrl
      
      // Remove any Referer-Policy headers that might suppress the Referer
      // This is especially important in production builds
      delete requestHeaders['Referer-Policy']
      delete requestHeaders['referrer-policy'] // lowercase variant
      
      // Ensure the header is actually set (defensive check)
      if (!requestHeaders['Referer']) {
        requestHeaders['Referer'] = refererUrl
      }
      
      // Log for debugging - this will show in production console
      const isProduction = app.isPackaged
      const method = details.method || 'GET'
      console.log(`[Main Process] ${isProduction ? '[PROD]' : '[DEV]'} YouTube ${method}: Referer=${requestHeaders['Referer']}, Origin=${requestHeaders['Origin']}, URL=${details.url.substring(0, 80)}`)
      
      callback({ requestHeaders })
    }
  )
  
  // Set Referer header for 4cdn.org and other image CDNs to bypass CORS restrictions
  session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://i.4cdn.org/*',
        'https://*.4cdn.org/*',
        'https://*.imgur.com/*',
        'https://i.imgur.com/*',
        'https://pbs.twimg.com/*',
        'https://*.twimg.com/*'
      ]
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      
      // For 4cdn.org, set Referer to 4chan.org (their main site)
      if (details.url.includes('4cdn.org')) {
        requestHeaders['Referer'] = 'https://www.4chan.org/'
        requestHeaders['Origin'] = 'https://www.4chan.org'
      } else if (details.url.includes('video.twimg.com')) {
        // For Twitter videos, set Referer to platform.twitter.com (where embeds load from)
        requestHeaders['Referer'] = 'https://platform.twitter.com/'
        requestHeaders['Origin'] = 'https://platform.twitter.com'
      } else {
        // For other image CDNs, set a generic Referer
        requestHeaders['Referer'] = refererUrl
      }
      
      console.log(`[Main Process] Setting Referer for image CDN: ${requestHeaders['Referer']} -> ${details.url.substring(0, 80)}`)
      
      callback({ requestHeaders })
    }
  )

  // Set Referer headers for Twitter video requests
  session.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://video.twimg.com/*',
        'https://*.video.twimg.com/*'
      ]
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      
      // Set Referer to platform.twitter.com to match the embed origin
      requestHeaders['Referer'] = 'https://platform.twitter.com/'
      requestHeaders['Origin'] = 'https://platform.twitter.com'
      
      console.log(`[Main Process] Setting Referer for Twitter video: ${details.url.substring(0, 80)}`)
      
      callback({ requestHeaders })
    }
  )

  // Add CORS headers for Twitter video requests to allow them to load in embeds
  session.webRequest.onHeadersReceived(
    {
      urls: [
        'https://video.twimg.com/*',
        'https://*.video.twimg.com/*'
      ]
    },
    (details, callback) => {
      const responseHeaders: Record<string, string | string[]> = { ...details.responseHeaders }
      
      // Add CORS headers to allow requests from platform.twitter.com
      // Note: This modifies the response, but the server might still reject if it checks origin
      responseHeaders['Access-Control-Allow-Origin'] = ['*']
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']
      responseHeaders['Access-Control-Allow-Headers'] = ['*']
      responseHeaders['Access-Control-Allow-Credentials'] = ['true']
      
      console.log(`[Main Process] Added CORS headers for Twitter video: ${details.url.substring(0, 80)}`)
      
      callback({ responseHeaders })
    }
  )

  
  // Modify CSP headers to allow embeds from various platforms
  // These embeds need to be allowed even when loaded from file:// protocol
  const modifyCSPForEmbeds = (
    details: Electron.OnHeadersReceivedListenerDetails,
    callback: (response: Electron.HeadersReceivedResponse) => void
  ) => {
    const responseHeaders: Record<string, string | string[]> = { ...details.responseHeaders }
    
    // Remove existing CSP headers (case-insensitive)
    const cspKeys = Object.keys(responseHeaders).filter(key => 
      key.toLowerCase() === 'content-security-policy' || 
      key.toLowerCase() === 'content-security-policy-report-only'
    )
    
    cspKeys.forEach(key => {
      delete responseHeaders[key]
    })

    // Also remove frame-blocking headers (case-insensitive)
    const frameKeys = Object.keys(responseHeaders).filter(key =>
      key.toLowerCase() === 'x-frame-options' ||
      key.toLowerCase() === 'frame-options'
    )
    frameKeys.forEach(key => {
      delete responseHeaders[key]
    })
    
    // Completely remove CSP restrictions for embeds
    // In production with file://, CSP frame-ancestors doesn't support file: scheme
    // So we remove all CSP restrictions to allow embeds to load
    // This is safe because we control the Electron app environment
    // Don't set any CSP - let the embeds load without restrictions
    // (We already removed the existing CSP headers above)
    
    callback({ responseHeaders })
  }

  // Reddit embeds
  session.webRequest.onHeadersReceived(
    {
      urls: ['https://embed.reddit.com/*', 'https://*.reddit.com/*', 'https://www.reddit.com/*']
    },
    (details, callback) => {
      const isProduction = app.isPackaged
      console.log(`[Main Process] ${isProduction ? '[PROD]' : '[DEV]'} Modified CSP for Reddit: ${details.url.substring(0, 80)}`)
      modifyCSPForEmbeds(details, callback)
    }
  )

  // YouTube embeds (youtube-nocookie.com and all YouTube resources)
  session.webRequest.onHeadersReceived(
    {
      urls: [
        'https://www.youtube-nocookie.com/*',
        'https://youtube-nocookie.com/*',
        'https://*.youtube-nocookie.com/*',
        'https://www.youtube.com/*',
        'https://youtube.com/*',
        'https://*.youtube.com/*',
        'https://*.ytimg.com/*',
        'https://*.googlevideo.com/*'
      ]
    },
    (details, callback) => {
      console.log(`[Main Process] Modified CSP for YouTube: ${details.url.substring(0, 80)}`)
      modifyCSPForEmbeds(details, callback)
    }
  )

  // Twitter/X embeds
  session.webRequest.onHeadersReceived(
    {
      urls: [
        'https://platform.twitter.com/*',
        'https://*.twitter.com/*',
        'https://*.x.com/*',
        'https://publish.twitter.com/*',
        'https://syndication.twitter.com/*'
      ]
    },
    (details, callback) => {
      console.log(`[Main Process] Modified CSP for Twitter: ${details.url.substring(0, 80)}`)
      modifyCSPForEmbeds(details, callback)
    }
  )

  // Destiny.gg embeds (e.g. chat embed)
  session.webRequest.onHeadersReceived(
    {
      urls: [
        'https://www.destiny.gg/*',
        'https://destiny.gg/*',
        'https://chat.destiny.gg/*',
      ]
    },
    (details, callback) => {
      console.log(`[Main Process] Modified CSP for Destiny: ${details.url.substring(0, 80)}`)
      modifyCSPForEmbeds(details, callback)
    }
  )

  // Enable auto-update logic
  update(win)

  // Show context menu on right-click
  win.webContents.on('context-menu', (_e, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []

    // If right-clicking on a link, show link-specific options
    if (params.linkURL) {
      menuItems.push(
        { label: 'Open Link', click: () => { win?.webContents.loadURL(params.linkURL!) } },
        { label: 'Copy Link Address', click: () => { clipboard.writeText(params.linkURL!) } },
        { type: 'separator' }
      )
    }

    // If there's selected text, show text editing options
    if (params.selectionText) {
      menuItems.push(
        { role: 'copy', label: 'Copy' },
        { type: 'separator' }
      )
    }

    // Always show standard editing options
    menuItems.push(
      { role: 'cut', label: 'Cut' },
      { role: 'copy', label: 'Copy' },
      { role: 'paste', label: 'Paste' },
      { role: 'pasteAndMatchStyle', label: 'Paste and Match Style' },
      { role: 'delete', label: 'Delete' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Select All' }
    )

    const contextMenu = Menu.buildFromTemplate(menuItems)
    contextMenu.popup()
  })

  // Handle external links - open in default browser
  // Intercept navigation to external URLs
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    const currentUrl = win?.webContents.getURL()
    
    // Allow navigation within the app (localhost, file://, etc.)
    if (currentUrl) {
      const currentParsed = new URL(currentUrl)
      // Same origin navigation is allowed
      if (parsedUrl.origin === currentParsed.origin) {
        return
      }
    }
    
    // Block navigation to external URLs and open in default browser instead
    event.preventDefault()
    shell.openExternal(navigationUrl)
  })

  // Handle new window requests (e.g., target="_blank" links)
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Check if this is a Twitter login window (opened via IPC)
    // Twitter login windows are handled separately via 'open-login-window' IPC
    // All other links should open in default browser
    shell.openExternal(url)
    return { action: 'deny' } // Deny creating a new window, we opened it externally instead
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // In production, use a local HTTP server instead of file://
    // This makes the environment identical to dev mode and fixes embed issues
    const localServer = createServer((req, res) => {
      let filePath = req.url === '/' ? '/index.html' : req.url || '/index.html'
      // Remove query string
      filePath = filePath.split('?')[0]
      
      const fullPath = path.join(RENDERER_DIST, filePath)
      
      try {
        const stats = statSync(fullPath)
        if (stats.isFile()) {
          const content = readFileSync(fullPath)
          const ext = path.extname(fullPath).toLowerCase()
          
          let contentType = 'text/html'
          if (ext === '.js') contentType = 'application/javascript'
          else if (ext === '.css') contentType = 'text/css'
          else if (ext === '.json') contentType = 'application/json'
          else if (ext === '.png') contentType = 'image/png'
          else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg'
          else if (ext === '.svg') contentType = 'image/svg+xml'
          else if (ext === '.ico') contentType = 'image/x-icon'
          
          res.writeHead(200, { 'Content-Type': contentType })
          res.end(content)
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      } catch (error) {
        res.writeHead(404)
        res.end('Not found')
      }
    })
    
    // Start server on a fixed port to ensure localStorage persists between restarts
    // localStorage is scoped by origin, so we need a consistent port
    const FIXED_PORT = 5173 // Use same port as Vite dev server for consistency
    localServer.listen(FIXED_PORT, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${FIXED_PORT}`
      console.log(`[Main Process] Starting local HTTP server for production: ${url}`)
      if (win && !win.isDestroyed()) {
        win.loadURL(url)
      }
    }).on('error', (err: NodeJS.ErrnoException) => {
      // If port is already in use, try a random port as fallback
      if (err.code === 'EADDRINUSE') {
        console.log(`[Main Process] Port ${FIXED_PORT} in use, trying random port...`)
        localServer.listen(0, '127.0.0.1', () => {
          const port = (localServer.address() as { port: number })?.port || 0
          const url = `http://127.0.0.1:${port}`
          console.log(`[Main Process] Starting local HTTP server on fallback port: ${url}`)
          if (win && !win.isDestroyed()) {
            win.loadURL(url)
          }
        })
      } else {
        console.error('[Main Process] Failed to start local HTTP server:', err)
        // Fallback to file:// if server fails
        if (win && !win.isDestroyed()) {
          win.loadFile(path.join(RENDERER_DIST, 'index.html'))
        }
      }
    })
  }
}

type LinkOpenAction = 'none' | 'clipboard' | 'browser' | 'viewer'

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function getOrCreateViewerWindow(): BrowserWindow {
  if (viewerWin && !viewerWin.isDestroyed()) {
    return viewerWin
  }

  viewerWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'Viewer',
    icon: path.join(process.env.VITE_PUBLIC, 'feelswierdman.png'),
    webPreferences: {
      // Keep viewer isolated like a normal browser window
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Reuse app session so logins/cookies can persist
      partition: 'persist:main',
    }
  })

  viewerWin.setMaxListeners(20)
  viewerWin.on('closed', () => {
    viewerWin = null
  })

  // Behave like a browser: allow in-window navigation for http(s), open other schemes externally
  viewerWin.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isHttpUrl(navigationUrl)) {
      event.preventDefault()
      // For non-http(s) URLs, fall back to OS handler
      shell.openExternal(navigationUrl).catch(() => {})
    }
  })

  // Any "new window" request loads in the same viewer window
  viewerWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) {
      viewerWin?.loadURL(url).catch(() => {})
    } else {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  return viewerWin
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    destinyEmbedView.setMainWindowRef(null)
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC Handlers (frameless window controls)
ipcMain.handle('window-minimize', () => {
  const w = BrowserWindow.getFocusedWindow()
  if (w) w.minimize()
})
ipcMain.handle('window-maximize', () => {
  const w = BrowserWindow.getFocusedWindow()
  if (w) {
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  }
})
ipcMain.handle('window-close', () => {
  const w = BrowserWindow.getFocusedWindow()
  if (w) w.close()
})
ipcMain.handle('window-is-maximized', () => {
  const w = BrowserWindow.getFocusedWindow()
  return w ? w.isMaximized() : false
})

ipcMain.handle('menu-popup', (_event, payload: { menuLabel: string; clientX: number; clientY: number }) => {
  const w = BrowserWindow.getFocusedWindow()
  if (!w) return
  const { menuLabel, clientX, clientY } = payload || {}
  const bounds = w.getBounds()
  const screenX = Math.round(bounds.x + (typeof clientX === 'number' ? clientX : 0))
  const screenY = Math.round(bounds.y + (typeof clientY === 'number' ? clientY : 0))
  const appMenu = Menu.getApplicationMenu()
  if (!appMenu) return
  const label = typeof menuLabel === 'string' ? menuLabel.trim() : ''
  const item = appMenu.items.find((i) => i.label && i.label.toLowerCase() === label.toLowerCase())
  if (item && item.submenu) {
    ;(item.submenu as Electron.Menu).popup({ window: w, x: screenX, y: screenY })
  }
})

ipcMain.handle('link-scroller-handle-link', async (_event, payload: { url: string, action: LinkOpenAction }) => {
  try {
    const url = payload?.url
    const action = payload?.action

    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Invalid url' }
    }

    if (action === 'none') {
      return { success: true }
    }

    if (action === 'clipboard') {
      clipboard.writeText(url)
      return { success: true }
    }

    if (action === 'browser') {
      await shell.openExternal(url)
      return { success: true }
    }

    if (action === 'viewer') {
      const v = getOrCreateViewerWindow()
      v.show()
      v.focus()
      if (isHttpUrl(url)) {
        await v.loadURL(url)
        return { success: true }
      }
      await shell.openExternal(url)
      return { success: true }
    }

    return { success: false, error: `Unknown action: ${String(action)}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error(`Error occurred in handler for 'link-scroller-handle-link':`, e)
    return { success: false, error: msg }
  }
})

ipcMain.handle('fetch-mentions', async (_event, username: string, size: number = 150, offset: number = 0, useCache: boolean = true) => {
  try {
    // Check cache first if enabled
    if (useCache) {
      const cachedIds = mentionCache.getCachedQuery(username, size, offset)
      if (cachedIds && cachedIds.length > 0) {
        const cachedMessages = mentionCache.getCachedMessages(cachedIds)
        if (cachedMessages.length > 0) {
          console.log(`[Main Process] Using cached mentions for "${username}" (${cachedMessages.length} messages)`)
          return { success: true, data: cachedMessages, cached: true }
        }
      }
    }

    const url = `https://polecat.me/api/mentions/${encodeURIComponent(username)}?size=${size}&offset=${offset}`
    
    console.log(`[Main Process] Fetching mentions for "${username}":`)
    console.log(`  - URL: ${url}`)
    console.log(`  - Size: ${size}, Offset: ${offset}`)
    console.log(`  - Request time: ${new Date().toISOString()}`)
    
    const startTime = Date.now()
    const response = await fetch(url, {
      cache: 'no-store', // Prevent caching
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
    
    const fetchTime = Date.now() - startTime
    console.log(`  - Response status: ${response.status} (took ${fetchTime}ms)`)
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response')
      console.error(`  - Error response body: ${errorText}`)
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    const dataLength = Array.isArray(data) ? data.length : 0
    console.log(`  - Received ${dataLength} mentions`)
    
    // Add unique ID to each mention using date and username directly (no hash needed)
    if (dataLength > 0 && Array.isArray(data)) {
      const dataWithIds = data.map((mention: any) => {
        // Use date-nick directly as unique ID (unique enough)
        const uniqueId = `${mention.date || ''}-${mention.nick || ''}`
        return {
          ...mention,
          id: uniqueId
        }
      })
      
      const firstDate = dataWithIds[0]?.date ? new Date(dataWithIds[0].date).toISOString() : 'N/A'
      const lastDate = dataWithIds[dataLength - 1]?.date ? new Date(dataWithIds[dataLength - 1].date).toISOString() : 'N/A'
      console.log(`  - Date range: ${firstDate} (first) to ${lastDate} (last)`)
      
      // Check the order - is first item newest or oldest?
      const dates = dataWithIds.map((m: any) => m.date).filter((d: any) => d != null)
      if (dates.length > 1) {
        const firstIsNewer = dates[0] > dates[dates.length - 1]
        console.log(`  - Order: ${firstIsNewer ? 'NEWEST FIRST (descending)' : 'OLDEST FIRST (ascending)'}`)
      }
      
      // Log a few sample dates to verify
      const sampleDates = dataWithIds.slice(0, 5).map((m: any, i: number) => 
        `${i}: ${m.date ? new Date(m.date).toISOString() : 'N/A'} (id: ${m.id})`
      )
      console.log(`  - First 5 dates:`, sampleDates)
      
      // Store in cache
      if (useCache) {
        mentionCache.storeQuery(username, size, offset, dataWithIds)
      }
      
      return { success: true, data: dataWithIds, cached: false }
    }
    
    return { success: true, data, cached: false }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorStack = error instanceof Error ? error.stack : undefined
    
    console.error('[Main Process] Error fetching mentions:', error)
    console.error(`  - Username: ${username}`)
    console.error(`  - Size: ${size}, Offset: ${offset}`)
    console.error(`  - Error message: ${errorMessage}`)
    if (errorStack) {
      console.error(`  - Error stack: ${errorStack}`)
    }
    
    // Also log to stderr for better visibility
    console.error(`[Main Process] FAILED to fetch mentions for "${username}": ${errorMessage}`)
    
    return { success: false, error: errorMessage }
  }
})

// Cache management IPC handlers
ipcMain.handle('clear-mention-cache', async () => {
  mentionCache.clearAll()
  return { success: true }
})

ipcMain.handle('get-cache-stats', async () => {
  return mentionCache.getStats()
})

// Fallback API: rustlesearch.dev search API
// Used when mentions API returns no results
// Parameters:
//   - filterTerms: array of search terms (joined with |)
//   - searchAfter: optional pagination token from previous response
//   - size: number of results to fetch
// Note: username parameter exists but won't be used for now
ipcMain.handle('fetch-rustlesearch', async (_event, filterTerms: string[], searchAfter?: number, size: number = 150) => {
  try {
    // Join filter terms with | separator
    const textParam = filterTerms.join('|')
    
    // Build URL with parameters
    const url = new URL('https://api-v2.rustlesearch.dev/anon/search')
    url.searchParams.set('text', textParam)
    url.searchParams.set('channel', 'Destinygg')
    if (searchAfter) {
      url.searchParams.set('search_after', searchAfter.toString()) // API uses underscore, not camelCase
    }
    // Optional: date range (commented out for now, can be added later)
    // const today = new Date()
    // const oneYearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
    // url.searchParams.set('start_date', oneYearAgo.toISOString().split('T')[0])
    // url.searchParams.set('end_date', today.toISOString().split('T')[0])
    
    console.log(`[Main Process] Fetching rustlesearch for terms: ${filterTerms.join(', ')}`)
    console.log(`  - URL: ${url.toString()}`)
    console.log(`  - SearchAfter: ${searchAfter || 'none'}, Size: ${size}`)
    
    const startTime = Date.now()
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    })
    
    const fetchTime = Date.now() - startTime
    console.log(`  - Response status: ${response.status} (took ${fetchTime}ms)`)
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response')
      console.error(`  - Error response body: ${errorText}`)
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const result = await response.json()
    
    if (result.type !== 'Success' || !result.data) {
      throw new Error(result.error || 'Invalid response format')
    }
    
    // Log response structure for debugging
    console.log(`  - Response data keys: ${Object.keys(result.data).join(', ')}`)
    if (result.data.searchAfter !== undefined) {
      console.log(`  - Response-level searchAfter: ${result.data.searchAfter}`)
    }
    
    const messages = result.data.messages || []
    const dataLength = messages.length
    console.log(`  - Received ${dataLength} messages`)
    
    // Log first message structure for debugging
    if (messages.length > 0) {
      console.log(`  - First message keys: ${Object.keys(messages[0]).join(', ')}`)
      if (messages[0].searchAfter !== undefined) {
        console.log(`  - First message searchAfter: ${messages[0].searchAfter}`)
      }
    }
    
    // Map rustlesearch format to MentionData format
    const mappedData = messages.map((msg: any) => {
      // Convert ISO timestamp to number (milliseconds)
      const date = new Date(msg.ts).getTime()
      // Use date-username as unique ID
      const uniqueId = `${date}-${msg.username || ''}`
      
      return {
        id: uniqueId,
        date: date,
        text: msg.text || '',
        nick: msg.username || '',
        flairs: '', // rustlesearch doesn't provide flairs
        matchedTerms: filterTerms // All terms matched since we searched for them
      }
    })
    
    // Get the last searchAfter value for pagination
    // According to the API, each message has a searchAfter field
    // We need to use the searchAfter from the last (oldest) message for the next page
    let lastSearchAfter: number | undefined = undefined
    
    if (messages.length > 0) {
      // Messages are returned in descending order (newest first)
      // The last message in the array is the oldest, and its searchAfter should be used for next page
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.searchAfter !== undefined) {
        lastSearchAfter = lastMessage.searchAfter
      } else {
        // Fallback: use the timestamp if searchAfter is missing
        const sortedByDate = [...mappedData].sort((a, b) => a.date - b.date)
        lastSearchAfter = sortedByDate[sortedByDate.length - 1].date
        console.log(`  - Warning: Last message missing searchAfter, using timestamp as fallback`)
      }
    }
    
    console.log(`  - Mapped ${mappedData.length} messages`)
    if (lastSearchAfter) {
      const lastMsg = messages[messages.length - 1]
      console.log(`  - Using searchAfter: ${lastSearchAfter} (from last message's searchAfter field: ${lastMsg.searchAfter})`)
    } else {
      console.log(`  - No searchAfter value available (no more pages)`)
    }
    
    return { 
      success: true, 
      data: mappedData,
      searchAfter: lastSearchAfter, // Return for pagination
      hasMore: dataLength > 0 && lastSearchAfter !== undefined // Has more if we got results and have a searchAfter
    }
  } catch (error) {
    console.error('[Main Process] Error fetching rustlesearch:', error)
    console.error(`  - Filter terms: ${filterTerms.join(', ')}`)
    if (error instanceof Error) {
      console.error(`  - Error message: ${error.message}`)
      console.error(`  - Error stack: ${error.stack}`)
      
      // Include rate limit info in response if available
      const rateLimitInfo = (error as any).rateLimitInfo
      if (rateLimitInfo) {
        const retryAfter = rateLimitInfo.retryAfter
        const retryDate = retryAfter ? new Date(Date.now() + retryAfter * 1000) : null
        
        return { 
          success: false, 
          error: error.message,
          rateLimitInfo: {
            retryAfter,
            retryDate: retryDate?.toISOString(),
            limit: rateLimitInfo.limit,
            remaining: rateLimitInfo.remaining,
            reset: rateLimitInfo.reset
          }
        }
      }
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Destiny embed (single BrowserView, userscript injection, detach support)
ipcMain.handle('destiny-embed-set-bounds', (_event, bounds: unknown) => {
  try {
    destinyEmbedView.setBounds(win ?? null, bounds)
  } catch (e) {
    console.error('destiny-embed-set-bounds failed:', e instanceof Error ? e.message : e, e instanceof Error ? e.stack : '')
  }
})
ipcMain.handle('destiny-embed-hide', () => {
  try {
    destinyEmbedView.hide(win ?? null)
  } catch (e) {
    console.error('destiny-embed-hide failed:', e instanceof Error ? e.message : e, '')
  }
})
ipcMain.handle('destiny-embed-detach', () => {
  try {
    destinyEmbedView.detach(win ?? null)
  } catch (e) {
    console.error('destiny-embed-detach failed:', e instanceof Error ? e.message : e, e instanceof Error ? e.stack : '')
  }
})
ipcMain.handle('destiny-embed-is-detached', () => {
  return destinyEmbedView.isDetached()
})
ipcMain.handle('destiny-embed-reload', () => {
  try {
    destinyEmbedView.reload()
  } catch (e) {
    console.error('destiny-embed-reload failed:', e instanceof Error ? e.message : e, '')
  }
})
ipcMain.handle('destiny-embed-open-devtools', () => {
  try {
    destinyEmbedView.openDevTools()
  } catch (e) {
    console.error('destiny-embed-open-devtools failed:', e instanceof Error ? e.message : e, '')
  }
})

ipcMain.handle('fetch-twitter-embed', async (event, tweetUrl: string, theme: 'light' | 'dark' = 'dark') => {
  let browserView: BrowserView | null = null
  try {
    const webContents = event.sender
    const session = webContents.session
    
    // Check for authentication cookies first
    const allCookies = await session.cookies.get({})
    const twitterCookies = allCookies.filter(cookie => 
      cookie.domain && (
        cookie.domain.includes('twitter.com') || 
        cookie.domain.includes('x.com') ||
        cookie.domain.includes('twimg.com')
      )
    )
    
    const authToken = twitterCookies.find(c => c.name === 'auth_token')
    const ct0 = twitterCookies.find(c => c.name === 'ct0')
    
    if (!authToken || !ct0) {
      return { 
        success: false, 
        error: 'Not logged in to Twitter. Please use the "Login to Twitter" button and complete the login process.' 
      }
    }
    
    console.log('Authentication cookies found - loading tweet page to get embed')
    
    // Create a hidden BrowserView with the same session
    browserView = new BrowserView({
      webPreferences: {
        partition: 'persist:main', // Use the same session
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
      },
    })
    
    // Make it very small and off-screen
    if (win) {
      win.setBrowserView(browserView)
      browserView.setBounds({ x: -1000, y: -1000, width: 1, height: 1 })
    }
    
    // Load the tweet page directly (this works when you open it in a new window)
    // Then extract the embed HTML or use Twitter's embed script
    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout loading tweet page'))
      }, 15000)
      
      browserView!.webContents.once('did-finish-load', async () => {
        clearTimeout(timeout)
        
        try {
          console.log('Tweet page loaded, extracting embed...')
          const currentUrl = browserView!.webContents.getURL()
          console.log('BrowserView URL:', currentUrl)
          
          // Wait a bit for page to fully render
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Try to get the oEmbed HTML from the page
          const embedHtml = await browserView!.webContents.executeJavaScript(`
            (async () => {
              try {
                const tweetUrl = window.location.href
                console.log('Current URL:', tweetUrl)
                
                // Check if we're on a tweet page
                const isTweetPage = window.location.pathname.includes('/status/')
                console.log('Is tweet page:', isTweetPage)
                
                if (isTweetPage) {
                  // Try oEmbed API from page context first (this should work from same origin)
                  try {
                    const oembedUrl = 'https://publish.twitter.com/oembed?url=' + encodeURIComponent(tweetUrl) + '&theme=${theme}&dnt=true&omit_script=true'
                    console.log('Trying oEmbed API from page context...')
                    
                    const response = await fetch(oembedUrl, {
                      credentials: 'include',
                      headers: {
                        'Accept': 'application/json',
                        'Referer': window.location.href,
                        'Origin': window.location.origin,
                      },
                    })
                    
                    console.log('oEmbed response status:', response.status)
                    
                    if (response.ok) {
                      const data = await response.json()
                      console.log('oEmbed success, got HTML, length:', data.html?.length || 0)
                      console.log('oEmbed HTML preview:', data.html?.substring(0, 200))
                      // Add align="center" if not present
                      if (data.html && !data.html.includes('align=')) {
                        data.html = data.html.replace('<blockquote', '<blockquote align="center"')
                      }
                      return { success: true, data }
                    } else {
                      const errorText = await response.text()
                      console.log('oEmbed failed:', response.status)
                      console.log('oEmbed error:', errorText.substring(0, 300))
                    }
                  } catch (e) {
                    console.log('oEmbed fetch error:', e.message)
                  }
                  
                  // Try to extract tweet content from the page DOM as fallback
                  try {
                    console.log('Trying to extract tweet content from page DOM...')
                    
                    // Look for the tweet text in various places Twitter stores it
                    const article = document.querySelector('article[data-testid="tweet"]')
                    console.log('Found article:', !!article)
                    
                    if (!article) {
                      // Try alternative selectors
                      article = document.querySelector('article') || document.querySelector('[data-testid="tweet"]')
                      console.log('Trying alternative article selector:', !!article)
                    }
                    
                    if (article) {
                      // Try multiple strategies to get tweet text
                      let textElement = article.querySelector('[data-testid="tweetText"]')
                      if (!textElement) {
                        // Try finding text in spans with lang attribute
                        textElement = article.querySelector('div[lang]') || 
                                     article.querySelector('[dir="auto"]') ||
                                     article.querySelector('div[data-testid="tweetText"]')
                      }
                      
                      // Try to get author info
                      let authorElement = article.querySelector('[data-testid="User-Name"]')
                      if (!authorElement) {
                        authorElement = article.querySelector('div[data-testid="User-Names"]') ||
                                       article.querySelector('a[href*="/"]') // First link might be author
                      }
                      
                      const dateElement = article.querySelector('time')
                      
                      console.log('Found elements - text:', !!textElement, 'author:', !!authorElement, 'date:', !!dateElement)
                      
                      if (textElement) {
                        // Extract and clean the HTML structure to match Twitter's oEmbed format
                        // Twitter's widgets.js expects: plain text with <a> tags for links, no CSS classes
                        let tweetHtml = ''
                        
                        // Process nodes recursively, preserving only links and text
                        const processNode = (node) => {
                          if (node.nodeType === 3) { // Text node
                            const text = node.textContent || ''
                            if (text.trim()) {
                              tweetHtml += text
                            }
                          } else if (node.nodeType === 1) { // Element node
                            const tagName = node.tagName.toLowerCase()
                            if (tagName === 'a') {
                              // Preserve links - these are important for hashtags, mentions, media
                              const href = node.getAttribute('href') || ''
                              const text = node.textContent || node.innerText || ''
                              // Clean up href - Twitter uses t.co links, convert to proper format
                              let cleanHref = href
                              if (href.includes('twitter.com/hashtag/')) {
                                // Hashtag link
                                const hashtag = href.match(/hashtag\\/([^?]+)/)?.[1]
                                if (hashtag) {
                                  cleanHref = 'https://twitter.com/hashtag/' + hashtag + '?src=hash&ref_src=twsrc%5Etfw'
                                }
                              } else if (href.includes('pic.twitter.com') || href.includes('t.co')) {
                                // Media link - keep as is
                                cleanHref = href
                              } else if (href.includes('twitter.com/') || href.includes('x.com/')) {
                                // Mention or other Twitter link
                                cleanHref = href + (href.includes('?') ? '&' : '?') + 'ref_src=twsrc%5Etfw'
                              }
                              tweetHtml += '<a href="' + cleanHref + '">' + text + '</a>'
                            } else if (tagName === 'br') {
                              tweetHtml += '<br>'
                            } else {
                              // For other elements (spans, divs, etc.), just process children
                              // This strips out CSS classes and other attributes
                              Array.from(node.childNodes || []).forEach(child => processNode(child))
                            }
                          }
                        }
                        
                        // Process all child nodes
                        Array.from(textElement.childNodes || []).forEach(child => processNode(child))
                        
                        // Fallback to text if HTML is still empty
                        if (!tweetHtml.trim()) {
                          tweetHtml = textElement.textContent || textElement.innerText || ''
                        }
                        
                        // Clean up: remove extra whitespace but preserve intentional spacing
                        tweetHtml = tweetHtml.trim().replace(/\\s+/g, ' ')
                        
                        console.log('Extracted tweet HTML (cleaned), length:', tweetHtml.length, 'preview:', tweetHtml.substring(0, 200))
                        
                        // Get author info
                        let authorName = 'User'
                        let authorHandle = '@user'
                        if (authorElement) {
                          const authorText = authorElement.textContent || ''
                          const nameParts = authorText.split('@')
                          if (nameParts.length > 0) {
                            authorName = nameParts[0].trim() || 'User'
                          }
                          if (nameParts.length > 1) {
                            authorHandle = '@' + nameParts[1].trim()
                          } else {
                            // Try to get handle from href
                            const authorLink = authorElement.querySelector('a[href*="/"]')
                            if (authorLink) {
                              const href = authorLink.getAttribute('href') || ''
                              const match = href.match(/\\/([^\\/]+)$/)
                              if (match) {
                                authorHandle = '@' + match[1]
                              }
                            }
                          }
                        }
                        
                        const date = dateElement?.getAttribute('datetime') 
                          ? new Date(dateElement.getAttribute('datetime')).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) 
                          : new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                        
                        // Construct blockquote with preserved HTML structure
                        // Add ref_src parameter to tweet URL (Twitter expects this)
                        const tweetUrlWithRef = tweetUrl + (tweetUrl.includes('?') ? '&' : '?') + 'ref_src=twsrc%5Etfw'
                        let blockquoteHtml = '<blockquote class="twitter-tweet" data-theme="${theme}" data-dnt="true" align="center"><p lang="en" dir="ltr">' + tweetHtml
                        
                        blockquoteHtml += '</p>&mdash; ' + authorName + ' (' + authorHandle + ') <a href="' + tweetUrlWithRef + '">' + date + '</a>'
                        blockquoteHtml += '</blockquote>'
                        
                        console.log('Extracted tweet content, total HTML length:', blockquoteHtml.length)
                        return { 
                          success: true, 
                          data: { 
                            html: blockquoteHtml,
                            fallback: true 
                          } 
                        }
                      } else {
                        console.log('No text element found in article')
                        // Try to get any text from article as last resort
                        const articleText = article.innerText || article.textContent || ''
                        if (articleText.trim().length > 20) {
                          console.log('Using article text as fallback, length:', articleText.length)
                          const escapedText = articleText.substring(0, 500).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                          const blockquoteHtml = '<blockquote class="twitter-tweet" data-theme="${theme}" data-dnt="true" align="center"><p lang="en" dir="ltr">' + escapedText + '</p><a href="' + tweetUrl + '"></a></blockquote>'
                          return { 
                            success: true, 
                            data: { 
                              html: blockquoteHtml,
                              fallback: true 
                            } 
                          }
                        }
                      }
                    } else {
                      console.log('No article element found on page')
                    }
                  } catch (e) {
                    console.log('DOM extraction error:', e.message, e.stack)
                  }
                  
                  // Fallback: construct a basic embed blockquote
                  // Twitter's embed script will render this
                  const tweetId = window.location.pathname.split('/status/')[1]?.split('/')[0]
                  console.log('Using fallback blockquote, tweetId:', tweetId)
                  
                  if (tweetId) {
                    // Use Twitter's standard embed format - must match exactly what Twitter expects
                    // The blockquote needs the tweet URL in the <a> tag's href
                    const blockquoteHtml = '<blockquote class="twitter-tweet" data-theme="${theme}" data-dnt="true"><a href="' + tweetUrl + '"></a></blockquote>'
                    console.log('Generated fallback blockquote, length:', blockquoteHtml.length)
                    return { 
                      success: true, 
                      data: { 
                        html: blockquoteHtml,
                        fallback: true 
                      } 
                    }
                  }
                }
                
                return { success: false, error: 'Could not extract embed from page' }
              } catch (error) {
                console.error('Error in embed extraction:', error)
                return { success: false, error: error.message }
              }
            })()
          `)
          
          console.log('Embed extraction result:', embedHtml?.success ? 'Success' : 'Failed', embedHtml?.error || '')
          resolve(embedHtml)
        } catch (error) {
          console.error('Error in did-finish-load handler:', error)
          reject(error)
        }
      })
      
      browserView!.webContents.once('did-fail-load', (_event, _errorCode, errorDescription) => {
        clearTimeout(timeout)
        reject(new Error(`Failed to load: ${errorDescription}`))
      })
      
      // Load the tweet URL directly
      browserView!.webContents.loadURL(tweetUrl)
    })
    
    return result
  } catch (error) {
    console.error('Error fetching Twitter embed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    // Clean up the BrowserView
    if (browserView) {
      if (win) {
        win.setBrowserView(null)
      }
      // BrowserView cleanup - remove from window and let it be garbage collected
      browserView = null
    }
  }
})

ipcMain.handle('fetch-tiktok-embed', async (_event, tiktokUrl: string) => {
  try {
    console.log('[Main Process] Fetching TikTok embed for URL:', tiktokUrl)
    
    // Use TikTok's oEmbed API for better reliability and extra info
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(tiktokUrl)}`
    console.log('[Main Process] Calling TikTok oEmbed API:', oembedUrl)
    
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    })
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error(`[Main Process] TikTok oEmbed API returned status ${response.status}:`, errorText.substring(0, 200))
      throw new Error(`TikTok oEmbed API error: ${response.status}`)
    }
    
    const data = await response.json()
    console.log('[Main Process] Got TikTok oEmbed data:', {
      type: data.type,
      title: data.title?.substring(0, 50),
      author: data.author_name,
      htmlLength: data.html?.length || 0
    })
    
    if (data.html) {
      // Remove the script tag from the HTML - we'll load it separately via scriptLoader
      let html = data.html
      const scriptMatch = html.match(/<script[^>]*>.*?<\/script>/i)
      if (scriptMatch) {
        html = html.replace(/<script[^>]*>.*?<\/script>/gi, '')
        console.log('[Main Process] Removed script tag from TikTok oEmbed HTML')
      }
      
      return { success: true, data: { html } }
    } else {
      throw new Error('TikTok oEmbed API did not return HTML')
    }
  } catch (error) {
    console.error('[Main Process] Error fetching TikTok embed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
})

ipcMain.handle('fetch-imgur-album', async (_event, imgurUrl: string) => {
  let browserView: BrowserView | null = null
  const win = BrowserWindow.getFocusedWindow()
  
  try {
    console.log('[Main Process] Fetching Imgur album for URL:', imgurUrl)
    console.log('[Main Process] Request time:', new Date().toISOString())
    
    // Check if this is an album/gallery link
    // Supports both /gallery/ID and /a/ID formats (short album links)
    const urlObj = new URL(imgurUrl)
    const pathname = urlObj.pathname // Don't lowercase - album IDs are case-sensitive!
    const pathnameLower = pathname.toLowerCase()
    const isAlbum = pathnameLower.startsWith('/gallery/') || pathnameLower.startsWith('/a/')
    
    if (!isAlbum) {
      // Not an album, return null to treat as regular link
      return { success: false, error: 'Not an Imgur album link' }
    }
    
    // Extract album ID from URL (preserve case - album IDs are case-sensitive!)
    const albumIdMatch = pathname.match(/\/(?:gallery|a)\/([^\/]+)/i)
    const albumId = albumIdMatch ? albumIdMatch[1] : null
    
    if (!albumId) {
      return { success: false, error: 'Could not extract album ID from URL' }
    }
    
    console.log('[Main Process] Extracted album ID:', albumId)
    
    // Try the Imgur API first - this is much simpler and more reliable
    try {
      const apiUrl = `https://api.imgur.com/post/v1/albums/${albumId}?client_id=d70305e7c3ac5c6&include=media%2Cadconfig%2Caccount%2Ctags`
      console.log('[Main Process] Fetching from Imgur API:', apiUrl)
      const apiStartTime = Date.now()
      
      const response = await fetchWithCookies(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      
      const apiFetchTime = Date.now() - apiStartTime
      console.log(`[Main Process] Imgur API response status: ${response.status} (took ${apiFetchTime}ms)`)
      
      if (response.ok) {
        const apiData = await response.json()
        console.log('[Main Process] Got album data from API:', {
          id: apiData.id,
          title: apiData.title,
          image_count: apiData.image_count,
          media_count: apiData.media?.length || 0
        })
        
        // Extract media URLs and descriptions
        const media = (apiData.media || []).map((item: any) => ({
          id: item.id,
          url: item.url,
          description: item.metadata?.description || '',
          title: item.metadata?.title || item.name || '',
          width: item.width || 0,
          height: item.height || 0,
          type: item.type,
          mime_type: item.mime_type
        }))
        
        return {
          success: true,
          data: {
            id: apiData.id,
            title: apiData.title || '',
            description: apiData.description || '',
            media: media,
            image_count: apiData.image_count || media.length,
            is_album: apiData.is_album || false
          }
        }
      } else {
        const errorText = await response.text().catch(() => '')
        console.log(`[Main Process] Imgur API returned status ${response.status}:`, errorText.substring(0, 200))
      }
    } catch (apiError) {
      console.log('[Main Process] Imgur API request failed, falling back to page extraction:', apiError)
    }
    
    // Fallback: Create a hidden BrowserView to load the page and extract data
    browserView = new BrowserView({
      webPreferences: {
        partition: 'persist:main',
        webSecurity: false,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    
    if (win) {
      win.setBrowserView(browserView)
      browserView.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      browserView.setAutoResize({ width: false, height: false })
    }
    
    const result = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout loading Imgur page'))
      }, 15000)
      
      browserView!.webContents.once('did-finish-load', async () => {
        clearTimeout(timeout)
        
        try {
          // Wait for the React app to load and populate the page
          // Try multiple times as the data loads asynchronously
          let albumData = null
          let attempts = 0
          const maxAttempts = 10
          
          while (!albumData && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 500))
            attempts++
            
            albumData = await browserView!.webContents.executeJavaScript(`
              (() => {
                try {
                  // Method 1: Try to access window.postDataJSON directly (for /gallery/ links)
                  if (window.postDataJSON && typeof window.postDataJSON === 'object') {
                    return window.postDataJSON
                  }
                  
                  // Method 2: Look for the script tag with window.postDataJSON (for /gallery/ links)
                  const scripts = document.querySelectorAll('script')
                  for (const script of scripts) {
                    if (script.textContent && script.textContent.includes('window.postDataJSON')) {
                      // Extract the JSON string - it's in the format: window.postDataJSON="..."
                      const match = script.textContent.match(/window\\.postDataJSON\\s*=\\s*"([^"]+)"/)
                      if (match && match[1]) {
                        // The JSON is escaped in the HTML, so we need to unescape it
                        let jsonStr = match[1]
                          .replace(/\\\\"/g, '"')
                          .replace(/\\\\n/g, '\\n')
                          .replace(/\\\\t/g, '\\t')
                          .replace(/\\\\\\\\/g, '\\\\')
                          .replace(/\\\\u([0-9a-fA-F]{4})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
                        
                        try {
                          const data = JSON.parse(jsonStr)
                          return data
                        } catch (e) {
                          console.error('Failed to parse postDataJSON:', e)
                        }
                      }
                    }
                  }
                  
                  // Method 3: For /a/ links, try to extract from React app state
                  // Look for data in window.__INITIAL_STATE__ or similar
                  if (window.__INITIAL_STATE__) {
                    const state = window.__INITIAL_STATE__
                    // Try to find album/post data in the state
                    if (state.post || state.album) {
                      return state.post || state.album
                    }
                  }
                  
                  // Method 4: Try to find data in window.__REACT_QUERY_STATE__ or similar
                  if (window.__REACT_QUERY_STATE__) {
                    const queryState = window.__REACT_QUERY_STATE__
                    // Look for album/post data in React Query cache
                    for (const key in queryState.queries) {
                      const query = queryState.queries[key]
                      if (query && query.state && query.state.data) {
                        const data = query.state.data
                        if (data.media || data.image_count || data.is_album) {
                          return data
                        }
                      }
                    }
                  }
                  
                  // Method 5: Try to find data in the React root element's props/state
                  const root = document.getElementById('root')
                  if (root) {
                    // Try React DevTools approach - look for _reactInternalFiber or _reactInternalInstance
                    const reactKey = Object.keys(root).find(key => 
                      key.startsWith('__reactInternalInstance') || 
                      key.startsWith('__reactFiber') ||
                      key.startsWith('_reactInternalFiber')
                    )
                    if (reactKey) {
                      let fiber = (root as any)[reactKey]
                      // Traverse React fiber tree
                      const traverseFiber = (node: any, depth = 0): any => {
                        if (depth > 10) return null // Prevent infinite loops
                        if (!node) return null
                        
                        // Check memoizedState
                        if (node.memoizedState) {
                          let state = node.memoizedState
                          while (state) {
                            if (state.memoizedState && (state.memoizedState.media || state.memoizedState.image_count)) {
                              return state.memoizedState
                            }
                            state = state.next
                          }
                        }
                        
                        // Check memoizedProps
                        if (node.memoizedProps && (node.memoizedProps.post || node.memoizedProps.album)) {
                          return node.memoizedProps.post || node.memoizedProps.album
                        }
                        
                        // Check stateNode
                        if (node.stateNode && node.stateNode.state) {
                          const state = node.stateNode.state
                          if (state.post || state.album || state.media) {
                            return state.post || state.album || state
                          }
                        }
                        
                        // Recurse
                        return traverseFiber(node.child, depth + 1) || 
                               traverseFiber(node.sibling, depth + 1)
                      }
                      
                      const found = traverseFiber(fiber)
                      if (found) return found
                    }
                  }
                  
                  // Method 6: Try to find JSON data in script tags with type="application/json"
                  const jsonScripts = document.querySelectorAll('script[type="application/json"]')
                  for (const script of jsonScripts) {
                    try {
                      const data = JSON.parse(script.textContent)
                      if (data.media || data.image_count) {
                        return data
                      }
                    } catch (e) {
                      // Not valid JSON, continue
                    }
                  }
                  
                  // Method 7: Try to extract from meta tags (at least get the cover image)
                  const ogImage = document.querySelector('meta[property="og:image"]')
                  const twitterImage = document.querySelector('meta[name="twitter:image"]')
                  const imageUrl = ogImage?.getAttribute('content') || twitterImage?.getAttribute('content')
                  
                  if (imageUrl) {
                    // Extract image ID from URL (e.g., https://i.imgur.com/XrcZ1ga.png -> XrcZ1ga)
                    const imageIdMatch = imageUrl.match(/i\\.imgur\\.com\\/([^.?]+)/)
                    if (imageIdMatch) {
                      return {
                        id: albumId,
                        title: document.title.replace(' - Album on Imgur', '').replace('Imgur: ', ''),
                        description: '',
                        media: [{
                          id: imageIdMatch[1],
                          url: imageUrl.split('?')[0], // Remove query params
                          description: '',
                          title: '',
                          width: 0,
                          height: 0,
                          type: 'image',
                          mime_type: 'image/png'
                        }],
                        image_count: 1,
                        is_album: false
                      }
                    }
                  }
                  
                  return null
                } catch (error) {
                  console.error('Error extracting Imgur data:', error)
                  return null
                }
              })()
            `)
            
            if (albumData) {
              console.log(`Found album data after ${attempts} attempt(s)`)
              break
            }
          }
          
          // If we still don't have data, try the oEmbed API as a fallback
          if (!albumData) {
            console.log('Trying Imgur oEmbed API as fallback...')
            try {
              const oembedUrl = `https://api.imgur.com/oembed.json?url=${encodeURIComponent(imgurUrl)}`
              const response = await fetchWithCookies(oembedUrl)
              if (response.ok) {
                const oembedData = await response.json()
                console.log('Got oEmbed data:', oembedData)
                // oEmbed doesn't give us the full album data, but we can extract some info
                // For now, we'll still need to get the full data from the page
                // This is just a fallback that might help
              }
            } catch (oembedError) {
              console.log('oEmbed API also failed:', oembedError)
            }
          }
          
          if (!albumData) {
            reject(new Error('Could not extract album data from Imgur page after multiple attempts'))
            return
          }
          
          console.log('Extracted Imgur album data:', {
            id: albumData.id,
            title: albumData.title,
            image_count: albumData.image_count,
            media_count: albumData.media?.length || 0
          })
          
          // Extract media URLs and descriptions
          const media = (albumData.media || []).map((item: any) => ({
            id: item.id,
            url: item.url,
            description: item.metadata?.description || '',
            title: item.metadata?.title || '',
            width: item.width,
            height: item.height,
            type: item.type,
            mime_type: item.mime_type
          }))
          
          resolve({
            success: true,
            data: {
              id: albumData.id,
              title: albumData.title || '',
              description: albumData.description || '',
              media: media,
              image_count: albumData.image_count || media.length,
              is_album: albumData.is_album || false
            }
          })
        } catch (error) {
          console.error('Error in did-finish-load handler:', error)
          reject(error)
        }
      })
      
      browserView!.webContents.once('did-fail-load', (_event, _errorCode, errorDescription) => {
        clearTimeout(timeout)
        reject(new Error(`Failed to load: ${errorDescription}`))
      })
      
      // Load the Imgur URL
      browserView!.webContents.loadURL(imgurUrl)
    })
    
    return result
  } catch (error) {
    console.error('Error fetching Imgur album:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    // Clean up the BrowserView
    if (browserView) {
      if (win) {
        win.setBrowserView(null)
      }
      // BrowserView cleanup - remove from window and let it be garbage collected
      browserView = null
    }
  }
})

// Proxy image requests to bypass CORS restrictions
ipcMain.handle('fetch-image', async (_event, imageUrl: string) => {
  try {
    console.log('[Main Process] Fetching image:', imageUrl.substring(0, 80))
    
    // Prepare headers for the request
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    // Set appropriate Referer based on the domain
    if (imageUrl.includes('4cdn.org')) {
      headers['Referer'] = 'https://www.4chan.org/'
      headers['Origin'] = 'https://www.4chan.org'
    } else if (imageUrl.includes('imgur.com')) {
      headers['Referer'] = 'https://imgur.com/'
    } else if (imageUrl.includes('twimg.com')) {
      headers['Referer'] = 'https://twitter.com/'
    }
    
    // Fetch the image using regular fetch (main process has no CORS restrictions)
    const response = await fetch(imageUrl, {
      headers
    })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
    }
    
    // Get the image as a buffer
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Determine content type from response or URL
    let contentType = response.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) {
      // Fallback: try to determine from URL extension
      if (imageUrl.match(/\.(jpg|jpeg)$/i)) contentType = 'image/jpeg'
      else if (imageUrl.match(/\.png$/i)) contentType = 'image/png'
      else if (imageUrl.match(/\.gif$/i)) contentType = 'image/gif'
      else if (imageUrl.match(/\.webp$/i)) contentType = 'image/webp'
      else contentType = 'image/jpeg' // Default fallback
    }
    
    // Convert to base64 data URL
    const base64 = buffer.toString('base64')
    const dataUrl = `data:${contentType};base64,${base64}`
    
    console.log('[Main Process] Successfully fetched image, size:', buffer.length, 'bytes')
    
    return { success: true, dataUrl }
  } catch (error) {
    console.error('[Main Process] Error fetching image:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
})

ipcMain.handle('fetch-reddit-embed', async (_event, redditUrl: string, theme: 'light' | 'dark' = 'dark') => {
  try {
    console.log('Fetching Reddit embed for URL:', redditUrl)
    
    // Try Reddit's oEmbed API first
    try {
      const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(redditUrl)}`
      // Use fetchWithCookies to include session cookies
      const response = await fetchWithCookies(oembedUrl)
      if (response.ok) {
        const data = await response.json()
        if (data.html) {
          console.log('Got Reddit embed from oEmbed API')
          console.log('oEmbed HTML length:', data.html.length)
          console.log('oEmbed HTML preview:', data.html.substring(0, 300))
          
          // Check if the HTML includes a script tag - if so, we need to extract just the blockquote
          // Reddit's oEmbed sometimes includes the script tag in the HTML
          let html = data.html
          
          // If HTML includes script tag, extract just the blockquote part
          const scriptMatch = html.match(/<script[^>]*>.*?<\/script>/i)
          if (scriptMatch) {
            console.log('oEmbed HTML includes script tag, extracting blockquote')
            // Remove script tag - we'll load it separately via the manager
            html = html.replace(/<script[^>]*>.*?<\/script>/gi, '')
          }
          
          // Ensure the blockquote has the correct class and theme if it doesn't
          if (html.includes('<blockquote')) {
            if (!html.includes('reddit-embed-bq')) {
              console.log('Adding reddit-embed-bq class to blockquote')
              html = html.replace('<blockquote', '<blockquote class="reddit-embed-bq"')
            }
            // Ensure dark theme is set
            if (!html.includes('data-embed-theme')) {
              console.log('Adding data-embed-theme="dark" to blockquote')
              html = html.replace('<blockquote', `<blockquote data-embed-theme="${theme}"`)
            } else if (theme === 'dark' && html.includes('data-embed-theme="light"')) {
              console.log('Changing theme from light to dark')
              html = html.replace('data-embed-theme="light"', 'data-embed-theme="dark"')
            }
          }
          
          return { success: true, data: { html } }
        }
      }
    } catch (oembedError) {
      console.log('Reddit oEmbed API failed, constructing manually')
    }
    
    // Check if this is a media link
    const urlObj = new URL(redditUrl)
    if (urlObj.pathname === '/media' && urlObj.searchParams.has('url')) {
      // For media links, we can't embed them as Reddit posts
      // Return null to indicate it should be treated as a regular link
      throw new Error('Reddit media links cannot be embedded as Reddit posts')
    }
    
    // If oEmbed fails, construct manually from URL
    // Format: https://www.reddit.com/r/SUBREDDIT/comments/POST_ID/TITLE/
    const urlMatch = redditUrl.match(/\/r\/([^/]+)\/comments\/([^/]+)\/([^/]+)/)
    if (!urlMatch) {
      throw new Error('Invalid Reddit URL format')
    }
    
    const subreddit = urlMatch[1]
    const titleSlug = urlMatch[3]
    
    // Decode title from slug (basic decoding)
    const title = decodeURIComponent(titleSlug.replace(/_/g, ' '))
    
    // Construct the blockquote HTML matching Reddit's official format
    // Format should match: <blockquote class="reddit-embed-bq" style="height:316px" data-embed-theme="dark" data-embed-height="316">...</blockquote>
    const blockquoteHtml = `<blockquote class="reddit-embed-bq" style="height:500px" data-embed-theme="${theme}" data-embed-height="500"><a href="${redditUrl}">${title}</a><br> by<a href="https://www.reddit.com/user/USER/">u/USER</a> in<a href="https://www.reddit.com/r/${subreddit}/">${subreddit}</a></blockquote>`
    
    console.log('Generated Reddit embed HTML')
    return { success: true, data: { html: blockquoteHtml } }
  } catch (error) {
    console.error('Error fetching Reddit embed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
})

// Open login window for services
ipcMain.handle('open-login-window', async (_event, service: string) => {
  try {
    const loginUrls: Record<string, string> = {
      twitter: 'https://twitter.com/i/flow/login',
      tiktok: 'https://www.tiktok.com/login',
      reddit: 'https://www.reddit.com/login',
      destiny: 'https://www.destiny.gg/login',
    }
    
    const url = loginUrls[service.toLowerCase()] || 'https://www.google.com'
    
    // Create a new browser window for login using the same persistent session
    const loginWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Use the same persistent session partition so cookies are shared and saved
        partition: 'persist:main',
      },
      title: `Login to ${service.charAt(0).toUpperCase() + service.slice(1)}`,
    })
    
    // For login windows, allow normal navigation within the window
    // Don't intercept links - let the login flow work normally
    // Only the main window should open external links in the default browser
    
    loginWindow.loadURL(url)
    
    // When login window navigates, check for successful login
    loginWindow.webContents.on('did-navigate', async (_event, navigationUrl) => {
      // Check if we're on a logged-in page (e.g., twitter.com/home, reddit.com, etc.)
      const loggedInPatterns: Record<string, RegExp> = {
        twitter: /twitter\.com\/(home|notifications|messages|i\/bookmarks|i\/flow\/login)/,
        tiktok: /tiktok\.com\/(foryou|following|discover)/,
        reddit: /reddit\.com\/($|r\/|user\/)/,
      }
      
      const pattern = loggedInPatterns[service.toLowerCase()]
      if (pattern && pattern.test(navigationUrl)) {
        console.log(`Login navigation detected for ${service}`)
        
        // Wait a bit for cookies to be set, then verify
        setTimeout(async () => {
          if (service.toLowerCase() === 'twitter') {
            const session = loginWindow.webContents.session
            const cookies = await session.cookies.get({ domain: '.twitter.com' })
            console.log(`Found ${cookies.length} Twitter cookies after login`)
            if (cookies.length > 0) {
              const authCookies = cookies.filter(c => c.name.includes('auth') || c.name === 'ct0')
              console.log(`Auth cookies: ${authCookies.map(c => c.name).join(', ')}`)
            }
          }
        }, 2000)
        
        // Optionally notify renderer
        win?.webContents.send('login-success', service)
      }
    })
    
    // Also listen for cookie changes
    loginWindow.webContents.session.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (!removed && cookie.domain && (cookie.domain.includes('twitter.com') || cookie.domain.includes('x.com'))) {
        console.log(`Twitter cookie ${removed ? 'removed' : 'set'}: ${cookie.name} for ${cookie.domain}`)
        
        // Check if this is an authentication cookie
        if (cookie.name === 'auth_token' || cookie.name === 'ct0') {
          console.log(`✅ Authentication cookie set: ${cookie.name}`)
          // Notify the main window that login was successful
          win?.webContents.send('twitter-login-success')
        }
      }

      // Destiny.gg login (typically sets sid / rememberme)
      if (!removed && cookie.domain && cookie.domain.includes('destiny.gg')) {
        if (cookie.name === 'sid' || cookie.name === 'rememberme') {
          console.log(`✅ Destiny cookie set: ${cookie.name} for ${cookie.domain}`)
          win?.webContents.send('login-success', 'destiny')
        }
      }
    })
    
    loginWindow.setMaxListeners(20)
    // Clean up when window is closed
    loginWindow.on('closed', () => {
      // Optionally notify renderer that login window was closed
      // win?.webContents.send('login-window-closed', service)
    })
    
    return { success: true }
  } catch (error) {
    console.error('Error opening login window:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

// Chat WebSocket IPC handlers
ipcMain.handle('chat-websocket-connect', async (_event) => {
  try {
    if (!chatWebSocket) {
      chatWebSocket = new ChatWebSocket()
      
      // Helper function to safely send messages to renderer
      const safeSend = (channel: string, ...args: any[]) => {
        try {
          // Check if window exists and is not destroyed
          if (!win) return
          
          // Check if window is destroyed - this might throw, so wrap in try-catch
          let isDestroyed = false
          try {
            isDestroyed = win.isDestroyed()
          } catch {
            // If checking isDestroyed throws, assume it's destroyed
            return
          }
          
          if (isDestroyed) return
          
          // Check if webContents exists and is not destroyed
          if (!win.webContents) return
          
          let webContentsDestroyed = false
          try {
            webContentsDestroyed = win.webContents.isDestroyed()
          } catch {
            // If checking isDestroyed throws, assume it's destroyed
            return
          }
          
          if (webContentsDestroyed) return
          
          // Now safe to send
          win.webContents.send(channel, ...args)
        } catch (error) {
          // Window or webContents was destroyed - silently ignore
          // This is expected during app shutdown
        }
      }
      
      // Forward events to renderer
      chatWebSocket.on('connected', () => {
        safeSend('chat-websocket-connected')
      })
      
      chatWebSocket.on('disconnected', (data) => {
        safeSend('chat-websocket-disconnected', data)
      })
      
      chatWebSocket.on('error', (error) => {
        try {
          const errorMessage = error instanceof Error ? error.message : (error?.message || String(error) || 'Unknown error')
          safeSend('chat-websocket-error', { message: errorMessage })
        } catch (sendError) {
          console.error('[Main Process] Failed to send WebSocket error to renderer:', sendError)
        }
      })
      
      chatWebSocket.on('history', (history) => {
        console.log(`[Main Process] Received history event with ${history.messages?.length || 0} messages`)
        safeSend('chat-websocket-history', history)
      })
      
      chatWebSocket.on('message', (data) => {
        safeSend('chat-websocket-message', data)
      })
      
      chatWebSocket.on('userEvent', (event) => {
        safeSend('chat-websocket-user-event', event)
      })
      
      chatWebSocket.on('paidEvents', (event) => {
        safeSend('chat-websocket-paid-events', event)
      })
      
      chatWebSocket.on('pin', (event) => {
        safeSend('chat-websocket-pin', event)
      })
      
      chatWebSocket.on('names', (event) => {
        safeSend('chat-websocket-names', event)
      })
      
      chatWebSocket.on('mute', (event) => {
        safeSend('chat-websocket-mute', event)
      })
      
      chatWebSocket.on('me', (event) => {
        safeSend('chat-websocket-me', event)
      })
      
      chatWebSocket.on('pollStart', (event) => {
        safeSend('chat-websocket-poll-start', event)
      })
      
      chatWebSocket.on('voteCast', (event) => {
        safeSend('chat-websocket-vote-cast', event)
      })
      
      chatWebSocket.on('pollStop', (event) => {
        safeSend('chat-websocket-poll-stop', event)
      })

      chatWebSocket.on('death', (event) => {
        safeSend('chat-websocket-death', event)
      })

      chatWebSocket.on('unban', (event) => {
        safeSend('chat-websocket-unban', event)
      })

      chatWebSocket.on('subscription', (event) => {
        safeSend('chat-websocket-subscription', event)
      })

      chatWebSocket.on('broadcast', (event) => {
        safeSend('chat-websocket-broadcast', event)
      })
    }
    
    if (!chatWebSocket.isConnected()) {
      chatWebSocket.connect()
    }
    
    return { success: true }
  } catch (error) {
    console.error('[Main Process] Error connecting chat WebSocket:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('chat-websocket-disconnect', async (_event) => {
  try {
    if (chatWebSocket) {
      chatWebSocket.disconnect()
      chatWebSocket.destroy()
      chatWebSocket = null
    }
    return { success: true }
  } catch (error) {
    console.error('[Main Process] Error disconnecting chat WebSocket:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('chat-websocket-status', async (_event) => {
  return {
    connected: chatWebSocket?.isConnected() || false
  }
})

// Live (embeds) WebSocket IPC handlers
ipcMain.handle('live-websocket-connect', async (_event) => {
  try {
    if (!liveWebSocket) {
      liveWebSocket = new LiveWebSocket()

      const safeSend = (channel: string, ...args: any[]) => {
        try {
          if (!win) return
          let isDestroyed = false
          try {
            isDestroyed = win.isDestroyed()
          } catch {
            return
          }
          if (isDestroyed) return
          if (!win.webContents) return
          let webContentsDestroyed = false
          try {
            webContentsDestroyed = win.webContents.isDestroyed()
          } catch {
            return
          }
          if (webContentsDestroyed) return
          win.webContents.send(channel, ...args)
        } catch {
          // ignore
        }
      }

      liveWebSocket.on('connected', () => safeSend('live-websocket-connected'))
      liveWebSocket.on('disconnected', (data) => safeSend('live-websocket-disconnected', data))
      liveWebSocket.on('error', (error) => {
        const message = error?.message || (error instanceof Error ? error.message : String(error) || 'Unknown error')
        safeSend('live-websocket-error', { message })
      })
      liveWebSocket.on('message', (data) => safeSend('live-websocket-message', data))
    }

    if (!liveWebSocket.isConnected()) {
      liveWebSocket.connect()
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('live-websocket-disconnect', async (_event) => {
  try {
    if (liveWebSocket) {
      liveWebSocket.disconnect()
      liveWebSocket.destroy()
      liveWebSocket = null
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('live-websocket-status', async (_event) => {
  return { connected: liveWebSocket?.isConnected() || false }
})

// Kick (Pusher) chat IPC handlers
ipcMain.handle('kick-chat-set-targets', async (_event, payload: { slugs: string[] }) => {
  try {
    const slugs = Array.isArray(payload?.slugs) ? payload.slugs : []
    if (!kickChatManager) {
      kickChatManager = new KickChatManager()

      const safeSend = (channel: string, ...args: any[]) => {
        try {
          if (!win) return
          let isDestroyed = false
          try {
            isDestroyed = win.isDestroyed()
          } catch {
            return
          }
          if (isDestroyed) return
          if (!win.webContents) return
          let webContentsDestroyed = false
          try {
            webContentsDestroyed = win.webContents.isDestroyed()
          } catch {
            return
          }
          if (webContentsDestroyed) return
          win.webContents.send(channel, ...args)
        } catch {
          // ignore
        }
      }

      kickChatManager.on('message', (msg) => safeSend('kick-chat-message', msg))
    }

    await kickChatManager.setTargets(slugs)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) || 'Unknown error' }
  }
})

// Kick history helpers (Cloudflare/cookie priming + retry)
ipcMain.handle('kick-open-cookie-window', async (_event, payload?: { slug?: string }) => {
  try {
    const slug = String(payload?.slug || '').trim()
    // Prefer the popout chat page so we hit the same path/site behavior as history + chat.
    const url = slug ? `https://kick.com/popout/${encodeURIComponent(slug)}/chat` : 'https://kick.com/'

    const w = new BrowserWindow({
      width: 900,
      height: 720,
      autoHideMenuBar: true,
      title: 'Kick (history setup)',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:main',
      },
    })

    // If Cloudflare challenge appears, user can complete it; cookies will be stored in persist:main.
    try {
      w.webContents.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      )
    } catch {
      // ignore
    }

    w.setMaxListeners(20)
    // After the user closes the window, re-attempt history fetches.
    w.on('closed', () => {
      try {
        kickChatManager?.refetchHistory().catch(() => {})
      } catch {
        // ignore
      }
    })

    // Don't await: Kick/Cloudflare pages can keep "loading" forever, but cookies are still written.
    // We just need the window to open.
    w.loadURL(url).catch(() => {})
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) || 'Unknown error' }
  }
})

ipcMain.handle('kick-chat-refetch-history', async (_event, payload?: { slugs?: string[] }) => {
  try {
    const slugs = Array.isArray(payload?.slugs) ? payload?.slugs : []
    if (!kickChatManager) return { success: false, error: 'KickChatManager not initialized' }
    await kickChatManager.refetchHistory(slugs)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) || 'Unknown error' }
  }
})

// YouTube chat IPC handlers (polls youtubei live_chat endpoint)
ipcMain.handle(
  'youtube-chat-set-targets',
  async (_event, payload: { videoIds: string[]; opts?: { delayMultiplier?: number } }) => {
  try {
    const videoIds = Array.isArray(payload?.videoIds) ? payload.videoIds : []
    const opts = payload?.opts

    if (!youTubeChatManager) {
      youTubeChatManager = new YouTubeChatManager()

      const safeSend = (channel: string, ...args: any[]) => {
        try {
          if (!win) return
          let isDestroyed = false
          try {
            isDestroyed = win.isDestroyed()
          } catch {
            return
          }
          if (isDestroyed) return
          if (!win.webContents) return
          let webContentsDestroyed = false
          try {
            webContentsDestroyed = win.webContents.isDestroyed()
          } catch {
            return
          }
          if (webContentsDestroyed) return
          win.webContents.send(channel, ...args)
        } catch {
          // ignore
        }
      }

      youTubeChatManager.on('message', (msg) => safeSend('youtube-chat-message', msg))
    }

    await youTubeChatManager.setTargets(videoIds, opts)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) || 'Unknown error' }
  }
})

// Twitch chat IPC handlers (IRC over WebSocket)
ipcMain.handle('twitch-chat-set-targets', async (_event, payload: { channels: string[] }) => {
  try {
    const channels = Array.isArray(payload?.channels) ? payload.channels : []

    if (!twitchChatManager) {
      twitchChatManager = new TwitchChatManager()

      const safeSend = (channel: string, ...args: any[]) => {
        try {
          if (!win) return
          let isDestroyed = false
          try {
            isDestroyed = win.isDestroyed()
          } catch {
            return
          }
          if (isDestroyed) return
          if (!win.webContents) return
          let webContentsDestroyed = false
          try {
            webContentsDestroyed = win.webContents.isDestroyed()
          } catch {
            return
          }
          if (webContentsDestroyed) return
          win.webContents.send(channel, ...args)
        } catch {
          // ignore
        }
      }

      twitchChatManager.on('message', (msg) => safeSend('twitch-chat-message', msg))
    }

    await twitchChatManager.setTargets(channels)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) || 'Unknown error' }
  }
})

ipcMain.handle('fetch-lsf-video-url', async (_event, lsfUrl: string) => {
  try {
    console.log('[Main Process] Fetching LSF video URL for:', lsfUrl)
    
    const response = await fetch(lsfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const html = await response.text()
    
    // Extract video URL from <source id="clip-source" src="...">
    const sourceMatch = html.match(/<source[^>]*id=["']clip-source["'][^>]*src=["']([^"']+)["']/i)
    if (sourceMatch && sourceMatch[1]) {
      const videoUrl = sourceMatch[1]
      console.log('[Main Process] Extracted LSF video URL:', videoUrl.substring(0, 100) + '...')
      return { success: true, data: { videoUrl } }
    }
    
    // Fallback: try to find any source tag with .mp4
    const mp4Match = html.match(/<source[^>]*src=["']([^"']+\.mp4[^"']*)["']/i)
    if (mp4Match && mp4Match[1]) {
      const videoUrl = mp4Match[1]
      console.log('[Main Process] Extracted LSF video URL (fallback):', videoUrl.substring(0, 100) + '...')
      return { success: true, data: { videoUrl } }
    }
    
    throw new Error('Could not find video source in LSF page HTML')
  } catch (error) {
    console.error('[Main Process] Error fetching LSF video URL:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
  }
})

// Initialize file logger after APP_ROOT is set (line 18)
// This ensures the logs directory is created in the correct location (project root/logs)
fileLogger.initialize()

// Intercept console methods in main process to write to file
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const originalConsoleInfo = console.info
const originalConsoleDebug = console.debug

console.log = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  fileLogger.writeLog('info', 'main', message, args)
  originalConsoleLog.apply(console, args)
}

console.error = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  fileLogger.writeLog('error', 'main', message, args)
  originalConsoleError.apply(console, args)
}

console.warn = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  fileLogger.writeLog('warn', 'main', message, args)
  originalConsoleWarn.apply(console, args)
}

console.info = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  fileLogger.writeLog('info', 'main', message, args)
  originalConsoleInfo.apply(console, args)
}

console.debug = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')
  fileLogger.writeLog('debug', 'main', message, args)
  originalConsoleDebug.apply(console, args)
}

// IPC handler for renderer process to send logs
ipcMain.handle('log-to-file', (_event, level: string, message: string, args: any[] = []) => {
  fileLogger.writeLog(level, 'renderer', message, args)
})

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error) || 'Unknown error'
  const errorStack = error instanceof Error ? error.stack : String(error)
  console.error('[Main Process] Uncaught Exception:', errorMessage)
  console.error('[Main Process] Uncaught Exception stack:', errorStack)
  fileLogger.writeLog('error', 'main', `Uncaught Exception: ${errorMessage}`, [errorStack])
  // Don't exit - log and continue
})

process.on('unhandledRejection', (reason, _promise) => {
  const reasonMessage = reason instanceof Error ? reason.message : String(reason) || 'Unknown reason'
  console.error('[Main Process] Unhandled Rejection:', reasonMessage)
  fileLogger.writeLog('error', 'main', `Unhandled Rejection: ${reasonMessage}`, [reason])
  // Don't exit - log and continue
})

// Cleanup on app quit
app.on('before-quit', () => {
  if (chatWebSocket) {
    chatWebSocket.destroy()
    chatWebSocket = null
  }
  if (liveWebSocket) {
    liveWebSocket.destroy()
    liveWebSocket = null
  }
  fileLogger.close()
})

app.whenReady().then(() => {
  // Clear expired cache entries on startup
  mentionCache.clearExpired()
  createApplicationMenu()
  createWindow()
})
