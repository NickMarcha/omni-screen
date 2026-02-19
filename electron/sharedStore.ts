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
}

const store = new Store({
  name: 'omni-screen',
  defaults: {
    bookmarkedStreamers: [] as BookmarkedStreamer[],
    minimizeToTray: true,
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
  return store.get('minimizeToTray', true) as boolean
}

export function setMinimizeToTray(value: boolean) {
  store.set('minimizeToTray', value)
}

/** Get raw store for IPC – used when renderer needs other keys. */
export function storeGet(key: string): unknown {
  return store.get(key)
}

/** Set raw store for IPC. */
export function storeSet(key: string, value: unknown) {
  store.set(key, value)
}
