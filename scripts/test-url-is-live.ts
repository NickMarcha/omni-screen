#!/usr/bin/env npx tsx
/**
 * Simple test for Twitch url-is-live logic.
 * Run: npx tsx scripts/test-url-is-live.ts
 *
 * Tests:
 * - puppies_24h: 24/7 stream (expect live: true)
 * - gigachadredfish: 24/7 offline (expect live: false)
 */

const TWITCH_LIVE_CHANNEL = 'puppies_24h'
const TWITCH_OFFLINE_CHANNEL = 'gigachadredfish'

function parseTwitchJsonLd(html: string): { live: boolean; parsed?: object; parseError?: string } {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  const raw = match?.[1]?.trim()
  if (!raw) {
    return { live: false, parseError: 'No application/ld+json script found' }
  }
  try {
    const data = JSON.parse(raw) as {
      '@graph'?: Array<{ '@type'?: string; publication?: { isLiveBroadcast?: boolean } }>
      '@type'?: string
      publication?: { isLiveBroadcast?: boolean }
    }
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

async function checkTwitchLive(login: string): Promise<{ live: boolean; error?: string }> {
  const url = `https://www.twitch.tv/${encodeURIComponent(login)}?_=${Date.now()}`
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })

  if (res.status === 429) return { live: false, error: 'Rate limited' }
  if (res.status >= 500) return { live: false, error: `Server error ${res.status}` }

  const html = await res.text()
  const jsonResult = parseTwitchJsonLd(html)

  if (jsonResult.live) return { live: true }
  if (jsonResult.parseError) {
    if (/"isLiveBroadcast"\s*:\s*true\b/.test(html)) return { live: true }
    if (/"isLive"\s*:\s*true\b/.test(html)) return { live: true }
    if (/"type"\s*:\s*"live"\b/.test(html) && html.includes(login)) return { live: true }
    return { live: false, error: jsonResult.parseError }
  }
  return { live: false }
}

async function main() {
  console.log('Testing Twitch url-is-live logic...\n')

  console.log(`1. ${TWITCH_LIVE_CHANNEL} (24/7 stream, expect live: true)`)
  const liveResult = await checkTwitchLive(TWITCH_LIVE_CHANNEL)
  const liveOk = liveResult.live && !liveResult.error
  console.log(`   Result: live=${liveResult.live}${liveResult.error ? `, error=${liveResult.error}` : ''}`)
  console.log(`   ${liveOk ? 'PASS' : 'FAIL'}\n`)

  console.log(`2. ${TWITCH_OFFLINE_CHANNEL} (24/7 offline, expect live: false)`)
  const offlineResult = await checkTwitchLive(TWITCH_OFFLINE_CHANNEL)
  const offlineOk = !offlineResult.live
  console.log(`   Result: live=${offlineResult.live}${offlineResult.error ? `, error=${offlineResult.error}` : ''}`)
  console.log(`   ${offlineOk ? 'PASS' : 'FAIL'}\n`)

  const allOk = liveOk && offlineOk
  console.log(allOk ? 'All tests passed.' : 'Some tests failed.')
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
