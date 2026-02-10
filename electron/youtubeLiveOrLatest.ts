/**
 * Resolve a YouTube channel to the current live stream or latest video (no API key).
 * 1) Scrape channel page for {"text":" watching"} to get live/premiere video ID.
 * 2) Else use channel RSS feed for latest published video.
 */

import fs from 'fs'
import path from 'path'
import { fileLogger } from './fileLogger'

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
 * Whether the input is a YouTube channel page URL we can resolve by fetching (e.g. /channel-slug, /c/foo, /user/foo).
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

/** Build full URL for a YouTube channel page (custom /slug, /c/foo, /user/foo, or bare slug). */
function buildChannelPageUrl(input: string): string {
  const s = input.trim()
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  const path = s.startsWith('/') ? s.slice(1) : s
  return `https://www.youtube.com/${path}`
}

/** Bare slug (e.g. channel name) that we can turn into youtube.com/slug. */
function isBareChannelSlug(input: string): boolean {
  const s = input.trim()
  if (!s || s.length > 80) return false
  if (/^UC[\w-]{22}$/i.test(s)) return false
  if (s.includes('/') || s.includes('@') || s.startsWith('http')) return false
  return /^[\w-]+$/i.test(s)
}

/** Write channel page HTML to logs dir for debugging when resolution fails. Returns the file path. */
function writeDebugHtml(fetchedUrl: string, html: string): string | null {
  try {
    const logsDir = fileLogger.getLogsDirectoryPath()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const slug = fetchedUrl.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9@_-]/g, '_').slice(0, 60)
    const filename = `youtube-debug-${timestamp}-${slug}.html`
    const filePath = path.join(logsDir, filename)
    fs.writeFileSync(filePath, html, 'utf8')
    return filePath
  } catch {
    return null
  }
}

/**
 * Extract channel ID from the channel page HTML.
 * Prefer the RSS link in the source (feeds/videos.xml?channel_id=UC...) — that's the channel's own RSS.
 */
function scrapeChannelIdFromPage(html: string): string | null {
  // First: RSS feed URL in page source (what you get when you "extract the rss from the source")
  const rssMatch = html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/)
  if (rssMatch) return rssMatch[1]
  const channelIdParam = html.match(/channel_id=(UC[\w-]{22})/)
  if (channelIdParam) return channelIdParam[1]
  // Fallbacks: ytInitialData / canonical / etc.
  const m = html.match(/"channelId"\s*:\s*"(UC[\w-]{22})"/)
  if (m) return m[1]
  const m2 = html.match(/"(?:externalId|browseId)"\s*:\s*"(UC[\w-]{22})"/)
  if (m2) return m2[1]
  const m3 = html.match(/youtube\.com\/channel\/(UC[\w-]{22})/)
  if (m3) return m3[1]
  return null
}

/** Result of channel resolution: success with ID, or failure with a reason you can inspect. */
type ResolveResult = { channelId: string } | { error: string; detail?: string }

