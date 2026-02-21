/**
 * Shared store for data that must be accessible from main process (e.g. background tasks, tray).
 * Uses electron-store; main process owns the instance; renderer accesses via IPC.
 */

import Store from 'electron-store'

export interface BookmarkedStreamer {
  id: string
  nickname: string
  youtubeChannelId?: string
  kickSlug?: string
  twitchLogin?: string
  color?: string
  youtubeColor?: string
  kickColor?: string
  twitchColor?: string
  openWhenLive?: boolean
  hideLabelInCombinedChat?: boolean
  notifyWhenLive?: boolean
}

export interface NotificationPrefs {
  soundEnabled: boolean
  soundFile: string
  soundVolume: number
  customSoundPath: string
  systemEnabled: boolean
  systemWithSound: boolean
}

const defaultNotificationPrefs: NotificationPrefs = {
  soundEnabled: false,
  soundFile: '534.wav',
  soundVolume: 0.8,
  customSoundPath: '',
  systemEnabled: false,
  systemWithSound: true,
}

const store = new Store({
  name: 'omni-screen',
  defaults: {
    bookmarkedStreamers: [] as BookmarkedStreamer[],
    minimizeToTray: false,
    notifications: defaultNotificationPrefs,
  },
})

export function getBookmarkedStreamers(): BookmarkedStreamer[] {
  const raw = store.get('bookmarkedStreamers')
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s): s is BookmarkedStreamer =>
      s && typeof s === 'object' && typeof s.id === 'string' && typeof s.nickname === 'string'
  )
}

export function setBookmarkedStreamers(streamers: BookmarkedStreamer[]) {
  store.set('bookmarkedStreamers', streamers)
}

export function getMinimizeToTray(): boolean {
  return store.get('minimizeToTray', false) as boolean
}

export function setMinimizeToTray(value: boolean) {
  store.set('minimizeToTray', value)
}

export function getNotificationPrefs(): NotificationPrefs {
  const raw = store.get('notifications') as unknown
  if (!raw || typeof raw !== 'object') return { ...defaultNotificationPrefs }
  const o = raw as Record<string, unknown>
  return {
    soundEnabled: typeof o.soundEnabled === 'boolean' ? o.soundEnabled : defaultNotificationPrefs.soundEnabled,
    soundFile: typeof o.soundFile === 'string' ? o.soundFile : defaultNotificationPrefs.soundFile,
    soundVolume: typeof o.soundVolume === 'number' ? Math.max(0, Math.min(1, o.soundVolume)) : defaultNotificationPrefs.soundVolume,
    customSoundPath: typeof o.customSoundPath === 'string' ? o.customSoundPath : defaultNotificationPrefs.customSoundPath,
    systemEnabled: typeof o.systemEnabled === 'boolean' ? o.systemEnabled : defaultNotificationPrefs.systemEnabled,
    systemWithSound: typeof o.systemWithSound === 'boolean' ? o.systemWithSound : defaultNotificationPrefs.systemWithSound,
  }
}

export function setNotificationPrefs(prefs: Partial<NotificationPrefs>) {
  const current = getNotificationPrefs()
  store.set('notifications', { ...current, ...prefs })
}

/** Get raw store for IPC – used when renderer needs other keys. */
export function storeGet(key: string): unknown {
  return store.get(key)
}

/** Set raw store for IPC. */
export function storeSet(key: string, value: unknown) {
  store.set(key, value)
}
