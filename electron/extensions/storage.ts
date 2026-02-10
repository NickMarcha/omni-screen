import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import type { ExtensionManifest, InstalledExtension } from './types.js'

const EXTENSIONS_DIR_NAME = 'extensions'
const EXTENSIONS_LIST_FILE = 'extensions.json'

function getExtensionsDir(): string {
  const userData = app.getPath('userData')
  return path.join(userData, EXTENSIONS_DIR_NAME)
}

function getExtensionsListPath(): string {
  return path.join(getExtensionsDir(), EXTENSIONS_LIST_FILE)
}

function ensureExtensionsDir(): void {
  const dir = getExtensionsDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const req = client.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson<T>(res.headers.location).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T)
        } catch (e) {
          reject(new Error('Invalid JSON'))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location).then(resolve).catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

/**
 * Read the list of installed extensions from disk.
 */
export function readExtensionsList(): InstalledExtension[] {
  ensureExtensionsDir()
  const listPath = getExtensionsListPath()
  if (!fs.existsSync(listPath)) return []
  try {
    const raw = fs.readFileSync(listPath, 'utf-8')
    const data = JSON.parse(raw) as { extensions?: InstalledExtension[] }
    const list = Array.isArray(data.extensions) ? data.extensions : []
    return list.filter((e) => e && typeof e.id === 'string' && typeof e.updateUrl === 'string')
  } catch {
    return []
  }
}

/**
 * Write the list of installed extensions to disk.
 */
export function writeExtensionsList(list: InstalledExtension[]): void {
  ensureExtensionsDir()
  const listPath = getExtensionsListPath()
  fs.writeFileSync(listPath, JSON.stringify({ extensions: list }, null, 2), 'utf-8')
}

/**
 * Get the on-disk path for an extension by id.
 */
export function getExtensionDir(extensionId: string): string {
  const base = getExtensionsDir()
  const safeId = extensionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(base, safeId)
}

/**
 * Install an extension from a manifest URL (e.g. from omnichat://install?url=...).
 * Fetches the manifest, downloads the entry bundle, and adds to the installed list.
 */
export async function installFromManifestUrl(manifestUrl: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  ensureExtensionsDir()
  let manifest: ExtensionManifest
  try {
    manifest = await fetchJson<ExtensionManifest>(manifestUrl)
  } catch (e) {
    return { ok: false, error: `Failed to fetch manifest: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!manifest.id || !manifest.entry || !manifest.version || !manifest.updateUrl) {
    return { ok: false, error: 'Manifest must include id, entry, version, and updateUrl' }
  }
  const extDir = getExtensionDir(manifest.id)
  if (fs.existsSync(extDir)) {
    fs.rmSync(extDir, { recursive: true })
  }
  fs.mkdirSync(extDir, { recursive: true })
  try {
    const buffer = await fetchBuffer(manifest.entry)
    const entryBasename = path.basename(new URL(manifest.entry).pathname)
    const entryPath = path.join(extDir, entryBasename)
    fs.writeFileSync(entryPath, buffer)
  } catch (e) {
    if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true })
    return { ok: false, error: `Failed to download extension: ${e instanceof Error ? e.message : String(e)}` }
  }
  const list = readExtensionsList()
  const existing = list.find((e) => e.id === manifest.id)
  const installed: InstalledExtension = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    updateUrl: manifest.updateUrl,
    path: extDir,
    enabled: existing?.enabled ?? true,
    installedAt: new Date().toISOString(),
    description: manifest.description,
    tags: Array.isArray(manifest.tags) ? manifest.tags : undefined,
    icon: typeof manifest.icon === 'string' ? manifest.icon : undefined,
  }
  const newList = list.filter((e) => e.id !== manifest.id).concat(installed)
  writeExtensionsList(newList)
  return { ok: true, id: manifest.id }
}

/**
 * Set an installed extension's enabled state. Returns true if found and updated.
 */
export function setExtensionEnabled(extensionId: string, enabled: boolean): boolean {
  const list = readExtensionsList()
  const idx = list.findIndex((e) => e.id === extensionId)
  if (idx < 0) return false
  list[idx] = { ...list[idx], enabled }
  writeExtensionsList(list)
  return true
}

/**
 * Uninstall an extension: remove its folder and remove from the installed list.
 * Returns { ok: true } on success, { ok: false, error } on failure.
 */
export function uninstallExtension(extensionId: string): { ok: boolean; error?: string } {
  const list = readExtensionsList()
  const ext = list.find((e) => e.id === extensionId)
  if (!ext) return { ok: false, error: 'Extension not found' }
  const extDir = getExtensionDir(extensionId)
  try {
    if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true })
  } catch (e) {
    return { ok: false, error: `Failed to remove extension folder: ${e instanceof Error ? e.message : String(e)}` }
  }
  const newList = list.filter((e) => e.id !== extensionId)
  writeExtensionsList(newList)
  return { ok: true }
}