async function resolveChannelId(input: string): Promise<ResolveResult> {
  const fromUrl = extractChannelIdFromUrl(input)
  if (fromUrl) return { channelId: fromUrl }
  if (isHandleUrl(input)) {
    const url = buildHandleUrl(input)
    try {
      const { text: html } = await fetchTextWithUrl(url)
      const channelId = scrapeChannelIdFromPage(html)
      if (channelId) return { channelId }
      const debugPath = writeDebugHtml(url, html)
      return {
        error: 'Could not find channel ID in page source (no feeds/videos.xml?channel_id=... in HTML).',
        detail: debugPath ? `Fetched: ${url}. HTML saved to: ${debugPath}` : `Fetched: ${url}`,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { error: `Fetch failed: ${msg}`, detail: `URL: ${url}` }
    }
  }
  if (isYouTubeChannelPageUrl(input)) {
    const url = buildChannelPageUrl(input)
    const pathSegment = (() => {
      try {
        const u = new URL(url)
        return (u.pathname || '').replace(/^\/+/, '').split('/')[0] ?? ''
      } catch {
        return ''
      }
    })()
    if (pathSegment && !pathSegment.startsWith('@')) {
      const handleUrl = buildHandleUrl(pathSegment)
      try {
        const { text: html } = await fetchTextWithUrl(handleUrl)
        const channelId = scrapeChannelIdFromPage(html)
        if (channelId) return { channelId }
        const debugPath = writeDebugHtml(handleUrl, html)
        return {
          error: 'Could not find channel ID in page source (no feeds/videos.xml?channel_id=... in HTML).',
          detail: debugPath ? `Fetched: ${handleUrl}. HTML saved to: ${debugPath}` : `Fetched: ${handleUrl}`,
        }
      } catch {
        // fall through to custom URL
      }
    }
    const { text: html, url: finalUrl } = await fetchTextWithUrl(url)
    const fromRedirect = extractChannelIdFromChannelUrl(finalUrl)
    if (fromRedirect) return { channelId: fromRedirect }
    const scraped = scrapeChannelIdFromPage(html)
    if (scraped) return { channelId: scraped }
    const debugPath = writeDebugHtml(url, html)
    return {
      error: 'Could not find channel ID on page.',
      detail: debugPath ? `Final URL: ${finalUrl}. HTML saved to: ${debugPath}` : `Final URL: ${finalUrl}`,
    }
  }
  if (isBareChannelSlug(input)) {
    const handleUrl = buildHandleUrl(input)
    try {
      const { text: html } = await fetchTextWithUrl(handleUrl)
      const channelId = scrapeChannelIdFromPage(html)
      if (channelId) return { channelId }
      const debugPath = writeDebugHtml(handleUrl, html)
      return {
        error: 'Could not find channel ID in page source (no feeds/videos.xml?channel_id=... in HTML).',
        detail: debugPath ? `Fetched: ${handleUrl}. HTML saved to: ${debugPath}` : `Fetched: ${handleUrl}`,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { error: `Fetch failed: ${msg}`, detail: `URL: ${handleUrl}` }
    }
  }
  return { error: 'Unrecognized input format.' }
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

/** Check if a video's watch page indicates it is live (isLive in embedded JSON). Exported for url-is-live. */
export async function isVideoLive(videoId: string): Promise<boolean> {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  const html = await fetchText(url)
  if (/\b"isLive"\s*:\s*true\b/.test(html)) return true
  if (/\b"isLive"\s*:\s*true/.test(html)) return true
  if (/\b"isLiveContent"\s*:\s*true\b/.test(html)) return true
  if (/\b"status"\s*:\s*"LIVE"\b/.test(html)) return true
  if (/\b"status"\s*:\s*"LIVE"/.test(html)) return true
  if (/\b"liveBroadcastDetails"\b/.test(html) && /"isLive"\s*:\s*true/.test(html)) return true
  if (/"liveBroadcastDetails"\s*:\s*\{[^}]*"isLive"\s*:\s*true/.test(html)) return true
  if (/liveBroadcastDetails[\s\S]{0,200}isLive[\s\S]{0,50}true/.test(html)) return true
  return false
}

/** Parse video IDs from RSS/Atom XML (shared by channel and playlist feeds). */
function parseVideoIdsFromRssXml(xml: string, maxCount: number): string[] {
  const ids: string[] = []
  const ytRegex = /<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g
  let m: RegExpExecArray | null
  while ((m = ytRegex.exec(xml)) !== null && ids.length < maxCount) {
    if (!ids.includes(m[1])) ids.push(m[1])
  }
  if (ids.length > 0) return ids
  const idMatch = xml.match(/<id>\s*yt:video:([a-zA-Z0-9_-]{11})\s*<\/id>/)
  if (idMatch) return [idMatch[1]]
  const linkMatch = xml.match(/watch\?v=([a-zA-Z0-9_-]{11})/)
  return linkMatch ? [linkMatch[1]] : []
}

/** Parse channel ID from YouTube RSS/Atom feed XML (feed or first entry). */
function parseChannelIdFromRssXml(xml: string): string | null {
  const m = xml.match(/<yt:channelId>(UC[\w-]{22})<\/yt:channelId>/)
  return m ? m[1] : null
}

async function fetchRssXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      ...FETCH_HEADERS,
      Accept: 'application/atom+xml, application/xml, text/xml, */*',
      Referer: 'https://www.youtube.com/',
    },
  })
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`)
  return res.text()
}

/**
 * Build the Live streams RSS URL from a channel ID (no HTML scraping).
 * YouTube convention: channel UC + 22 chars → live playlist UULV + same 22 chars.
 * So channel_id=UC554eY5jNUfDq3yDOJYirOQ → playlist_id=UULV554eY5jNUfDq3yDOJYirOQ.
 * This matches the URL you get from the channel's "Live" tab / general RSS context.
 */
function buildLivePlaylistRssUrl(channelId: string): string {
  const suffix = channelId.startsWith('UC') && channelId.length === 24 ? channelId.slice(2) : channelId
  const playlistId = `UULV${suffix}`
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`
}

