import { app, BrowserWindow, ipcMain, Menu, clipboard, session, BrowserView } from 'electron'
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
        cookie.domain.includes('twitter.com') || 
        cookie.domain.includes('x.com') ||
        cookie.domain.includes('twimg.com')
      )
      
      // Sort by domain specificity (more specific first)
      twitterCookies.sort((a, b) => {
        const aSpecificity = a.domain.split('.').length
        const bSpecificity = b.domain.split('.').length
        return bSpecificity - aSpecificity
      })
      
      // Remove duplicates (prefer more specific domain cookies)
      const uniqueCookies = new Map<string, Electron.Cookie>()
      for (const cookie of twitterCookies) {
        const key = cookie.name
        if (!uniqueCookies.has(key) || 
            cookie.domain.split('.').length > uniqueCookies.get(key)!.domain.split('.').length) {
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
      } catch (err) {
        // Ignore errors for specific domains
      }
    }
    
    const uniqueCookies = new Map<string, Electron.Cookie>()
    for (const cookie of allCookies) {
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

  // Enable auto-update logic
  update(win)

  // Show context menu on right-click
  win.webContents.on('context-menu', (e, params) => {
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
    
    if (dataLength > 0 && Array.isArray(data)) {
      const firstDate = data[0]?.date ? new Date(data[0].date).toISOString() : 'N/A'
      const lastDate = data[dataLength - 1]?.date ? new Date(data[dataLength - 1].date).toISOString() : 'N/A'
      console.log(`  - Date range: ${firstDate} (first) to ${lastDate} (last)`)
      
      // Check the order - is first item newest or oldest?
      const dates = data.map((m: any) => m.date).filter((d: any) => d != null)
      if (dates.length > 1) {
        const firstIsNewer = dates[0] > dates[dates.length - 1]
        console.log(`  - Order: ${firstIsNewer ? 'NEWEST FIRST (descending)' : 'OLDEST FIRST (ascending)'}`)
      }
      
      // Log a few sample dates to verify
      const sampleDates = data.slice(0, 5).map((m: any, i: number) => 
        `${i}: ${m.date ? new Date(m.date).toISOString() : 'N/A'}`
      )
      console.log(`  - First 5 dates:`, sampleDates)
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
      cookie.domain.includes('twitter.com') || 
      cookie.domain.includes('x.com') ||
      cookie.domain.includes('twimg.com')
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
      
      browserView!.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
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
      browserView.webContents.destroy()
    }
  }
})

ipcMain.handle('fetch-tiktok-embed', async (_event, tiktokUrl: string) => {
  try {
    console.log('Fetching TikTok embed for URL:', tiktokUrl)
    
    // Extract video ID from TikTok URL
    // Format: https://www.tiktok.com/@username/video/VIDEO_ID
    const urlMatch = tiktokUrl.match(/\/video\/(\d+)/)
    if (!urlMatch || !urlMatch[1]) {
      console.error('Failed to extract video ID from URL:', tiktokUrl)
      throw new Error(`Invalid TikTok URL format: ${tiktokUrl}`)
    }
    const videoId = urlMatch[1]
    console.log('Extracted video ID:', videoId)
    
    // Extract username from URL
    const usernameMatch = tiktokUrl.match(/@([^/]+)/)
    const username = usernameMatch ? usernameMatch[1] : ''
    console.log('Extracted username:', username)
    
    // Construct the blockquote HTML similar to Twitter
    // TikTok's oEmbed might not work, so we construct the HTML manually
    const blockquoteHtml = `<blockquote class="tiktok-embed" cite="${tiktokUrl}" data-video-id="${videoId}" style="max-width: 605px;min-width: 325px;"><section><a target="_blank" title="@${username}" href="https://www.tiktok.com/@${username}?refer=embed">@${username}</a></section></blockquote>`
    
    console.log('Generated TikTok embed HTML')
    return { success: true, data: { html: blockquoteHtml } }
  } catch (error) {
    console.error('Error fetching TikTok embed:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: errorMessage }
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
          return { success: true, data: { html: data.html } }
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
    const postId = urlMatch[2]
    const titleSlug = urlMatch[3]
    
    // Decode title from slug (basic decoding)
    const title = decodeURIComponent(titleSlug.replace(/_/g, ' '))
    
    // Construct the blockquote HTML
    const now = new Date().toISOString()
    const blockquoteHtml = `<blockquote class="reddit-embed-bq" data-embed-theme="${theme}" style="height:500px" data-embed-created="${now}"><a href="${redditUrl}">${title}</a><br> by <a href="https://www.reddit.com/user/USER/">u/USER</a> in <a href="https://www.reddit.com/r/${subreddit}/">${subreddit}</a></blockquote>`
    
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
    
    loginWindow.loadURL(url)
    
    // When login window navigates, check for successful login
    loginWindow.webContents.on('did-navigate', async (event, navigationUrl) => {
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
    loginWindow.webContents.session.cookies.on('changed', (event, cookie, cause, removed) => {
      if (!removed && (cookie.domain.includes('twitter.com') || cookie.domain.includes('x.com'))) {
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

app.whenReady().then(createWindow)
