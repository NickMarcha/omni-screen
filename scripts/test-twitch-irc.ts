#!/usr/bin/env npx tsx
/**
 * Test Twitch IRC WebSocket with anonymous (logged-out) connection.
 * Replicates the behavior observed in browser: PASS SCHMOOPIIE, NICK justinfanXXXX.
 *
 * Run: npm run test:twitch-irc
 *
 * Connects to wss://irc-ws.chat.twitch.tv/, JOINs #puppies_24h,
 * collects 353 (NAMES) and 366 (End of NAMES) messages, parses chatters.
 * With twitch.tv/membership we expect the full chatters list.
 */

import WebSocket from 'ws'

const IRC_URL = 'wss://irc-ws.chat.twitch.tv/'
const CHANNEL = 'puppies_24h'

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Strip IRC prefix (@ mod, + voice) from nick. */
function stripPrefix(nick: string): string {
  const s = String(nick || '').trim()
  if (s.startsWith('@') || s.startsWith('+')) return s.slice(1)
  return s
}

/** Parse 353: :server 353 nick = #channel :user1 user2 user3 */
function parse353(line: string): { channel: string; users: string[] } | null {
  const rest = line.startsWith(':') ? line.slice(line.indexOf(' ') + 1) : line
  const parts = rest.split(' ')
  if (parts.length < 5 || parts[0] !== '353') return null
  const eqIdx = parts.indexOf('=')
  if (eqIdx < 0 || eqIdx + 1 >= parts.length) return null
  const channel = parts[eqIdx + 1].replace(/^#/, '').toLowerCase()
  const usersStart = line.indexOf(' :')
  const usersStr = usersStart >= 0 ? line.slice(usersStart + 2) : ''
  const users = usersStr.split(/\s+/).map(stripPrefix).filter(Boolean)
  return { channel, users }
}

/** Parse 366: End of /NAMES list */
function parse366(line: string): string | null {
  const rest = line.startsWith(':') ? line.slice(line.indexOf(' ') + 1) : line
  const parts = rest.split(' ')
  if (parts.length < 4 || parts[0] !== '366') return null
  const channel = parts[2]?.replace(/^#/, '').toLowerCase()
  return channel || null
}

async function main() {
  console.log(`Testing Twitch IRC anonymous connection for #${CHANNEL}\n`)

  const nick = `justinfan${randInt(10000, 999999)}`
  const allNames = new Set<string>()
  let received353 = false
  let received366 = false

  const ws = new WebSocket(IRC_URL, {
    headers: {
      Origin: 'https://www.twitch.tv',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    },
    handshakeTimeout: 10000,
  })

  const send = (line: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(`${line}\r\n`)
  }

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('Connected. Sending CAP REQ, PASS, NICK, USER...')
      send('CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership')
      send('PASS SCHMOOPIIE')
      send(`NICK ${nick}`)
      send(`USER ${nick} 8 * :${nick}`)
      resolve()
    })
    ws.on('error', reject)
  })

  // Wait for server welcome (001) before JOIN - Twitch expects this order
  await new Promise<void>((resolve) => {
    const onMsg = (data: WebSocket.Data) => {
      const raw = data.toString()
      if (/\s001\s/.test(raw) || /\s376\s/.test(raw)) {
        ws.off('message', onMsg)
        console.log('Server ready. Sending JOIN...')
        send(`JOIN #${CHANNEL}`)
        resolve()
      }
    }
    ws.on('message', onMsg)
    setTimeout(() => resolve(), 5000) // fallback in case 001 never comes
  })

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close()
      resolve()
    }, 15000)

    ws.on('message', (data: WebSocket.Data) => {
      const raw = data.toString()
      for (const line of raw.split('\r\n').filter(Boolean)) {
        if (line.startsWith('PING ')) {
          const payload = line.slice(5)
          send(`PONG ${payload}`)
          continue
        }

        const p353 = parse353(line)
        if (p353 && p353.channel === CHANNEL) {
          received353 = true
          p353.users.forEach((u) => allNames.add(u))
          console.log(`  353: received ${p353.users.length} nicks (total so far: ${allNames.size})`)
        }

        const ch366 = parse366(line)
        if (ch366 && ch366 === CHANNEL) {
          received366 = true
          console.log(`  366: End of NAMES for #${CHANNEL}`)
          clearTimeout(timeout)
          ws.close()
          resolve()
        }
      }
    })

    ws.on('close', () => {
      clearTimeout(timeout)
      resolve()
    })
    ws.on('error', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

  console.log(`\nResult:`)
  console.log(`  Received 353: ${received353}`)
  console.log(`  Received 366: ${received366}`)
  console.log(`  Total unique nicks: ${allNames.size}`)
  if (allNames.size > 0) {
    const sample = Array.from(allNames).slice(0, 10)
    console.log(`  Sample nicks: ${sample.join(', ')}${allNames.size > 10 ? '...' : ''}`)
  }

  const ok = received353 && received366
  if (ok) {
    console.log('\nPASS: Anonymous IRC connection and names parsing works.')
  } else {
    console.log('\nFAIL: Did not receive expected 353 and 366 messages.')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