export interface YouTubeLiveOrLatestResult {
  isLive: boolean
  iframeUrl: string
  videoId: string
}

export interface YouTubeLiveOrLatestError {
  error: string
}

/**
 * Normalize input so we never resolve the wrong channel.
 * - youtube.com/slug (custom URL) can point to a different channel than @handle (handle).
 * - Rewrite any single-segment path to @handle so we always get the handle's channel.
 * No shortcuts: we do not fall back to the custom URL.
 * Exported so main process can normalize at IPC boundary.
 */
export function normalizeYouTubeChannelInput(input: string): string {
  const s = (input || '').trim()
  if (!s) return s
  if (/^UC[\w-]{22}$/i.test(s)) return s
  try {
    const u = new URL(s.startsWith('http') ? s : `https://www.youtube.com/${s}`)
    const host = (u.hostname || '').toLowerCase()
    if (host !== 'www.youtube.com' && host !== 'youtube.com') return s
    const path = (u.pathname || '').replace(/^\/+/, '')
    const segment = path.split('/')[0] ?? ''
    if (!segment || segment.startsWith('@') || segment === 'channel' || segment === 'watch' || segment === 'embed' || segment === 'shorts' || segment === 'live') return s
    return `https://www.youtube.com/@${segment}`
  } catch {
    if (/^[\w-]+$/i.test(s) && !s.includes('@')) return `https://www.youtube.com/@${s}`
    return s
  }
}

/**
 * Exact flow (your manual steps, no shortcuts):
 * 1. Normalize input so /slug -> @slug (we never use custom URL for resolution).
 * 2. Resolve to channel ID by fetching the channel page and getting channel_id from the page.
 * 3. Build general RSS URL from that: feeds/videos.xml?channel_id=UC...
 * 4. Build live playlist URL from that: feeds/videos.xml?playlist_id=UULV... (extracted from above).
 * 5. Fetch that live playlist RSS; first entry = current live stream.
 */
export async function getYouTubeLiveOrLatest(
  channelIdOrUrl: string
): Promise<YouTubeLiveOrLatestResult | YouTubeLiveOrLatestError> {
  const normalized = normalizeYouTubeChannelInput(channelIdOrUrl)
  const resolved = await resolveChannelId(normalized)
  if ('error' in resolved) {
    const msg = resolved.detail
      ? `${resolved.error} (${resolved.detail})`
      : resolved.error
    return { error: msg }
  }
  const channelId = resolved.channelId

  try {
    // Step 2: Build Live RSS URL from channel ID (same as "extracted from above url": UULV + rest of channel ID)
    const liveRssUrl = buildLivePlaylistRssUrl(channelId)

    // Step 3: Fetch that Live RSS; if entries exist, first is the current live stream
    const xml = await fetchRssXml(liveRssUrl)
    const videoIds = parseVideoIdsFromRssXml(xml, 1)
    if (videoIds.length === 0) {
      return { error: 'Channel is not currently live' }
    }

    // Step 4: Only return this video if the feed is for the channel we requested.
    const feedChannelId = parseChannelIdFromRssXml(xml)
    if (feedChannelId != null && feedChannelId !== channelId) {
      return { error: 'Channel is not currently live' }
    }

    const videoId = videoIds[0]
    // Step 5: The Live feed can include the most recent past stream when the channel is offline.
    // Verify the video is actually live; if not, do not return it.
    const actuallyLive = await isVideoLive(videoId)
    if (!actuallyLive) {
      return { error: 'Channel is not currently live' }
    }

    return {
      isLive: true,
      iframeUrl: `https://www.youtube.com/embed/${videoId}`,
      videoId,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg }
  }
}
