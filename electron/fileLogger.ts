import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'

class FileLogger {
  private logFilePath: string | null = null
  private errorLogFilePath: string | null = null
  private logStream: fs.WriteStream | null = null
  private errorStream: fs.WriteStream | null = null
  private logsDir: string | null = null
  private sessionTimestamp: string | null = null
  private extraStreams: Map<string, fs.WriteStream> = new Map()
  private __dirname = path.dirname(fileURLToPath(import.meta.url))

  constructor() {
    // Logs directory will be resolved lazily when initialize() is called
    // This allows APP_ROOT to be set first in main.ts before fileLogger is used
  }

  /** Public path for "Open Log Directory" menu / IPC. */
  getLogsDirectoryPath(): string {
    return this.getLogsDirectory()
  }

  private getLogsDirectory(): string {
    if (this.logsDir) {
      return this.logsDir
    }
    
    // Create logs directory in project root
    // APP_ROOT is set in main.ts to point to the project root (one level up from dist-electron)
    let appRoot: string
    if (process.env.APP_ROOT) {
      appRoot = process.env.APP_ROOT
    } else {
      // Fallback: try to find project root
      // In packaged app, app.getAppPath() returns the app.asar path
      const appPath = app.getAppPath()
      if (appPath.includes('app.asar')) {
        // Packaged app - go up from app.asar
        appRoot = path.dirname(path.dirname(appPath))
      } else {
        // Development - __dirname should be dist-electron, go up one level
        appRoot = path.join(this.__dirname, '..')
      }
    }
    this.logsDir = path.join(appRoot, 'logs')
    this.ensureLogsDirectory()
    return this.logsDir
  }

