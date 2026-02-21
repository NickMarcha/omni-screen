import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  isElectron: true,
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    const wrappedListener = (_event: any, ...args: any[]) => listener(_event, ...args)
    ipcRenderer.on(channel as string, wrappedListener)
    return () => ipcRenderer.off(channel as string, wrappedListener)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel as string, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel as string, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel as string, ...omit)
  },

  // Shared store (bookmarked streamers, prefs)
  store: {
    getBookmarkedStreamers: () => ipcRenderer.invoke('store-get-bookmarked-streamers'),
    setBookmarkedStreamers: (streamers: unknown) => ipcRenderer.invoke('store-set-bookmarked-streamers', streamers),
    getMinimizeToTray: () => ipcRenderer.invoke('store-get-minimize-to-tray'),
    setMinimizeToTray: (value: boolean) => ipcRenderer.invoke('store-set-minimize-to-tray', value),
    getNotificationPrefs: () => ipcRenderer.invoke('store-get-notification-prefs'),
    setNotificationPrefs: (prefs: Record<string, unknown>) => ipcRenderer.invoke('store-set-notification-prefs', prefs),
  },
  getNotificationSoundsList: () => ipcRenderer.invoke('notification-sounds-list'),
  pickCustomNotificationSound: () => ipcRenderer.invoke('notification-pick-custom-sound'),
  playNotificationSoundPreview: (pathOrFilename: string, volume: number) =>
    ipcRenderer.invoke('play-notification-sound-preview', pathOrFilename, volume),
})
