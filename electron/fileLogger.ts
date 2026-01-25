import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { fileURLToPath } from 'node:url'

class FileLogger {
  private logFilePath: string | null = null
  private logStream: fs.WriteStream | null = null
  private logsDir: string | null = null
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
