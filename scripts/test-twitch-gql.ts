#!/usr/bin/env npx tsx
/**
 * Test Twitch GQL UseViewCount API for viewer count.
 * Uses the same endpoint Twitch's web client uses.
 *
 * Run: npm run test:twitch-gql
 *
 * POST https://gql.twitch.tv/gql
 * Body: UseViewCount operation with channelLogin
 * Returns: stream.viewersCount
 */

const GQL_URL = 'https://gql.twitch.tv/gql'
const CHANNEL = 'puppies_24h'

/** Known public Twitch web client ID (used by embed, etc.) */
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

const GQL_BODY = [
  {
    operationName: 'UseViewCount',
    variables: {
      channelLogin: CHANNEL,
    },
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: 'e28de6b91c2ac736882f4960e7de60ca4a4eeebc06affdc45d6408b19318cef7',
      },
    },
  },
]

async function fetchWithMinimalHeaders() {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Client-Id': TWITCH_CLIENT_ID,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      Accept: '*/*',
      'Accept-Language': 'en-US',
      Referer: 'https://www.twitch.tv/',
      Origin: 'https://www.twitch.tv',
    },
    body: JSON.stringify(GQL_BODY),
  })
  return res
}

async function fetchWithFullHeaders() {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'Client-Id': TWITCH_CLIENT_ID,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
      Accept: '*/*',
      'Accept-Language': 'en-US',
      Referer: 'https://www.twitch.tv/',
      Origin: 'https://www.twitch.tv',
      'X-Device-Id': '4ed6789e40fa4f14a357d7b5426a9a55',
      'Client-Version': '45c5aca4-b983-4dd6-a5c1-585af49e1c26',
      'Client-Session-Id': 'b6f0f82d183c4e7b',
      DNT: '1',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    },
    body: JSON.stringify(GQL_BODY),
  })
  return res
}

async function main() {
  console.log(`Testing Twitch GQL UseViewCount for channel: ${CHANNEL}\n`)

  console.log('1. Minimal headers (Client-Id, User-Agent, Content-Type, Referer, Origin)...')
  try {
    const res = await fetchWithMinimalHeaders()
    const text = await res.text()
    console.log(`   Status: ${res.status} ${res.statusText}`)
    if (res.ok) {
      const data = JSON.parse(text) as Array<{ data?: { user?: { stream?: { viewersCount?: number } } }; errors?: unknown[] }>
      const first = data?.[0]
      const viewers = first?.data?.user?.stream?.viewersCount
      const errors = first?.errors
      if (errors?.length) {
        console.log(`   Errors:`, JSON.stringify(errors, null, 2))
      }
      if (typeof viewers === 'number') {
        console.log(`   viewersCount: ${viewers}`)
        console.log(`   PASS\n`)
      } else {
        console.log(`   Response: ${text.slice(0, 500)}...`)
        console.log(`   (no viewersCount in expected path)\n`)
      }
    } else {
      console.log(`   Body: ${text.slice(0, 300)}`)
    }
  } catch (e) {
    console.log(`   ERROR: ${e instanceof Error ? e.message : String(e)}\n`)
  }

  console.log('2. Full headers (with X-Device-Id, Client-Version, etc.)...')
  try {
    const res = await fetchWithFullHeaders()
    const text = await res.text()
    console.log(`   Status: ${res.status} ${res.statusText}`)
    if (res.ok) {
      const data = JSON.parse(text) as Array<{ data?: { user?: { stream?: { viewersCount?: number } } }; errors?: unknown[] }>
      const first = data?.[0]
      const viewers = first?.data?.user?.stream?.viewersCount
      const errors = first?.errors
      if (errors?.length) {
        console.log(`   Errors:`, JSON.stringify(errors, null, 2))
      }
      if (typeof viewers === 'number') {
        console.log(`   viewersCount: ${viewers}`)
        console.log(`   PASS\n`)
      } else {
        console.log(`   Response: ${text.slice(0, 500)}...`)
      }
    } else {
      console.log(`   Body: ${text.slice(0, 300)}`)
    }
  } catch (e) {
    console.log(`   ERROR: ${e instanceof Error ? e.message : String(e)}\n`)
  }
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
