/**
 * Background live-check scheduler for bookmarked streamers with notifyWhenLive.
 * Runs in main process regardless of window state (works when app is in tray).
 * On streamer going live: plays sound, shows OS notification, broadcasts to renderers.
 */

import { Notification } from 'electron'
import { getBookmarkedStreamers, getNotificationPrefs } from './sharedStore'
import type { BookmarkedStreamer } from './sharedStore'
import { checkUrlIsLive } from './urlIsLive'
import { getYouTubeLiveOrLatest } from './youtubeLiveOrLatest'
import { playNotificationSound } from './soundWindow'

const POLL_INTERVAL_MS = 60_000

function makeEmbedKey(platform: string, id: string): string {
  const p = String(platform || '').toLowerCase()
  const rawId = String(id || '')
  const normalizedId = p === 'youtube' ? rawId : rawId.toLowerCase()
  return `${p}:${normalizedId}`
}

/** streamerId -> wasLive (true if we last saw them live) */
const wasLiveByStreamerId = new Map<string, boolean>()

let intervalId: ReturnType<typeof setInterval> | null = null

export interface StreamerWentLivePayload {
  streamerId: string
  embedKey: string
  platform: string
  id: string
  nickname: string
  /** When true, renderer should show in-app toast instead of system notification (main window is focused). */
  showToast?: boolean
}

function notifyStreamerWentLive(
  streamer: BookmarkedStreamer,
  embedKey: string,
  platform: string,
  id: string,
  broadcast: (channel: string, payload: StreamerWentLivePayload) => void,
  getIsMainWindowFocused: () => boolean,
): void {
  const prefs = getNotificationPrefs()
  const mainWindowFocused = getIsMainWindowFocused()

  if (prefs.soundEnabled) {
    const path = prefs.soundFile === 'custom' && prefs.customSoundPath
      ? prefs.customSoundPath
      : prefs.soundFile
    playNotificationSound(path, prefs.soundVolume).catch(() => {})
  }

  if (prefs.systemEnabled) {
    if (mainWindowFocused) {
      broadcast('streamer-went-live', {
        streamerId: streamer.id,
        embedKey,
        platform,
        id,
        nickname: streamer.nickname || streamer.id,
        showToast: true,
      })
    } else if (Notification.isSupported()) {
      new Notification({
        title: 'Live',
        body: `${streamer.nickname || streamer.id} is now live`,
        silent: !prefs.systemWithSound,
      }).show()
      broadcast('streamer-went-live', {
        streamerId: streamer.id,
        embedKey,
        platform,
        id,
        nickname: streamer.nickname || streamer.id,
        showToast: false,
      })
    } else {
      broadcast('streamer-went-live', {
        streamerId: streamer.id,
        embedKey,
        platform,
        id,
        nickname: streamer.nickname || streamer.id,
        showToast: false,
      })
    }
  } else {
    broadcast('streamer-went-live', {
      streamerId: streamer.id,
      embedKey,
      platform,
      id,
      nickname: streamer.nickname || streamer.id,
      showToast: false,
    })
  }
}

async function runLiveChecks(
  broadcast: (channel: string, payload: StreamerWentLivePayload) => void,
  getIsMainWindowFocused: () => boolean,
): Promise<void> {
  const streamers = getBookmarkedStreamers().filter((s) => s.notifyWhenLive === true)
  if (streamers.length === 0) return

  for (const s of streamers) {
    let live = false
    let embedKey: string | null = null
    let platform: string | null = null
    let id: string | null = null

    if (s.youtubeChannelId?.trim()) {
      try {
        const r = await getYouTubeLiveOrLatest(s.youtubeChannelId.trim())
        if (!('error' in r) && r.isLive && r.videoId) {
          live = true
          platform = 'youtube'
          id = r.videoId
          embedKey = makeEmbedKey('youtube', r.videoId)
        }
      } catch {
        // ignore
      }
    }

    if (!live && s.kickSlug?.trim()) {
      try {
        const r = await checkUrlIsLive(`https://kick.com/${s.kickSlug.trim().toLowerCase()}`)
        if (!r.error && r.live) {
          live = true
          platform = 'kick'
          id = s.kickSlug.trim().toLowerCase()
          embedKey = makeEmbedKey('kick', id)
        }
      } catch {
        // ignore
      }
    }

    if (!live && s.twitchLogin?.trim()) {
      try {
        const r = await checkUrlIsLive(`https://twitch.tv/${s.twitchLogin.trim().toLowerCase()}`)
        if (!r.error && r.live) {
          live = true
          platform = 'twitch'
          id = s.twitchLogin.trim().toLowerCase()
          embedKey = makeEmbedKey('twitch', id)
        }
      } catch {
        // ignore
      }
    }

    const prev = wasLiveByStreamerId.get(s.id)
    wasLiveByStreamerId.set(s.id, live)

    if (live && prev !== true && embedKey && platform && id) {
      notifyStreamerWentLive(s, embedKey, platform, id, broadcast, getIsMainWindowFocused)
    }
  }
}

export function startLiveCheckScheduler(
  broadcast: (channel: string, payload: StreamerWentLivePayload) => void,
  getIsMainWindowFocused: () => boolean,
): void {
  if (intervalId) return
  runLiveChecks(broadcast, getIsMainWindowFocused)
  intervalId = setInterval(() => runLiveChecks(broadcast, getIsMainWindowFocused), POLL_INTERVAL_MS)
}

export function stopLiveCheckScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  wasLiveByStreamerId.clear()
}
