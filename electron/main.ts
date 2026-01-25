import { app, BrowserWindow, ipcMain, Menu, clipboard, session, BrowserView, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { update } from './update'

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
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

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
  
  // Add other headers that Twitter might expect
  headers.set('Accept', 'application/json, text/javascript, */*; q=0.01')
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  headers.set('Referer', 'https://twitter.com/')
  headers.set('Origin', 'https://twitter.com')
  
  return fetch(url, {
    ...options,
    headers,
    // Important: include credentials
    credentials: 'include',
  })
}

function createWindow() {
  // Handle external links - open in default browser
  // This will be set on the window after it's created
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      // Use persistent session partition to save cookies between restarts
      partition: 'persist:main',
      // Disable web security to allow cross-origin requests with credentials
      // This is needed for Twitter oEmbed API which doesn't allow CORS with credentials
      webSecurity: false,
    },
  })

  // Configure webRequest handlers for YouTube and Reddit embeds
  const session = win.webContents.session
  
  // Set Referer header for YouTube embeds (required by YouTube API)
  // App ID from electron-builder.json: com.nickmarcha.omni-screen
  const appId = 'com.nickmarcha.omni-screen'
  const refererUrl = `https://${appId}`
  
  // Set Referer header for YouTube requests (required by YouTube API)
  session.webRequest.onBeforeSendHeaders(
    {
      urls: ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://*.youtube.com/*', 'https://youtu.be/*', 'https://*.ytimg.com/*', 'https://*.googlevideo.com/*']
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders }
      
      // Always set Referer for YouTube requests
      requestHeaders['Referer'] = refererUrl
      console.log(`[Main Process] Setting Referer for YouTube: ${refererUrl} -> ${details.url.substring(0, 80)}`)
      
      callback({ requestHeaders })
    }
  )
  
  // Modify CSP headers to allow Reddit embeds
  // Reddit's embed iframes need to be allowed even when loaded from file:// protocol
  session.webRequest.onHeadersReceived(
    {
      urls: ['https://embed.reddit.com/*', 'https://*.reddit.com/*']
    },
    (details, callback) => {
      const responseHeaders: Record<string, string | string[]> = { ...details.responseHeaders }
      
      // Remove existing CSP headers (case-insensitive)
      const cspKeys = Object.keys(responseHeaders).filter(key => 
        key.toLowerCase() === 'content-security-policy' || 
        key.toLowerCase() === 'content-security-policy-report-only'
      )
      
      cspKeys.forEach(key => {
        delete responseHeaders[key]
      })
      
      // Add new CSP that allows frames from any origin (including file://)
      responseHeaders['Content-Security-Policy'] = [
        "frame-ancestors * data: blob: file:; frame-src * data: blob: file:; script-src * 'unsafe-inline' 'unsafe-eval'; object-src *;"
      ]
      
      console.log(`[Main Process] Modified CSP for Reddit: ${details.url.substring(0, 80)}`)
      
      callback({ responseHeaders })
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
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
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

// IPC Handlers
ipcMain.handle('fetch-mentions', async (_event, username: string, size: number = 150, offset: number = 0) => {
  try {
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
      
      return { success: true, data: dataWithIds }
    }
    
    return { success: true, data }
  } catch (error) {
    console.error('[Main Process] Error fetching mentions:', error)
    console.error(`  - Username: ${username}`)
    console.error(`  - Size: ${size}, Offset: ${offset}`)
    if (error instanceof Error) {
      console.error(`  - Error message: ${error.message}`)
      console.error(`  - Error stack: ${error.stack}`)
    }
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
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
    })
    
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

app.whenReady().then(createWindow)
