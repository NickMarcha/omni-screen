// Centralized logging system with configurable log types

type LogType = 'theme' | 'embed' | 'settings' | 'api' | 'debug' | 'error' | 'warn' | 'info'

interface LogConfig {
  enabled: boolean
  types: Set<LogType>
}

class Logger {
  private config: LogConfig = {
    enabled: true, // Set to false to disable all logs
    types: new Set<LogType>(['error', 'warn', 'theme', 'settings']), // Default enabled log types
  }

  /**
   * Enable or disable all logging
   */
  setEnabled(enabled: boolean) {
    this.config.enabled = enabled
  }

  /**
   * Enable a specific log type
   */
  enableType(type: LogType) {
    this.config.types.add(type)
  }

  /**
   * Disable a specific log type
   */
  disableType(type: LogType) {
    this.config.types.delete(type)
  }

  /**
   * Enable multiple log types at once
   */
  enableTypes(types: LogType[]) {
    types.forEach(type => this.config.types.add(type))
  }

  /**
   * Disable multiple log types at once
   */
  disableTypes(types: LogType[]) {
    types.forEach(type => this.config.types.delete(type))
  }

  /**
   * Check if a log type is enabled
   */
  isEnabled(type: LogType): boolean {
    return this.config.enabled && this.config.types.has(type)
  }

  /**
   * Log a message with a specific type
   */
  log(type: LogType, message: string, ...args: any[]) {
    if (!this.isEnabled(type)) return

    const prefix = `[${type.toUpperCase()}]`
    console.log(prefix, message, ...args)
  }

  /**
   * Convenience methods for each log type
   */
  theme(message: string, ...args: any[]) {
    this.log('theme', message, ...args)
  }

  embed(message: string, ...args: any[]) {
    this.log('embed', message, ...args)
  }

  settings(message: string, ...args: any[]) {
    this.log('settings', message, ...args)
  }

  api(message: string, ...args: any[]) {
    this.log('api', message, ...args)
  }

  debug(message: string, ...args: any[]) {
    this.log('debug', message, ...args)
  }

  error(message: string, ...args: any[]) {
    this.log('error', message, ...args)
  }

  warn(message: string, ...args: any[]) {
    this.log('warn', message, ...args)
  }

  info(message: string, ...args: any[]) {
    this.log('info', message, ...args)
  }
}

// Export singleton instance
export const logger = new Logger()

// Export types for use in other files
export type { LogType }
