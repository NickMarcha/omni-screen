/**
 * Chat subscription registry – tracks which consumers want which chats,
 * computes union of targets for platform managers, and caches messages for new subscribers.
 */

const MAX_CACHED_MESSAGES = 1000

export interface CachedMessage {
  channel: string
  payload: unknown
  embedKey: string
  seq: number
}

export type NewSubscriptionCallback = (embedKey: string) => void

export class ChatSubscriptionRegistry {
  private consumers = new Map<string, Set<string>>()
  private cache: CachedMessage[] = []
  private seq = 0
  private onNewSubscription: NewSubscriptionCallback | null = null

  setOnNewSubscription(cb: NewSubscriptionCallback | null) {
    this.onNewSubscription = cb
  }

  /** Register or update a consumer's desired embed chat keys. */
  register(consumerId: string, embedChatKeys: string[]) {
    const keys = new Set(embedChatKeys.filter((k) => typeof k === 'string' && k.trim().length > 0))
    this.consumers.set(consumerId, keys)

    // Detect newly subscribed keys (no other consumer had them before)
    if (this.onNewSubscription) {
      const allKeysBefore = new Set<string>()
      this.consumers.forEach((s, id) => {
        if (id !== consumerId) s.forEach((k) => allKeysBefore.add(k))
      })
      keys.forEach((k) => {
        if (!allKeysBefore.has(k)) this.onNewSubscription!(k)
      })
    }
  }

  /** Unregister a consumer. */
  unregister(consumerId: string) {
    this.consumers.delete(consumerId)
  }

  /** Get union of all requested embed keys across consumers. */
  getUnionEmbedKeys(): Set<string> {
    const union = new Set<string>()
    this.consumers.forEach((keys) => keys.forEach((k) => union.add(k)))
    return union
  }

  /** Get union targets for Kick (slugs). */
  getKickSlugs(): string[] {
    const slugs: string[] = []
    this.getUnionEmbedKeys().forEach((k) => {
      if (k.startsWith('kick:')) slugs.push(k.slice('kick:'.length))
    })
    return Array.from(new Set(slugs)).sort()
  }

  /** Get union targets for YouTube (video IDs). */
  getYouTubeVideoIds(): string[] {
    const ids: string[] = []
    this.getUnionEmbedKeys().forEach((k) => {
      if (k.startsWith('youtube:')) ids.push(k.slice('youtube:'.length))
    })
    return Array.from(new Set(ids)).sort()
  }

  /** Get union targets for Twitch (channel names). */
  getTwitchChannels(): string[] {
    const chans: string[] = []
    this.getUnionEmbedKeys().forEach((k) => {
      if (k.startsWith('twitch:')) chans.push(k.slice('twitch:'.length))
    })
    return Array.from(new Set(chans)).sort()
  }

  /** Primary chat source id if any consumer wants it (e.g. "dgg" from key "primary:dgg"). */
  getPrimaryChatSourceId(): string | null {
    for (const k of this.getUnionEmbedKeys()) {
      if (k.startsWith('primary:')) return k.slice('primary:'.length)
    }
    return null
  }

  /** Add a message to the cache and evict oldest if over limit. */
  addToCache(embedKey: string, channel: string, payload: unknown) {
    this.seq++
    this.cache.push({ embedKey, channel, payload, seq: this.seq })
    while (this.cache.length > MAX_CACHED_MESSAGES) {
      this.cache.shift()
    }
  }

  /** Get cached messages for the given embed keys, in order. */
  getCachedForKeys(embedChatKeys: Set<string>): CachedMessage[] {
    if (embedChatKeys.size === 0) return []
    return this.cache.filter((m) => embedChatKeys.has(m.embedKey))
  }

  /** Check if any consumer is registered (chat pane or external window open). */
  hasConsumers(): boolean {
    return this.consumers.size > 0
  }
}
