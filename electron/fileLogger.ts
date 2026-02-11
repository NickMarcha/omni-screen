import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'

export type LogLevel = 'normal' | 'verbose'

/** Message prefixes that are only logged when log level is 'verbose'. */
const VERBOSE_MESSAGE_PREFIXES = [
  '[OmniScreen:bookmarked]',
  '[CombinedChat] POLL',
  '[CombinedChat] Vote',
  '[CombinedChat] Poll vote',
  '[Chat WS] POLL',
  '[Chat WS] Vote',
  '[Main Process] Poll vote cast',
  '[send-whisper] Attempt',
  '[send-whisper] OK (WebSocket)',
  '[protocol] second-instance',
  '[protocol] launch URL',
  '[protocol] result sent',
  '[Kick] send_message attempt',
  '[Kick] send_message response',
  '[Extensions] Loaded',
  'combinedAvailableEmbeds',
  'dockItems',
  'YT result',
  'Kick result',
  'YT poll done',
  'Kick poll done',
  '[ChatWebSocket] Disconnected',
]

class FileLogger {
  private logFilePath: string | null = null
  private errorLogFilePath: string | null = null
  private logStream: fs.WriteStream | null = null
  private errorStream: fs.WriteStream | null = null
  private logsDir: string | null = null
  private sessionTimestamp: string | null = null
  private extraStreams: Map<string, fs.WriteStream> = new Map()
  private __dirname = path.dirname(fileURLToPath(import.meta.url))
  private _logLevel: LogLevel = 'normal'
  private _logLevelLoaded = false

  constructor() {
    // Logs directory will be resolved lazily when initialize() is called
    // This allows APP_ROOT to be set first in main.ts before fileLogger is used
  }

  /** Public path for "Open Log Directory" menu / IPC. */
  getLogsDirectoryPath(): string {
    return this.getLogsDirectory()
  }

  private getLogLevelPath(): string {
    try {
      return path.join(app.getPath('userData'), 'log-level.json')
    } catch {
      return ''
    }
  }

  private loadLogLevel(): void {
    if (this._logLevelLoaded) return
    this._logLevelLoaded = true
    try {
      const p = this.getLogLevelPath()
      if (!p) return
      const raw = fs.readFileSync(p, 'utf8')
      const data = JSON.parse(raw) as { logLevel?: string }
      if (data.logLevel === 'verbose' || data.logLevel === 'normal') {
        this._logLevel = data.logLevel
      }
    } catch {
      // keep default 'normal'
    }
  }

  getLogLevel(): LogLevel {
    this.loadLogLevel()
    return this._logLevel
  }

  setLogLevel(level: LogLevel): void {
    this._logLevelLoaded = true
    this._logLevel = level
    try {
      const p = this.getLogLevelPath()
      if (p) fs.writeFileSync(p, JSON.stringify({ logLevel: level }), 'utf8')
    } catch {
      // ignore
    }
  }

  private isVerboseMessage(level: string, message: string): boolean {
    if (level !== 'info' && level !== 'debug') return false
    const msg = String(message)
    return VERBOSE_MESSAGE_PREFIXES.some((prefix) => msg.includes(prefix))
  }

