import fs from 'fs'
import path from 'path'
import { app, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'

const { autoUpdater } = createRequire(import.meta.url)('electron-updater');

/** True if the app is installed in a system/read-only location (e.g. /opt) where in-app update cannot replace the binary. */
function isSystemInstall(): boolean {
  try {
    const exePath = process.execPath || app.getPath('exe')
    const exeDir = path.dirname(exePath)
    fs.accessSync(exeDir, fs.constants.W_OK)
    return false
  } catch {
    return true
  }
}

export function update(win: Electron.BrowserWindow) {

  // When set to false, the update download will be triggered through the API
  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = false
  autoUpdater.allowDowngrade = false

  // start check
  autoUpdater.on('checking-for-update', function () { })
  // update available
  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: true, version: app.getVersion(), newVersion: arg?.version })
  })
  // update not available
  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: false, version: app.getVersion(), newVersion: arg?.version })
  })

  // Checking for updates
  ipcMain.handle('check-update', async () => {
    if (!app.isPackaged) {
      const error = new Error('The update feature is only available after the package.')
      return { message: error.message, error }
    }

    if (isSystemInstall()) {
      const payload = { update: false, version: app.getVersion(), systemInstall: true }
      win.webContents.send('update-can-available', payload)
      return payload
    }

    try {
      return await autoUpdater.checkForUpdatesAndNotify()
    } catch {
      // YAML missing (release still in progress), network error, etc. — treat as no update available
      win.webContents.send('update-can-available', {
        update: false,
        version: app.getVersion(),
        newVersion: undefined,
      })
      return { update: false, version: app.getVersion() }
    }
  })

  // Start downloading and feedback on progress
  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    if (isSystemInstall()) {
      event.sender.send('update-error', {
        message: 'Updates are managed by your package manager. Use: yay -Syu omni-screen-bin (or pacman -Syu omni-screen-bin)',
      })
      return
    }
    startDownload(
      (error, progressInfo) => {
        if (error) {
          // feedback download error message
          event.sender.send('update-error', { message: error.message, error })
        } else {
          // feedback update progress message
          event.sender.send('download-progress', progressInfo)
        }
      },
      () => {
        // feedback update downloaded message
        event.sender.send('update-downloaded')
      }
    )
  })

  // Install now
  ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

function startDownload(
  callback: (error: Error | null, info: ProgressInfo | null) => void,
  complete: (event: UpdateDownloadedEvent) => void,
) {
  autoUpdater.on('download-progress', (info: ProgressInfo) => callback(null, info))
  autoUpdater.on('error', (error: Error) => callback(error, null))
  autoUpdater.on('update-downloaded', complete)
  autoUpdater.downloadUpdate()
}