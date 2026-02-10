import { createRequire } from 'node:module'
import path from 'node:path'
import { readExtensionsList } from './storage.js'
import { clearExtensionConfig, createExtensionContext } from './context.js'
import type { InstalledExtension } from './types.js'
import { fileLogger } from '../fileLogger.js'

const require = createRequire(import.meta.url)

/** In-memory registry of loaded extensions (metadata + any registered config). */
let loadedExtensions: InstalledExtension[] = []

/**
 * Load all enabled extensions from disk and run their entry bundles. Call at app startup.
 */
export function loadExtensions(): InstalledExtension[] {
  clearExtensionConfig()
  const list = readExtensionsList()
  loadedExtensions = list.filter((e) => e.enabled)

  for (const ext of loadedExtensions) {
    const entryPath = path.join(ext.path, 'bundle.js')
    try {
      const mod = require(entryPath)
      const context = createExtensionContext(ext.path, ext.id, ext.name)
      if (typeof mod.register === 'function') {
        mod.register(context)
      }
      try {
        fileLogger.writeLog('info', 'main', `[Extensions] Loaded ${ext.id}`, [])
      } catch {
        // ignore
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const errStack = e instanceof Error ? e.stack : undefined
      console.error(`[Extensions] Failed to load ${ext.id}:`, e)
      try {
        fileLogger.writeLog('error', 'main', `[Extensions] Failed to load ${ext.id}: ${errMsg}`, errStack ? [errStack] : [])
      } catch {
        // ignore
      }
    }
  }

  return loadedExtensions
}

/**
 * Reload extensions from disk (e.g. after install or menu "Reload extensions").
 */
export function reloadExtensions(): InstalledExtension[] {
  return loadExtensions()
}

/**
 * Get currently loaded extensions (metadata only).
 */
export function getLoadedExtensions(): InstalledExtension[] {
  return [...loadedExtensions]
}
