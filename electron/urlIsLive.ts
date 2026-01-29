/**
 * Check if a given embed URL points to a currently live stream (YouTube video, Kick channel, Twitch channel).
 * Used so "+ Link" only accepts live content (Kick/Twitch). YouTube uses the same isVideoLive as the resolver.
 */

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

/** Check if a Kick channel slug is currently live (channel API returns livestream). */
async function isKickChannelLive(slug: string): Promise<boolean> {
  const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Origin: 'https://kick.com',
      Referer: `https://kick.com/${encodeURIComponent(slug)}`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  })
  if (!res.ok) return false
  const data = (await res.json()) as any
  const livestream = data?.livestream ?? data?.data?.livestream
  return Boolean(livestream && (livestream.id ?? livestream.slug ?? livestream.channel_id))
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
