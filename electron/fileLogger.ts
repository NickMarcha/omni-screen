import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'

class FileLogger {
  private logFilePath: string | null = null
  private logStream: fs.WriteStream | null = null
  private logsDir: string | null = null
  private sessionTimestamp: string | null = null
  private extraStreams: Map<string, fs.WriteStream> = new Map()
  private __dirname = path.dirname(fileURLToPath(import.meta.url))

  constructor() {
    // Logs directory will be resolved lazily when initialize() is called
    // This allows APP_ROOT to be set first in main.ts before fileLogger is used
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
      console.error('Failed to create logs directory:', error)
    }
  }

  /**
   * Initialize log file for this session
   * Creates a new log file with timestamp
   */
  initialize() {
    try {
      // Ensure directory exists and get the correct path
      const logsDir = this.getLogsDirectory()
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) // Format: 2026-01-25T12-30-45
      this.sessionTimestamp = timestamp
      const filename = `app-${timestamp}.log`
      this.logFilePath = path.join(logsDir, filename)
      
      // Create write stream (append mode)
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' })
      
      // Write session start marker
      const startMessage = `=== Application Session Started ===\n`
      this.logStream.write(`[${new Date().toISOString()}] [INFO] [MAIN] ${startMessage}`)
      
      console.log(`[FileLogger] Log file created: ${this.logFilePath}`)
      
      return this.logFilePath
    } catch (error) {
      console.error('Failed to initialize file logger:', error)
      return null
    }
  }

  private ensureSessionInitialized() {
    if (!this.logStream || !this.sessionTimestamp) {
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
      console.error('[FileLogger] Failed to create extra stream:', key, e)
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
   * Write a log entry to file
   */
  writeLog(level: string, process: 'main' | 'renderer', message: string, args: any[] = []) {
    if (!this.logStream) {
      // Try to initialize if not already done
      this.initialize()
      if (!this.logStream) return
    }

    try {
      const timestamp = new Date().toISOString()

      // Format log line
      let logLine = `[${timestamp}] [${level.toUpperCase()}] [${process.toUpperCase()}] ${message}`
      
      // Add arguments if present
      if (args.length > 0) {
        try {
          const argsStr = args.map(arg => {
            if (typeof arg === 'object') {
              return JSON.stringify(arg, null, 2)
            }
            return String(arg)
          }).join(' ')
          logLine += ` ${argsStr}`
        } catch (e) {
          logLine += ` [Error serializing args: ${e}]`
        }
      }
      
      logLine += '\n'
      
      this.logStream.write(logLine)
    } catch (error) {
      console.error('Failed to write to log file:', error)
    }
  }

  /**
   * Close the log stream
   */
  close() {
    if (this.logStream) {
      this.writeLog('info', 'main', '=== Application Session Ended ===', [])
      this.logStream.end()
      this.logStream = null
    }

    // Close extra streams
    for (const stream of this.extraStreams.values()) {
      try {
        stream.end()
      } catch {
        // ignore
      }
    }
    this.extraStreams.clear()
  }

  /**
   * Get the current log file path
   */
  getLogFilePath(): string | null {
    return this.logFilePath
  }
}

// Export singleton instance
export const fileLogger = new FileLogger()
