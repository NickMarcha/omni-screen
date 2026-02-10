import type { ExtensionSettingsSection } from './types.js'
import { fileLogger } from '../fileLogger.js'

/** Full config for a chat source (WebSocket URLs, API paths, cookie domains). Provided by the extension that registers the source. */
export interface ChatSourceConfig {
  chatWssUrl: string
  chatOrigin: string
  liveWssUrl: string
  liveOrigin: string
  baseUrl: string
  apiMe: string
  apiUserinfo: string
  apiUnread: string
  apiInboxPath: string
  emotesJsonUrl: string
  emotesCssUrl: string
  flairsJsonUrl: string
  flairsCssUrl: string
  cookieDomains: string[]
  loginUrl: string
}

/** Per-source renderer config (exposed via get-app-config). Extensions set this under chatSources[id]. */
export interface ChatSourceRendererConfig {
  baseUrl: string
  loginUrl: string
  emotesJsonUrl: string
  emotesCssUrl: string
  flairsJsonUrl: string
  flairsCssUrl: string
  platformIconUrl?: string
  /** Channel label for mentions/log search (e.g. rustlesearch); set by extension. */
  mentionsChannelLabel?: string
}

/** Connection platform entry for the Connections UI (login/cookies). Provided by extensions. */
export interface ConnectionPlatform {
  id: string
  label: string
  loginUrl: string
  loginService: string
  description: string
  cookieNames: string[]
  snippet: string
  namePrefix?: string
  httpOnlyNote?: string
  manualCookieNames?: string[]
}

/** Renderer config overlay: extensions set chatSources[id] and connectionPlatforms. */
export type RendererConfigOverlay = {
  chatSources?: Record<string, ChatSourceRendererConfig>
  connectionPlatforms?: ConnectionPlatform[]
  [key: string]: unknown
}

/**
 * API passed to the extension's live message handler. The extension parses messages and uses this
 * to update main app state and send data to the renderer.
 */
export interface LiveMessageHandlerApi {
  /** Send a message to the renderer on the given IPC channel. */
  sendToRenderer(channel: string, ...args: unknown[]): void
  /** Update the current live embed keys (and optional display names). Used e.g. for "is this YouTube in the live feed?". */
  setLiveEmbeds(
    keys: Iterable<string>,
    byKey?: Map<string, { displayName?: string }> | Record<string, { displayName?: string }>
  ): void
}

/** Chat source registration: getConfig is called when the app needs to connect. */
export interface ChatSourceRegistration {
  id: string
  getConfig: () => ChatSourceConfig
  /** Optional: called for each message from the live WebSocket (URL from getConfig().liveWssUrl). */
  onLiveMessage?: (message: unknown, api: LiveMessageHandlerApi) => void
}

/** Optional APIs a chat source extension can provide (e.g. mentions search, log search). */
export interface ChatSourceApi {
  /** Fetch mentions for a username. Returns raw array; main process may add ids and cache. */
  fetchMentions?: (username: string, size: number, offset: number) => Promise<{ success: boolean; data?: unknown[]; error?: string }>
  /** Search chat logs (e.g. rustlesearch). Returns mapped messages and pagination. */
  fetchRustlesearch?: (
    filterTerms: string[],
    searchAfter?: number,
    size?: number
  ) => Promise<{ success: boolean; data?: unknown[]; searchAfter?: number; hasMore?: boolean; error?: string }>
}

const chatSourceRegistry = new Map<string, ChatSourceRegistration>()
const chatSourceApiRegistry = new Map<string, ChatSourceApi>()
let rendererConfigOverlay: RendererConfigOverlay = {}
const extensionSettingsRegistry = new Map<string, ExtensionSettingsSection[]>()

/** First registered chat source that has getConfig (used for chat/live WebSocket and connections). */
export function getPrimaryChatSource(): { id: string; config: ChatSourceConfig } | null {
  for (const [id, reg] of chatSourceRegistry) {
    if (!reg?.getConfig) continue
    try {
      const config = reg.getConfig()
      if (config?.baseUrl) return { id, config }
    } catch {
      continue
    }
  }
  return null
}

/** Live message handler from the first chat source that has liveWssUrl and onLiveMessage. */
export function getLiveMessageHandler(): ((message: unknown, api: LiveMessageHandlerApi) => void) | null {
  for (const [, reg] of chatSourceRegistry) {
    if (!reg?.onLiveMessage) continue
    try {
      const config = reg.getConfig()
      if (config?.liveWssUrl) return reg.onLiveMessage
    } catch {
      continue
    }
  }
  return null
}

export function getRendererConfigOverlay(): RendererConfigOverlay {
  return { ...rendererConfigOverlay }
}

export function hasPrimaryChatSource(): boolean {
  return getPrimaryChatSource() !== null
}

/** Get optional API (mentions, rustlesearch) for a chat source. Used by main IPC handlers. */
export function getChatSourceApi(chatSourceId: string): ChatSourceApi | undefined {
  return chatSourceApiRegistry.get(chatSourceId)
}

/** Get all extension settings schemas (for renderer to show settings UI). */
export function getExtensionSettingsSchemas(): Record<string, ExtensionSettingsSection[]> {
  const out: Record<string, ExtensionSettingsSection[]> = {}
  extensionSettingsRegistry.forEach((sections, id) => {
    out[id] = [...sections]
  })
  return out
}

/** Clear extension-provided config (call before reloading extensions). */
export function clearExtensionConfig(): void {
  chatSourceRegistry.clear()
  chatSourceApiRegistry.clear()
  rendererConfigOverlay = {}
  extensionSettingsRegistry.clear()
}

/**
 * Create the context object passed to extension's register(context).
 */
export function createExtensionContext(
  extensionPath: string,
  extensionId: string,
  _extensionName: string
): {
  registerChatSource: (id: string, registration: Omit<ChatSourceRegistration, 'id'>) => void
  registerChatSourceApi: (chatSourceId: string, api: ChatSourceApi) => void
  setRendererConfig: (partial: RendererConfigOverlay) => void
  registerSettings: (sections: ExtensionSettingsSection[]) => void
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: unknown[]) => void
  extensionPath: string
  extensionId: string
} {
  return {
    extensionPath,
    extensionId,
    log(level: 'info' | 'warn' | 'error' | 'debug', message: string, ...args: unknown[]) {
      try {
        const msg = `[ext:${extensionId}] ${message}`
        fileLogger.writeLog(level, 'main', msg, args.length ? [...args] : [])
      } catch {
        // no-op so extension logging never breaks the host
      }
    },
    registerChatSource(id: string, registration: Omit<ChatSourceRegistration, 'id'>) {
      if (id) {
        chatSourceRegistry.set(id, { id, ...registration })
      }
    },
    registerChatSourceApi(chatSourceId: string, api: ChatSourceApi) {
      if (chatSourceId && api) chatSourceApiRegistry.set(chatSourceId, api)
    },
    setRendererConfig(partial: RendererConfigOverlay) {
      rendererConfigOverlay = { ...rendererConfigOverlay, ...partial }
    },
    registerSettings(sections: ExtensionSettingsSection[]) {
      if (extensionId && Array.isArray(sections) && sections.length > 0) {
        extensionSettingsRegistry.set(extensionId, sections)
      }
    },
  }
}
