/**
 * Check if a given embed URL points to a currently live stream (YouTube video, Kick channel, Twitch channel).
 * Used so "+ Link" only accepts live content (Kick/Twitch). YouTube uses the same isVideoLive as the resolver.
 * Kick: uses app session (persist:main) so cookies (e.g. Cloudflare) are sent; supports both
 * kick.com/api/v2 response shapes (livestream vs stream.is_live).
 */

import { session, net } from 'electron'
import { isVideoLive as isYouTubeVideoLive } from './youtubeLiveOrLatest'

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

/**
 * Check if a Kick channel slug is currently live.
 * Uses app session so Kick/Cloudflare cookies are sent (same as Kick chat).
 * Supports both response shapes: livestream (v2 legacy) and stream.is_live (official-style).
 */
async function isKickChannelLive(slug: string): Promise<boolean> {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`
  const { ok, bodyText } = await fetchWithSession(url, {
    accept: 'application/json',
    origin: 'https://kick.com',
    referer: `https://kick.com/${encodeURIComponent(slug)}`,
  })
  if (!ok) return false
  let data: any
  try {
    data = JSON.parse(bodyText || '{}')
  } catch {
    return false
  }
  // Legacy v2: livestream object with id/slug/channel_id
  const livestream = data?.livestream ?? data?.data?.livestream
  if (livestream && (livestream.id ?? livestream.slug ?? livestream.channel_id)) return true
  // Official API shape: stream with is_live
  const stream = data?.stream ?? data?.data?.stream
  if (stream && stream.is_live === true) return true
  return false
}

/** Check if a Twitch channel (login) is currently live. Scrapes channel page for isLive in embedded data. */
async function isTwitchChannelLive(login: string): Promise<boolean> {
  const url = `https://www.twitch.tv/${encodeURIComponent(login)}`
  const html = await fetchText(url)
  // Twitch injects __NEXT_DATA__ or similar with stream info; fallback: look for "isLive":true
  if (/\b"isLive"\s*:\s*true\b/.test(html)) return true
  if (/\b"type"\s*:\s*"live"\b/.test(html) && html.includes(login)) return true
  return false
}

export interface UrlIsLiveResult {
  live: boolean
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
      const live = await isYouTubeVideoLive(id)
      return { live }
    }
    if (platform === 'kick') {
      const live = await isKickChannelLive(id)
      return { live }
    }
    if (platform === 'twitch') {
      const live = await isTwitchChannelLive(id)
      return { live }
    }
    return { live: false, error: 'Unsupported platform' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { live: false, error: msg }
  }
}