  private getLogsDirectory(): string {
    if (this.logsDir) {
      return this.logsDir
    }

    // Use user data directory when packaged (AppImage/installer) so we never write into read-only app.asar
    const appPath = app.getAppPath()
    if (appPath.includes('app.asar')) {
      this.logsDir = path.join(app.getPath('userData'), 'logs')
      this.ensureLogsDirectory()
      return this.logsDir
    }

    // Development: use project root (APP_ROOT set in main.ts, or one level up from dist-electron)
    let appRoot: string
    if (process.env.APP_ROOT) {
      appRoot = process.env.APP_ROOT
    } else {
      appRoot = path.join(this.__dirname, '..')
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
   * Write session header (platform/env info, same as title bar "Copy system info") at start of main log.
   */
  private writeSessionHeader(iso: string) {
    if (!this.logStream) return
    try {
      const execPath = process.execPath || app.getPath('exe')
      const lines = [
        '=== Session (equivalent to title bar Copy system info) ===',
        `App: Omni Screen ${app.getVersion()}`,
        `Packaged: ${app.isPackaged}`,
        `Platform: ${process.platform}`,
        `Arch: ${process.arch}`,
        `Exec path: ${execPath}`,
        `Electron: ${process.versions.electron}`,
        `Chrome: ${process.versions.chrome}`,
        `Node: ${process.versions.node}`,
      ]
      for (const line of lines) {
        this.logStream.write(`[${iso}] [INFO] [MAIN] [Session] ${line}\n`)
      }
    } catch {
      // ignore
    }
  }

  /**
   * Initialize log files for this session.
   * Creates only the general log file. Errors-only file is created on first error (like ws-discrepancies).
   */
  initialize() {
    try {
      const logsDir = this.getLogsDirectory()
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) // Format: 2026-01-25T12-30-45
      this.sessionTimestamp = timestamp
      const iso = new Date().toISOString()

      // General log: info + warning (always created)
      const filename = `app-${timestamp}.log`
      this.logFilePath = path.join(logsDir, filename)
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' })
      this.logStream.write(`[${iso}] [INFO] [MAIN] === Application Session Started ===\n`)
      this.logStream.write(`[${iso}] [INFO] [MAIN] [FileLogger] Log file: ${filename} (errors file created only if an error is logged)\n`)
      this.writeSessionHeader(iso)

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
    if (!this.logStream || !this.sessionTimestamp) {
      this.initialize()
    }
  }

  /** Create the errors-only log file on first use (like ws-discrepancies). */
  private getOrCreateErrorStream(): fs.WriteStream | null {
    this.ensureSessionInitialized()
    if (this.errorStream) return this.errorStream
    if (!this.sessionTimestamp) return null

    try {
      const logsDir = this.getLogsDirectory()
      const errorFilename = `app-${this.sessionTimestamp}-errors.log`
      this.errorLogFilePath = path.join(logsDir, errorFilename)
      this.errorStream = fs.createWriteStream(this.errorLogFilePath, { flags: 'a' })
      const iso = new Date().toISOString()
      this.errorStream.write(`[${iso}] [ERROR] [MAIN] === Application Session (errors only) ===\n`)
      return this.errorStream
    } catch (e) {
      try {
        if (process.stderr?.write) process.stderr.write(`[FileLogger] Failed to create errors log: ${e}\n`)
      } catch {
        // ignore
      }
      return null
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
   * Only for: new unknown message types, parse errors, malformed/unexpected message shapes.
   * Do not use for lifecycle (connect/disconnect), operational success, or routine errors; use writeLog instead.
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
   * Write a log entry to file(s). One line per entry for easy searching (args serialized as single-line JSON).
   * - info, warn, debug → general log only (app-*.log)
   * - error → both general log and errors-only log (app-*-errors.log)
   */
  writeLog(level: string, process: 'main' | 'renderer', message: string, args: any[] = []) {
    this.loadLogLevel()
    if (this._logLevel === 'normal' && this.isVerboseMessage(level, message)) return

    this.ensureSessionInitialized()
    if (!this.logStream) return

    try {
      const timestamp = new Date().toISOString()
      let logLine = `[${timestamp}] [${level.toUpperCase()}] [${process.toUpperCase()}] ${message}`
      if (args.length > 0) {
        try {
          const argsStr = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
          ).join(' ')
          // Keep one line per entry: collapse newlines (do not collapse spaces inside JSON)
          const oneLine = argsStr.replace(/\n+/g, ' ').trim()
          if (oneLine) logLine += ` ${oneLine}`
        } catch {
          logLine += ` [Error serializing args]`
        }
      }
      logLine += '\n'

      this.logStream.write(logLine)
      if (level === 'error') {
        const errStream = this.getOrCreateErrorStream()
        if (errStream) errStream.write(logLine)
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
      this.errorLogFilePath = null
    }
    this.logFilePath = null
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
