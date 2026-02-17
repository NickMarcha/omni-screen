#!/usr/bin/env npx tsx
/**
 * Test viewer count extraction for Kick, Twitch, and YouTube.
 * Uses reliable 24/7 streams for consistent testing.
 *
 * Run: npm run test:viewer-counts
 *
 * Test URLs (24/7 streams):
 * - Twitch: https://twitch.tv/puppies_24h
 * - YouTube: https://www.youtube.com/watch?v=jfKfPfyJRdk
 * - Kick: https://kick.com/saitochou
 *
 * When Twitch is tested, writes debug files to logs/twitch-debug/:
 * - twitch-{timestamp}.html — full HTML response
 * - twitch-{timestamp}-meta.txt — request URL, status, request/response headers
 */

import fs from 'fs'
import path from 'path'

const TEST_URLS = {
  twitch: 'https://twitch.tv/puppies_24h',
  youtube: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
  kick: 'https://kick.com/saitochou',
}

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
}

const TWITCH_GQL_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const TWITCH_USE_VIEW_COUNT_HASH = 'e28de6b91c2ac736882f4960e7de60ca4a4eeebc06affdc45d6408b19318cef7'

async function testTwitchGql(login: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Client-Id': TWITCH_GQL_CLIENT_ID,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      Accept: '*/*',
      'Accept-Language': 'en-US',
      Referer: 'https://www.twitch.tv/',
      Origin: 'https://www.twitch.tv',
    },
    body: JSON.stringify([
      {
        operationName: 'UseViewCount',
        variables: { channelLogin: login },
        extensions: { persistedQuery: { version: 1, sha256Hash: TWITCH_USE_VIEW_COUNT_HASH } },
      },
    ]),
  })
  if (res.status === 429) return { live: false, error: 'Rate limited' }
  if (!res.ok) return { live: false, error: `HTTP ${res.status}` }
  const data = (await res.json()) as Array<{ data?: { user?: { stream?: { viewersCount?: number } } } }>
  const stream = data?.[0]?.data?.user?.stream
  const live = stream != null
  const viewers = stream?.viewersCount
  return { live, viewers: typeof viewers === 'number' ? viewers : undefined }
}

async function testTwitchPageFetch(login: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  const fetchUrl = `https://www.twitch.tv/${encodeURIComponent(login)}`
  const res = await fetch(fetchUrl, { cache: 'no-store', headers: FETCH_HEADERS })
  if (res.status === 429) return { live: false, error: 'Rate limited' }
  if (res.status >= 500) return { live: false, error: `Server error ${res.status}` }

  const html = await res.text()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const debugDir = path.join(process.cwd(), 'logs', 'twitch-debug')
  fs.mkdirSync(debugDir, { recursive: true })
  fs.writeFileSync(path.join(debugDir, `twitch-page-${timestamp}.html`), html, 'utf8')
  const resHeaders: Record<string, string> = {}
  res.headers.forEach((v, k) => { resHeaders[k] = v })
  fs.writeFileSync(
    path.join(debugDir, `twitch-page-${timestamp}-meta.txt`),
    [
      `Request URL: ${fetchUrl} (no query param)`,
      `Status: ${res.status} ${res.statusText}`,
      '',
      '=== Request headers ===',
      ...Object.entries(FETCH_HEADERS).map(([k, v]) => `${k}: ${v}`),
      '',
      '=== Response headers ===',
      ...Object.entries(resHeaders).map(([k, v]) => `${k}: ${v}`),
      '',
      `Body length: ${html.length} chars`,
    ].join('\n'),
    'utf8'
  )

  const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (ldMatch) {
    try {
      const data = JSON.parse(ldMatch[1].trim()) as { '@graph'?: Array<Record<string, unknown>> }
      const items = Array.isArray(data?.['@graph']) ? data['@graph'] : [data]
      for (const item of items) {
        if (item?.['@type'] === 'VideoObject' && (item?.publication as { isLiveBroadcast?: boolean })?.isLiveBroadcast === true) {
          const stats = item?.interactionStatistic as Array<{ interactionType?: string; userInteractionCount?: number }> | undefined
          const stat = stats?.find((s) => s?.interactionType?.includes('View') || s?.interactionType === 'https://schema.org/WatchAction')
          const viewers = stat?.userInteractionCount
          return { live: true, viewers }
        }
      }
    } catch {
      /* fall through */
    }
  }

  const live =
    /"isLiveBroadcast"\s*:\s*true/.test(html) ||
    /"isLive"\s*:\s*true/.test(html) ||
    /"type"\s*:\s*"live"/.test(html) ||
    /"broadcastViewerCount"\s*:\s*\d+/.test(html)
  if (live) {
    const viewerMatch =
      html.match(/"broadcastViewerCount"\s*:\s*(\d+)/) ??
      html.match(/"viewerCount"\s*:\s*(\d+)/) ??
      html.match(/"viewers"\s*:\s*(\d+)/)
    const viewers = viewerMatch ? parseInt(viewerMatch[1], 10) : undefined
    return { live: true, viewers: Number.isFinite(viewers) ? viewers : undefined }
  }
  return { live: false }
}

