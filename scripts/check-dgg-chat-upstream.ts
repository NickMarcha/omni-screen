#!/usr/bin/env tsx
/**
 * Check destinygg/chat-gui upstream for file changes (by blob SHA).
 * Keeps a baseline in repo so state is maintained between commits.
 * Run manually or pre-release: npm run check:dgg-upstream
 *
 * Options:
 *   --update   Write current SHAs to baseline (after reporting). Default: true.
 *   --no-update  Only report; do not update baseline.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = __dirname

const BASE = 'https://api.github.com/repos'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const DELAY_MS = 650 // stay under 60/hr if unauthenticated; harmless with token
const MAX_REQUESTS_DEFAULT = 30

interface Config {
  repo: string
  ref: string
  maxRequests: number
  paths: string[]
}

interface Baseline {
  _comment?: string
  ref: string
  updatedAt: string | null
  files: Record<string, string>
}

function loadConfig(): Config {
  const p = join(SCRIPT_DIR, 'dgg-chat-upstream.config.json')
  const raw = readFileSync(p, 'utf-8')
  const c = JSON.parse(raw) as Config
  if (!c.repo || !Array.isArray(c.paths)) throw new Error('Invalid config: need repo and paths')
  c.ref = c.ref || 'master'
  c.maxRequests = Math.min(Number(c.maxRequests) || MAX_REQUESTS_DEFAULT, 60)
  return c
}

function loadBaseline(): Baseline | null {
  const p = join(SCRIPT_DIR, 'dgg-chat-baseline.json')
  if (!existsSync(p)) return null
  const raw = readFileSync(p, 'utf-8')
  const b = JSON.parse(raw) as Baseline
  return b && typeof b.files === 'object' ? b : null
}

function saveBaseline(baseline: Baseline): void {
  const p = join(SCRIPT_DIR, 'dgg-chat-baseline.json')
  baseline.updatedAt = new Date().toISOString()
  writeFileSync(p, JSON.stringify(baseline, null, 2) + '\n', 'utf-8')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchFileSha(repo: string, ref: string, path: string): Promise<{ sha: string } | null> {
  const url = `${BASE}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'omni-screen-check-dgg-upstream',
  }
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`

  const res = await fetch(url, { headers })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${url}`)
  }
  const data = (await res.json()) as { sha?: string; type?: string }
  if (data.type === 'dir') return null
  return data.sha ? { sha: data.sha } : null
}

function githubFileUrl(repo: string, ref: string, path: string): string {
  return `https://github.com/${repo}/blob/${ref}/${path}`
}

function githubHistoryUrl(repo: string, ref: string, path: string): string {
  return `https://github.com/${repo}/commits/${ref}/${path}`
}

async function main(): Promise<void> {
  const doUpdate = process.argv.includes('--no-update') ? false : true

  const config = loadConfig()
  const baseline = loadBaseline()
  const paths = config.paths.slice(0, config.maxRequests)

  console.log(`Checking ${paths.length} paths in ${config.repo} (ref: ${config.ref})…`)
  console.log('')

  const current: Record<string, string> = {}
  const changed: { path: string; oldSha: string | undefined; newSha: string }[] = []

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    if (i > 0) await sleep(DELAY_MS)

    try {
      const info = await fetchFileSha(config.repo, config.ref, path)
      if (!info) {
        console.warn(`  [skip] ${path} (not found or directory)`)
        continue
      }
      current[path] = info.sha
      const prev = baseline?.files?.[path]
      if (prev !== undefined && prev !== info.sha) {
        changed.push({ path, oldSha: prev, newSha: info.sha })
      }
    } catch (e) {
      console.error(`  [error] ${path}:`, e instanceof Error ? e.message : e)
    }
  }

  if (changed.length === 0) {
    console.log('No changes detected since last baseline.')
  } else {
    console.log('Files changed upstream (since last baseline):')
    console.log('')
    for (const { path, oldSha, newSha } of changed) {
      const fileUrl = githubFileUrl(config.repo, config.ref, path)
      const historyUrl = githubHistoryUrl(config.repo, config.ref, path)
      console.log(`  ${path}`)
      console.log(`    was: ${oldSha ?? '(new)'}  →  now: ${newSha}`)
      console.log(`    file:   ${fileUrl}`)
      console.log(`    history: ${historyUrl}`)
      console.log('')
    }
  }

  if (doUpdate && Object.keys(current).length > 0) {
    const newBaseline: Baseline = {
      _comment: baseline?._comment,
      ref: config.ref,
      updatedAt: new Date().toISOString(),
      files: current,
    }
    saveBaseline(newBaseline)
    console.log('Baseline updated (scripts/dgg-chat-baseline.json). Commit to keep state.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
