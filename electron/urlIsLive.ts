/**
 * Check if a given embed URL points to a currently live stream (YouTube video, Kick channel, Twitch channel).
 * Used so "+ Link" only accepts live content (Kick/Twitch). YouTube uses the same isVideoLive as the resolver.
 * Kick: uses app session (persist:main) so cookies (e.g. Cloudflare) are sent; supports both
 * kick.com/api/v2 response shapes (livestream vs stream.is_live).
 */

import fs from 'fs'
import path from 'path'
import { session, net } from 'electron'
import { fileLogger } from './fileLogger'
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
    cache: 'no-store',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
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

/**
 * Check if a Kick channel slug is currently live.
 * Uses app session so Kick/Cloudflare cookies are sent (same as Kick chat).
 * Supports both response shapes: livestream (v2 legacy) and stream.is_live (official-style).
 */
async function isKickChannelLive(slug: string): Promise<boolean> {
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
    return false
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
    return false
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
  if (hasLivestream) return true
  if (hasStreamLive) return true
  return false
}

/** Write Twitch page HTML to logs dir for debugging when live check returns false. Returns the file path. */
function writeTwitchDebugHtml(login: string, html: string): string | null {
  try {
    const logsDir = fileLogger.getLogsDirectoryPath()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `twitch-debug-${timestamp}-${login}.html`
    const filePath = path.join(logsDir, filename)
    fs.writeFileSync(filePath, html, 'utf8')
    return filePath
  } catch {
    return null
  }
}

/** Extract and parse JSON-LD from Twitch page. Returns { live, parsed } or { live, parseError }. */
function parseTwitchJsonLd(html: string): { live: boolean; parsed?: object; parseError?: string } {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  const raw = match?.[1]?.trim()
  if (!raw) {
    return { live: false, parseError: 'No application/ld+json script found' }
  }
  try {
    const data = JSON.parse(raw) as { '@graph'?: Array<{ '@type'?: string; publication?: { isLiveBroadcast?: boolean } }>; '@type'?: string; publication?: { isLiveBroadcast?: boolean } }
    const graph = data?.['@graph']
    const items = Array.isArray(graph) ? graph : [data]
    for (const item of items) {
      if (item?.['@type'] === 'VideoObject' && item?.publication?.isLiveBroadcast === true) {
        return { live: true, parsed: item }
      }
    }
    return { live: false, parsed: data }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { live: false, parseError: msg }
  }
}

/** Check if a Twitch channel (login) is currently live. Parses JSON-LD from page; falls back to regex if parse fails. */
async function isTwitchChannelLive(login: string): Promise<boolean> {
  const url = `https://www.twitch.tv/${encodeURIComponent(login)}?_=${Date.now()}`
  const html = await fetchText(url)
  const jsonResult = parseTwitchJsonLd(html)

  if (jsonResult.parseError) {
    fileLogger.writeLog('error', 'main', '[url-is-live] Twitch JSON-LD parse failed', [
      { login, url, parseError: jsonResult.parseError },
    ])
  }

  if (fileLogger.getLogLevel() === 'debug') {
    fileLogger.writeLog('debug', 'main', '[url-is-live] Twitch check', [
      {
        login,
        url,
        htmlLength: html.length,
        live: jsonResult.live,
        parsed: jsonResult.parsed,
        parseError: jsonResult.parseError,
      },
    ])
    if (!jsonResult.live && jsonResult.parseError) {
      const debugPath = writeTwitchDebugHtml(login, html)
      fileLogger.writeLog('debug', 'main', '[url-is-live] Twitch HTML saved (parse failed)', [
        debugPath ? { path: debugPath } : 'failed to write',
      ])
    }
  }

  if (jsonResult.live) return true
  if (jsonResult.parseError) {
    // Fallback to regex when parse fails
    if (/"isLiveBroadcast"\s*:\s*true\b/.test(html)) return true
    if (/"isLive"\s*:\s*true\b/.test(html)) return true
    if (/"type"\s*:\s*"live"\b/.test(html) && html.includes(login)) return true
  }
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
