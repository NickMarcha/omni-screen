#!/usr/bin/env node
/**
 * Extracts 2-4 sample messages per type from chat-history.log for debug page.
 * Only fills in missing data; does not remove or overwrite existing samples.
 * Usage: node scripts/extract-chat-samples.mjs [path/to/chat-history.log]
 *        node scripts/extract-chat-samples.mjs   (defaults to logs/chat-history.log)
 * Output: logs/chat-samples.json
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SAMPLES_PER_TYPE = 4
const SAMPLES_PER_MSG_SUBTYPE = 2

// Common emote names for subtype classification
const COMMON_EMOTES = new Set([
  'LULW', 'dinkDonk', 'SWEATSTINY', 'OMEGALUL', 'POGGERS', 'KEK', 'Abathur', 'YesHoney',
  'CINEMA', 'ALARMA', 'NAHH', 'LeRuse', 'SCHIZO', 'CORNPOP', 'WWWWaiting', 'comfggL',
  'PepeLaugh', 'MMMM', 'Stare', 'TRUELOVE', 'haHAA', 'FAHHHHHH', 'LMAOOOOOOOO',
])

function parseLine(line) {
  const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/s)
  if (!match) return null
  const [, timestamp, source, content] = match
  return { timestamp, source, content }
}

function classifyMsgData(data, nicksInBatch = new Set()) {
  const d = String(data || '')
  const hasLink = /https?:\/\//i.test(d) || /#(?:kick|twitch|youtube)\/[^\s]+/.test(d)
  const hasShortLink = /\b(?:youtube\.com|www\.youtube\.com|youtu\.be|kick\.com|www\.kick\.com|twitch\.tv|www\.twitch\.tv)\b/i.test(d) && !/https?:\/\//i.test(d)
  const hasGreentext = /^>/m.test(d)
  const hasSuspost = /^\u0D9E/.test(d) // Sinhala char ඞ
  const hasEmote = [...COMMON_EMOTES].some((e) => new RegExp(`\\b${e}\\b`, 'i').test(d))
  const hasMention = nicksInBatch.size > 0 && [...nicksInBatch].some((n) => new RegExp(`(?<!\\w)${n}(?!\\w)`, 'i').test(d))
  if (hasGreentext) return 'greentext'
  if (hasSuspost) return 'suspost'
  if (hasShortLink && !hasLink) return 'shortlink'
  if (hasLink && hasEmote) return 'link+emote'
  if (hasLink && hasMention) return 'link+mention'
  if (hasLink) return 'link'
  if (hasEmote && hasMention) return 'emote+mention'
  if (hasEmote) return 'emote'
  if (hasMention) return 'mention'
  return 'plain'
}

function extractPrimaryChatType(content) {
  const token = content.trim().split(/\s+/, 1)[0]
  return token || null
}

function loadExistingSamples(outPath) {
  if (!existsSync(outPath)) return null
  try {
    return JSON.parse(readFileSync(outPath, 'utf-8'))
  } catch {
    return null
  }
}

function extractSamples(filePath, existingSamples) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter((l) => l.trim())

  // Start with existing data, preserving structure. Deep merge sources.
  const samples = existingSamples
    ? JSON.parse(JSON.stringify(existingSamples))
    : { 'primary-chat': {}, 'primary-live': {}, kick: {}, youtube: {}, twitch: {} }

  // Ensure all expected sources exist
  for (const src of ['primary-chat', 'primary-live', 'kick', 'youtube', 'twitch']) {
    if (!samples[src] || typeof samples[src] !== 'object') samples[src] = {}
  }

  const nicksFromNames = new Set()
  // Pre-populate msgSubtypeBuckets from existing MSG samples
  const msgSubtypeBuckets = new Map()
  const existingMsg = samples['primary-chat']?.MSG
  if (Array.isArray(existingMsg)) {
    for (const s of existingMsg) {
      const subtype = s?.subtype ?? 'plain'
      if (!msgSubtypeBuckets.has(subtype)) msgSubtypeBuckets.set(subtype, [])
      msgSubtypeBuckets.get(subtype).push(s)
    }
  }

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue

    const { source, content: rawContent } = parsed

    if (source === 'primary-chat') {
      const type = extractPrimaryChatType(rawContent)
      if (!type) continue

      if (!samples['primary-chat'][type]) {
        samples['primary-chat'][type] = []
      }
      const arr = samples['primary-chat'][type]
      if (arr.length >= SAMPLES_PER_TYPE && type !== 'MSG') continue

      if (type === 'MSG') {
        try {
          const jsonPart = rawContent.substring(4).trim()
          const msg = JSON.parse(jsonPart)
          const data = msg?.data ?? ''
          const nick = msg?.nick ?? ''
          const subtype = classifyMsgData(data, nicksFromNames)
          if (!msgSubtypeBuckets.has(subtype)) msgSubtypeBuckets.set(subtype, [])
          const bucket = msgSubtypeBuckets.get(subtype)
          if (bucket.length < SAMPLES_PER_MSG_SUBTYPE) {
            bucket.push({ data, nick, raw: msg, subtype })
          }
        } catch {
          // skip parse errors
        }
        continue
      }

      if (type === 'HISTORY') {
        try {
          const jsonPart = rawContent.substring(8).trim()
          const arr = JSON.parse(jsonPart)
          if (Array.isArray(arr) && arr.length > 0 && !samples['primary-chat'].HISTORY?.length) {
            const items = arr.slice(0, SAMPLES_PER_TYPE).map((s) => {
              if (typeof s === 'string' && s.startsWith('MSG ')) {
                try {
                  return { type: 'MSG', raw: JSON.parse(s.substring(4)) }
                } catch {
                  return { type: 'MSG', raw: null, rawStr: s.slice(0, 200) }
                }
              }
              if (typeof s === 'string' && s.startsWith('BROADCAST ')) {
                try {
                  return { type: 'BROADCAST', raw: JSON.parse(s.substring(10)) }
                } catch {
                  return { type: 'BROADCAST', raw: null, rawStr: s.slice(0, 200) }
                }
              }
              return { raw: s }
            })
            samples['primary-chat'].HISTORY = items
          }
        } catch {
          // skip
        }
        continue
      }

      if (type === 'NAMES') {
        try {
          const jsonPart = rawContent.substring(6).trim()
          const obj = JSON.parse(jsonPart)
          const users = obj?.users ?? []
          users.forEach((u) => {
            if (u?.nick) nicksFromNames.add(String(u.nick))
          })
        } catch {
          // skip
        }
      }

      if (arr.length < SAMPLES_PER_TYPE) {
        try {
          let payload = rawContent
          if (['ME', 'JOIN', 'QUIT', 'UPDATEUSER', 'PAIDEVENTS', 'NAMES'].includes(type)) {
            const jsonPart = rawContent.substring(type.length).trim()
            if (jsonPart) {
              try {
                payload = JSON.parse(jsonPart)
              } catch {
                payload = { raw: jsonPart.slice(0, 500) }
              }
            }
          }
          arr.push({ raw: payload, preview: String(rawContent).slice(0, 200) })
        } catch {
          arr.push({ preview: String(rawContent).slice(0, 200) })
        }
      }
    }

    if (source === 'primary-live') {
      try {
        const json = JSON.parse(rawContent)
        const type = json?.type ?? '(no type)'
        if (!samples['primary-live'][type]) samples['primary-live'][type] = []
        const arr = samples['primary-live'][type]
        if (arr.length < SAMPLES_PER_TYPE) {
          arr.push({ raw: json, preview: JSON.stringify(json).slice(0, 300) })
        }
      } catch {
        // skip
      }
    }

    if (source === 'kick') {
      try {
        const json = JSON.parse(rawContent)
        const event = json?.event ?? '(no event)'
        if (event === 'App\\Events\\ChatMessageEvent') {
          if (!samples.kick['ChatMessageEvent']) samples.kick['ChatMessageEvent'] = []
          const arr = samples.kick['ChatMessageEvent']
          if (arr.length < SAMPLES_PER_TYPE) {
            let dataStr = json?.data
            if (typeof dataStr === 'string') {
              try {
                const inner = JSON.parse(dataStr)
                arr.push({
                  content: inner?.content ?? '',
                  sender: inner?.sender,
                  raw: inner,
                })
              } catch {
                arr.push({ content: dataStr?.slice(0, 200), raw: json })
              }
            }
          }
        }
      } catch {
        // skip
      }
    }

    if (source === 'youtube') {
      try {
        const json = JSON.parse(rawContent)
        const actions = json?.continuationContents?.liveChatContinuation?.actions ?? []
        for (const a of actions) {
          const item = a?.addChatItemAction?.item
          const renderer = item?.liveChatTextMessageRenderer
          if (renderer) {
            if (!samples.youtube['liveChatTextMessageRenderer']) {
              samples.youtube['liveChatTextMessageRenderer'] = []
            }
            const arr = samples.youtube['liveChatTextMessageRenderer']
            if (arr.length < SAMPLES_PER_TYPE) {
              const runs = renderer?.message?.runs ?? []
              const message = renderer?.message
              const authorName = renderer?.authorName?.simpleText ?? ''
              arr.push({
                runs,
                message,
                authorName,
                raw: renderer,
              })
            }
          }
        }
      } catch {
        // skip
      }
    }

    if (source === 'twitch') {
      const trimmed = rawContent.trim()
      if (trimmed.includes('PRIVMSG')) {
        if (!samples.twitch['PRIVMSG']) samples.twitch['PRIVMSG'] = []
        const arr = samples.twitch['PRIVMSG']
        if (arr.length < SAMPLES_PER_TYPE) {
          arr.push({ raw: trimmed, preview: trimmed.slice(0, 300) })
        }
      }
    }
  }

  // Flatten MSG samples by subtype into primary-chat.MSG
  const msgSamples = []
  for (const [subtype, bucket] of msgSubtypeBuckets) {
    for (const s of bucket) {
      msgSamples.push(s)
    }
  }
  if (msgSamples.length > 0) {
    samples['primary-chat'].MSG = msgSamples
  }

  return samples
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

  const outDir = join(__dirname, '..', 'logs')
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }
  const outPath = join(outDir, 'chat-samples.json')
  const existingSamples = loadExistingSamples(outPath)

  const samples = extractSamples(filePath, existingSamples)
  writeFileSync(outPath, JSON.stringify(samples, null, 2), 'utf-8')
  console.log(`Wrote ${outPath}`)
}

main()
