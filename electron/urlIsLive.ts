/**
 * Check if a given embed URL points to a currently live stream (YouTube video, Kick channel, Twitch channel).
 * Used so "+ Link" only accepts live content (Kick/Twitch). YouTube uses the same isVideoLive as the resolver.
 * Kick: uses app session (persist:main) so cookies (e.g. Cloudflare) are sent; supports both
 * kick.com/api/v2 response shapes (livestream vs stream.is_live).
 */

import { session, net } from 'electron'
import { fileLogger } from './fileLogger'
import { isVideoLiveWithViewers } from './youtubeLiveOrLatest'

function isLikelyYouTubeId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,20}$/.test(id)
}

function parseEmbedUrl(url: string): { platform: string; id: string } | null {
  const s = String(url || '').trim()
  if (!s) return null
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    const host = (u.hostname || '').toLowerCase()
    if (host === 'www.youtube.com' || host === 'youtube.com') {
      const v = u.searchParams.get('v')
      if (v && isLikelyYouTubeId(v)) return { platform: 'youtube', id: v }
    }
    if (host === 'youtu.be') {
      const id = (u.pathname || '').replace(/^\/+/, '').split('/')[0]
      if (id && isLikelyYouTubeId(id)) return { platform: 'youtube', id }
    }
    if (host === 'www.kick.com' || host === 'kick.com') {
      const m = (u.pathname || '').match(/^\/([^/]+)/)
      if (m && m[1]) return { platform: 'kick', id: m[1].toLowerCase() }
    }
    if (host === 'www.twitch.tv' || host === 'twitch.tv') {
      const m = (u.pathname || '').match(/^\/([^/]+)/)
      if (m && m[1]) return { platform: 'twitch', id: m[1].toLowerCase() }
    }
  } catch {
    // ignore
  }
  return null
}

/** Fetch URL with app session (cookies) so Kick/Cloudflare accept the request. */
async function fetchWithSession(
  url: string,
  opts: { accept: string; origin: string; referer: string }
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const ses = session.fromPartition('persist:main')
  return new Promise((resolve) => {
    const req = net.request({
      method: 'GET',
      url,
      session: ses,
      redirect: 'follow',
      useSessionCookies: true,
      headers: {
        Accept: opts.accept,
        Origin: opts.origin,
        Referer: opts.referer,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      },
    })
    const chunks: Buffer[] = []
    req.on('response', (res) => {
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf-8')
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode ?? 0, bodyText })
      })
      res.on('error', () => resolve({ ok: false, status: 0, bodyText: '' }))
    })
    req.on('error', () => resolve({ ok: false, status: 0, bodyText: '' }))
    req.end()
  })
}

