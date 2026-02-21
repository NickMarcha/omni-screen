/// <reference types="vite-plugin-electron/electron-env" />

/** Build-time feature flag for charity raffle. Replaced by Vite define. */
declare const __CHARITY_RAFFLE_ENABLED__: boolean

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer & {
    isElectron?: boolean
    store?: {
      getBookmarkedStreamers: () => Promise<unknown[]>
      setBookmarkedStreamers: (streamers: unknown) => Promise<void>
      getMinimizeToTray: () => Promise<boolean>
      setMinimizeToTray: (value: boolean) => Promise<void>
      getNotificationPrefs: () => Promise<{
        soundEnabled: boolean
        soundFile: string
        soundVolume: number
        customSoundPath: string
        systemEnabled: boolean
        systemWithSound: boolean
      }>
      setNotificationPrefs: (prefs: Record<string, unknown>) => Promise<void>
    }
    getNotificationSoundsList?: () => Promise<string[]>
    pickCustomNotificationSound?: () => Promise<string | null>
    playNotificationSoundPreview?: (pathOrFilename: string, volume: number) => Promise<void>
  }
}
