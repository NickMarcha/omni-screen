/**
 * Hidden window for playing notification sounds via HTML5 audio.
 * Created lazily on first play, destroyed on app quit.
 * Uses show: false + skipTaskbar so it does not appear in taskbar or task switcher.
 */

import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { fileLogger } from './fileLogger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = process.env.APP_ROOT || path.join(__dirname, '..')
const RENDERER_DIST = path.join(APP_ROOT, 'dist')

let soundWin: BrowserWindow | null = null

function getSoundPlayerPath(): string {
  // In production, public files are in dist root
  const distPath = path.join(RENDERER_DIST, 'sound-player.html')
  if (existsSync(distPath)) return distPath
  // In development, use public folder
  return path.join(APP_ROOT, 'public', 'sound-player.html')
}

/** Resolve sound path to a file:// URL for the audio element. */
export function resolveSoundPath(filenameOrPath: string): string | null {
  if (!filenameOrPath || typeof filenameOrPath !== 'string') return null
  const trimmed = filenameOrPath.trim()
  if (!trimmed) return null

  // Custom path: user-selected file
  if (existsSync(trimmed)) {
    return pathToFileUrl(trimmed)
  }

  // Bundled sound: filename with ext (e.g. 534.wav) or base name. Check notification subfolder.
  const notificationDir = path.join(APP_ROOT, 'src', 'assets', 'media', 'sound', 'notification')
  const distNotificationDir = path.join(RENDERER_DIST, 'assets', 'media', 'sound', 'notification')
  const publicNotificationDir = path.join(APP_ROOT, 'public', 'sounds', 'notification')
  const distPublicNotificationDir = path.join(RENDERER_DIST, 'sounds', 'notification')
  const extensions = ['mp3', 'wav', 'ogg', 'm4a', 'aac']
  for (const dir of [notificationDir, distNotificationDir, publicNotificationDir, distPublicNotificationDir]) {
    if (!existsSync(dir)) continue
    if (trimmed.includes('.')) {
      const fullPath = path.join(dir, trimmed)
      if (existsSync(fullPath)) return pathToFileUrl(fullPath)
    } else {
      for (const ext of extensions) {
        const fullPath = path.join(dir, `${trimmed}.${ext}`)
        if (existsSync(fullPath)) return pathToFileUrl(fullPath)
      }
      const fullPathNoExt = path.join(dir, trimmed)
      if (existsSync(fullPathNoExt)) return pathToFileUrl(fullPathNoExt)
    }
  }

  return null
}

function pathToFileUrl(p: string): string {
  const resolved = path.resolve(p).replace(/\\/g, '/')
  return resolved.startsWith('/') ? `file://${resolved}` : `file:///${resolved}`
}

let soundWindowReadyPromise: Promise<void> | null = null

export async function getOrCreateSoundWindow(): Promise<BrowserWindow | null> {
  if (soundWin && !soundWin.isDestroyed()) {
    return soundWin
  }

  const playerPath = getSoundPlayerPath()
  if (!existsSync(playerPath)) {
    fileLogger.writeLog('warn', 'main', '[soundWindow] sound-player.html not found', [playerPath])
    return null
  }

  soundWin = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  })

  soundWin.setMenu(null)
  soundWindowReadyPromise = new Promise<void>((resolve) => {
    soundWin!.webContents.once('did-finish-load', () => resolve())
    soundWin!.webContents.once('did-fail-load', (_e, code, desc) => {
      fileLogger.writeLog('warn', 'main', '[soundWindow] sound-player load failed', [code, desc])
      resolve()
    })
  })
  soundWin.loadFile(playerPath)
  soundWin.on('closed', () => {
    soundWin = null
    soundWindowReadyPromise = null
  })

  await soundWindowReadyPromise
  return soundWin
}

export async function playNotificationSound(filenameOrPath: string, volume: number): Promise<void> {
  const resolved = resolveSoundPath(filenameOrPath)
  if (!resolved) {
    fileLogger.writeLog('warn', 'main', '[soundWindow] Could not resolve sound path (add files to src/assets/media/sound/notification)', [filenameOrPath])
    return
  }
  const w = await getOrCreateSoundWindow()
  if (!w || w.isDestroyed()) return
  w.webContents.send('play-sound', { path: resolved, volume })
}

export function destroySoundWindow(): void {
  if (soundWin && !soundWin.isDestroyed()) {
    soundWin.destroy()
    soundWin = null
  }
}

const SOUND_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac']

/** List sound filenames (with extension, e.g. 534.wav) from notification directory. */
export function getNotificationSoundsList(): string[] {
  const notificationDir = path.join(APP_ROOT, 'src', 'assets', 'media', 'sound', 'notification')
  const distNotificationDir = path.join(RENDERER_DIST, 'assets', 'media', 'sound', 'notification')
  const publicNotificationDir = path.join(APP_ROOT, 'public', 'sounds', 'notification')
  const distPublicNotificationDir = path.join(RENDERER_DIST, 'sounds', 'notification')
  const seen = new Set<string>()
  const result: string[] = []
  for (const dir of [notificationDir, distNotificationDir, publicNotificationDir, distPublicNotificationDir]) {
    if (!existsSync(dir)) continue
    try {
      for (const name of readdirSync(dir)) {
        const ext = path.extname(name).toLowerCase()
        if (SOUND_EXTENSIONS.includes(ext)) {
          if (!seen.has(name)) {
            seen.add(name)
            result.push(name)
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return result.sort()
}
