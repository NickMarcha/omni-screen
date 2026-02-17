#!/usr/bin/env node
/**
 * Analyzes raw WebSocket chat history logs to identify event/message types
 * and report which ones are not currently supported by the app.
 * Usage: node scripts/analyze-chat-history.mjs [path/to/chat-history.log]
 *        node scripts/analyze-chat-history.mjs   (defaults to logs/chat-history.log)
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Supported types from codebase (kickChatManager.ts, chatWebSocket.ts)
const KICK_SUPPORTED = new Set([
  'pusher:ping',
  'pusher:connection_established',
  'pusher_internal:subscription_succeeded',
  'App\\Events\\ChatMessageEvent',
  'pusher:error',
  'App\\Events\\MessageDeletedEvent',
  'App\\Events\\UserBannedEvent',
  'App\\Events\\UserUnbannedEvent',
])

const PRIMARY_CHAT_SUPPORTED = new Set([
  'MSG',
  'HISTORY',
  'ME',
  'JOIN',
  'QUIT',
  'UPDATEUSER',
  'PAIDEVENTS',
  'PIN',
  'NAMES',
  'MUTE',
  'UNMUTE',
  'POLLSTART',
  'VOTECAST',
  'POLLSTOP',
  'VOTECOUNTED',
  'ERR',
  'DEATH',
  'UNBAN',
  'SUBSCRIPTION',
  'BROADCAST',
  'BAN',
  'SUBONLY',
  'RELOAD',
  'PRIVMSGSENT',
  'ADDPHRASE',
  'REMOVEPHRASE',
  'GIFTSUB',
  'MASSGIFT',
  'DONATION',
  'PRIVMSG',
])

// Parse line: [timestamp] [source] content
function parseLine(line) {
  const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/s)
  if (!match) return null
  const [, timestamp, source, content] = match
  return { timestamp, source, content }
}

function extractKickEvent(content) {
  try {
    const json = JSON.parse(content)
    return typeof json?.event === 'string' ? json.event : '(no event)'
  } catch {
    return '(parse error)'
  }
}

function extractPrimaryChatType(content) {
  const token = content.trim().split(/\s+/, 1)[0]
  return token || '(empty)'
}

function extractPrimaryLiveType(content) {
  try {
    const json = JSON.parse(content)
    return typeof json?.type === 'string' ? json.type : '(no type)'
  } catch {
    return '(parse error)'
  }
}

function extractYoutubeType(content) {
  try {
    const json = JSON.parse(content)
    if (!json || typeof json !== 'object') return '(parse error)'
    if (json.continuationContents?.liveChatContinuation) return 'liveChatContinuation'
    if (json.responseContext) return 'responseContext'
    const keys = Object.keys(json).filter((k) => !k.startsWith('_'))
    return keys.length > 0 ? keys.join('+') : '(empty)'
  } catch {
    return '(parse error)'
  }
}

function extractTwitchType(content) {
  // IRC: [:prefix] COMMAND args... or COMMAND args...
  const trimmed = content.trim()
  const parts = trimmed.split(/\s+/)
  if (parts.length === 0) return '(empty)'
  const first = parts[0]
  if (first.startsWith(':')) {
    // :prefix COMMAND
    return parts.length >= 2 ? parts[1] : first
  }
  return first
}

function extractType(source, content) {
  switch (source) {
    case 'kick':
      return extractKickEvent(content)
    case 'primary-chat':
      return extractPrimaryChatType(content)
    case 'primary-live':
    case 'primary-live-out':
      return extractPrimaryLiveType(content)
    case 'youtube':
      return extractYoutubeType(content)
    case 'twitch':
      return extractTwitchType(content)
    default:
      return '(unknown source)'
  }
}

function analyzeChatHistory(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter((l) => l.trim())

  const bySource = new Map()
  const typeCounts = new Map() // source -> Map(type -> count)
  const firstTimestamp = []
  const lastTimestamp = []

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue

    const { timestamp, source, content: rawContent } = parsed
    bySource.set(source, (bySource.get(source) || 0) + 1)

    const type = extractType(source, rawContent)
    if (!typeCounts.has(source)) typeCounts.set(source, new Map())
    const counts = typeCounts.get(source)
    counts.set(type, (counts.get(type) || 0) + 1)

    if (timestamp) {
      if (firstTimestamp.length === 0) firstTimestamp.push(timestamp)
      lastTimestamp[0] = timestamp
    }
  }

  return {
    totalLines: lines.length,
    bySource,
    typeCounts,
    firstTimestamp: firstTimestamp[0],
    lastTimestamp: lastTimestamp[0],
  }
}

function formatDuration(first, last) {
  if (!first || !last) return '?'
  try {
    const a = new Date(first)
    const b = new Date(last)
    const mins = Math.round((b - a) / 60000)
    if (mins < 60) return `${mins}m`
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m ? `${h}h ${m}m` : `${h}h`
  } catch {
    return '?'
  }
}

function formatTypeList(counts, supported, maxItems = 15) {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const supportedList = []
  const unsupportedList = []
  for (const [type, count] of sorted) {
    if (supported.has(type)) {
      supportedList.push({ type, count })
    } else {
      unsupportedList.push({ type, count })
    }
  }
  return { supportedList, unsupportedList }
}

function main() {
  let filePath = process.argv[2]
  if (!filePath) {
    filePath = join(__dirname, '..', 'logs', 'chat-history.log')
  }
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`)
    process.exit(1)
  }

  const result = analyzeChatHistory(filePath)
  const duration = formatDuration(result.firstTimestamp, result.lastTimestamp)

  console.log('=== Chat History Analysis ===')
  console.log(`File: ${filePath}`)
  console.log(`Total lines: ${result.totalLines}`)
  console.log(`Duration: ~${duration}`)
  console.log('')
  console.log('By source:')
  const sortedSources = [...result.bySource.entries()].sort((a, b) => b[1] - a[1])
  for (const [source, count] of sortedSources) {
    console.log(`  ${source}: ${count}`)
  }

  // Kick: supported vs unsupported
  const kickCounts = result.typeCounts.get('kick')
  if (kickCounts && kickCounts.size > 0) {
    const { supportedList, unsupportedList } = formatTypeList(kickCounts, KICK_SUPPORTED)
    console.log('')
    console.log('--- Kick event types ---')
    if (supportedList.length > 0) {
      console.log('Supported:')
      for (const { type, count } of supportedList.slice(0, 10)) {
        console.log(`  ${type}: ${count}`)
      }
      if (supportedList.length > 10) {
        console.log(`  ... and ${supportedList.length - 10} more`)
      }
    }
    if (unsupportedList.length > 0) {
      console.log('Unsupported:')
      for (const { type, count } of unsupportedList) {
        console.log(`  ${type}: ${count}`)
      }
    } else {
      console.log('Unsupported: (none observed)')
    }
  }

  // Primary-chat: supported vs unsupported
  const chatCounts = result.typeCounts.get('primary-chat')
  if (chatCounts && chatCounts.size > 0) {
    const { supportedList, unsupportedList } = formatTypeList(chatCounts, PRIMARY_CHAT_SUPPORTED)
    console.log('')
    console.log('--- Primary-chat types ---')
    if (supportedList.length > 0) {
      console.log('Supported:')
      for (const { type, count } of supportedList.slice(0, 10)) {
        console.log(`  ${type}: ${count}`)
      }
      if (supportedList.length > 10) {
        console.log(`  ... and ${supportedList.length - 10} more`)
      }
    }
    if (unsupportedList.length > 0) {
      console.log('Unsupported:')
      for (const { type, count } of unsupportedList) {
        console.log(`  ${type}: ${count}`)
      }
    } else {
      console.log('Unsupported: (none observed)')
    }
  }

  // primary-live, primary-live-out, youtube, twitch: report all observed types (no supported list)
  for (const source of ['primary-live', 'primary-live-out', 'youtube', 'twitch']) {
    const counts = result.typeCounts.get(source)
    if (counts && counts.size > 0) {
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      console.log('')
      console.log(`--- ${source} types ---`)
      for (const [type, count] of sorted.slice(0, 12)) {
        console.log(`  ${type}: ${count}`)
      }
      if (sorted.length > 12) {
        console.log(`  ... and ${sorted.length - 12} more`)
      }
    }
  }
}

main()
