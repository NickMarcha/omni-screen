/**
 * Chat embed URL utilities – parse and build URL params for combined chat (OBS, popout, shareable links).
 * Fallback: URL param → storage → app default.
 */

export type CombinedSortMode = 'timestamp' | 'arrival'

export interface ChatEmbedConfig {
  selectedEmbedChatKeys: string[]
  selectedEmbedKeys: string[]
  chatTransparent?: boolean
  maxLines?: number
  maxLinesScroll?: number
  showTimestamps?: boolean
  showLabels?: boolean
  showPlatformIcons?: boolean
  sortMode?: CombinedSortMode
  highlightTerms?: string[]
  pauseEmoteOffscreen?: boolean
  showPrimaryChatFlairs?: boolean
  includePrimaryChat?: boolean
  chatBackgroundColor?: string
  chatBackgroundOpacity?: number
  chatPanelOpacity?: number
}

const DEFAULT_MAX_LINES = 70
const DEFAULT_MAX_LINES_SCROLL = 5000
const DEFAULT_CHAT_PANEL_OPACITY = 0.85
const DEFAULT_CHAT_BACKGROUND_OPACITY = 1

function canonicalEmbedKey(key: string): string {
  const k = String(key || '')
  const idx = k.indexOf(':')
  if (idx <= 0) return k
  const platform = k.slice(0, idx).toLowerCase()
  const id = k.slice(idx + 1)
  if (!platform || !id) return k
  const idNorm = platform === 'youtube' ? id : id.toLowerCase()
  return `${platform}:${idNorm}`
}

/** Parse URL search params into ChatEmbedConfig. Returns partial config; omitted params are undefined. */
export function parseChatEmbedParams(searchParams: URLSearchParams): Partial<ChatEmbedConfig> {
  const config: Partial<ChatEmbedConfig> = {}

  const embedChatsRaw = searchParams.get('embedChats')
  if (embedChatsRaw) {
    try {
      const parsed = JSON.parse(decodeURIComponent(embedChatsRaw)) as {
        selectedEmbedChatKeys?: unknown[]
        selectedEmbedKeys?: unknown[]
      }
      const chatArr = Array.isArray(parsed?.selectedEmbedChatKeys)
        ? parsed.selectedEmbedChatKeys.filter((x): x is string => typeof x === 'string').map(canonicalEmbedKey)
        : []
      const embedArr = Array.isArray(parsed?.selectedEmbedKeys)
        ? parsed.selectedEmbedKeys.filter((x): x is string => typeof x === 'string').map(canonicalEmbedKey)
        : []
      config.selectedEmbedChatKeys = chatArr
      config.selectedEmbedKeys = embedArr
    } catch {
      /* ignore */
    }
  }

  const chatTransparent = searchParams.get('chatTransparent')
  if (chatTransparent === 'true' || chatTransparent === 'false') {
    config.chatTransparent = chatTransparent === 'true'
  }

  const maxLines = Number(searchParams.get('maxLines'))
  if (Number.isFinite(maxLines) && maxLines >= 50) config.maxLines = Math.floor(maxLines)

  const maxLinesScroll = Number(searchParams.get('maxLinesScroll'))
  if (Number.isFinite(maxLinesScroll) && maxLinesScroll >= 50) config.maxLinesScroll = Math.floor(maxLinesScroll)

  const showTimestamps = searchParams.get('showTimestamps')
  if (showTimestamps === '1' || showTimestamps === 'true' || showTimestamps === '0' || showTimestamps === 'false') {
    config.showTimestamps = showTimestamps === '1' || showTimestamps === 'true'
  }

  const showLabels = searchParams.get('showLabels')
  if (showLabels === '1' || showLabels === 'true' || showLabels === '0' || showLabels === 'false') {
    config.showLabels = showLabels === '1' || showLabels === 'true'
  }

  const showPlatformIcons = searchParams.get('showPlatformIcons')
  if (showPlatformIcons === '1' || showPlatformIcons === 'true' || showPlatformIcons === '0' || showPlatformIcons === 'false') {
    config.showPlatformIcons = showPlatformIcons === '1' || showPlatformIcons === 'true'
  }

  const sortMode = searchParams.get('sortMode')
  if (sortMode === 'timestamp' || sortMode === 'arrival') config.sortMode = sortMode

  const highlightTermsRaw = searchParams.get('highlightTerms')
  if (highlightTermsRaw) {
    try {
      const arr = JSON.parse(decodeURIComponent(highlightTermsRaw))
      config.highlightTerms = Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()) : []
    } catch {
      /* ignore */
    }
  }

  const pauseEmoteOffscreen = searchParams.get('pauseEmoteOffscreen')
  if (pauseEmoteOffscreen === '1' || pauseEmoteOffscreen === 'true' || pauseEmoteOffscreen === '0' || pauseEmoteOffscreen === 'false') {
    config.pauseEmoteOffscreen = pauseEmoteOffscreen === '1' || pauseEmoteOffscreen === 'true'
  }

  const showPrimaryChatFlairs = searchParams.get('showPrimaryChatFlairs')
  if (showPrimaryChatFlairs === '1' || showPrimaryChatFlairs === 'true' || showPrimaryChatFlairs === '0' || showPrimaryChatFlairs === 'false') {
    config.showPrimaryChatFlairs = showPrimaryChatFlairs === '1' || showPrimaryChatFlairs === 'true'
  }

  const includePrimaryChat = searchParams.get('includePrimaryChat')
  if (includePrimaryChat === '1' || includePrimaryChat === 'true' || includePrimaryChat === '0' || includePrimaryChat === 'false') {
    config.includePrimaryChat = includePrimaryChat === '1' || includePrimaryChat === 'true'
  }

  const chatBackgroundColor = searchParams.get('chatBackgroundColor')
  if (chatBackgroundColor && chatBackgroundColor.trim()) config.chatBackgroundColor = chatBackgroundColor.trim()

  const chatBackgroundOpacity = Number(searchParams.get('chatBackgroundOpacity'))
  if (Number.isFinite(chatBackgroundOpacity) && chatBackgroundOpacity >= 0 && chatBackgroundOpacity <= 1) {
    config.chatBackgroundOpacity = chatBackgroundOpacity
  }

  const chatPanelOpacity = Number(searchParams.get('chatPanelOpacity'))
  if (Number.isFinite(chatPanelOpacity) && chatPanelOpacity >= 0 && chatPanelOpacity <= 1) {
    config.chatPanelOpacity = chatPanelOpacity
  }

  return config
}

