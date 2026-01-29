/**
 * Resolve a YouTube channel to the current live stream or latest video (no API key).
 * 1) Scrape channel page for {"text":" watching"} to get live/premiere video ID.
 * 2) Else use channel RSS feed for latest published video.
 */

const WATCHING_MARKER = '{"text":" watching"}'
const WATCH_URL_PREFIX = '{"url":"/watch?v='

function extractChannelIdFromUrl(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  // Already a channel ID (UC... 24 chars)
  if (/^UC[\w-]{22}$/i.test(s)) return s
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    const host = (u.hostname || '').toLowerCase()
    if (host !== 'www.youtube.com' && host !== 'youtube.com') return null
    const path = (u.pathname || '').replace(/^\/+/, '')
    const m = path.match(/^channel\/([\w-]+)/i)
    if (m) return m[1]
  } catch {
    // ignore
  }
  return null
}

/** Whether the input is an @handle URL (needs fetch to resolve to channel ID). */
function isHandleUrl(input: string): boolean {
  const s = input.trim()
  if (!s) return false
  if (/^UC[\w-]{22}$/i.test(s)) return false
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    const host = (u.hostname || '').toLowerCase()
    if (host !== 'www.youtube.com' && host !== 'youtube.com') return false
    const path = (u.pathname || '').replace(/^\/+/, '')
    return path.startsWith('@') && path.length > 1
  } catch {
    return false
  }
}

function buildHandleUrl(input: string): string {
  const s = input.trim()
  return s.startsWith('http') ? s : `https://www.youtube.com/${s.startsWith('@') ? s : `@${s}`}`
}

/** Scrape channel ID from @handle page HTML (ytInitialData / meta / canonical). */
function scrapeChannelIdFromHandlePage(html: string): string | null {
  const m = html.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/)
  if (m) return m[1]
  const m2 = html.match(/"(?:externalId|browseId)"\s*:\s*"(UC[\w-]{22})"/)
  if (m2) return m2[1]
  const m3 = html.match(/youtube\.com\/channel\/(UC[\w-]{22})/)
  if (m3) return m3[1]
  return null
}

async function resolveChannelId(input: string): Promise<string | null> {
  const fromUrl = extractChannelIdFromUrl(input)
  if (fromUrl) return fromUrl
  if (!isHandleUrl(input)) return null
  const url = buildHandleUrl(input)
  const html = await fetchText(url)
  return scrapeChannelIdFromHandlePage(html)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function extractVideoIdFromWatching(html: string): string | null {
  const idx = html.indexOf(WATCHING_MARKER)
  if (idx === -1) return null
  const slice = html.slice(idx)
  const prefixIdx = slice.indexOf(WATCH_URL_PREFIX)
  if (prefixIdx === -1) return null
  const start = prefixIdx + WATCH_URL_PREFIX.length
  const id = slice.slice(start, start + 11)
  if (/^[\w-]{11}$/.test(id)) return id
  return null
}

async function getLatestFromRss(channelId: string): Promise<string | null> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}&orderby=published`
  const xml = await fetchText(url)
  // <link href="https://www.youtube.com/watch?v=VIDEO_ID"/>
  const m = xml.match(/<link\s+href="https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{11})"/)
  return m ? m[1] : null
}

export interface YouTubeLiveOrLatestResult {
  isLive: boolean
  iframeUrl: string
  videoId: string
}

export interface YouTubeLiveOrLatestError {
  error: string
}

export async function getYouTubeLiveOrLatest(
  channelIdOrUrl: string
): Promise<YouTubeLiveOrLatestResult | YouTubeLiveOrLatestError> {
  const channelId = await resolveChannelId(channelIdOrUrl)
  if (!channelId) {
    return {
      error:
        'Invalid channel. Use channel ID (UC...), youtube.com/channel/UC..., or youtube.com/@Handle (e.g. @AgendaFreeTV).',
    }
  }

  try {
    const channelUrl = `https://www.youtube.com/channel/${channelId}`
    const html = await fetchText(channelUrl)
    const videoId = extractVideoIdFromWatching(html)
    if (videoId) {
      return {
        isLive: true,
        iframeUrl: `https://www.youtube.com/embed/${videoId}`,
        videoId,
      }
    }
    const latestId = await getLatestFromRss(channelId)
    if (latestId) {
      return {
        isLive: false,
        iframeUrl: `https://www.youtube.com/embed/${latestId}`,
        videoId: latestId,
      }
    }
    return { error: 'No live stream or videos found for this channel' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg }
  }
}
