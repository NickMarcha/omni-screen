import fs from 'fs'
import path from 'path'
import { app } from 'electron'

interface CacheEntry {
  messageIds: string[]
  timestamp: number
  queryKey: string
}

interface MessageData {
  id: string
  date: number
  text: string
  nick: string
  flairs: string
  matchedTerms?: string[]
  searchAfter?: number
  isStreaming?: boolean
}

class MentionCache {
  private cacheDir: string | null = null
  private queryCachePath: string | null = null
  private messagesCachePath: string | null = null
  private queryCache: Map<string, CacheEntry> = new Map()
  private messagesCache: Map<string, MessageData> = new Map()
  private initialized = false

  private getCachePaths() {
    if (!this.cacheDir) {
      // Use app.getPath('userData') for persistent storage
      // This is typically: %APPDATA%/omni-screen on Windows
      const userDataPath = app.getPath('userData')
      this.cacheDir = path.join(userDataPath, 'cache')
      this.queryCachePath = path.join(this.cacheDir, 'queries.json')
      this.messagesCachePath = path.join(this.cacheDir, 'messages.json')
    }
    return {
      cacheDir: this.cacheDir,
      queryCachePath: this.queryCachePath!,
      messagesCachePath: this.messagesCachePath!
    }
  }

  private ensureCacheDir() {
    const { cacheDir } = this.getCachePaths()
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true })
    }
  }

  private loadCache() {
    if (this.initialized) return

    const { queryCachePath, messagesCachePath } = this.getCachePaths()
    this.ensureCacheDir()

    // Load query cache
    try {
      if (fs.existsSync(queryCachePath)) {
        const data = fs.readFileSync(queryCachePath, 'utf-8')
        const parsed = JSON.parse(data)
        this.queryCache = new Map(Object.entries(parsed))
        console.log(`[MentionCache] Loaded ${this.queryCache.size} query cache entries`)
      }
    } catch (error) {
      console.error('[MentionCache] Error loading query cache:', error)
      this.queryCache = new Map()
    }

    // Load messages cache
    try {
      if (fs.existsSync(messagesCachePath)) {
        const data = fs.readFileSync(messagesCachePath, 'utf-8')
        const parsed = JSON.parse(data)
        this.messagesCache = new Map(Object.entries(parsed))
        console.log(`[MentionCache] Loaded ${this.messagesCache.size} message cache entries`)
      }
    } catch (error) {
      console.error('[MentionCache] Error loading messages cache:', error)
      this.messagesCache = new Map()
    }

    this.initialized = true
  }

  private saveQueryCache() {
    try {
      const { queryCachePath } = this.getCachePaths()
      this.ensureCacheDir()
      const data = Object.fromEntries(this.queryCache)
      fs.writeFileSync(queryCachePath, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error('[MentionCache] Error saving query cache:', error)
    }
  }

  private saveMessagesCache() {
    try {
      const { messagesCachePath } = this.getCachePaths()
      this.ensureCacheDir()
      const data = Object.fromEntries(this.messagesCache)
      fs.writeFileSync(messagesCachePath, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error('[MentionCache] Error saving messages cache:', error)
    }
  }

  /**
   * Generate a cache key from query parameters
   */
  private getQueryKey(username: string, size: number, offset: number): string {
    return `${username}:${size}:${offset}`
  }

  /**
   * Check if we have cached results for a query
   * Returns cached message IDs if found, null otherwise
   */
  getCachedQuery(username: string, size: number, offset: number): string[] | null {
    this.loadCache()
    const queryKey = this.getQueryKey(username, size, offset)
    const entry = this.queryCache.get(queryKey)

    if (!entry) {
      return null
    }

    // Check if cache is still valid (24 hour TTL)
    const now = Date.now()
    const cacheAge = now - entry.timestamp
    const ttl = 24 * 60 * 60 * 1000 // 24 hours

    if (cacheAge > ttl) {
      // Cache expired, remove it
      this.queryCache.delete(queryKey)
      this.saveQueryCache()
      return null
    }

    // Verify all message IDs still exist in messages cache
    const validIds = entry.messageIds.filter(id => this.messagesCache.has(id))
    
    if (validIds.length !== entry.messageIds.length) {
      // Some messages were removed, update cache
      entry.messageIds = validIds
      this.queryCache.set(queryKey, entry)
      this.saveQueryCache()
    }

    return validIds.length > 0 ? validIds : null
  }

  /**
   * Get cached messages by their IDs
   */
  getCachedMessages(messageIds: string[]): MessageData[] {
    this.loadCache()
    const messages: MessageData[] = []
    
    for (const id of messageIds) {
      const message = this.messagesCache.get(id)
      if (message) {
        messages.push(message)
      }
    }

    return messages
  }

  /**
   * Store query results in cache
   */
  storeQuery(username: string, size: number, offset: number, messages: MessageData[]) {
    this.loadCache()
    const queryKey = this.getQueryKey(username, size, offset)
    
    // Store messages in messages cache
    for (const message of messages) {
      this.messagesCache.set(message.id, message)
    }

    // Store query mapping
    const messageIds = messages.map(m => m.id)
    this.queryCache.set(queryKey, {
      messageIds,
      timestamp: Date.now(),
      queryKey
    })

    // Save both caches
    this.saveQueryCache()
    this.saveMessagesCache()

    console.log(`[MentionCache] Stored query ${queryKey} with ${messages.length} messages`)
  }

  /**
   * Clear expired cache entries (older than TTL)
   */
  clearExpired() {
    this.loadCache()
    const now = Date.now()
    const ttl = 24 * 60 * 60 * 1000 // 24 hours
    let cleared = 0

    for (const [key, entry] of this.queryCache.entries()) {
      if (now - entry.timestamp > ttl) {
        this.queryCache.delete(key)
        cleared++
      }
    }

    if (cleared > 0) {
      this.saveQueryCache()
      console.log(`[MentionCache] Cleared ${cleared} expired query entries`)
    }
  }

  /**
   * Clear all cache
   */
  clearAll() {
    this.queryCache.clear()
    this.messagesCache.clear()
    
    try {
      const { queryCachePath, messagesCachePath } = this.getCachePaths()
      if (fs.existsSync(queryCachePath)) {
        fs.unlinkSync(queryCachePath)
      }
      if (fs.existsSync(messagesCachePath)) {
        fs.unlinkSync(messagesCachePath)
      }
      console.log('[MentionCache] Cleared all cache')
    } catch (error) {
      console.error('[MentionCache] Error clearing cache files:', error)
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    this.loadCache()
    const { cacheDir } = this.getCachePaths()
    return {
      queryEntries: this.queryCache.size,
      messageEntries: this.messagesCache.size,
      cacheDir: cacheDir
    }
  }
}

// Export singleton instance
export const mentionCache = new MentionCache()