/** Merge URL config with storage defaults. URL takes precedence when defined. */
export function mergeWithStorageDefaults(
  urlConfig: Partial<ChatEmbedConfig>,
  getStorage: (key: string) => string | null
): ChatEmbedConfig {
  const numFromStorage = (key: string, defaultVal: number, min = 0) => {
    const saved = Number(getStorage(key))
    if (!Number.isFinite(saved)) return defaultVal
    return saved >= min ? saved : defaultVal
  }
  const boolFromStorage = (key: string, defaultVal: boolean) => {
    const saved = getStorage(key)
    if (saved === '0' || saved === 'false') return false
    if (saved === '1' || saved === 'true') return true
    return defaultVal
  }

  return {
    selectedEmbedChatKeys: urlConfig.selectedEmbedChatKeys ?? [],
    selectedEmbedKeys: urlConfig.selectedEmbedKeys ?? [],
    chatTransparent: urlConfig.chatTransparent ?? boolFromStorage('chat-window-transparent-background', false),
    maxLines: urlConfig.maxLines ?? numFromStorage('omni-screen:combined-max-lines', DEFAULT_MAX_LINES, 50),
    maxLinesScroll: urlConfig.maxLinesScroll ?? numFromStorage('omni-screen:combined-max-lines-scroll', DEFAULT_MAX_LINES_SCROLL, 50),
    showTimestamps: urlConfig.showTimestamps ?? boolFromStorage('omni-screen:combined-show-timestamps', true),
    showLabels: urlConfig.showLabels ?? boolFromStorage('omni-screen:combined-show-labels', true),
    showPlatformIcons: urlConfig.showPlatformIcons ?? boolFromStorage('omni-screen:combined-show-platform-icons', false),
    sortMode: urlConfig.sortMode ?? (getStorage('omni-screen:combined-sort-mode') === 'timestamp' ? 'timestamp' : 'arrival'),
    highlightTerms: urlConfig.highlightTerms ?? (() => {
      try {
        const raw = getStorage('omni-screen:combined-highlight-terms')
        if (!raw) return []
        const arr = JSON.parse(raw)
        return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : []
      } catch {
        return []
      }
    })(),
    pauseEmoteOffscreen: urlConfig.pauseEmoteOffscreen ?? boolFromStorage('omni-screen:combined-pause-emote-offscreen', false),
    showPrimaryChatFlairs: urlConfig.showPrimaryChatFlairs ?? true,
    includePrimaryChat: urlConfig.includePrimaryChat ?? true,
    chatBackgroundColor: urlConfig.chatBackgroundColor,
    chatBackgroundOpacity: urlConfig.chatBackgroundOpacity ?? numFromStorage('omni-screen:combined-chat-background-opacity', DEFAULT_CHAT_BACKGROUND_OPACITY),
    chatPanelOpacity: urlConfig.chatPanelOpacity ?? numFromStorage('omni-screen:combined-chat-overlay-opacity', DEFAULT_CHAT_PANEL_OPACITY),
  }
}

