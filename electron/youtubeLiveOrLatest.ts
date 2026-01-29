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

/**
 * Whether the input is a YouTube channel page URL we can resolve by fetching (e.g. /destiny, /c/foo, /user/foo).
 * Excludes /watch (video) and paths that are already handled by extractChannelIdFromUrl or isHandleUrl.
 */
function isYouTubeChannelPageUrl(input: string): boolean {
  const s = input.trim()
  if (!s) return false
  if (/^UC[\w-]{22}$/i.test(s)) return false
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    const host = (u.hostname || '').toLowerCase()
    if (host !== 'www.youtube.com' && host !== 'youtube.com') return false
    const path = (u.pathname || '').replace(/^\/+/, '').split('/')[0] ?? ''
    if (!path) return false
    // /watch is video, not channel
    if (path === 'watch' || path === 'embed' || path === 'shorts' || path === 'live') return false
    // @handle is handled by isHandleUrl
    if (path.startsWith('@')) return false
    // channel/UC... is handled by extractChannelIdFromUrl
    if (path === 'channel') return false
    return true
  } catch {
    return false
  }
}

/** Build full URL for a YouTube channel page (custom /destiny, /c/foo, /user/foo, or bare "destiny"). */
function buildChannelPageUrl(input: string): string {
  const s = input.trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const path = s.startsWith('/') ? s.slice(1) : s
  return `https://www.youtube.com/${path}`
}

/** Bare slug (e.g. "destiny") that we can turn into youtube.com/destiny. */
function isBareChannelSlug(input: string): boolean {
  const s = input.trim()
  if (!s || s.length > 80) return false
  if (/^UC[\w-]{22}$/i.test(s)) return false
  if (s.includes('/') || s.includes('@') || s.startsWith('http')) return false
  return /^[\w-]+$/i.test(s)
}

/** Scrape channel ID from any YouTube channel page HTML (ytInitialData, meta, canonical, or RSS link). */
function scrapeChannelIdFromPage(html: string): string | null {
  const m = html.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/)
  if (m) return m[1]
  const m2 = html.match(/"(?:externalId|browseId)"\s*:\s*"(UC[\w-]{22})"/)
  if (m2) return m2[1]
  const m3 = html.match(/youtube\.com\/channel\/(UC[\w-]{22})/)
  if (m3) return m3[1]
  // RSS feed URL in page source: feeds/videos.xml?channel_id=UC...
  const m4 = html.match(/channel_id=(UC[\w-]{22})/)
  if (m4) return m4[1]
  const m5 = html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/)
  if (m5) return m5[1]
  return null
}

async function resolveChannelId(input: string): Promise<string | null> {
  const fromUrl = extractChannelIdFromUrl(input)
  if (fromUrl) return fromUrl
  if (isHandleUrl(input)) {
    const url = buildHandleUrl(input)
    const { text: html, url: finalUrl } = await fetchTextWithUrl(url)
    const fromRedirect = extractChannelIdFromChannelUrl(finalUrl)
    if (fromRedirect) return fromRedirect
    return scrapeChannelIdFromPage(html)
  }
  if (isYouTubeChannelPageUrl(input)) {
    const url = buildChannelPageUrl(input)
    const { text: html, url: finalUrl } = await fetchTextWithUrl(url)
    const fromRedirect = extractChannelIdFromChannelUrl(finalUrl)
    if (fromRedirect) return fromRedirect
    return scrapeChannelIdFromPage(html)
  }
  if (isBareChannelSlug(input)) {
    const url = buildChannelPageUrl(input)
    const { text: html, url: finalUrl } = await fetchTextWithUrl(url)
    const fromRedirect = extractChannelIdFromChannelUrl(finalUrl)
    if (fromRedirect) return fromRedirect
    return scrapeChannelIdFromPage(html)
  }
  return null
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: FETCH_HEADERS })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** Fetch and return body text plus final URL (after redirects). Use to resolve channel ID from redirect. */
async function fetchTextWithUrl(url: string): Promise<{ text: string; url: string }> {
  const res = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  return { text, url: res.url }
}

/** Extract channel ID from a YouTube URL (e.g. after redirect to youtube.com/channel/UC...). */
function extractChannelIdFromChannelUrl(finalUrl: string): string | null {
  try {
    const u = new URL(finalUrl)
    const host = (u.hostname || '').toLowerCase()
    if (host !== 'www.youtube.com' && host !== 'youtube.com') return null
    const m = (u.pathname || '').match(/^\/channel\/(UC[\w-]{22})/i)
    return m ? m[1] : null
  } catch {
    return null
  }
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

/** Check if a video's watch page indicates it is live (isLive in embedded JSON). */
async function isVideoLive(videoId: string): Promise<boolean> {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const html = await fetchText(url)
  if (/\b"isLive"\s*:\s*true\b/.test(html)) return true
  if (/\b"isLiveContent"\s*:\s*true\b/.test(html)) return true
  if (/\b"status"\s*:\s*"LIVE"\b/.test(html)) return true
  if (/\b"liveBroadcastDetails"\b/.test(html) && /"isLive"\s*:\s*true/.test(html)) return true
  if (/"liveBroadcastDetails"\s*:\s*\{[^}]*"isLive"\s*:\s*true/.test(html)) return true
  return false
}

async function getLatestFromRss(channelId: string): Promise<string | null> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  const res = await fetch(url, {
    headers: {
      ...FETCH_HEADERS,
      Accept: 'application/atom+xml, application/xml, text/xml, */*',
      Referer: 'https://www.youtube.com/',
    },
  })
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`)
  const xml = await res.text()
  // Primary: <yt:videoId>VIDEO_ID</yt:videoId> (first entry = latest)
  const ytMatch = xml.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/)
  if (ytMatch) return ytMatch[1]
  // <id>yt:video:VIDEO_ID</id>
  const idMatch = xml.match(/<id>\s*yt:video:([a-zA-Z0-9_-]{11})\s*<\/id>/)
  if (idMatch) return idMatch[1]
  // Any watch?v=VIDEO_ID (RSS or HTML error page)
  const linkMatch = xml.match(/watch\?v=([a-zA-Z0-9_-]{11})/)
  return linkMatch ? linkMatch[1] : null
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
        'Invalid channel. Use channel ID (UC...), youtube.com/channel/UC..., youtube.com/@Handle, or full channel URL (e.g. youtube.com/destiny).',
    }
  }

  try {
    const channelUrl = `https://www.youtube.com/channel/${channelId}`
    const html = await fetchText(channelUrl)
    let videoId = extractVideoIdFromWatching(html)
    if (videoId) {
      return {
        isLive: true,
        iframeUrl: `https://www.youtube.com/embed/${videoId}`,
        videoId,
      }
    }
    let latestId: string | null = null
    try {
      latestId = await getLatestFromRss(channelId)
    } catch {
      // RSS may be blocked (403) or fail; fall back to channel page scrape
    }
    if (!latestId) {
      const fromPage = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/)
      if (fromPage) latestId = fromPage[1]
    }
    if (latestId) {
      const live = await isVideoLive(latestId)
      return {
        isLive: live,
        iframeUrl: `https://www.youtube.com/embed/${latestId}`,
        videoId: latestId,
      }
    }
    return { error: `No live stream or videos found for this channel (resolved id: ${channelId})` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg }
  }
}
