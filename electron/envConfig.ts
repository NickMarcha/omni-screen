/**
 * DGG and platform URLs from environment variables.
 * Defaults match production (destiny.gg). Override in .env or .env.development.
 */

export interface DggConfig {
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
  /** Domains to collect cookies for (e.g. www.destiny.gg, chat.destiny.gg). */
  cookieDomains: string[]
  loginUrl: string
}

export interface PlatformUrls {
  dgg: string
  destiny: string
  youtube: string
  kick: string
  twitch: string
  twitter: string
  reddit: string
}

const defaultDgg: DggConfig = {
  chatWssUrl: 'wss://chat.destiny.gg/ws',
  chatOrigin: 'https://www.destiny.gg',
  liveWssUrl: 'wss://live.destiny.gg/',
  liveOrigin: 'https://www.destiny.gg',
  baseUrl: 'https://www.destiny.gg',
  apiMe: '/api/chat/me',
  apiUserinfo: '/api/userinfo',
  apiUnread: '/api/messages/unread',
  apiInboxPath: '/api/messages/usr',
  emotesJsonUrl: 'https://cdn.destiny.gg/emotes/emotes.json',
  emotesCssUrl: 'https://cdn.destiny.gg/emotes/emotes.css',
  flairsJsonUrl: 'https://cdn.destiny.gg/flairs/flairs.json',
  flairsCssUrl: 'https://cdn.destiny.gg/flairs/flairs.css',
  cookieDomains: ['www.destiny.gg', 'chat.destiny.gg', '.destiny.gg'],
  loginUrl: 'https://www.destiny.gg/login',
}

const defaultPlatformUrls: PlatformUrls = {
  dgg: 'https://www.destiny.gg',
  destiny: 'https://www.destiny.gg',
  youtube: 'https://www.youtube.com',
  kick: 'https://kick.com',
  twitch: 'https://www.twitch.tv',
  twitter: 'https://twitter.com',
  reddit: 'https://www.reddit.com',
}

function getEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined
}

export function getDggConfig(): DggConfig {
  const baseUrl = getEnv('DGG_BASE_URL') ?? defaultDgg.baseUrl
  const chatOrigin = getEnv('DGG_CHAT_ORIGIN') ?? getEnv('DGG_WSS_ORIGIN') ?? baseUrl
  const liveOrigin = getEnv('DGG_LIVE_ORIGIN') ?? baseUrl

  const cookieDomainsStr = getEnv('DGG_COOKIE_DOMAINS')
  const cookieDomains = cookieDomainsStr
    ? cookieDomainsStr.split(',').map((d) => d.trim()).filter(Boolean)
    : defaultDgg.cookieDomains

  return {
    chatWssUrl: getEnv('DGG_CHAT_WSS_URL') ?? defaultDgg.chatWssUrl,
    chatOrigin,
    liveWssUrl: getEnv('DGG_LIVE_WSS_URL') ?? defaultDgg.liveWssUrl,
    liveOrigin,
    baseUrl,
    apiMe: getEnv('DGG_API_ME') ?? defaultDgg.apiMe,
    apiUserinfo: getEnv('DGG_API_USERINFO') ?? defaultDgg.apiUserinfo,
    apiUnread: getEnv('DGG_API_UNREAD') ?? defaultDgg.apiUnread,
    apiInboxPath: getEnv('DGG_API_INBOX_PATH') ?? defaultDgg.apiInboxPath,
    emotesJsonUrl: getEnv('DGG_EMOTES_JSON_URL') ?? defaultDgg.emotesJsonUrl,
    emotesCssUrl: getEnv('DGG_EMOTES_CSS_URL') ?? defaultDgg.emotesCssUrl,
    flairsJsonUrl: getEnv('DGG_FLAIRS_JSON_URL') ?? defaultDgg.flairsJsonUrl,
    flairsCssUrl: getEnv('DGG_FLAIRS_CSS_URL') ?? defaultDgg.flairsCssUrl,
    cookieDomains,
    loginUrl: getEnv('DGG_LOGIN_URL') ?? `${baseUrl}/login`,
  }
}

export function getPlatformUrls(): PlatformUrls {
  const dgg = getDggConfig()
  return {
    dgg: dgg.baseUrl,
    destiny: dgg.baseUrl,
    youtube: getEnv('YOUTUBE_BASE_URL') ?? defaultPlatformUrls.youtube,
    kick: getEnv('KICK_BASE_URL') ?? defaultPlatformUrls.kick,
    twitch: getEnv('TWITCH_BASE_URL') ?? defaultPlatformUrls.twitch,
    twitter: getEnv('TWITTER_BASE_URL') ?? defaultPlatformUrls.twitter,
    reddit: getEnv('REDDIT_BASE_URL') ?? defaultPlatformUrls.reddit,
  }
}