/** Build query string from config. Only includes params that differ from defaults or are explicitly set. */
export function buildChatEmbedQuery(config: Partial<ChatEmbedConfig>): string {
  const params = new URLSearchParams()

  if (config.selectedEmbedChatKeys && config.selectedEmbedChatKeys.length > 0) {
    const embedChats = {
      selectedEmbedChatKeys: config.selectedEmbedChatKeys,
      selectedEmbedKeys: config.selectedEmbedKeys ?? [],
    }
    params.set('embedChats', encodeURIComponent(JSON.stringify(embedChats)))
  }

  if (typeof config.chatTransparent === 'boolean') params.set('chatTransparent', String(config.chatTransparent))
  if (typeof config.maxLines === 'number' && config.maxLines !== DEFAULT_MAX_LINES) params.set('maxLines', String(config.maxLines))
  if (typeof config.maxLinesScroll === 'number' && config.maxLinesScroll !== DEFAULT_MAX_LINES_SCROLL) params.set('maxLinesScroll', String(config.maxLinesScroll))
  if (typeof config.showTimestamps === 'boolean') params.set('showTimestamps', config.showTimestamps ? '1' : '0')
  if (typeof config.showLabels === 'boolean') params.set('showLabels', config.showLabels ? '1' : '0')
  if (typeof config.showPlatformIcons === 'boolean') params.set('showPlatformIcons', config.showPlatformIcons ? '1' : '0')
  if (config.sortMode) params.set('sortMode', config.sortMode)
  if (config.highlightTerms && config.highlightTerms.length > 0) params.set('highlightTerms', encodeURIComponent(JSON.stringify(config.highlightTerms)))
  if (typeof config.pauseEmoteOffscreen === 'boolean') params.set('pauseEmoteOffscreen', config.pauseEmoteOffscreen ? '1' : '0')
  if (typeof config.showPrimaryChatFlairs === 'boolean') params.set('showPrimaryChatFlairs', config.showPrimaryChatFlairs ? '1' : '0')
  if (typeof config.includePrimaryChat === 'boolean') params.set('includePrimaryChat', config.includePrimaryChat ? '1' : '0')
  if (config.chatBackgroundColor) params.set('chatBackgroundColor', config.chatBackgroundColor)
  if (typeof config.chatBackgroundOpacity === 'number') params.set('chatBackgroundOpacity', String(config.chatBackgroundOpacity))
  if (typeof config.chatPanelOpacity === 'number') params.set('chatPanelOpacity', String(config.chatPanelOpacity))

  const q = params.toString()
  return q
}

/** Build query string with leading ? for full URLs. */
export function buildChatEmbedQueryString(config: Partial<ChatEmbedConfig>): string {
  const q = buildChatEmbedQuery(config)
  return q ? `?${q}` : ''
}

/** Build full embed URL (origin + path + hash + query). */
export function buildChatEmbedUrl(config: Partial<ChatEmbedConfig>, baseUrl?: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : (baseUrl ?? 'http://127.0.0.1:5173')
  const path = typeof window !== 'undefined' ? window.location.pathname || '/' : '/'
  const query = buildChatEmbedQueryString(config)
  return `${origin}${path}${query}#chat-window`
}