  private ensureLogsDirectory() {
    try {
      const logsDir = this.getLogsDirectory()
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true })
      }
    } catch (error) {
      try {
        if (process.stderr?.write) process.stderr.write(`[FileLogger] Failed to create logs directory: ${error}\n`)
      } catch {
        // ignore
      }
    }
  }

  /**
   * Initialize log files for this session.
   * Creates two files: general (info/warn) and errors-only.
   */
  initialize() {
    try {
      const logsDir = this.getLogsDirectory()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) // Format: 2026-01-25T12-30-45
      this.sessionTimestamp = timestamp
      const iso = new Date().toISOString()

      // General log: info + warning
      const filename = `app-${timestamp}.log`
      this.logFilePath = path.join(logsDir, filename)
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' })
      this.logStream.write(`[${iso}] [INFO] [MAIN] === Application Session Started ===\n`)

      // Errors-only log
      const errorFilename = `app-${timestamp}-errors.log`
      this.errorLogFilePath = path.join(logsDir, errorFilename)
      this.errorStream = fs.createWriteStream(this.errorLogFilePath, { flags: 'a' })
      this.errorStream.write(`[${iso}] [ERROR] [MAIN] === Application Session Started (errors only) ===\n`)
      this.logStream.write(`[${iso}] [INFO] [MAIN] [FileLogger] Log files: general=${filename}, errors=${errorFilename}\n`)

      return this.logFilePath
    } catch (error) {
      try {
        const fallback = process.stderr
        if (fallback && fallback.write) fallback.write(`[FileLogger] Failed to initialize: ${error}\n`)
      } catch {
        // ignore
      }
      return null
    }
  }

  private ensureSessionInitialized() {
    if (!this.logStream || !this.errorStream || !this.sessionTimestamp) {
      this.initialize()
    }
  }

  private getOrCreateExtraStream(key: string, filename: string): fs.WriteStream | null {
    this.ensureSessionInitialized()
    const existing = this.extraStreams.get(key)
    if (existing) return existing

    try {
      const logsDir = this.getLogsDirectory()
      const fullPath = path.join(logsDir, filename)
      const stream = fs.createWriteStream(fullPath, { flags: 'a' })
      this.extraStreams.set(key, stream)

      // Write a helpful header once per extra stream
      try {
        const header = {
          startedAt: new Date().toISOString(),
          appVersion: (() => {
            try {
              return app.getVersion()
            } catch {
              return 'unknown'
            }
          })(),
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          v8: process.versions.v8,
        }
        stream.write(`=== ${key} ===\n${JSON.stringify(header, null, 2)}\n\n`)
      } catch {
        // ignore
      }

      return stream
    } catch (e) {
      try {
        this.writeLog('error', 'main', `[FileLogger] Failed to create extra stream: ${key}`, [String(e)])
      } catch {
        if (process.stderr?.write) process.stderr.write(`[FileLogger] Failed to create extra stream: ${key}\n`)
      }
      return null
    }
  }

  /**
   * Write websocket discrepancy entries to a dedicated file.
   * Intended for reverse-engineering / schema drift tracking.
   */
  writeWsDiscrepancy(source: 'chat' | 'live' | 'kick' | 'youtube' | 'twitch', kind: string, details: any = {}) {
    this.ensureSessionInitialized()
    if (!this.sessionTimestamp) return

    const stream = this.getOrCreateExtraStream('ws-discrepancies', `ws-discrepancies-${this.sessionTimestamp}.log`)
    if (!stream) return

    const timestamp = new Date().toISOString()
    const safeStringify = (obj: any) => {
      try {
        return JSON.stringify(obj, null, 2)
      } catch {
        try {
          return JSON.stringify(String(obj))
        } catch {
          return '"[unserializable]"'
        }
      }
    }

    // Keep entries readable and bounded
    const boundedDetails = (() => {
      if (details && typeof details === 'object') {
        const copy: any = { ...details }
        if (typeof copy.raw === 'string' && copy.raw.length > 5000) copy.raw = copy.raw.slice(0, 5000) + '…(truncated)'
        if (typeof copy.preview === 'string' && copy.preview.length > 5000) copy.preview = copy.preview.slice(0, 5000) + '…(truncated)'
        return copy
      }
      return details
    })()

    const line = `[${timestamp}] [${source.toUpperCase()}] [${kind}] ${safeStringify(boundedDetails)}\n`
    stream.write(line)
  }

  /**
   * Write a log entry to file(s).
   * - info, warn, debug → general log only (app-*.log)
   * - error → both general log and errors-only log (app-*-errors.log)
   */
  writeLog(level: string, process: 'main' | 'renderer', message: string, args: any[] = []) {
    this.ensureSessionInitialized()
    if (!this.logStream) return

    try {
      const timestamp = new Date().toISOString()
      let logLine = `[${timestamp}] [${level.toUpperCase()}] [${process.toUpperCase()}] ${message}`
      if (args.length > 0) {
        try {
          const argsStr = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(' ')
          logLine += ` ${argsStr}`
        } catch {
          logLine += ` [Error serializing args]`
        }
      }
      logLine += '\n'

      this.logStream.write(logLine)
      if (level === 'error' && this.errorStream) {
        this.errorStream.write(logLine)
      }
    } catch {
      try {
        const stderr = (process as unknown as NodeJS.Process).stderr
        if (stderr?.write) stderr.write('[FileLogger] Failed to write log line\n')
      } catch {
        // ignore
      }
    }
  }

  /**
   * Close all log streams
   */
  close() {
    const iso = new Date().toISOString()
    if (this.logStream) {
      this.logStream.write(`[${iso}] [INFO] [MAIN] === Application Session Ended ===\n`)
      this.logStream.end()
      this.logStream = null
    }
    if (this.errorStream) {
      this.errorStream.write(`[${iso}] [ERROR] [MAIN] === Application Session Ended ===\n`)
      this.errorStream.end()
      this.errorStream = null
    }
    this.logFilePath = null
    this.errorLogFilePath = null
    for (const stream of this.extraStreams.values()) {
      try {
        stream.end()
      } catch {
        // ignore
      }
    }
    this.extraStreams.clear()
  }

  /** Get the general log file path (info/warn). */
  getLogFilePath(): string | null {
    return this.logFilePath
  }

  /** Get the errors-only log file path. */
  getErrorLogFilePath(): string | null {
    return this.errorLogFilePath
  }
}

// Export singleton instance
export const fileLogger = new FileLogger()
