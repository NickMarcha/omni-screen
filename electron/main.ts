import { app, BrowserWindow, ipcMain, Menu, clipboard } from 'electron'
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

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
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
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    console.error('Error fetching mentions:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
})

ipcMain.handle('fetch-twitter-embed', async (_event, tweetUrl: string, theme: 'light' | 'dark' = 'dark') => {
  try {
    // Twitter's public oEmbed endpoint (no API key required)
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&theme=${theme}&dnt=true&omit_script=true`
    const response = await fetch(oembedUrl)
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      let errorMessage = `HTTP error! status: ${response.status}`
      
      // Provide more specific error messages
      if (response.status === 401 || response.status === 403) {
        errorMessage = 'Content may be age-restricted or require login. Try logging in to Twitter.'
      } else if (response.status === 404) {
        errorMessage = 'Tweet not found or may have been deleted.'
      } else if (response.status === 429) {
        errorMessage = 'Rate limit exceeded. Please try again later.'
      } else if (errorText.includes('suspended') || errorText.includes('unavailable')) {
        errorMessage = 'Tweet is unavailable or account is suspended.'
      }
      
      throw new Error(errorMessage)
    }
    const data = await response.json()
    return { success: true, data }
  } catch (error) {
    console.error('Error fetching Twitter embed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
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
      const response = await fetch(oembedUrl)
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
    
    // Create a new browser window for login
    const loginWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      title: `Login to ${service.charAt(0).toUpperCase() + service.slice(1)}`,
    })
    
    loginWindow.loadURL(url)
    
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