async function testTwitch(url: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  const m = url.match(/twitch\.tv\/([^/?#]+)/i)
  const login = m?.[1]?.toLowerCase()
  if (!login) return { live: false, error: 'Invalid Twitch URL' }

  const gqlResult = await testTwitchGql(login)
  const pageResult = await testTwitchPageFetch(login)

  const gqlStr = gqlResult.error
    ? `GQL: error=${gqlResult.error}`
    : `GQL: live=${gqlResult.live}, viewers=${gqlResult.viewers ?? '—'}`
  const pageStr = pageResult.error
    ? `Page: error=${pageResult.error}`
    : `Page: live=${pageResult.live}, viewers=${pageResult.viewers ?? '—'}`
  console.log(`   ${gqlStr}`)
  console.log(`   ${pageStr}`)
  console.log(`   Debug: logs/twitch-debug/twitch-page-*.html`)

  const live = gqlResult.live || pageResult.live
  const viewers = gqlResult.viewers ?? pageResult.viewers
  return { live, viewers }
}

async function testYouTube(url: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  const m = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/) ?? url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  const videoId = m?.[1]
  if (!videoId) return { live: false, error: 'Invalid YouTube URL' }

  const fetchUrl = `https://www.youtube.com/watch?v=${videoId}&_=${Date.now()}`
  const res = await fetch(fetchUrl, { cache: 'no-store', headers: { ...FETCH_HEADERS, Referer: 'https://www.youtube.com/' } })
  if (!res.ok) return { live: false, error: `HTTP ${res.status}` }

  const html = await res.text()
  const live =
    /"isLive"\s*:\s*true/.test(html) ||
    /"liveBroadcastDetails"/.test(html) ||
    /"status"\s*:\s*"LIVE"/.test(html) ||
    /"isLiveContent"\s*:\s*true/.test(html)

  // Prefer concurrentViewers (live) over viewCount (total views)
  const viewersMatch =
    html.match(/"concurrentViewers"\s*:\s*"(\d+)"/) ??
    html.match(/"concurrentViewers"\s*:\s*(\d+)/) ??
    html.match(/"viewCount"\s*:\s*"(\d+)"/)
  const viewers = viewersMatch ? parseInt(viewersMatch[1], 10) : undefined

  return { live, viewers: Number.isFinite(viewers) ? viewers : undefined }
}

async function testKick(url: string): Promise<{ live: boolean; viewers?: number; error?: string }> {
  const m = url.match(/kick\.com\/([^/?#]+)/i)
  const slug = m?.[1]?.toLowerCase()
  if (!slug) return { live: false, error: 'Invalid Kick URL' }

  const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}?_=${Date.now()}`
  const res = await fetch(apiUrl, {
    cache: 'no-store',
    headers: {
      ...FETCH_HEADERS,
      Accept: 'application/json',
      Origin: 'https://kick.com',
      Referer: `https://kick.com/${slug}`,
    },
  })
  if (!res.ok) return { live: false, error: `HTTP ${res.status}` }

  const data = (await res.json()) as Record<string, unknown>
  const livestream = data?.livestream ?? (data?.data as Record<string, unknown>)?.livestream
  const stream = data?.stream ?? (data?.data as Record<string, unknown>)?.stream
  const hasLivestream = !!(livestream && ((livestream as Record<string, unknown>).id ?? (livestream as Record<string, unknown>).slug))
  const hasStreamLive = !!(stream && (stream as Record<string, unknown>).is_live === true)
  const live = hasLivestream || hasStreamLive

  const viewers =
    (data?.viewers_count as number) ??
    (data?.viewersCount as number) ??
    ((livestream as Record<string, unknown>)?.viewer_count as number) ??
    ((livestream as Record<string, unknown>)?.viewers_count as number) ??
    ((stream as Record<string, unknown>)?.viewer_count as number)
  const viewersNum = typeof viewers === 'number' && Number.isFinite(viewers) && viewers >= 0 ? viewers : undefined

  return { live, viewers: viewersNum }
}

async function main() {
  console.log('Testing viewer count extraction (24/7 streams)...\n')

  let allOk = true

  console.log('1. Twitch:', TEST_URLS.twitch)
  try {
    const r = await testTwitch(TEST_URLS.twitch)
    const ok = r.live
    if (!ok) allOk = false
    console.log(`   ${ok ? 'PASS' : 'FAIL'} (page method kept for debug, not used for pass)\n`)
  } catch (e) {
    allOk = false
    console.log(`   ERROR: ${e instanceof Error ? e.message : String(e)}\n`)
  }

  console.log('2. YouTube:', TEST_URLS.youtube)
  try {
    const r = await testYouTube(TEST_URLS.youtube)
    const ok = r.live
    if (!ok) allOk = false
    console.log(`   live=${r.live}, viewers=${r.viewers ?? '—'}${r.error ? `, error=${r.error}` : ''}`)
    console.log(`   ${ok ? 'PASS' : 'FAIL'}\n`)
  } catch (e) {
    allOk = false
    console.log(`   ERROR: ${e instanceof Error ? e.message : String(e)}\n`)
  }

  console.log('3. Kick:', TEST_URLS.kick)
  try {
    const r = await testKick(TEST_URLS.kick)
    const ok = r.live
    if (!ok) allOk = false
    console.log(`   live=${r.live}, viewers=${r.viewers ?? '—'}${r.error ? `, error=${r.error}` : ''}`)
    console.log(`   ${ok ? 'PASS' : 'FAIL'}\n`)
  } catch (e) {
    allOk = false
    console.log(`   ERROR: ${e instanceof Error ? e.message : String(e)}\n`)
  }

  console.log(allOk ? 'All tests passed.' : 'Some tests failed.')
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
