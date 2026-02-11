#!/usr/bin/env node
/**
 * Analyzes omni-screen log files to identify sources of excessive log volume.
 * Usage: node scripts/analyze-logs.mjs [path/to/logfile]
 *        node scripts/analyze-logs.mjs   (defaults to most recent log in logs/)
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse log line into parts. Format: [timestamp] [LEVEL] [SOURCE] message...
function parseLine(line) {
  const match = line.match(/^\[[^\]]+\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/)
  if (!match) return null
  const [, level, source, message] = match
  return { level, source, message }
}

// Extract a category from the message for grouping.
// Prioritizes: [BracketedTerm], Prefix: rest, or first ~50 chars
function extractCategory(message) {
  if (!message || typeof message !== 'string') return '(empty)'

  // First bracketed term in message (e.g. [TwitterEmbed 123] -> TwitterEmbed)
  const bracketMatch = message.match(/\[([^\]]+)\]/)
  if (bracketMatch) {
    const inner = bracketMatch[1]
    // Normalize: "TwitterEmbed 2021610877925855552" -> "TwitterEmbed"
    const normalized = inner.replace(/\s+\d{15,}$/, '').replace(/\s+\d+$/, '')
    return `[${normalized}]`
  }

  // Prefix before colon (e.g. "TikTokEmbed: Processing URL" -> "TikTokEmbed: Processing URL")
  const colonIdx = message.indexOf(':')
  if (colonIdx > 0 && colonIdx < 60) {
    return message.slice(0, colonIdx + 1).trim()
  }

  // First meaningful phrase (before first space + long word, or truncate)
  const firstPart = message.slice(0, 60).trim()
  return firstPart || '(empty)'
}

// Build full category key: LEVEL/SOURCE/category
function getCategoryKey(level, source, message) {
  const cat = extractCategory(message)
  return `${level}/${source}/${cat}`
}

function analyzeLogFile(filePath) {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter((l) => l.trim())

  const counts = new Map()
  const firstTimestamp = []
  const lastTimestamp = []

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue

    const key = getCategoryKey(parsed.level, parsed.source, parsed.message)
    counts.set(key, (counts.get(key) || 0) + 1)

    const tsMatch = line.match(/^\[([^\]]+)\]/)
    if (tsMatch) {
      if (firstTimestamp.length === 0) firstTimestamp.push(tsMatch[1])
      lastTimestamp[0] = tsMatch[1]
    }
  }

  // Sort by count descending
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])

  return {
    totalLines: lines.length,
    uniqueCategories: counts.size,
    firstTimestamp: firstTimestamp[0],
    lastTimestamp: lastTimestamp[0],
    byCategory: sorted,
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

function main() {
  let filePath = process.argv[2]
  if (!filePath) {
    const logsDir = join(__dirname, '..', 'logs')
    const files = readdirSync(logsDir)
      .filter((f) => f.startsWith('app-') && f.endsWith('.log') && !f.includes('-errors'))
      .map((f) => ({ name: f, mtime: statSync(join(logsDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length === 0) {
      console.error('No log files found in logs/')
      process.exit(1)
    }
    filePath = join(logsDir, files[0].name)
    console.log(`Using most recent log: ${files[0].name}\n`)
  }

  const result = analyzeLogFile(filePath)
  const duration = formatDuration(result.firstTimestamp, result.lastTimestamp)

  console.log('=== Log Analysis Summary ===')
  console.log(`File: ${filePath}`)
  console.log(`Total lines: ${result.totalLines}`)
  console.log(`Duration: ~${duration}`)
  console.log(`Unique categories: ${result.uniqueCategories}`)
  console.log('')
  console.log('Top contributors (by line count):')
  console.log('─'.repeat(80))

  const top = result.byCategory.slice(0, 25)
  const maxCount = Math.max(...top.map(([, c]) => c))
  const maxDigits = String(maxCount).length

  for (const [key, count] of top) {
    const pct = ((count / result.totalLines) * 100).toFixed(1)
    const bar = '█'.repeat(Math.round((count / maxCount) * 20)) + '░'.repeat(20 - Math.round((count / maxCount) * 20))
    console.log(`${String(count).padStart(maxDigits)} (${pct.padStart(5)}%) ${bar} ${key}`)
  }

  console.log('')
  console.log('Recommendation: Consider reducing or moving to DEBUG/verbose:')
  for (const [key, count] of top.slice(0, 8)) {
    if (count > 50) {
      console.log(`  - ${key}`)
    }
  }
}

main()