/** Extract viewer count from Kick API response (field names vary across versions). */
function readKickViewerCount(data: any): number | undefined {
  if (!data || typeof data !== 'object') return undefined
  const n =
    data.viewers_count ??
    data.viewersCount ??
    data.livestream?.viewer_count ??
    data.livestream?.viewers_count ??
    data.data?.livestream?.viewer_count ??
    data.data?.livestream?.viewers_count ??
    data.stream?.viewer_count ??
    data.stream?.viewers_count
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Check if a Kick channel slug is currently live.
 * Uses app session so Kick/Cloudflare cookies are sent (same as Kick chat).
 * Supports both response shapes: livestream (v2 legacy) and stream.is_live (official-style).
 * Returns { live, viewers?, error } - when error is set, caller should not update state.
 */
async function isKickChannelLive(slug: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}?_=${Date.now()}`
  const { ok, status, bodyText } = await fetchWithSession(url, {
    accept: 'application/json',
    origin: 'https://kick.com',
    referer: `https://kick.com/${encodeURIComponent(slug)}`,
  })
  if (!ok) {
    if (fileLogger.getLogLevel() === 'debug') {
      fileLogger.writeLog('debug', 'main', '[url-is-live] Kick check', [
        { slug, url, ok, status, bodyPreview: (bodyText || '').slice(0, 300) },
      ])
    }
    return { live: false, error: status === 429 ? 'Rate limited' : `HTTP ${status}` }
  }
  let data: any
  try {
    data = JSON.parse(bodyText || '{}')
  } catch {
    if (fileLogger.getLogLevel() === 'debug') {
      fileLogger.writeLog('debug', 'main', '[url-is-live] Kick check parse error', [
        { slug, bodyPreview: (bodyText || '').slice(0, 500) },
      ])
    }
    return { live: false, error: 'Parse error' }
  }
  const livestream = data?.livestream ?? data?.data?.livestream
  const stream = data?.stream ?? data?.data?.stream
  const hasLivestream = !!(livestream && (livestream.id ?? livestream.slug ?? livestream.channel_id))
  const hasStreamLive = !!(stream && stream.is_live === true)
  const live = hasLivestream || hasStreamLive
  if (fileLogger.getLogLevel() === 'debug') {
    fileLogger.writeLog('debug', 'main', '[url-is-live] Kick check', [
      { slug, url, hasLivestream, hasStreamLive, live, livestream: !!livestream, streamIsLive: stream?.is_live },
    ])
  }
  const viewers = readKickViewerCount(data)
  if (hasLivestream) return { live: true, viewers }
  if (hasStreamLive) return { live: true, viewers }
  return { live: false }
}

/** Twitch GQL UseViewCount - returns { live, viewers } without needing page HTML. */
const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const TWITCH_USE_VIEW_COUNT_HASH = 'e28de6b91c2ac736882f4960e7de60ca4a4eeebc06affdc45d6408b19318cef7'

async function fetchTwitchViewCountGql(login: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Client-Id': TWITCH_GQL_CLIENT_ID,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
        Accept: '*/*',
        'Accept-Language': 'en-US',
        Referer: 'https://www.twitch.tv/',
        Origin: 'https://www.twitch.tv',
      },
      body: JSON.stringify([
        {
          operationName: 'UseViewCount',
          variables: { channelLogin: login },
          extensions: {
            persistedQuery: { version: 1, sha256Hash: TWITCH_USE_VIEW_COUNT_HASH },
          },
        },
      ]),
    })
    if (res.status === 429) return { live: false, error: 'Rate limited' }
    if (!res.ok) return { live: false, error: `HTTP ${res.status}` }
    const data = (await res.json()) as Array<{
      data?: { user?: { stream?: { viewersCount?: number } } }
      errors?: Array<{ message?: string }>
    }>
    const first = data?.[0]
    const stream = first?.data?.user?.stream
    const live = stream != null
    const viewers = stream?.viewersCount
    return { live, viewers: typeof viewers === 'number' ? viewers : undefined }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { live: false, error: msg }
  }
}

/** Check if a Twitch channel (login) is currently live. Uses GQL UseViewCount only (page fetch removed - unreliable). */
async function isTwitchChannelLive(login: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  return fetchTwitchViewCountGql(login)
}

export interface UrlIsLiveResult {
  live: boolean
  /** Viewer count when available (Kick, Twitch, YouTube). */
  viewers?: number
  error?: string
}

export async function checkUrlIsLive(url: string): Promise<UrlIsLiveResult> {
  const parsed = parseEmbedUrl(url)
  if (!parsed) {
    return { live: false, error: 'Unsupported URL. Use YouTube, Kick, or Twitch link.' }
  }
  const { platform, id } = parsed
  try {
    if (platform === 'youtube') {
      return await isVideoLiveWithViewers(id)
    }
    if (platform === 'kick') {
      return await isKickChannelLive(id)
    }
    if (platform === 'twitch') {
      const result = await isTwitchChannelLive(id)
      return result
    }
    return { live: false, error: 'Unsupported platform' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { live: false, error: msg }
  }
}
