/**
 * Platform base URLs from environment variables.
 * Redacted; chat source platforms are provided by extensions when installed.
 */

export interface PlatformUrls {
  youtube: string
  kick: string
  twitch: string
  twitter: string
  reddit: string
}

const defaultPlatformUrls: PlatformUrls = {
  youtube: 'https://www.youtube.com',
  kick: 'https://kick.com',
  twitch: 'https://www.twitch.tv',
  twitter: 'https://twitter.com',
  reddit: 'https://www.reddit.com',
}

function getEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined
}

/** Platform base URLs for built-in platforms only. Chat source platforms come from the extension overlay. */
export function getPlatformUrls(): PlatformUrls {
  return {
    youtube: getEnv('YOUTUBE_BASE_URL') ?? defaultPlatformUrls.youtube,
    kick: getEnv('KICK_BASE_URL') ?? defaultPlatformUrls.kick,
    twitch: getEnv('TWITCH_BASE_URL') ?? defaultPlatformUrls.twitch,
    twitter: getEnv('TWITTER_BASE_URL') ?? defaultPlatformUrls.twitter,
    reddit: getEnv('REDDIT_BASE_URL') ?? defaultPlatformUrls.reddit,
  }
}
