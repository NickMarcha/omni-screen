import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { logger } from '../utils/logger'
import { applyThemeToDocument, getAppPreferences } from '../utils/appPreferences'
import TwitterEmbed from './embeds/TwitterEmbed'
import TwitterTimelineEmbed from './embeds/TwitterTimelineEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import TikTokEmbed from './embeds/TikTokEmbed'
import RedditEmbed from './embeds/RedditEmbed'
import StreamableEmbed from './embeds/StreamableEmbed'
import WikipediaEmbed from './embeds/WikipediaEmbed'
import BlueskyEmbed from './embeds/BlueskyEmbed'
import KickEmbed from './embeds/KickEmbed'
import LSFEmbed from './embeds/LSFEmbed'
import VideoEmbed from './embeds/VideoEmbed'
import ImageEmbed from './embeds/ImageEmbed'
import ListManager from './ListManager'
import twitterIcon from '../assets/icons/third-party/twitter.png'
import youtubeIcon from '../assets/icons/third-party/youtube.png'
import tiktokIcon from '../assets/icons/third-party/tiktok.png'
import kickIcon from '../assets/icons/third-party/kick.png'
import twitchIcon from '../assets/icons/third-party/twitch.png'
import redditIcon from '../assets/icons/third-party/reddit.png'
import streamableIcon from '../assets/icons/third-party/streamable.ico'
import imgurIcon from '../assets/icons/third-party/imgur.png'
import wikipediaIcon from '../assets/icons/third-party/wikipedia.png'
import blueskyIcon from '../assets/icons/third-party/bluesky.svg'
import jorkingitGif from '../assets/media/jorkingit.gif'
import feelswierdmanPng from '../assets/media/feelswierdman.png'
import pepeCharmGif from '../assets/media/PepeCharm.gif'
import yeeCharmGif from '../assets/media/YeeCharm.gif'
import manHoldsCatPng from '../assets/media/ManHoldsCat.png'
import bennyLovePng from '../assets/media/BennyLove.png'
import achshullyRetardedPng from '../assets/media/ACHshullyRetarded.png'

// Canonical message ID for banning/filtering: platform:channel:date:nick
export function messageId(platform: string, channel: string, date: number, nick: string): string {
  return `${platform}:${channel}:${date}:${nick}`
}

// Kick emote shape (from Kick chat message payload)
interface KickEmote {
  id: number
  name?: string
  start?: number
  end?: number
}

interface MentionData {
  id: string // Unique ID: platform:channel:date:nick (or legacy date-nick)
  date: number
  text: string
  nick: string
  flairs: string
  matchedTerms: string[] // Terms from filter that matched this mention
  searchAfter?: number // For rustlesearch API pagination
  isStreaming?: boolean // true for new incoming WebSocket messages, false for history/API
  platform?: string // e.g. primary chat source id, 'kick'
  channel?: string // e.g. mentions channel label
  kickEmotes?: KickEmote[] // Kick emote positions/ids for rendering
}

interface ImgurAlbumMedia {
  id: string
  url: string
  description: string
  title: string
  width: number
  height: number
  type: string
  mime_type: string
}

interface ImgurAlbumData {
  id: string
  title: string
  description: string
  media: ImgurAlbumMedia[]
  image_count: number
  is_album: boolean
}

export interface LinkCard {
  id: string
  messageId: string // platform:channel:date:nick for banning whole message
  url: string
  text: string
  nick: string
  date: number
  isDirectMedia: boolean
  mediaType?: 'image' | 'video'
  linkType?: string
  embedUrl?: string
  isYouTube?: boolean
  isTwitter?: boolean
  isTwitterTimeline?: boolean
  twitterEmbedHtml?: string
  isTikTok?: boolean
  tiktokEmbedHtml?: string
  isReddit?: boolean
  redditEmbedHtml?: string
  isImgur?: boolean
  imgurAlbumData?: ImgurAlbumData
  isStreamable?: boolean
  isWikipedia?: boolean
  isBluesky?: boolean
  isKick?: boolean
  isLSF?: boolean
  isTrusted?: boolean
  isStreaming?: boolean // true for new incoming WebSocket messages
  platform?: string // e.g. primary chat source id, 'kick'
  channel?: string // e.g. mentions channel label
  kickEmotes?: KickEmote[] // Kick emote data for rendering
}

// Extract URLs from text (exported for Debug page to derive link from message text)
export function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  return text.match(urlRegex) || []
}

// Check if URL is direct media
function isDirectMedia(url: string): { isMedia: boolean; type?: 'image' | 'video' } {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    
    // Check for Twitter image hosting
    if (hostname.includes('pbs.twimg.com') || hostname.includes('twimg.com')) {
      // Check format parameter or assume image if it's from Twitter's CDN
      const format = urlObj.searchParams.get('format')
      if (format && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(format.toLowerCase())) {
        return { isMedia: true, type: 'image' }
      }
      // If no format param but it's from twimg.com, it's likely an image
      if (hostname.includes('pbs.twimg.com')) {
        return { isMedia: true, type: 'image' }
      }
    }
  } catch {
    // If URL parsing fails, continue with extension check
  }
  
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i
  const videoExtensions = /\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i
  
  if (imageExtensions.test(url)) {
    return { isMedia: true, type: 'image' }
  }
  if (videoExtensions.test(url)) {
    return { isMedia: true, type: 'video' }
  }
  return { isMedia: false }
}

// Check if text contains NSFW
function containsNSFW(text: string): boolean {
  return /NSFW/i.test(text)
}

// Check if text contains NSFL
function containsNSFL(text: string): boolean {
  return /NSFL/i.test(text)
}

// Check if text contains banned terms (substring match: no word-boundary, so offensive terms cannot be bypassed)
function containsBannedTerms(text: string, bannedTerms: string[] | undefined): boolean {
  if (!bannedTerms || bannedTerms.length === 0) return false
  const lowerText = text.toLowerCase()
  return bannedTerms.some(term => term.trim() && lowerText.includes(term.trim().toLowerCase()))
}

// Normalize filter term: strip leading @ (IRC-style "@nick" and "nick" are equivalent)
function normalizeFilterTerm(term: string): string {
  return term.trim().replace(/^@/, '')
}

// Check if filter term appears in text/nick as a whole word (whitespace or start/end of string; used only for filter terms, not banned terms)
// Accepts both "term" and "@term" in the haystack (IRC mention style)
function filterTermMatchesAsWord(haystack: string, term: string): boolean {
  const t = normalizeFilterTerm(term)
  if (!t) return false
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  try {
    const re = new RegExp('(\\b' + escaped + '\\b|\\b@' + escaped + '\\b)', 'i')
    return re.test(haystack)
  } catch {
    const lower = haystack.toLowerCase()
    return lower.includes(t.toLowerCase()) || lower.includes('@' + t.toLowerCase())
  }
}

// Banned/trusted users are stored as "platform:nick" (e.g. "primaryId:nick", "kick:countrycaptain")
function parsePlatformUser(entry: string): { platform: string; nick: string } | null {
  const idx = entry.indexOf(':')
  if (idx <= 0) return null
  return { platform: entry.slice(0, idx), nick: entry.slice(idx + 1).trim() }
}
function formatPlatformUser(platform: string, nick: string): string {
  return `${platform}:${nick}`
}

// Check if user is banned on the given platform
function isBannedUser(nick: string, platform: string, bannedUsers: string[] | undefined): boolean {
  if (!bannedUsers || bannedUsers.length === 0) return false
  const lowerNick = nick.toLowerCase()
  return bannedUsers.some(entry => {
    const parsed = parsePlatformUser(entry)
    if (!parsed) return false
    return parsed.platform === platform && parsed.nick.toLowerCase() === lowerNick
  })
}

// Check if user is trusted on the given platform
function isTrustedUser(nick: string, platform: string, trustedUsers: string[] | undefined): boolean {
  if (!trustedUsers || trustedUsers.length === 0) return false
  const lowerNick = nick.toLowerCase()
  return trustedUsers.some(entry => {
    const parsed = parsePlatformUser(entry)
    if (!parsed) return false
    return parsed.platform === platform && parsed.nick.toLowerCase() === lowerNick
  })
}

// Muted user interface
interface MutedUser {
  nick: string
  muteUntil: number // Timestamp when mute expires
}

// Check if user is muted (and mute hasn't expired)
function isMutedUser(nick: string, mutedUsers: MutedUser[] | undefined): boolean {
  if (!mutedUsers || mutedUsers.length === 0) return false
  const lowerNick = nick.toLowerCase()
  const now = Date.now()
  return mutedUsers.some(muted => {
    const lowerMuted = muted.nick.toLowerCase()
    return lowerMuted === lowerNick && muted.muteUntil > now
  })
}

// Clean up expired mutes
function cleanupExpiredMutes(mutedUsers: MutedUser[] | undefined): MutedUser[] {
  if (!mutedUsers || mutedUsers.length === 0) return []
  const now = Date.now()
  return mutedUsers.filter(muted => muted.muteUntil > now)
}

// Check if platform is disabled
export type PlatformDisplayMode = 'filter' | 'text' | 'embed'

// Get platform display mode for a given link type
function getPlatformDisplayMode(linkType: string | undefined, platformSettings: Record<string, PlatformDisplayMode> | undefined): PlatformDisplayMode {
  if (!linkType || !platformSettings) return 'embed' // Default to embed
  const lowerLinkType = linkType.toLowerCase()
  // Find matching platform in settings (case-insensitive)
  const platformKey = Object.keys(platformSettings).find(key => key.toLowerCase() === lowerLinkType)
  return platformKey ? platformSettings[platformKey] : 'embed' // Default to embed if not found
}

// Check if platform should be filtered out
function isPlatformFiltered(linkType: string | undefined, platformSettings: Record<string, PlatformDisplayMode> | undefined): boolean {
  return getPlatformDisplayMode(linkType, platformSettings) === 'filter'
}

// Keybind interface
interface Keybind {
  action: string
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

// Theme settings
type ThemeMode = 'system' | 'light' | 'dark'
type LightTheme = 'light' | 'cupcake' | 'bumblebee' | 'emerald' | 'corporate' | 'retro' | 'cyberpunk' | 'valentine' | 'garden' | 'lofi' | 'pastel' | 'fantasy' | 'wireframe' | 'cmyk' | 'autumn' | 'acid' | 'lemonade' | 'winter' | 'nord' | 'caramellatte' | 'silk'
type DarkTheme = 'dark' | 'synthwave' | 'halloween' | 'forest' | 'aqua' | 'black' | 'luxury' | 'dracula' | 'business' | 'acid' | 'night' | 'coffee' | 'dim' | 'sunset' | 'abyss'
type EmbedThemeMode = 'follow' | 'light' | 'dark'

// Link opening behavior
type LinkOpenAction = 'none' | 'clipboard' | 'browser' | 'viewer'

interface ThemeSettings {
  mode: ThemeMode // system, light, or dark
  lightTheme: LightTheme // Selected light theme
  darkTheme: DarkTheme // Selected dark theme
  embedTheme: EmbedThemeMode // Embed theme: follow, light, or dark
}

// Normalize URL for banned-link matching (strip fragment, lowercase)
function normalizeUrlForBan(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    return u.href.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

// Settings interface
interface Settings {
  filter: string[] // list of usernames/terms to filter by
  showNSFW: boolean
  showNSFL: boolean
  showNonLinks: boolean
  bannedTerms: string[]
  bannedUsers: string[]
  bannedLinks: string[] // normalized URLs to hide (right-click "Ban this link")
  bannedMessages: string[] // message IDs (platform:channel:date:nick) to hide (right-click "Ban this message")
  platformSettings: Record<string, PlatformDisplayMode>
  linkOpenAction: LinkOpenAction
  trustedUsers: string[]
  mutedUsers?: MutedUser[]
  keybinds: Keybind[]
  theme: ThemeSettings
  // Channels: where to fetch incoming messages (key = primary chat source id or 'kick')
  channels?: Record<string, { enabled: boolean; channelSlug?: string }>
  // Footer display: platform label, color, and date/time
  footerDisplay?: {
    showPlatformLabel?: boolean
    platformColorStyle?: 'tint' | 'subtle' | 'none'
    /** 'timestamp' = time only, 'datetimestamp' = date + time, 'none' = hide */
    timestampDisplay?: 'timestamp' | 'datetimestamp' | 'none'
  }
}

// Load settings from localStorage
function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem('omni-screen-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      logger.settings('Loaded settings from localStorage')
      
      // Migrate old format (bannedTerms as string) to new format (array)
      if (typeof parsed.bannedTerms === 'string') {
        parsed.bannedTerms = parsed.bannedTerms.split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0)
      }
      
      // Ensure all new fields exist with defaults
      const defaultKeybinds: Keybind[] = [
        { action: 'next', key: 'ArrowRight', ctrl: false, shift: false, alt: false },
        { action: 'previous', key: 'ArrowLeft', ctrl: false, shift: false, alt: false },
        { action: 'toggleAutoplay', key: 'a', ctrl: false, shift: false, alt: false },
        { action: 'toggleMute', key: 'm', ctrl: false, shift: false, alt: false },
        { action: 'toggleLoop', key: 'l', ctrl: false, shift: false, alt: false },
        { action: 'refresh', key: 'r', ctrl: true, shift: false, alt: false },
        { action: 'settings', key: ',', ctrl: false, shift: false, alt: false },
      ]
      
      // Migrate old disabledPlatforms to new platformSettings
      const allPlatforms = ['YouTube', 'Twitter', 'TikTok', 'Reddit', 'Kick', 'Twitch', 'Streamable', 'Imgur', 'Wikipedia', 'Bluesky', 'LSF']
      let platformSettings: Record<string, PlatformDisplayMode> = {}
      
      if (parsed.platformSettings && typeof parsed.platformSettings === 'object') {
        // New format already exists
        platformSettings = parsed.platformSettings
      } else if (Array.isArray(parsed.disabledPlatforms)) {
        // Migrate from old format: disabledPlatforms array
        allPlatforms.forEach(platform => {
          const isDisabled = parsed.disabledPlatforms.some((p: string) => p.toLowerCase() === platform.toLowerCase())
          platformSettings[platform] = isDisabled ? 'filter' : 'embed'
        })
      } else {
        // Default: all platforms set to 'embed'
        allPlatforms.forEach(platform => {
          platformSettings[platform] = 'embed'
        })
      }
      
      // Migrate filter from string to array if needed
      let filter: string[] = []
      if (parsed.filter) {
        if (Array.isArray(parsed.filter)) {
          filter = parsed.filter
        } else if (typeof parsed.filter === 'string') {
          // Migrate old string filter to array
          filter = [parsed.filter]
        }
      } else {
        // Default to mrMouton if no filter exists
        filter = ['mrMouton']
      }
      
      // Clean up expired mutes
      let mutedUsers: MutedUser[] = []
      if (Array.isArray(parsed.mutedUsers)) {
        mutedUsers = cleanupExpiredMutes(parsed.mutedUsers)
        if (mutedUsers.length !== parsed.mutedUsers.length) {
          logger.settings(`Cleaned up ${parsed.mutedUsers.length - mutedUsers.length} expired mutes`)
        }
      }
      
      const migrated: Settings = {
        filter: filter,
        showNSFW: parsed.showNSFW ?? false,
        showNSFL: parsed.showNSFL ?? false,
        showNonLinks: parsed.showNonLinks ?? false,
        bannedTerms: Array.isArray(parsed.bannedTerms) ? parsed.bannedTerms : [],
        bannedUsers: Array.isArray(parsed.bannedUsers) ? parsed.bannedUsers : [],
        bannedLinks: Array.isArray(parsed.bannedLinks) ? parsed.bannedLinks : [],
        bannedMessages: Array.isArray(parsed.bannedMessages) ? parsed.bannedMessages : [],
        platformSettings: platformSettings,
        linkOpenAction: (parsed.linkOpenAction === 'none' || parsed.linkOpenAction === 'clipboard' || parsed.linkOpenAction === 'browser' || parsed.linkOpenAction === 'viewer')
          ? parsed.linkOpenAction
          : 'browser',
        trustedUsers: Array.isArray(parsed.trustedUsers) ? parsed.trustedUsers : [],
        mutedUsers: mutedUsers,
        keybinds: Array.isArray(parsed.keybinds) ? parsed.keybinds : defaultKeybinds,
        theme: parsed.theme && typeof parsed.theme === 'object' ? {
          mode: parsed.theme.mode || 'system',
          lightTheme: parsed.theme.lightTheme || 'retro',
          darkTheme: parsed.theme.darkTheme || 'business',
          embedTheme: parsed.theme.embedTheme || 'follow'
        } : { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
        channels: parsed.channels && typeof parsed.channels === 'object' ? (() => {
          const out: Record<string, { enabled: boolean; channelSlug?: string }> = { ...parsed.channels } as any
          delete out.dgg
          out.kick = parsed.channels.kick != null
            ? { enabled: !!parsed.channels.kick.enabled, channelSlug: String(parsed.channels.kick.channelSlug || '').trim() || undefined }
            : { enabled: false, channelSlug: undefined }
          return out
        })() : { kick: { enabled: false, channelSlug: undefined } },
        footerDisplay: parsed.footerDisplay && typeof parsed.footerDisplay === 'object' ? {
          showPlatformLabel: parsed.footerDisplay.showPlatformLabel !== false,
          platformColorStyle: (parsed.footerDisplay.platformColorStyle === 'tint' || parsed.footerDisplay.platformColorStyle === 'subtle' || parsed.footerDisplay.platformColorStyle === 'none') ? parsed.footerDisplay.platformColorStyle : 'tint',
          timestampDisplay: (parsed.footerDisplay.timestampDisplay === 'timestamp' || parsed.footerDisplay.timestampDisplay === 'datetimestamp' || parsed.footerDisplay.timestampDisplay === 'none') ? parsed.footerDisplay.timestampDisplay : 'datetimestamp'
        } : { showPlatformLabel: true, platformColorStyle: 'tint' as const, timestampDisplay: 'datetimestamp' as const },
      }
      return migrated
    }
  } catch (e) {
    logger.error('Failed to load settings:', e)
  }
  const defaultKeybinds: Keybind[] = [
    { action: 'next', key: 'ArrowRight', ctrl: false, shift: false, alt: false },
    { action: 'previous', key: 'ArrowLeft', ctrl: false, shift: false, alt: false },
    { action: 'toggleAutoplay', key: 'a', ctrl: false, shift: false, alt: false },
    { action: 'toggleMute', key: 'm', ctrl: false, shift: false, alt: false },
    { action: 'toggleLoop', key: 'l', ctrl: false, shift: false, alt: false },
    { action: 'refresh', key: 'r', ctrl: true, shift: false, alt: false },
    { action: 'settings', key: ',', ctrl: false, shift: false, alt: false },
  ]
  
  // Default platform settings: all set to 'embed'
  const defaultPlatformSettings: Record<string, PlatformDisplayMode> = {
    'YouTube': 'embed',
    'Twitter': 'embed',
    'TikTok': 'embed',
    'Reddit': 'embed',
    'Kick': 'embed',
    'Twitch': 'embed',
    'Streamable': 'embed',
    'Imgur': 'embed',
    'Wikipedia': 'embed',
    'Bluesky': 'embed',
    'LSF': 'embed',
  }
  
  const defaults: Settings = {
    filter: ['mrMouton'],
    showNSFW: false,
    showNSFL: false,
    showNonLinks: false,
    bannedTerms: [],
    bannedUsers: [],
    bannedLinks: [],
    bannedMessages: [],
    platformSettings: defaultPlatformSettings,
    linkOpenAction: 'browser',
    trustedUsers: [],
    mutedUsers: [],
    keybinds: defaultKeybinds,
    theme: { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
    channels: { kick: { enabled: false, channelSlug: undefined } },
    footerDisplay: { showPlatformLabel: true, platformColorStyle: 'tint', timestampDisplay: 'datetimestamp' },
  }
    logger.settings('Using default settings')
  return defaults
}

// Save settings to localStorage
function saveSettings(settings: Settings) {
  try {
    localStorage.setItem('omni-screen-settings', JSON.stringify(settings))
    logger.settings('Saved settings to localStorage')
    // Verify it was saved
    const verify = localStorage.getItem('omni-screen-settings')
    if (!verify) {
      logger.error('Settings were not saved - localStorage may be disabled')
    }
  } catch (e) {
    logger.error('Failed to save settings:', e)
  }
}

// Detect link type for display
function getLinkType(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'Twitter'
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'YouTube'
    if (hostname.includes('tiktok.com')) return 'TikTok'
    if (hostname.includes('kick.com')) return 'Kick'
    if (hostname.includes('twitch.tv')) return 'Twitch'
    if (hostname.includes('reddit.com')) return 'Reddit'
    if (hostname.includes('streamable.com')) return 'Streamable'
    if (hostname.includes('imgur.com')) return 'Imgur'
    if (hostname.includes('wikipedia.org')) return 'Wikipedia'
    if (hostname.includes('bsky.app')) return 'Bluesky'
    if (hostname.includes('arazu.io')) return 'LSF'
    return 'Link'
  } catch {
    return 'Link'
  }
}

// Get icon for link type
function getLinkTypeIcon(linkType?: string): string | null {
  if (!linkType) return null
  const iconMap: Record<string, string> = {
    'Twitter': twitterIcon,
    'YouTube': youtubeIcon,
    'TikTok': tiktokIcon,
    'Kick': kickIcon,
    'Twitch': twitchIcon,
    'Reddit': redditIcon,
    'Streamable': streamableIcon,
    'Imgur': imgurIcon,
    'Wikipedia': wikipediaIcon,
    'Bluesky': blueskyIcon,
    'LSF': redditIcon, // Use Reddit icon as placeholder for LSF (LSF is related to Reddit)
  }
  return iconMap[linkType] || null
}

// Check if URL is a YouTube link
function isYouTubeLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('youtube.com') || hostname.includes('youtu.be')
  } catch {
    return false
  }
}

// Check if URL is a YouTube clip (clips should not be embedded)
function isYouTubeClipLink(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    const pathname = urlObj.pathname.toLowerCase()
    // YouTube clip URLs have format: /clip/CLIP_ID
    return hostname.includes('youtube.com') && pathname.startsWith('/clip/')
  } catch {
    return false
  }
}

// Check if URL is a Twitter/X link
function isTwitterLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('twitter.com') || hostname === 'x.com'
  } catch {
    return false
  }
}

// Check if URL is a Twitter/X status/tweet link
function isTwitterStatusLink(url: string): boolean {
  try {
    if (!isTwitterLink(url)) return false
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    // Check for /username/status/ID format
    return /\/status\/\d+/.test(pathname)
  } catch {
    return false
  }
}

// Check if URL is a Twitter/X timeline (profile, list, likes, collection) - embeddable via timeline oEmbed
function isTwitterTimelineLink(url: string): boolean {
  try {
    if (!isTwitterLink(url) || isTwitterStatusLink(url)) return false
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.replace(/\/$/, '').toLowerCase()
    if (!pathname || pathname === '/') return false
    // User profile: /Username
    if (/^\/[a-z0-9_]+$/i.test(pathname)) return true
    // List: /Username/lists/list-slug
    if (/^\/[a-z0-9_]+\/lists\/[^/]+$/i.test(pathname)) return true
    // Likes: /Username/likes
    if (/^\/[a-z0-9_]+\/likes$/i.test(pathname)) return true
    // Collection: /i/collections/...
    if (/^\/i\/collections\/[^/]+/i.test(pathname)) return true
    return false
  } catch {
    return false
  }
}

// Check if URL is a TikTok link
function isTikTokLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('tiktok.com')
  } catch {
    return false
  }
}

// Check if URL is a TikTok video link
function isTikTokVideoLink(url: string): boolean {
  try {
    if (!isTikTokLink(url)) return false
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    // Check for /@username/video/ID format or /t/ID format (short links)
    return /\/@[\w.-]+\/video\/\d+/.test(pathname) || /^\/t\/[\w-]+/.test(pathname)
  } catch {
    return false
  }
}

// Check if URL is a Reddit link
function isRedditLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('reddit.com')
  } catch {
    return false
  }
}

// Check if URL is a Reddit post link
function isRedditPostLink(url: string): boolean {
  try {
    if (!isRedditLink(url)) return false
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    // Check for /r/SUBREDDIT/comments/POST_ID/TITLE format
    return /\/r\/[\w]+\/comments\/[\w]+\//.test(pathname)
  } catch {
    return false
  }
}

// Check if URL is a Reddit media link
function isRedditMediaLink(url: string): boolean {
  try {
    if (!isRedditLink(url)) return false
    const urlObj = new URL(url)
    const pathname = urlObj.pathname.toLowerCase()
    // Check for /media?url= format
    return pathname === '/media' && urlObj.searchParams.has('url')
  } catch {
    return false
  }
}

// Check if URL is an Imgur album/gallery link
function isImgurAlbumLink(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    if (!hostname.includes('imgur.com')) return false
    const pathname = urlObj.pathname.toLowerCase()
    // Check for /gallery/ or /a/ paths (albums)
    return pathname.startsWith('/gallery/') || pathname.startsWith('/a/')
  } catch {
    return false
  }
}

// Check if URL is a Wikipedia link
function isWikipediaLink(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    return hostname.includes('wikipedia.org')
  } catch {
    return false
  }
}

// Check if URL is a Bluesky link
function isBlueskyLink(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    return hostname.includes('bsky.app')
  } catch {
    return false
  }
}

// Check if URL is a Streamable link
function isStreamableLink(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname.includes('streamable.com')
  } catch {
    return false
  }
}

// Check if URL is a Kick livestream link (excludes clips)
function isKickLink(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    const pathname = urlObj.pathname.toLowerCase()
    
    // Only match kick.com domains
    if (!hostname.includes('kick.com')) {
      return false
    }
    
    // Exclude clip URLs (they contain /clips/ in the path)
    if (pathname.includes('/clips/')) {
      return false
    }
    
    // Match livestream URLs: /username or player.kick.com/username
    // Pathname should be just /username (single segment after the leading slash)
    const pathSegments = pathname.split('/').filter(segment => segment.length > 0)
    return pathSegments.length === 1 || hostname.includes('player.kick.com')
  } catch {
    return false
  }
}

// Check if URL is an LSF link
function isLSFLink(url: string): boolean {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    // Match arazu.io domain and check if it's a clip URL (starts with /t3_)
    if (hostname.includes('arazu.io')) {
      const pathname = urlObj.pathname
      // LSF clip URLs have format: /t3_XXXXX/
      return /^\/t3_/.test(pathname)
    }
    return false
  } catch {
    return false
  }
}

// Extract YouTube embed URL from various YouTube URL formats
// Convert YouTube timestamp parameter to seconds
// Supports formats: t=53, t=1h2m3s, t=1m30s, etc.
function parseYouTubeTimestamp(tParam: string | null): number | null {
  if (!tParam) return null
  
  try {
    // If it's just a number, it's seconds
    const numericMatch = tParam.match(/^(\d+)$/)
    if (numericMatch) {
      return parseInt(numericMatch[1], 10)
    }
    
    // Parse format like 1h2m3s or 1m30s
    let totalSeconds = 0
    const hourMatch = tParam.match(/(\d+)h/)
    if (hourMatch) {
      totalSeconds += parseInt(hourMatch[1], 10) * 3600
    }
    const minuteMatch = tParam.match(/(\d+)m/)
    if (minuteMatch) {
      totalSeconds += parseInt(minuteMatch[1], 10) * 60
    }
    const secondMatch = tParam.match(/(\d+)s/)
    if (secondMatch) {
      totalSeconds += parseInt(secondMatch[1], 10)
    }
    
    // If we found any matches, return the total
    if (hourMatch || minuteMatch || secondMatch) {
      return totalSeconds
    }
    
    return null
  } catch {
    return null
  }
}

function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    
    // Extract timestamp parameter (t=)
    const tParam = urlObj.searchParams.get('t')
    const startSeconds = parseYouTubeTimestamp(tParam)
    
    // Build base embed URL with rel=0 and widget_referrer for Electron
    const buildEmbedUrl = (videoId: string, additionalParams?: string) => {
      const params = new URLSearchParams()
      params.set('rel', '0')
      params.set('widget_referrer', 'https://com.nickmarcha.omni-screen')
      if (startSeconds !== null) {
        params.set('start', startSeconds.toString())
      }
      if (additionalParams) {
        const additional = new URLSearchParams(additionalParams)
        additional.forEach((value, key) => {
          if (key !== 'rel' && key !== 'start' && key !== 'widget_referrer') {
            params.set(key, value)
          }
        })
      }
      return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
    }
    
    // Handle youtu.be short links: https://youtu.be/VIDEO_ID
    if (hostname === 'youtu.be') {
      const videoId = urlObj.pathname.slice(1).split('?')[0]
      if (videoId) {
        return buildEmbedUrl(videoId)
      }
    }
    
    // Handle youtube.com URLs
    if (hostname.includes('youtube.com')) {
      // Check for playlist: youtube.com/playlist?list=PLAYLIST_ID
      const playlistId = urlObj.searchParams.get('list')
      if (playlistId) {
        const params = new URLSearchParams()
        params.set('list', playlistId)
        params.set('rel', '0')
        if (startSeconds !== null) {
          params.set('start', startSeconds.toString())
        }
        return `https://www.youtube-nocookie.com/embed/videoseries?${params.toString()}`
      }
      
      // Check for YouTube Shorts: youtube.com/shorts/VIDEO_ID
      if (urlObj.pathname.startsWith('/shorts/')) {
        const videoId = urlObj.pathname.split('/shorts/')[1]?.split('?')[0]
        if (videoId) {
          return buildEmbedUrl(videoId)
        }
      }
      
      // Check for YouTube Clips: youtube.com/clip/CLIP_ID
      // Note: Clips require fetching the video ID from the clip page
      // This will be handled separately in the YouTubeEmbed component
      if (urlObj.pathname.startsWith('/clip/')) {
        // Return null here - the YouTubeEmbed component will handle fetching the video ID
        return null
      }
      
      // Check for video ID in various formats
      // youtube.com/watch?v=VIDEO_ID
      const videoId = urlObj.searchParams.get('v')
      if (videoId) {
        return buildEmbedUrl(videoId)
      }
      
      // youtube.com/embed/VIDEO_ID (already an embed URL)
      if (urlObj.pathname.startsWith('/embed/')) {
        const embedId = urlObj.pathname.split('/embed/')[1]?.split('?')[0]
        if (embedId) {
          // Preserve existing params and add rel=0 if not present
          const params = new URLSearchParams(urlObj.search)
          if (!params.has('rel')) {
            params.set('rel', '0')
          }
          if (!params.has('widget_referrer')) {
            params.set('widget_referrer', 'https://com.nickmarcha.omni-screen')
          }
          // Add start parameter if timestamp exists
          if (startSeconds !== null && !params.has('start')) {
            params.set('start', startSeconds.toString())
          }
          return `https://www.youtube-nocookie.com/embed/${embedId}?${params.toString()}`
        }
      }
      
      // youtube.com/v/VIDEO_ID
      if (urlObj.pathname.startsWith('/v/')) {
        const videoId = urlObj.pathname.split('/v/')[1]?.split('?')[0]
        if (videoId) {
          return buildEmbedUrl(videoId)
        }
      }
    }
    
    return null
  } catch {
    return null
  }
}

// Helpers for card footer platform label and color (exported for DebugPage and shared card components)
export function getPlatformLabel(
  card: LinkCard,
  primaryChatSourceId?: string | null,
  primaryChatSourceDisplayLabel?: string | null
): string {
  if (card.platform === 'kick') return `Kick • ${card.channel || '?'}`
  if (primaryChatSourceId && card.platform === primaryChatSourceId) return primaryChatSourceDisplayLabel ?? card.platform ?? ''
  if (card.channel) return `${card.platform || 'Chat'} • ${card.channel}`
  return card.platform || ''
}

export function getPlatformFooterColor(
  platform: string | undefined,
  style: 'tint' | 'subtle' | 'none' | undefined,
  primaryChatSourceId?: string | null
): string {
  if (!style || style === 'none' || !platform) return ''
  if (primaryChatSourceId && platform === primaryChatSourceId) return style === 'tint' ? 'border-l-4 border-l-primary bg-primary/5' : 'border-l-4 border-l-primary/40 bg-primary/5'
  if (platform === 'kick') return style === 'tint' ? 'border-l-4 border-l-success bg-success/5' : 'border-l-4 border-l-success/40 bg-success/5'
  return style === 'tint' ? 'border-l-4 border-l-secondary bg-secondary/5' : 'border-l-4 border-l-secondary/40 bg-secondary/5'
}

/** Strip trailing punctuation often captured when extracting URLs from message text (e.g. "https://x.com/u/status/123."). */
function normalizeUrlFromMessage(url: string): string {
  return url.trim().replace(/[.,;:)!?\]]+$/, '')
}

/** Returns embed-related LinkCard fields derived from a URL. Use for building synthetic cards (e.g. Debug page) so the same components receive the same shape as real data. */
export function getLinkCardEmbedFieldsFromUrl(url: string): Pick<LinkCard, 'url' | 'isDirectMedia' | 'mediaType' | 'embedUrl' | 'isYouTube' | 'isTwitter' | 'isTwitterTimeline' | 'isTikTok' | 'isReddit' | 'isImgur' | 'isStreamable' | 'isWikipedia' | 'isBluesky' | 'isKick' | 'isLSF'> {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return { url: url || '', isDirectMedia: false }
  }
  let actualUrl = normalizeUrlFromMessage(url)
  let isRedditMedia = false
  if (isRedditMediaLink(url)) {
    try {
      const urlObj = new URL(url)
      const mediaUrl = urlObj.searchParams.get('url')
      if (mediaUrl) {
        actualUrl = decodeURIComponent(mediaUrl)
        isRedditMedia = true
      }
    } catch {
      // use original
    }
  }
  const mediaInfo = isDirectMedia(actualUrl)
  const isYouTubeClip = isYouTubeClipLink(actualUrl)
  const isYouTube = isYouTubeLink(actualUrl) && !isYouTubeClip
  const embedUrl = isYouTube ? getYouTubeEmbedUrl(actualUrl) : undefined
  const isTwitter = isTwitterStatusLink(actualUrl)
  const isTwitterTimeline = isTwitterTimelineLink(actualUrl)
  const isTikTok = isTikTokVideoLink(actualUrl)
  const isReddit = isRedditPostLink(actualUrl) && !isRedditMedia
  const isImgur = isImgurAlbumLink(url)
  const isStreamable = isStreamableLink(actualUrl)
  const isWikipedia = isWikipediaLink(actualUrl)
  const isBluesky = isBlueskyLink(actualUrl)
  const isKick = isKickLink(actualUrl)
  const isLSF = isLSFLink(actualUrl)
  return {
    url: actualUrl,
    isDirectMedia: mediaInfo.isMedia,
    mediaType: mediaInfo.type,
    embedUrl: embedUrl ?? undefined,
    isYouTube,
    isTwitter,
    isTwitterTimeline,
    isTikTok,
    isReddit,
    isImgur,
    isStreamable,
    isWikipedia,
    isBluesky,
    isKick,
    isLSF,
  }
}

/** Build LinkCards from a single chat message (e.g. combined chat). Used by LiteLinkScroller. */
export function buildLinkCardsFromMessage(
  platform: string,
  channel: string,
  nick: string,
  dateMs: number,
  text: string,
  kickEmotes?: LinkCard['kickEmotes']
): LinkCard[] {
  const rawUrls = extractUrls(text)
  if (rawUrls.length === 0) return []
  const msgId = messageId(platform, channel, dateMs, nick)
  const cards: LinkCard[] = []
  const seenNormalized = new Set<string>()
  rawUrls.forEach((rawUrl, urlIndex) => {
    const url = normalizeUrlFromMessage(rawUrl)
    if (!url || seenNormalized.has(url)) return
    seenNormalized.add(url)
    const embedFields = getLinkCardEmbedFieldsFromUrl(url)
    const urlHash = url.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const uniqueId = `${msgId}-${urlIndex}-${urlHash}-${url.slice(-20)}`
    cards.push({
      id: uniqueId,
      messageId: msgId,
      platform,
      channel,
      kickEmotes,
      url: embedFields.url,
      text,
      nick,
      date: dateMs,
      isDirectMedia: embedFields.isDirectMedia ?? false,
      mediaType: embedFields.mediaType,
      linkType: getLinkType(url),
      embedUrl: embedFields.embedUrl,
      isYouTube: embedFields.isYouTube,
      isTwitter: embedFields.isTwitter,
      isTwitterTimeline: embedFields.isTwitterTimeline,
      isTikTok: embedFields.isTikTok,
      isReddit: embedFields.isReddit,
      isImgur: embedFields.isImgur,
      isStreamable: embedFields.isStreamable,
      isWikipedia: embedFields.isWikipedia,
      isBluesky: embedFields.isBluesky,
      isKick: embedFields.isKick,
      isLSF: embedFields.isLSF,
    })
  })
  return cards
}

// Shared overview card content (used by MasonryGrid, DebugPage, LiteLinkScroller)
function renderLinkCardOverviewContent(
  card: LinkCard,
  onCardClick: (cardId: string) => void,
  onOpenLink: ((url: string) => void) | undefined,
  onContextMenu: ((e: React.MouseEvent, card: LinkCard) => void) | undefined,
  _getEmbedTheme: () => 'light' | 'dark',
  platformSettings: Record<string, PlatformDisplayMode>,
  emotesMap: Map<string, string>,
  footerDisplay: { showPlatformLabel?: boolean; platformColorStyle?: 'tint' | 'subtle' | 'none'; timestampDisplay?: 'timestamp' | 'datetimestamp' | 'none' } | undefined,
  embedReloadKey: number,
  /** When provided (e.g. LiteLinkScroller), override autoplay/mute for this card and optionally listen for video end. */
  cardEmbedOverrides?: { autoplay?: boolean; muted?: boolean; onEnded?: () => void },
  primaryChatSourceId?: string | null,
  primaryChatSourceDisplayLabel?: string | null,
  primaryChatSourceMentionsChannel?: string | null
) {
  const embedAutoplay = cardEmbedOverrides?.autoplay ?? false
  const embedMuted = cardEmbedOverrides?.muted ?? true
  const embedOnEnded = cardEmbedOverrides?.onEnded
  const handleAnchorClick = (e: React.MouseEvent, url: string) => { e.preventDefault(); e.stopPropagation(); onOpenLink?.(url) }
  const reloadKey = embedReloadKey
  // Check platform display mode (calculate outside IIFE so we can use it for hasEmbed check)
  const youtubeMode = getPlatformDisplayMode('YouTube', platformSettings)
  const twitterMode = getPlatformDisplayMode('Twitter', platformSettings)
  const tiktokMode = getPlatformDisplayMode('TikTok', platformSettings)
  const redditMode = getPlatformDisplayMode('Reddit', platformSettings)
  const streamableMode = getPlatformDisplayMode('Streamable', platformSettings)
  const wikipediaMode = getPlatformDisplayMode('Wikipedia', platformSettings)
  const blueskyMode = getPlatformDisplayMode('Bluesky', platformSettings)
  const kickMode = getPlatformDisplayMode('Kick', platformSettings)
  const lsfMode = getPlatformDisplayMode('LSF', platformSettings)
  const imgurMode = getPlatformDisplayMode('Imgur', platformSettings)
  
  // Check if card has an embed to show
  const hasEmbed = card.isDirectMedia || 
    (card.isYouTube && youtubeMode === 'embed' && card.embedUrl) ||
    (card.isTwitter && twitterMode === 'embed') ||
    (card.isTikTok && tiktokMode === 'embed') ||
    (card.isReddit && redditMode === 'embed') ||
    (card.isStreamable && streamableMode === 'embed') ||
    (card.isWikipedia && wikipediaMode === 'embed') ||
    (card.isBluesky && blueskyMode === 'embed') ||
    (card.isKick && kickMode === 'embed') ||
    (card.isLSF && lsfMode === 'embed') ||
    (card.isImgur && imgurMode === 'embed')
  
  const getEmbedTheme = _getEmbedTheme
  return (
    <>
      {/* Embed content above - constrained to prevent overflow */}
      <div className="flex-shrink-0 overflow-hidden">
        {card.isDirectMedia ? (
          <div>
            {card.mediaType === 'image' ? (
              <ImageEmbed 
                key={`image-${card.id}-${reloadKey}`}
                url={card.url} 
                alt={card.text}
                className="w-full object-contain rounded-t-lg"
              />
            ) : (
              <VideoEmbed 
                key={`video-${card.id}-${reloadKey}`}
                url={card.url}
                autoplay={embedAutoplay}
                muted={embedMuted}
                controls={true}
                className="w-full rounded-t-lg"
                onEnded={embedOnEnded}
              />
            )}
          </div>
        ) : card.isTwitterTimeline ? (
          <div className="bg-base-200 rounded-t-lg p-4 text-center">
            <p className="text-sm text-base-content/80 mb-2">Open in expanded mode to see Twitter timeline</p>
            <a href={card.url} target="_blank" rel="noopener noreferrer" className="link link-primary text-sm" onClick={(e) => { e.stopPropagation(); onOpenLink?.(card.url) }}>Open on X</a>
          </div>
        ) : card.isYouTube && youtubeMode === 'embed' && card.embedUrl ? (
          <YouTubeEmbed key={`yt-${card.id}-${reloadKey}`} url={card.url} embedUrl={card.embedUrl as string} autoplay={embedAutoplay} mute={embedMuted} />
        ) : card.isTwitter && twitterMode === 'embed' ? (
          <TwitterEmbed key={`tw-${card.id}-${reloadKey}`} url={card.url} theme={getEmbedTheme()} />
        ) : card.isTikTok && tiktokMode === 'embed' ? (
          <TikTokEmbed key={`tt-${card.id}-${reloadKey}`} url={card.url} autoplay={embedAutoplay} mute={embedMuted} loop={false} />
        ) : card.isReddit && redditMode === 'embed' ? (
          <RedditEmbed key={`rd-${card.id}-${reloadKey}`} url={card.url} theme={getEmbedTheme()} />
        ) : card.isStreamable && streamableMode === 'embed' ? (
          <StreamableEmbed key={`streamable-${card.id}-${reloadKey}`} url={card.url} autoplay={embedAutoplay} mute={embedMuted} loop={false} />
        ) : card.isWikipedia && wikipediaMode === 'embed' ? (
          <WikipediaEmbed key={`wiki-${card.id}-${reloadKey}`} url={card.url} />
        ) : card.isBluesky && blueskyMode === 'embed' ? (
          <BlueskyEmbed key={`bsky-${card.id}-${reloadKey}`} url={card.url} />
        ) : card.isKick && kickMode === 'embed' ? (
          <KickEmbed key={`kick-${card.id}-${reloadKey}`} url={card.url} autoplay={embedAutoplay} mute={embedMuted} />
        ) : card.isLSF && lsfMode === 'embed' ? (
          <LSFEmbed key={`lsf-${card.id}-${reloadKey}`} url={card.url} autoplay={embedAutoplay} mute={embedMuted} />
        ) : null}
      </div>
      {/* Text content and metadata at bottom - always visible */}
      <div className="flex-shrink-0">
        <div className="bg-base-300 rounded-lg p-3" onContextMenu={onContextMenu ? (e) => onContextMenu(e, card) : undefined}>
          <div className="break-words overflow-wrap-anywhere mb-2">
            <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
              {renderTextWithLinks(card.text, undefined, undefined, emotesMap, onOpenLink, card.kickEmotes)}
            </p>
          </div>
          <div
            className={`flex items-center justify-between pt-1 px-3 pb-3 -mx-3 -mb-3 border-t border-base-content/20 rounded-b-lg ${getPlatformFooterColor(card.platform, footerDisplay?.platformColorStyle ?? 'tint', primaryChatSourceId)}`}
            onContextMenu={onContextMenu ? (e) => onContextMenu(e, card) : undefined}
          >
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                {footerDisplay?.showPlatformLabel !== false && getPlatformLabel(card, primaryChatSourceId, primaryChatSourceDisplayLabel) && (
                  <span className="text-xs text-base-content/50 mr-2" data-platform={card.platform}>{getPlatformLabel(card, primaryChatSourceId, primaryChatSourceDisplayLabel)}</span>
                )}
                <span className="text-xs text-base-content/70">Posted by</span>
                <a
                  href={card.platform === primaryChatSourceId ? `https://rustlesearch.dev/?username=${encodeURIComponent(card.nick)}&channel=${encodeURIComponent(card.channel || primaryChatSourceMentionsChannel || primaryChatSourceId || '')}` : (card.platform === 'kick' ? `https://kick.com/${encodeURIComponent(card.channel || '')}` : '#')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-sm font-bold text-primary hover:underline"
                  onClick={(e) => {
                    const url = card.platform === primaryChatSourceId ? `https://rustlesearch.dev/?username=${encodeURIComponent(card.nick)}&channel=${encodeURIComponent(card.channel || primaryChatSourceMentionsChannel || primaryChatSourceId || '')}` : (card.platform === 'kick' ? `https://kick.com/${encodeURIComponent(card.channel || '')}` : card.url || '#')
                    handleAnchorClick(e, url)
                  }}
                >
                  {card.nick}
                </a>
              </div>
              {footerDisplay?.timestampDisplay !== 'none' && (
                <div className="text-xs text-base-content/50">
                  {footerDisplay?.timestampDisplay === 'timestamp'
                    ? new Date(card.date).toLocaleTimeString()
                    : new Date(card.date).toLocaleString()}
                </div>
              )}
            </div>
            {hasEmbed ? (
              <button
                onClick={() => onCardClick(card.id)}
                className="btn btn-sm btn-circle btn-primary flex-shrink-0"
                title="Expand"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

export function LinkCardOverviewCard(props: {
  card: LinkCard
  onCardClick: (cardId: string) => void
  onOpenLink?: (url: string) => void
  onContextMenu?: (e: React.MouseEvent, card: LinkCard) => void
  getEmbedTheme: () => 'light' | 'dark'
  platformSettings: Record<string, PlatformDisplayMode>
  emotesMap: Map<string, string>
  footerDisplay?: { showPlatformLabel?: boolean; platformColorStyle?: 'tint' | 'subtle' | 'none'; timestampDisplay?: 'timestamp' | 'datetimestamp' | 'none' }
  embedReloadKey?: number
  /** Override autoplay/mute/onEnded for this card (e.g. LiteLinkScroller active card). */
  cardEmbedOverrides?: { autoplay?: boolean; muted?: boolean; onEnded?: () => void }
  primaryChatSourceId?: string | null
  primaryChatSourceDisplayLabel?: string | null
  primaryChatSourceMentionsChannel?: string | null
}) {
  return renderLinkCardOverviewContent(props.card, props.onCardClick, props.onOpenLink, props.onContextMenu, props.getEmbedTheme, props.platformSettings, props.emotesMap, props.footerDisplay, props.embedReloadKey ?? 0, props.cardEmbedOverrides, props.primaryChatSourceId, props.primaryChatSourceDisplayLabel, props.primaryChatSourceMentionsChannel)
}

/** Expanded modal content (left panel + embed area). Used by LinkScroller modal and DebugPage. */
export function LinkCardExpandedContent(props: {
  card: LinkCard
  getEmbedTheme: () => 'light' | 'dark'
  emotesMap: Map<string, string>
  onOpenLink?: (url: string) => void
  footerDisplay?: { showPlatformLabel?: boolean; platformColorStyle?: 'tint' | 'subtle' | 'none'; timestampDisplay?: 'timestamp' | 'datetimestamp' | 'none' }
}) {
  const { card, getEmbedTheme, emotesMap, onOpenLink, footerDisplay } = props
  const handleOpenLink = (e: React.MouseEvent, url: string) => {
    e.preventDefault()
    e.stopPropagation()
    onOpenLink?.(url)
  }
  return (
    <div className="flex-1 flex overflow-hidden relative">
      <div className="w-80 border-r border-base-300 overflow-y-auto p-4 flex-shrink-0">
        <div className="space-y-4">
          <div>
            <div className="text-xs text-base-content/50 mb-1">User</div>
            <div className="font-semibold">{card.nick}</div>
          </div>
          <div>
            <div className="text-xs text-base-content/50 mb-1">Message</div>
            <div className="text-sm whitespace-pre-wrap break-words">
              {renderTextWithLinks(card.text, undefined, undefined, emotesMap, onOpenLink, card.kickEmotes)}
            </div>
          </div>
          <div>
            <div className="text-xs text-base-content/50 mb-1">Link</div>
            <a
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="link link-primary text-sm break-all"
              onClick={(e) => handleOpenLink(e, card.url)}
            >
              {card.url}
            </a>
          </div>
          {card.date && footerDisplay?.timestampDisplay !== 'none' && (
            <div>
              <div className="text-xs text-base-content/50 mb-1">Time</div>
              <div className="text-sm">
                {footerDisplay?.timestampDisplay === 'timestamp'
                  ? new Date(card.date).toLocaleTimeString()
                  : new Date(card.date).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <div className="w-full max-w-4xl">
          {card.isDirectMedia ? (
            <div>
              {card.mediaType === 'image' ? (
                <ImageEmbed url={card.url} alt={card.text} />
              ) : (
                <VideoEmbed url={card.url} autoplay={false} muted={false} controls={true} />
              )}
            </div>
          ) : card.isYouTube && card.embedUrl ? (
            <YouTubeEmbed url={card.url} embedUrl={card.embedUrl as string} autoplay={false} mute={false} />
          ) : card.isTwitterTimeline ? (
            <TwitterTimelineEmbed url={card.url} theme={getEmbedTheme()} />
          ) : card.isTwitter ? (
            <TwitterEmbed url={card.url} theme={getEmbedTheme()} />
          ) : card.isTikTok ? (
            <TikTokEmbed url={card.url} autoplay={false} mute={false} loop={false} />
          ) : card.isReddit ? (
            <RedditEmbed url={card.url} theme={getEmbedTheme()} />
          ) : card.isStreamable ? (
            <StreamableEmbed url={card.url} autoplay={false} mute={false} loop={false} />
          ) : card.isWikipedia ? (
            <WikipediaEmbed url={card.url} />
          ) : card.isBluesky ? (
            <BlueskyEmbed url={card.url} />
          ) : card.isKick ? (
            <KickEmbed url={card.url} autoplay={false} mute={true} />
          ) : card.isLSF ? (
            <LSFEmbed url={card.url} autoplay={false} mute={false} />
          ) : (
            <div className="bg-base-200 rounded-lg p-6">
              <a
                href={card.url}
                target="_blank"
                rel="noopener noreferrer"
                className="link link-primary break-all"
                onClick={(e) => handleOpenLink(e, card.url)}
              >
                {card.url}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Masonry Grid Component - distributes cards into columns based on estimated height
function MasonryGrid({ cards, onCardClick, onOpenLink, getEmbedTheme, platformSettings, emotesMap, embedReloadKeys, onContextMenu, stackDirection = 'down', footerDisplay, primaryChatSourceId, primaryChatSourceDisplayLabel, primaryChatSourceMentionsChannel }: { cards: LinkCard[], onCardClick: (cardId: string) => void, onOpenLink?: (url: string) => void, getEmbedTheme: () => 'light' | 'dark', platformSettings: Record<string, PlatformDisplayMode>, emotesMap: Map<string, string>, embedReloadKeys?: Map<string, number>, onContextMenu?: (e: React.MouseEvent, card: LinkCard) => void, stackDirection?: 'up' | 'down', footerDisplay?: { showPlatformLabel?: boolean; platformColorStyle?: 'tint' | 'subtle' | 'none'; timestampDisplay?: 'timestamp' | 'datetimestamp' | 'none' }, primaryChatSourceId?: string | null, primaryChatSourceDisplayLabel?: string | null, primaryChatSourceMentionsChannel?: string | null }) {
  const [columns, setColumns] = useState<LinkCard[][]>([])
  
  // Responsive column count based on screen size
  const getColumnCount = () => {
    if (typeof window === 'undefined') return 4
    const width = window.innerWidth
    if (width < 768) return 1 // Mobile
    if (width < 1024) return 2 // Tablet
    if (width < 1536) return 3 // Desktop
    return 4 // Large desktop
  }
  
  const [columnCount, setColumnCount] = useState(getColumnCount())
  
  useEffect(() => {
    const handleResize = () => {
      setColumnCount(getColumnCount())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
  // Estimate card height based on type
  const estimateCardHeight = (card: LinkCard): number => {
    // Base height for text/metadata section
    const baseHeight = 150
    
    // Add estimated height for embed/content
    if (card.isDirectMedia) {
      return baseHeight + (card.mediaType === 'image' ? 300 : 400)
    } else if (card.isYouTube) {
      return baseHeight + 315 // Standard YouTube embed height
    } else if (card.isTwitter || card.isTwitterTimeline) {
      // Twitter tweet/timeline embeds have variable heights
      return baseHeight + (card.isTwitterTimeline ? 450 : 350)
    } else if (card.isTikTok) {
      return baseHeight + 600 // TikTok embeds are taller
    } else if (card.isReddit) {
      return baseHeight + 400
    } else if (card.isStreamable) {
      return baseHeight + 400
    } else if (card.isKick) {
      return baseHeight + 400 // Similar to Streamable
    } else if (card.isImgur) {
      return baseHeight + 100
    } else {
      // Generic link - estimate based on text length
      return baseHeight + Math.min(card.text.length / 10, 200)
    }
  }
  
  // Memoize cards by ID to prevent unnecessary recomputation
  const cardsKey = useMemo(() => cards.map(c => c.id).join(','), [cards])

  // Refs for incremental masonry: only place NEW cards (prepend/append), never re-place existing ones
  // so existing cards stay in the same column and don't remount (embeds don't reload)
  const lastColumnsRef = useRef<LinkCard[][] | null>(null)
  const lastColumnCountRef = useRef(columnCount)

  useEffect(() => {
    const fullRedistribute = () => {
      const newColumns: LinkCard[][] = Array.from({ length: columnCount }, () => [])
      const columnHeights: number[] = Array(columnCount).fill(0)
      cards.forEach((card) => {
        let shortestColumn = 0
        let minHeight = columnHeights[0]
        for (let i = 1; i < columnCount; i++) {
          if (columnHeights[i] < minHeight) {
            minHeight = columnHeights[i]
            shortestColumn = i
          }
        }
        newColumns[shortestColumn].push(card)
        columnHeights[shortestColumn] += estimateCardHeight(card)
      })
      lastColumnsRef.current = newColumns.map(col => [...col])
      lastColumnCountRef.current = columnCount
      setColumns(newColumns)
    }

    // Column count changed (e.g. resize), no previous state, or cards empty → full redistribute
    if (columnCount !== lastColumnCountRef.current || lastColumnsRef.current === null || cards.length === 0) {
      if (cards.length === 0) {
        lastColumnsRef.current = null
        setColumns(Array.from({ length: columnCount }, () => []))
        return
      }
      fullRedistribute()
      return
    }

    const previousColumns = lastColumnsRef.current
    const previousIds = new Set(previousColumns.flat().map(c => c.id))
    const currentIds = cards.map(c => c.id)
    const newIds = new Set(currentIds.filter(id => !previousIds.has(id)))

    // No new cards
    if (newIds.size === 0) {
      if (currentIds.length !== previousIds.size) {
        // Some cards removed (e.g. refresh) → full redistribute
        fullRedistribute()
      }
      return
    }

    // New cards: determine if prepend (new at top) or append (new at bottom)
    const newCards = cards.filter(c => newIds.has(c.id))
    const firstNewIndex = cards.findIndex(c => newIds.has(c.id))
    const lastNewIndex = cards.length - 1 - [...cards].reverse().findIndex(c => newIds.has(c.id))
    const isPrepend = firstNewIndex === 0 && lastNewIndex === newCards.length - 1
    const isAppend = lastNewIndex === cards.length - 1 && firstNewIndex === cards.length - newCards.length

    if (!isPrepend && !isAppend) {
      // Reorder, replace, or mixed change → full redistribute
      fullRedistribute()
      return
    }

    // Incremental: keep previous column assignment, only place new cards in shortest column
    const newColumns = previousColumns.map(col => [...col])
    const columnHeights = newColumns.map(col => col.reduce((sum, c) => sum + estimateCardHeight(c), 0))

    for (const card of newCards) {
      let shortestColumn = 0
      let minHeight = columnHeights[0]
      for (let i = 1; i < columnCount; i++) {
        if (columnHeights[i] < minHeight) {
          minHeight = columnHeights[i]
          shortestColumn = i
        }
      }
      if (isPrepend) {
        newColumns[shortestColumn].unshift(card)
      } else {
        newColumns[shortestColumn].push(card)
      }
      columnHeights[shortestColumn] += estimateCardHeight(card)
    }

    lastColumnsRef.current = newColumns.map(col => [...col])
    setColumns(newColumns)
  }, [cardsKey, columnCount, stackDirection, cards])

  return (
    <div className={`flex gap-4 ${stackDirection === 'up' ? 'items-end' : ''}`}>
      {columns.map((columnCards, columnIndex) => (
        <div 
          key={columnIndex} 
          className="flex-1 flex flex-col gap-4"
        >
          {columnCards.map((card) => (
            <div 
              key={card.id}
              id={`card-${card.id}`}
              className={`card shadow-xl flex flex-col border-2 transition-all duration-200 ease-out p-0 ${card.isTrusted ? 'bg-base-200 border-yellow-500' : 'bg-base-200 border-base-content/20'}`}
              onContextMenu={onContextMenu ? (e) => onContextMenu(e, card) : undefined}
            >
              {renderLinkCardOverviewContent(card, onCardClick, onOpenLink, onContextMenu, getEmbedTheme, platformSettings, emotesMap, footerDisplay, embedReloadKeys?.get(card.id) || 0, undefined, primaryChatSourceId, primaryChatSourceDisplayLabel, primaryChatSourceMentionsChannel)}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Emote data type
interface EmoteData {
  prefix: string
  creator: string
  twitch: boolean
  theme: number
  minimumSubTier: number
  image: Array<{
    url: string
    name: string
    mime: string
    height: number
    width: number
  }>
}

// Render text with clickable links and emotes
// Keybinds Tab Component
function KeybindsTab({ keybinds, onKeybindsChange }: { keybinds: Keybind[]; onKeybindsChange: (keybinds: Keybind[]) => void }) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [capturedKeys, setCapturedKeys] = useState<{ key: string; ctrl: boolean; shift: boolean; alt: boolean } | null>(null)
  
  const actionNames: Record<string, string> = {
    next: 'Next Card',
    previous: 'Previous Card',
    toggleAutoplay: 'Toggle Autoplay',
    toggleMute: 'Toggle Mute',
    toggleLoop: 'Toggle Loop',
    refresh: 'Refresh Feed',
    settings: 'Open Settings',
  }
  
  return (
    <div className="space-y-4">
      <div className="text-sm text-base-content/70 mb-4">
        Click on a keybind to customize it. Press the keys you want to use.
      </div>
      {keybinds.map((keybind, index) => (
        <div key={index} className="flex items-center gap-4">
          <div className="flex-1">
            <label className="label">
              <span className="label-text">{actionNames[keybind.action] || keybind.action}</span>
            </label>
          </div>
          <div className="flex-1">
            {editingIndex === index ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="input input-bordered input-sm flex-1"
                  placeholder="Press keys..."
                  onKeyDown={(e) => {
                    e.preventDefault()
                    const key = e.key === ' ' ? 'Space' : e.key
                    setCapturedKeys({
                      key,
                      ctrl: e.ctrlKey,
                      shift: e.shiftKey,
                      alt: e.altKey,
                    })
                  }}
                  onBlur={() => {
                    if (capturedKeys) {
                      const newKeybinds = [...keybinds]
                      newKeybinds[index] = {
                        ...newKeybinds[index],
                        ...capturedKeys,
                      }
                      onKeybindsChange(newKeybinds)
                      setCapturedKeys(null)
                    }
                    setEditingIndex(null)
                  }}
                  autoFocus
                />
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setEditingIndex(null)
                    setCapturedKeys(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-sm btn-outline w-full"
                onClick={() => setEditingIndex(index)}
              >
                {[
                  keybind.ctrl && 'Ctrl',
                  keybind.alt && 'Alt',
                  keybind.shift && 'Shift',
                  keybind.key,
                ]
                  .filter(Boolean)
                  .join(' + ')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// Theme Tab Component (reserved for settings UI; exported so TS noUnusedLocals doesn't flag it)
export function ThemeTab({ theme, onThemeChange }: { theme: ThemeSettings; onThemeChange: (theme: ThemeSettings) => void }) {
  const lightThemes: LightTheme[] = [
    'light', 'cupcake', 'bumblebee', 'emerald', 'corporate', 'retro', 'cyberpunk', 
    'valentine', 'garden', 'lofi', 'pastel', 'fantasy', 'wireframe', 'cmyk', 
    'autumn', 'acid', 'lemonade', 'winter', 'nord', 'caramellatte', 'silk'
  ]
  
  const darkThemes: DarkTheme[] = [
    'dark', 'synthwave', 'halloween', 'forest', 'aqua', 'black', 'luxury', 
    'dracula', 'business', 'acid', 'night', 'coffee', 'dim', 'sunset', 'abyss'
  ]
  
  return (
    <div className="space-y-4">
      <div>
        <label className="label">
          <span className="label-text">Theme Mode</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={theme.mode}
          onChange={(e) => {
            onThemeChange({
              ...theme,
              mode: e.target.value as ThemeMode,
            })
          }}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <label className="label">
          <span className="label-text-alt">
            {theme.mode === 'system' && 'Follows your system theme preference'}
            {theme.mode === 'light' && 'Always use light theme'}
            {theme.mode === 'dark' && 'Always use dark theme'}
          </span>
        </label>
      </div>
      
      <div>
        <label className="label">
          <span className="label-text">Light Theme</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={theme.lightTheme || 'retro'}
          onChange={(e) => {
            onThemeChange({
              ...theme,
              lightTheme: e.target.value as LightTheme,
            })
          }}
          disabled={theme.mode === 'dark'}
        >
          {lightThemes.map((themeName) => (
            <option key={themeName} value={themeName}>
              {themeName.charAt(0).toUpperCase() + themeName.slice(1)}
            </option>
          ))}
        </select>
        <label className="label">
          <span className="label-text-alt">
            {theme.mode === 'dark' ? 'Disabled when dark mode is selected' : 'Theme to use for light mode'}
          </span>
        </label>
      </div>
      
      <div>
        <label className="label">
          <span className="label-text">Dark Theme</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={theme.darkTheme || 'business'}
          onChange={(e) => {
            onThemeChange({
              ...theme,
              darkTheme: e.target.value as DarkTheme,
            })
          }}
          disabled={theme.mode === 'light'}
        >
          {darkThemes.map((themeName) => (
            <option key={themeName} value={themeName}>
              {themeName.charAt(0).toUpperCase() + themeName.slice(1)}
            </option>
          ))}
        </select>
        <label className="label">
          <span className="label-text-alt">
            {theme.mode === 'light' ? 'Disabled when light mode is selected' : 'Theme to use for dark mode'}
          </span>
        </label>
      </div>
      
      <div>
        <label className="label">
          <span className="label-text">Embed Theme</span>
        </label>
        <select
          className="select select-bordered w-full"
          value={theme.embedTheme || 'follow'}
          onChange={(e) => {
            onThemeChange({
              ...theme,
              embedTheme: e.target.value as EmbedThemeMode,
            })
          }}
        >
          <option value="follow">Follow Theme</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <label className="label">
          <span className="label-text-alt">
            Theme to use for embedded content (Twitter, YouTube, etc.). "Follow Theme" uses the current app theme.
          </span>
        </label>
      </div>
    </div>
  )
}

// Load CSS file dynamically
function loadCSSOnce(href: string, id: string): Promise<void> {
  // Check if already loaded
  const existingLink = document.querySelector(`link[href="${href}"]`)
  if (existingLink) {
    return Promise.resolve()
  }
  
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.id = id
    
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`Failed to load CSS: ${href}`))
    
    document.head.appendChild(link)
  })
}

// Kick emote: render as img from files.kick.com
function renderKickEmoteImg(id: number, name?: string, key?: string) {
  const src = `https://files.kick.com/emotes/${encodeURIComponent(String(id))}/fullsize`
  return (
    <img
      key={key ?? `kick-emote-${id}`}
      src={src}
      alt={name ? `:${name}:` : 'kick emote'}
      title={name ? `:${name}:` : undefined}
      loading="lazy"
      className="inline-block align-middle mx-0.5"
      style={{ height: 18, width: 'auto' }}
    />
  )
}

// Process text with Kick emotes (position-based or name-based)
function processTextWithKickEmotes(text: string, kickEmotes: KickEmote[], baseKey: number = 0): (string | JSX.Element)[] {
  if (!text) return ['']
  if (!kickEmotes?.length) return [text]

  const withRanges = kickEmotes
    .map((e) => ({
      id: Number(e?.id),
      name: typeof e?.name === 'string' ? e.name : undefined,
      start: typeof e?.start === 'number' ? e.start : Number(e?.start),
      end: typeof e?.end === 'number' ? e.end : Number(e?.end),
    }))
    .filter((e) => Number.isFinite(e.id) && e.id > 0 && Number.isFinite(e.start) && Number.isFinite(e.end) && (e.end as number) > (e.start as number))
    .sort((a, b) => (a.start as number) - (b.start as number))

  if (withRanges.length > 0) {
    const parts: (string | JSX.Element)[] = []
    let last = 0
    let k = baseKey
    for (const e of withRanges) {
      const s = e.start as number
      const en = e.end as number
      if (s < last) continue
      if (s > text.length) continue
      if (en > text.length) continue
      if (s > last) parts.push(text.slice(last, s))
      parts.push(renderKickEmoteImg(e.id, e.name, `kick-emote-${k++}`))
      last = en
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts.length ? parts : [text]
  }

  const nameToId = new Map<string, number>()
  for (const e of kickEmotes) {
    const id = Number((e as any)?.id)
    const name = typeof (e as any)?.name === 'string' ? String((e as any).name).trim() : ''
    if (!name || !Number.isFinite(id) || id <= 0) continue
    if (!nameToId.has(name)) nameToId.set(name, id)
  }
  if (nameToId.size === 0) return [text]

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const names = Array.from(nameToId.keys()).sort((a, b) => b.length - a.length).slice(0, 50)
  const pattern = `:?(${names.map(escapeRegex).join('|')}):?`
  let re: RegExp
  try {
    re = new RegExp(`(?<![\\w])${pattern}(?![\\w])`, 'g')
  } catch {
    re = new RegExp(`\\b${pattern}\\b`, 'g')
  }
  const parts: (string | JSX.Element)[] = []
  let last = 0
  let match: RegExpExecArray | null
  let k = baseKey
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const name = match[1]
    const id = nameToId.get(name)
    if (id) parts.push(renderKickEmoteImg(id, name, `kick-emote-${k++}`))
    else parts.push(match[0])
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

// Process text segment to replace emotes with CSS-styled spans
function processTextWithEmotes(text: string, emotesMap: Map<string, string>, baseKey: number = 0): (string | JSX.Element)[] {
  if (emotesMap.size === 0) {
    return [text]
  }

  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let keyCounter = baseKey

  // Sort emotes by prefix length (longest first) to match longer prefixes first
  const sortedPrefixes = Array.from(emotesMap.keys()).sort((a, b) => b.length - a.length)

  // Create a regex pattern that matches any emote prefix as a whole word
  // Use word boundaries to ensure we match whole words only
  const emotePattern = new RegExp(
    `\\b(${sortedPrefixes.map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi'
  )

  let match
  while ((match = emotePattern.exec(text)) !== null) {
    const matchedPrefix = match[1]
    // Check if emote exists (we don't need the URL for CSS-based rendering)
    if (emotesMap.has(matchedPrefix)) {
      // Add text before the emote
      if (match.index > lastIndex) {
        const beforeText = text.substring(lastIndex, match.index)
        if (beforeText) {
          parts.push(beforeText)
        }
      }
      
      // Add the emote as a span with CSS classes
      // The CSS file defines .emote.PREFIX classes
      parts.push(
        <span
          key={`emote-${keyCounter++}`}
          className={`emote ${matchedPrefix}`}
          style={{ display: 'inline-block' }}
        />
      )
      
      lastIndex = match.index + match[0].length
    }
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex)
    if (remainingText) {
      parts.push(remainingText)
    }
  }
  
  return parts.length > 0 ? parts : [text]
}

// Replace Kick bracket syntax [emote:ID:name] with emote images (Kick sends this when no emotes array)
function processKickEmoteBrackets(text: string, baseKey: number = 0): (string | JSX.Element)[] {
  const tokenRe = /\[emote:(\d+):([^\]]+)\]/g
  if (!tokenRe.test(text)) return [text]
  tokenRe.lastIndex = 0
  const parts: (string | JSX.Element)[] = []
  let last = 0
  let match: RegExpExecArray | null
  let k = baseKey
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const id = parseInt(match[1], 10)
    const name = match[2] || undefined
    if (Number.isFinite(id) && id > 0) parts.push(renderKickEmoteImg(id, name, `kick-bracket-${k++}`))
    else parts.push(match[0])
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : [text]
}

// Process a text segment for greentext (lines starting with ">")
function processGreentext(text: string, emotesMap?: Map<string, string>, baseKey: number = 0, kickEmotes?: KickEmote[]): (string | JSX.Element)[] {
  const lines = text.split('\n')
  const parts: (string | JSX.Element)[] = []
  let keyCounter = baseKey
  const processEmotes = (line: string, key: number) => {
    if (line.includes('[emote:')) return processKickEmoteBrackets(line, key)
    if (kickEmotes?.length) return processTextWithKickEmotes(line, kickEmotes, key)
    return emotesMap ? processTextWithEmotes(line, emotesMap, key) : [line]
  }

  lines.forEach((line, lineIndex) => {
    const isGreentext = line.trim().startsWith('>')
    
    if (isGreentext) {
      const processedLine = processEmotes(line, keyCounter)
      
      processedLine.forEach((part) => {
        if (typeof part === 'string') {
          parts.push(
            <span
              key={`greentext-${keyCounter++}`}
              style={{
                color: 'rgb(108, 165, 40)',
                fontFamily: '"Roboto", Helvetica, "Trebuchet MS", Verdana, sans-serif',
                fontSize: '16px',
                lineHeight: '26.4px',
                boxSizing: 'border-box',
                textRendering: 'optimizeLegibility',
                overflowWrap: 'break-word'
              }}
            >
              {part}
            </span>
          )
        } else {
          // For emote images, wrap in greentext span
          parts.push(
            <span
              key={`greentext-${keyCounter++}`}
              style={{
                color: 'rgb(108, 165, 40)',
                fontFamily: '"Roboto", Helvetica, "Trebuchet MS", Verdana, sans-serif',
                fontSize: '16px',
                lineHeight: '26.4px',
                boxSizing: 'border-box',
                textRendering: 'optimizeLegibility',
                overflowWrap: 'break-word'
              }}
            >
              {part}
            </span>
          )
        }
      })
    } else {
      const processedLine = processEmotes(line, keyCounter)
      processedLine.forEach((part) => {
        if (typeof part === 'string') {
          parts.push(part)
        } else {
          parts.push(part)
        }
        keyCounter++
      })
    }
    
    // Add newline after each line except the last
    if (lineIndex < lines.length - 1) {
      parts.push('\n')
    }
  })

  return parts.length > 0 ? parts : [text]
}

function renderTextWithLinks(text: string, replaceUrl?: string, replaceWith?: string, emotesMap?: Map<string, string>, onOpenLink?: (url: string) => void, kickEmotes?: KickEmote[]): JSX.Element {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let match
  let hasLinks = false
  let keyCounter = 0

  while ((match = urlRegex.exec(text)) !== null) {
    hasLinks = true
    if (match.index > lastIndex) {
      const textSegment = text.substring(lastIndex, match.index)
      const processedSegment = processGreentext(textSegment, emotesMap, keyCounter, kickEmotes)
      processedSegment.forEach((part) => {
        parts.push(part)
        keyCounter++
      })
    }
    
    // Add the link
    const url = match[0]
    // If this URL should be replaced with a shorter text
    const shouldReplace = replaceUrl && url === replaceUrl
    const displayText = shouldReplace && replaceWith ? replaceWith : url
    
    parts.push(
      <a
        key={`link-${keyCounter++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="link link-primary break-words overflow-wrap-anywhere"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenLink?.(url)
        }}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {displayText}
      </a>
    )
    
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < text.length) {
    const textSegment = text.substring(lastIndex)
    const processedSegment = processGreentext(textSegment, emotesMap, keyCounter, kickEmotes)
    processedSegment.forEach((part) => {
      parts.push(part)
      keyCounter++
    })
  }
  
  if (!hasLinks) {
    const processedSegment = processGreentext(text, emotesMap, keyCounter, kickEmotes)
    return <>{processedSegment}</>
  }

  return <>{parts}</>
}

function LinkScroller({ onBackToMenu }: { onBackToMenu?: () => void }) {
  // Primary chat source from extension config (for channel label and rustlesearch)
  const [primaryChatSourceId, setPrimaryChatSourceId] = useState<string | null>(null)
  const [primaryChatSourceMentionsChannel, setPrimaryChatSourceMentionsChannel] = useState<string | null>(null)
  const [primaryChatSourceDisplayLabel, setPrimaryChatSourceDisplayLabel] = useState<string | null>(null)
  useEffect(() => {
    window.ipcRenderer.invoke('get-app-config').then((config: { chatSources?: Record<string, { mentionsChannelLabel?: string }>; connectionPlatforms?: Array<{ id: string; label: string }> }) => {
      const chatSources = config?.chatSources ?? {}
      const id = Object.keys(chatSources)[0] ?? null
      setPrimaryChatSourceId(id)
      if (id) {
        setPrimaryChatSourceMentionsChannel(chatSources[id]?.mentionsChannelLabel ?? null)
        const label = config?.connectionPlatforms?.find((p: { id: string; label: string }) => p.id === id)?.label ?? id
        setPrimaryChatSourceDisplayLabel(label)
      } else {
        setPrimaryChatSourceMentionsChannel(null)
        setPrimaryChatSourceDisplayLabel(null)
      }
    }).catch(() => {})
  }, [])

  // Load settings on mount
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // View mode: 'overview' or 'highlight'
  const [viewMode, setViewMode] = useState<'overview' | 'highlight'>('overview')
  // Initialize tempSettings with safe defaults
  const [tempSettings, setTempSettings] = useState<Settings>(() => ({
    filter: Array.isArray(settings.filter) ? settings.filter : (settings.filter ? [settings.filter] : ['mrMouton']),
    showNSFW: settings.showNSFW ?? false,
    showNSFL: settings.showNSFL ?? false,
    showNonLinks: settings.showNonLinks ?? false,
    bannedTerms: Array.isArray(settings.bannedTerms) ? settings.bannedTerms : [],
    bannedUsers: Array.isArray(settings.bannedUsers) ? settings.bannedUsers : [],
    bannedLinks: Array.isArray(settings.bannedLinks) ? settings.bannedLinks : [],
    bannedMessages: Array.isArray(settings.bannedMessages) ? settings.bannedMessages : [],
    platformSettings: settings.platformSettings && typeof settings.platformSettings === 'object' ? settings.platformSettings : {
      'YouTube': 'embed',
      'Twitter': 'embed',
      'TikTok': 'embed',
      'Reddit': 'embed',
      'Kick': 'embed',
      'Twitch': 'embed',
      'Streamable': 'embed',
      'Imgur': 'embed',
      'Wikipedia': 'embed',
      'Bluesky': 'embed',
      'LSF': 'embed',
    },
    linkOpenAction: settings.linkOpenAction || 'browser',
    trustedUsers: Array.isArray(settings.trustedUsers) ? settings.trustedUsers : [],
    mutedUsers: Array.isArray(settings.mutedUsers) ? cleanupExpiredMutes(settings.mutedUsers) : [],
    keybinds: Array.isArray(settings.keybinds) ? settings.keybinds : settings.keybinds || [],
    theme: settings.theme || { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
    channels: settings.channels ?? { kick: { enabled: false, channelSlug: undefined } },
    footerDisplay: settings.footerDisplay ?? { showPlatformLabel: true, platformColorStyle: 'tint', timestampDisplay: 'datetimestamp' },
  }))
  
  // Settings tab state
  const [settingsTab, setSettingsTab] = useState<'filtering' | 'banned' | 'channels' | 'footer' | 'keybinds'>('filtering')
  
  const { filter, showNSFW, showNSFL, showNonLinks, bannedTerms, bannedUsers, bannedLinks, bannedMessages, platformSettings, linkOpenAction, trustedUsers, mutedUsers, footerDisplay } = settings
  const primaryChatEnabled = primaryChatSourceId != null && (settings.channels?.[primaryChatSourceId]?.enabled !== false)

  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mentions, setMentions] = useState<MentionData[]>([])
  // Ref to track if a fetch is in progress to prevent duplicate calls
  const fetchInProgressRef = useRef(false)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null)
  // Rustlesearch fallback state
  const [usingRustlesearch, setUsingRustlesearch] = useState(false)
  const [rustlesearchSearchAfter, setRustlesearchSearchAfter] = useState<number | undefined>(undefined)
  // Track if WebSocket history has been received (for proper loading order)
  const [websocketHistoryReceived, setWebsocketHistoryReceived] = useState(false)
  // Ref to track WebSocket history timeout
  const websocketHistoryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Track when refresh happened (for separator in overview mode)
  const [refreshTimestamp, setRefreshTimestamp] = useState<number | null>(null)
  // For overview mode: card ID that's expanded in modal
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null)
  const [autoplayEnabled, setAutoplayEnabled] = useState(true) // Default to true for highlight mode
  const [muteEnabled, setMuteEnabled] = useState(false) // Default to false (sound on)
  const [loopEnabled, setLoopEnabled] = useState(false) // Default to false (no loop)
  const [imgurAlbumData, setImgurAlbumData] = useState<ImgurAlbumData | null>(null)
  const [loadingImgurAlbum, setLoadingImgurAlbum] = useState(false)
  const [imgurAlbumError, setImgurAlbumError] = useState<string | null>(null)
  const waitingForMoreRef = useRef(false) // Track if we're waiting for more content to load
  const refreshingRef = useRef(false) // Track if we're refreshing the feed
  
  // Emotes data
  const [emotesMap, setEmotesMap] = useState<Map<string, string>>(new Map())
  
  // Random loading spinner (chosen once per component mount)
  const loadingSpinner = useMemo(() => Math.random() < 0.5 ? pepeCharmGif : yeeCharmGif, [])
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    card: LinkCard | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    card: null
  })

  // Update temp settings when settings modal opens or when settings change while modal is open
  useEffect(() => {
    if (settingsOpen) {
      // Ensure all fields are present with defaults
      const defaultPlatformSettings: Record<string, PlatformDisplayMode> = {
        'YouTube': 'embed',
        'Twitter': 'embed',
        'TikTok': 'embed',
        'Reddit': 'embed',
        'Kick': 'embed',
        'Twitch': 'embed',
        'Streamable': 'embed',
        'Imgur': 'embed',
        'Wikipedia': 'embed',
        'Bluesky': 'embed',
        'LSF': 'embed',
      }
      setTempSettings({
        filter: Array.isArray(settings.filter) ? settings.filter : (settings.filter ? [settings.filter] : ['mrMouton']),
        showNSFW: settings.showNSFW ?? false,
        showNSFL: settings.showNSFL ?? false,
        showNonLinks: settings.showNonLinks ?? false,
        bannedTerms: Array.isArray(settings.bannedTerms) ? settings.bannedTerms : [],
        bannedUsers: Array.isArray(settings.bannedUsers) ? settings.bannedUsers : [],
        bannedLinks: Array.isArray(settings.bannedLinks) ? settings.bannedLinks : [],
        bannedMessages: Array.isArray(settings.bannedMessages) ? settings.bannedMessages : [],
        platformSettings: settings.platformSettings && typeof settings.platformSettings === 'object' ? settings.platformSettings : defaultPlatformSettings,
        linkOpenAction: settings.linkOpenAction || 'browser',
        trustedUsers: Array.isArray(settings.trustedUsers) ? settings.trustedUsers : [],
        mutedUsers: Array.isArray(settings.mutedUsers) ? settings.mutedUsers : [],
        keybinds: Array.isArray(settings.keybinds) ? settings.keybinds : settings.keybinds || [],
        theme: settings.theme || { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
        channels: settings.channels ?? { kick: { enabled: false, channelSlug: undefined } },
        footerDisplay: settings.footerDisplay ?? { showPlatformLabel: true, platformColorStyle: 'tint', timestampDisplay: 'datetimestamp' },
      })
    }
  }, [settingsOpen, settings])

  // Save settings when they change
  const updateSettings = (newSettings: Settings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }

  // Centralized link handling for Link Scroller
  const handleOpenLink = useCallback(async (url: string) => {
    const action: LinkOpenAction = linkOpenAction || 'browser'
    if (action === 'none') return
    try {
      await window.ipcRenderer.invoke('link-scroller-handle-link', { url, action })
    } catch (e) {
      logger.error('Failed to handle link open action:', e)
    }
  }, [linkOpenAction])

  // Context menu handlers – clamp position so menu stays on screen
  const CONTEXT_MENU_APPROX_WIDTH = 220
  const CONTEXT_MENU_APPROX_HEIGHT = 420
  const handleContextMenu = useCallback((e: React.MouseEvent, card: LinkCard) => {
    e.preventDefault()
    e.stopPropagation()
    
    let x = e.clientX
    let y = e.clientY
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + CONTEXT_MENU_APPROX_WIDTH > vw) x = vw - CONTEXT_MENU_APPROX_WIDTH
    if (y + CONTEXT_MENU_APPROX_HEIGHT > vh) y = vh - CONTEXT_MENU_APPROX_HEIGHT
    if (x < 0) x = 0
    if (y < 0) y = 0
    
    setContextMenu({
      visible: true,
      x,
      y,
      card
    })
    
    logger.api(`Context menu opened for card: ${card.id}, user: ${card.nick}`)
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu({ visible: false, x: 0, y: 0, card: null })
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu.visible) {
      const handleClick = () => closeContextMenu()
      window.addEventListener('click', handleClick)
      return () => window.removeEventListener('click', handleClick)
    }
  }, [contextMenu.visible, closeContextMenu])

  // Context menu actions
  const handleBanUser = useCallback((nick: string, platform: string) => {
    const entry = formatPlatformUser(platform, nick)
    const newBannedUsers = [...(settings.bannedUsers || [])]
    if (!newBannedUsers.some(e => parsePlatformUser(e)?.platform === platform && parsePlatformUser(e)?.nick.toLowerCase() === nick.toLowerCase())) {
      newBannedUsers.push(entry)
      updateSettings({ ...settings, bannedUsers: newBannedUsers })
    }
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])

  const handleTrustUser = useCallback((nick: string, platform: string) => {
    const entry = formatPlatformUser(platform, nick)
    const newTrustedUsers = [...(settings.trustedUsers || [])]
    if (!newTrustedUsers.some(e => parsePlatformUser(e)?.platform === platform && parsePlatformUser(e)?.nick.toLowerCase() === nick.toLowerCase())) {
      newTrustedUsers.push(entry)
      updateSettings({ ...settings, trustedUsers: newTrustedUsers })
    }
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])

  const handleUntrustUser = useCallback((nick: string, platform: string) => {
    const newTrustedUsers = (settings.trustedUsers || []).filter(entry => {
      const p = parsePlatformUser(entry)
      return !p || p.platform !== platform || p.nick.toLowerCase() !== nick.toLowerCase()
    })
    updateSettings({ ...settings, trustedUsers: newTrustedUsers })
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])

  const handleMuteUser = useCallback((nick: string) => {
    const now = Date.now()
    const muteUntil = now + (24 * 60 * 60 * 1000) // 24 hours from now
    const currentMutedUsers = cleanupExpiredMutes(settings.mutedUsers || [])
    
    // Remove existing mute for this user if any
    const filteredMuted = currentMutedUsers.filter(m => m.nick.toLowerCase() !== nick.toLowerCase())
    
    // Add new mute
    const newMutedUsers = [...filteredMuted, { nick, muteUntil }]
    logger.api(`Muting user: ${nick} until ${new Date(muteUntil).toLocaleString()}`)
    updateSettings({ ...settings, mutedUsers: newMutedUsers })
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])

  const handleUnmuteUser = useCallback((nick: string) => {
    const newMutedUsers = (settings.mutedUsers || []).filter(m => m.nick.toLowerCase() !== nick.toLowerCase())
    updateSettings({ ...settings, mutedUsers: newMutedUsers })
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])


  const handleCopyLink = useCallback((url: string) => {
    navigator.clipboard.writeText(url).catch(err => {
      logger.error('Failed to copy link:', err)
    })
    closeContextMenu()
  }, [closeContextMenu])

  const handleOpenAllLinks = useCallback((card: LinkCard) => {
    const urls = extractUrls(card.text)
    urls.forEach(url => {
      // Route through configured link-open behavior (browser/clipboard/viewer/none)
      handleOpenLink(url)
    })
    closeContextMenu()
  }, [closeContextMenu, handleOpenLink])

  const handleBanLink = useCallback((url: string) => {
    const normalized = normalizeUrlForBan(url)
    const current = settings.bannedLinks || []
    if (current.includes(normalized)) { closeContextMenu(); return }
    updateSettings({ ...settings, bannedLinks: [...current, normalized] })
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])

  const handleBanMessage = useCallback((messageIdToBan: string) => {
    const current = settings.bannedMessages || []
    if (current.includes(messageIdToBan)) { closeContextMenu(); return }
    updateSettings({ ...settings, bannedMessages: [...current, messageIdToBan] })
    closeContextMenu()
  }, [settings, updateSettings, closeContextMenu])

  const handleCopyMessage = useCallback((card: LinkCard) => {
    navigator.clipboard.writeText(card.text).catch(err => {
      logger.error('Failed to copy message:', err)
    })
    closeContextMenu()
  }, [closeContextMenu])

  const handleCopyUsername = useCallback((nick: string) => {
    navigator.clipboard.writeText(nick).catch(err => {
      logger.error('Failed to copy username:', err)
    })
    closeContextMenu()
  }, [closeContextMenu])

  // Track embed reload keys to force re-render
  const [embedReloadKeys, setEmbedReloadKeys] = useState<Map<string, number>>(new Map())
  
  const handleReloadEmbed = useCallback((cardId: string) => {
    // Force re-render by updating a reload key
    setEmbedReloadKeys(prev => {
      const newMap = new Map(prev)
      newMap.set(cardId, (newMap.get(cardId) || 0) + 1);
      return newMap
    })
    
    // If card is expanded, also refresh the expanded view
    if (expandedCardId === cardId) {
      setExpandedCardId(null)
      setTimeout(() => setExpandedCardId(cardId), 100)
    }
    
    // If card is highlighted, refresh highlight view
    if (highlightedCardId === cardId) {
      setHighlightedCardId(null)
      setTimeout(() => setHighlightedCardId(cardId), 100)
    }
    
    closeContextMenu()
  }, [expandedCardId, highlightedCardId, closeContextMenu])

  // Handle settings modal save
  const handleSaveSettings = () => {
    // Clean up expired mutes before saving
    const cleanedMutedUsers = cleanupExpiredMutes(tempSettings.mutedUsers || [])
    const cleanedSettings = { ...tempSettings, mutedUsers: cleanedMutedUsers }
    updateSettings(cleanedSettings)
    setSettingsOpen(false)
    // Theme settings live in the main Menu; re-apply current app theme just in case.
    applyThemeToDocument(getAppPreferences().theme)
  }
  
  // Helper function to get embed theme
  const getEmbedTheme = useCallback((): 'light' | 'dark' => {
    const appTheme = getAppPreferences().theme
    if (appTheme.embedTheme === 'follow') {
      // Follow the current app theme
      if (appTheme.mode === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        return mediaQuery.matches ? 'dark' : 'light'
      } else if (appTheme.mode === 'light') {
        return 'light'
      } else {
        return 'dark'
      }
    } else {
      // Override with explicit light or dark
      return appTheme.embedTheme
    }
  }, [])
  
  // Fetch emotes and load CSS on mount (URLs from main process config)
  useEffect(() => {
    const fetchEmotes = async () => {
      try {
        const config = await window.ipcRenderer.invoke('get-app-config').catch(() => null)
        const chatSources = config?.chatSources ?? {}
        const primaryId = Object.keys(chatSources)[0]
        const primary = primaryId ? chatSources[primaryId] : undefined
        if (!primary?.emotesJsonUrl || !primary?.emotesCssUrl) return
        const cacheKey = Date.now()
        const cssUrl = `${primary.emotesCssUrl}?_=${cacheKey}`
        await loadCSSOnce(cssUrl, 'primary-chat-emotes-css')
        const response = await fetch(`${primary.emotesJsonUrl}?_=${cacheKey}`, { cache: 'no-store' })
        if (!response.ok) {
          throw new Error(`Failed to fetch emotes: ${response.status}`)
        }
        const emotesData: EmoteData[] = await response.json()
        
        // Create a map of prefix -> exists (we just need to know which emotes exist for CSS classes)
        const map = new Map<string, string>()
        emotesData.forEach((emote) => {
          if (emote.image && emote.image.length > 0) {
            // Store a placeholder value (we don't need the URL for CSS-based rendering)
            map.set(emote.prefix, '')
          }
        })
        
        setEmotesMap(map)
        logger.api(`Loaded ${map.size} emotes with CSS`)
      } catch (error) {
        logger.error('Failed to fetch emotes or load CSS:', error)
        // Continue without emotes if fetch fails
      }
    }
    
    fetchEmotes()
  }, [])

  const SIZE = 150

  const fetchMentions = useCallback(async (filterTerms: string[], currentOffset: number, append: boolean = false, primaryChatEnabledFlag: boolean = true) => {
    if (fetchInProgressRef.current) {
      logger.api('fetchMentions: Another fetch already in progress, skipping duplicate call')
      return
    }
    if (!primaryChatEnabledFlag) {
      setLoading(false)
      setLoadingMore(false)
      if (!append) setMentions([])
      return
    }
    
    // Deduplicate and normalize filter terms (strip leading @ so "@nick" and "nick" are equivalent)
    const uniqueFilterTerms = Array.from(new Set(
      filterTerms.map(term => normalizeFilterTerm(term)).filter(term => term.length > 0)
    ))
    
    logger.api('fetchMentions called', {
      originalFilterTerms: filterTerms,
      uniqueFilterTerms,
      currentOffset,
      append,
      size: SIZE,
      timestamp: new Date().toISOString()
    })
    
    // Empty filter: use Rustlesearch only (channel history), skip mentions API
    if (uniqueFilterTerms.length === 0) {
      fetchInProgressRef.current = true
      if (!append) {
        setLoading(true)
        setError(null)
      } else {
        setLoadingMore(true)
      }
      try {
        logger.api('No filter terms: fetching channel history via Rustlesearch only')
        const rustleResult = await window.ipcRenderer.invoke('fetch-rustlesearch', [], append ? rustlesearchSearchAfter : undefined, SIZE)
        if (rustleResult.success && Array.isArray(rustleResult.data)) {
          const rustleData = rustleResult.data as MentionData[]
          const platform = primaryChatSourceId ?? ''
          const channel = primaryChatSourceMentionsChannel ?? primaryChatSourceId ?? ''
          const mergedData = rustleData.map(m => ({
            ...m,
            id: messageId(platform, channel, m.date, m.nick),
            matchedTerms: [] as string[],
            isStreaming: false,
            platform,
            channel
          })).sort((a, b) => b.date - a.date)
          if (append) {
            setMentions(prev => {
              const byId = new Map(prev.map(m => [m.id, m]))
              mergedData.forEach(m => { if (!byId.has(m.id)) byId.set(m.id, m) })
              return Array.from(byId.values()).sort((a, b) => b.date - a.date)
            })
            if (rustleResult.searchAfter) setRustlesearchSearchAfter(rustleResult.searchAfter)
            else setRustlesearchSearchAfter(undefined)
            setHasMore(rustleResult.hasMore ?? false)
          } else {
            // Preserve Kick messages that may have arrived from kick-chat-refetch-history during refresh
            setMentions(prev => {
              const kickOnly = prev.filter(m => m.platform === 'kick')
              const combined = [...mergedData, ...kickOnly].sort((a, b) => b.date - a.date)
              if (kickOnly.length > 0) logger.api(`Preserved ${kickOnly.length} Kick message(s) when setting Rustlesearch results`)
              return combined
            })
            setUsingRustlesearch(true)
            if (rustleResult.searchAfter) setRustlesearchSearchAfter(rustleResult.searchAfter)
            else setRustlesearchSearchAfter(undefined)
            setHasMore(rustleResult.hasMore ?? false)
          }
        } else if (!append) {
          setMentions([])
          setError(rustleResult.error || 'Failed to load channel history')
        }
      } catch (err) {
        logger.error('Rustlesearch channel-only fetch failed:', err)
        if (!append) {
          setMentions([])
          setError(err instanceof Error ? err.message : 'Failed to load channel history')
        }
      } finally {
        fetchInProgressRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
      return
    }

    // Mark fetch as in progress
    fetchInProgressRef.current = true
    
    if (append) {
      setLoadingMore(true)
      logger.api(`Loading more mentions (offset: ${currentOffset})`)
    } else {
      setLoading(true)
      setError(null)
      logger.api(`Fetching fresh mentions (offset: ${currentOffset})`)
    }
    
    try {
      const startTime = Date.now()
      
      // Fetch mentions API only when we have filter terms (exclude when empty)
      const useCache = append || currentOffset > 0
      logger.api(`Fetching mentions for ${uniqueFilterTerms.length} unique terms (${filterTerms.length} original) - cache: ${useCache}`)
      logger.api(`Terms to fetch: ${uniqueFilterTerms.map((t, i) => `${i + 1}. "${t}"`).join(', ')}`)
      
      const fetchPromises = uniqueFilterTerms.map((term, index) => {
        logger.api(`[${index + 1}/${uniqueFilterTerms.length}] Starting fetch for term: "${term}"`)
        return window.ipcRenderer.invoke('fetch-mentions', term, SIZE, currentOffset, useCache)
          .then(result => {
            logger.api(`[${index + 1}/${uniqueFilterTerms.length}] Completed fetch for "${term}": success=${result.success}, dataLength=${result.data?.length || 0}, cached=${result.cached || false}`)
            if (!result.success) {
              logger.error(`[${index + 1}/${uniqueFilterTerms.length}] Fetch failed for "${term}": ${result.error || 'Unknown error'}`)
            }
            return result
          })
          .catch(error => {
            logger.error(`[${index + 1}/${uniqueFilterTerms.length}] Fetch exception for "${term}":`, error)
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error', data: [] }
          })
      })
      
      const results = await Promise.all(fetchPromises)
      const fetchTime = Date.now() - startTime
      const cachedCount = results.filter(r => r.cached).length
      const successCount = results.filter(r => r.success).length
      const dataCount = results.reduce((sum, r) => sum + (Array.isArray(r.data) ? r.data.length : 0), 0)
      logger.api(`All IPC calls completed in ${fetchTime}ms - Success: ${successCount}/${results.length}, Cached: ${cachedCount}/${results.length}, Total data: ${dataCount} mentions`)
      
      // Merge results by unique ID (date-nick)
      const mentionsMap = new Map<string, MentionData>()
      
      results.forEach((result, index) => {
        const term = uniqueFilterTerms[index]
        if (result.success && Array.isArray(result.data)) {
          const termData = result.data as MentionData[]
          const source = result.cached ? 'cache' : 'API'
          logger.api(`Processing ${termData.length} mentions for term "${term}" (from ${source}, offset=${currentOffset})`)
          
          if (termData.length === 0) {
            logger.api(`⚠️ Term "${term}" returned 0 mentions (success but empty) - may have reached end`)
          } else if (append && termData.length < SIZE) {
            logger.api(`⚠️ Term "${term}" returned only ${termData.length} mentions (expected ${SIZE}) - may have reached end`)
            // Log date range to verify we're getting older messages
            const oldest = termData[termData.length - 1]
            const newest = termData[0]
            logger.api(`  Date range for "${term}": ${new Date(oldest.date).toISOString()} (oldest) to ${new Date(newest.date).toISOString()} (newest)`)
          }
          
          const platform = primaryChatSourceId ?? ''
          const channel = primaryChatSourceMentionsChannel ?? primaryChatSourceId ?? ''
          termData.forEach(mention => {
            const matchesAsWord = filterTermMatchesAsWord(mention.text, term)
            if (!matchesAsWord) return
            const uniqueId = messageId(platform, channel, mention.date, mention.nick)
            if (mentionsMap.has(uniqueId)) {
              const existing = mentionsMap.get(uniqueId)!
              if (!existing.matchedTerms.includes(term)) {
                existing.matchedTerms.push(term)
              }
            } else {
              mentionsMap.set(uniqueId, {
                ...mention,
                id: uniqueId,
                matchedTerms: [term],
                isStreaming: false,
                platform,
                channel
              })
            }
          })
        } else {
          const errorMsg = result.error || 'Unknown error'
          logger.error(`❌ Fetch failed for term "${term}": ${errorMsg}`)
          logger.api(`Failed mention fetch details - term: "${term}", error: ${errorMsg}, success: ${result.success}`)
        }
      })
      
      // Convert map to array and sort by date (newest first)
      let mergedData = Array.from(mentionsMap.values()).sort((a, b) => b.date - a.date)
      logger.api(`Merged ${mergedData.length} unique mentions from ${uniqueFilterTerms.length} unique terms`)
      
      // If mentions API returned no results and we're not appending, try rustlesearch fallback
      if (mergedData.length === 0 && !append) {
        logger.api('Mentions API returned no results, trying rustlesearch fallback')
        logger.api(`Filter terms: ${uniqueFilterTerms.join(', ')}`)
        
        try {
          logger.api(`Invoking fetch-rustlesearch IPC with terms: ${uniqueFilterTerms.join(', ')}`)
          const rustleResult = await window.ipcRenderer.invoke('fetch-rustlesearch', uniqueFilterTerms, undefined, SIZE)
          
          logger.api(`Rustlesearch IPC result: success=${rustleResult.success}, dataLength=${rustleResult.data?.length || 0}, error=${rustleResult.error || 'none'}`)
          
          if (rustleResult.success && Array.isArray(rustleResult.data)) {
            const rustleData = rustleResult.data as MentionData[]
            logger.api(`Rustlesearch returned ${rustleData.length} messages`)
            
            if (rustleData.length > 0) {
              logger.api(`First rustlesearch message: date=${new Date(rustleData[0].date).toISOString()}, nick=${rustleData[0].nick}, text=${rustleData[0].text.substring(0, 50)}...`)
            }
            
            const platform = primaryChatSourceId ?? ''
            const channel = primaryChatSourceMentionsChannel ?? primaryChatSourceId ?? ''
            mergedData = rustleData.map(m => ({
              ...m,
              id: messageId(platform, channel, m.date, m.nick),
              isStreaming: false,
              platform,
              channel
            })).sort((a, b) => b.date - a.date)
            
            // Store searchAfter for pagination and mark as using rustlesearch
            if (rustleResult.searchAfter) {
              setRustlesearchSearchAfter(rustleResult.searchAfter)
              logger.api(`Stored rustlesearch searchAfter: ${rustleResult.searchAfter}`)
            }
            setUsingRustlesearch(true)
            logger.api('Marked as using rustlesearch fallback')
            
            // Update hasMore based on rustlesearch response
            setHasMore(rustleResult.hasMore || false)
            logger.api(`Set hasMore to: ${rustleResult.hasMore || false}`)
          } else {
            const errorMsg = rustleResult.error || 'Unknown error'
            logger.error('Rustlesearch fallback failed:', errorMsg)
            logger.error('Rustlesearch result details:', rustleResult)
            
            // Check for rate limit info
            if (rustleResult.rateLimitInfo) {
              const { retryAfter, retryDate } = rustleResult.rateLimitInfo
              if (retryAfter && retryDate) {
                const retryDateObj = new Date(retryDate)
                const minutesUntilRetry = Math.ceil(retryAfter / 60)
                const retryTimeStr = retryDateObj.toLocaleTimeString()
                
                logger.error(`Rate limited: Please wait ${minutesUntilRetry} minute(s) before retrying (retry after ${retryTimeStr})`)
                setError(`Rustlesearch API rate limited. Please wait ${minutesUntilRetry} minute(s) before retrying. (Retry after ${retryTimeStr})`)
              } else {
                setError(`Rustlesearch API error: ${errorMsg}`)
              }
            } else {
              setError(`Rustlesearch API error: ${errorMsg}`)
            }
            
            setHasMore(false)
          }
        } catch (rustleErr) {
          logger.error('Exception in rustlesearch fallback:', rustleErr)
          if (rustleErr instanceof Error) {
            logger.error('Error message:', rustleErr.message)
            logger.error('Error stack:', rustleErr.stack)
          }
          setHasMore(false)
        }
      } else if (append && usingRustlesearch && rustlesearchSearchAfter !== undefined) {
        // Continue using rustlesearch for pagination
        logger.api('Continuing with rustlesearch pagination')
        
        try {
          const rustleResult = await window.ipcRenderer.invoke(
            'fetch-rustlesearch', 
            uniqueFilterTerms, 
            rustlesearchSearchAfter, 
            SIZE
          )
          
          if (rustleResult.success && Array.isArray(rustleResult.data)) {
            const rustleData = rustleResult.data as MentionData[]
            logger.api(`Rustlesearch pagination returned ${rustleData.length} messages`)
            
            // Mark all rustlesearch pagination data as not streaming
            mergedData = rustleData.map(m => ({ ...m, isStreaming: false })).sort((a, b) => b.date - a.date)
            
            // Update searchAfter for next page
            if (rustleResult.searchAfter) {
              setRustlesearchSearchAfter(rustleResult.searchAfter)
            } else {
              setRustlesearchSearchAfter(undefined)
            }
            
            setHasMore(rustleResult.hasMore || false)
          } else {
            const errorMsg = rustleResult.error || 'Unknown error'
            logger.error('Rustlesearch pagination failed:', errorMsg)
            
            // Check for rate limit info
            if (rustleResult.rateLimitInfo) {
              const { retryAfter, retryDate } = rustleResult.rateLimitInfo
              if (retryAfter && retryDate) {
                const retryDateObj = new Date(retryDate)
                const minutesUntilRetry = Math.ceil(retryAfter / 60)
                const retryTimeStr = retryDateObj.toLocaleTimeString()
                
                logger.error(`Rate limited: Please wait ${minutesUntilRetry} minute(s) before retrying (retry after ${retryTimeStr})`)
                setError(`Rustlesearch API rate limited. Please wait ${minutesUntilRetry} minute(s) before retrying. (Retry after ${retryTimeStr})`)
              } else {
                setError(`Rustlesearch API error: ${errorMsg}`)
              }
            } else {
              setError(`Rustlesearch API error: ${errorMsg}`)
            }
            
            setHasMore(false)
          }
        } catch (rustleErr) {
          logger.error('Exception in rustlesearch pagination:', rustleErr)
          setHasMore(false)
        }
      } else {
        // Normal mentions API flow
        logger.api(`Skipping rustlesearch fallback: mergedData.length=${mergedData.length}, append=${append}, usingRustlesearch=${usingRustlesearch}`)
        
        // Calculate hasMore based on whether any term returned the full requested size
        // When loading older messages, if any term returns fewer than SIZE, we've likely reached the end
        const anyReturnedFullSize = results.some(r => r.success && Array.isArray(r.data) && r.data.length >= SIZE)
        const hasMoreResult = anyReturnedFullSize && mergedData.length > 0
        
        // For offset calculation: when appending, we need to increment by the number of messages
        // we actually received from the API (not merged unique count, which might be less due to duplicates)
        // Use the maximum data length from any successful fetch to ensure we don't miss messages
        const maxDataLength = Math.max(...results.filter(r => r.success && Array.isArray(r.data)).map(r => r.data.length), 0)
        const newOffset = append ? currentOffset + maxDataLength : mergedData.length
        
        setHasMore(hasMoreResult)
        setOffset(newOffset)
        logger.api(`Updated state: offset=${newOffset} (was ${currentOffset}, maxDataLength=${maxDataLength}, mergedData.length=${mergedData.length}), hasMore=${hasMoreResult}`)
        logger.api(`Offset calculation: append=${append}, anyReturnedFullSize=${anyReturnedFullSize}, results with data: ${results.filter(r => r.success && Array.isArray(r.data)).map(r => r.data.length).join(', ')}`)
      }
      
      if (mergedData.length > 0) {
        const firstFew = mergedData.slice(0, 3).map(m => ({
          date: new Date(m.date).toISOString(),
          text: m.text.substring(0, 50) + '...',
          matchedTerms: m.matchedTerms
        }))
        logger.debug('First 3 merged mentions:', firstFew)
      }
      
      if (append) {
        setMentions(prev => {
          // Merge with existing, avoiding duplicates
          const existingMap = new Map<string, MentionData>()
          prev.forEach(m => existingMap.set(m.id, m))
          
          const beforeCount = existingMap.size
          mergedData.forEach(m => {
            if (existingMap.has(m.id)) {
              // Merge matchedTerms
              const existing = existingMap.get(m.id)!
              m.matchedTerms.forEach(term => {
                if (!existing.matchedTerms.includes(term)) {
                  existing.matchedTerms.push(term)
                }
              })
            } else {
              existingMap.set(m.id, m)
            }
          })
          
          const combined = Array.from(existingMap.values()).sort((a, b) => b.date - a.date)
          const newCount = existingMap.size - beforeCount
          logger.api(`Appended mentions: ${newCount} new (${mergedData.length} total merged, ${beforeCount} existing, ${combined.length} total now)`)
          
          // Log date range of newly added messages for debugging
          if (newCount > 0) {
            const newMessages = combined.filter(m => !prev.some(p => p.id === m.id))
            if (newMessages.length > 0) {
              const oldestNew = newMessages[newMessages.length - 1]
              const newestNew = newMessages[0]
              logger.api(`New messages date range: ${new Date(oldestNew.date).toISOString()} (oldest) to ${new Date(newestNew.date).toISOString()} (newest)`)
            }
          }
          
          return combined
        })
      } else {
        logger.api('Setting initial mentions (merging with existing WebSocket messages)')
        // Merge with existing mentions instead of replacing, to preserve WebSocket messages
        setMentions(prev => {
          const existingMap = new Map<string, MentionData>()
          prev.forEach(m => existingMap.set(m.id, m))
          
          mergedData.forEach(m => {
            if (existingMap.has(m.id)) {
              // Merge matchedTerms
              const existing = existingMap.get(m.id)!
              m.matchedTerms.forEach(term => {
                if (!existing.matchedTerms.includes(term)) {
                  existing.matchedTerms.push(term)
                }
              })
            } else {
              existingMap.set(m.id, m)
            }
          })
          
          const combined = Array.from(existingMap.values()).sort((a, b) => b.date - a.date)
          logger.api(`Merged initial mentions. Total now: ${combined.length} (${prev.length} existing + ${mergedData.length} new)`)
          
          // Set refresh timestamp when initial load completes
          setRefreshTimestamp(Date.now())
          
          return combined
        })
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      logger.error('Exception in fetchMentions:', err)
      logger.error('Error details:', {
        message: errorMsg,
        stack: err instanceof Error ? err.stack : 'No stack trace'
      })
      setError(errorMsg)
      setHasMore(false)
    } finally {
      // Mark fetch as complete
      fetchInProgressRef.current = false
      
      if (append) {
        setLoadingMore(false)
        logger.api('Finished loading more')
      } else {
        setLoading(false)
        logger.api('Finished fetching')
      }
    }
  }, [usingRustlesearch, rustlesearchSearchAfter])

  // Reset state when filter changes (empty = channel-only via Rustlesearch; has terms = wait for WebSocket then mentions API)
  useEffect(() => {
    setOffset(0)
    setHasMore(true)
    setUsingRustlesearch(false)
    setRustlesearchSearchAfter(undefined)
    setMentions([])
    setRefreshTimestamp(null)
    if (filter && filter.length > 0) {
      setWebsocketHistoryReceived(false)
      logger.api('Filter changed, resetting state and waiting for WebSocket history')
    } else {
      logger.api('Filter empty, will fetch channel history via Rustlesearch only')
    }
  }, [filter])

  // Fetch: with filter terms wait for WebSocket history then use mentions API; with no terms use Rustlesearch only
  useEffect(() => {
    if (!primaryChatEnabled) return
    const hasTerms = filter && filter.length > 0
    if (hasTerms && !websocketHistoryReceived) return
    if (hasTerms) logger.api('WebSocket history received, now fetching mentions API')
    else logger.api('No filter terms, fetching channel history via Rustlesearch')
    fetchMentions(filter || [], 0, false, primaryChatEnabled)
  }, [filter, fetchMentions, websocketHistoryReceived, primaryChatEnabled])

  // WebSocket connection for streaming messages
  useEffect(() => {
    if (!primaryChatEnabled) {
      setWebsocketHistoryReceived(true)
      return
    }
    // Clear any existing timeout
    if (websocketHistoryTimeoutRef.current) {
      clearTimeout(websocketHistoryTimeoutRef.current)
      websocketHistoryTimeoutRef.current = null
    }
    
    websocketHistoryTimeoutRef.current = setTimeout(() => {
      if (!websocketHistoryReceived && filter && filter.length > 0) {
        logger.api('WebSocket history timeout - proceeding with mentions API fetch')
        setWebsocketHistoryReceived(true)
      }
      websocketHistoryTimeoutRef.current = null
    }, 5000)

    window.ipcRenderer.invoke('chat-websocket-connect').catch((err) => {
      logger.error('Failed to connect chat WebSocket:', err)
      if (!websocketHistoryReceived && filter && filter.length > 0) {
        logger.api('WebSocket connection failed - proceeding with mentions API fetch')
        setWebsocketHistoryReceived(true)
      }
    })

    // Listen for WebSocket messages (primary chat source)
    const handleMessage = (_event: any, data: { type: 'MSG'; message: any }) => {
      if (data.type === 'MSG' && data.message) {
        const chatMsg = data.message
        const platform = primaryChatSourceId ?? ''
        const channel = primaryChatSourceMentionsChannel ?? primaryChatSourceId ?? ''
        const date = chatMsg.timestamp
        const nick = chatMsg.nick
        const mention: MentionData = {
          id: messageId(platform, channel, date, nick),
          date,
          text: chatMsg.data,
          nick,
          flairs: chatMsg.features?.join(',') || '',
          matchedTerms: [],
          isStreaming: true,
          platform,
          channel
        }

        // When no filter terms, show all; otherwise only if message matches a term (whole-word)
        const matchingTerms: string[] = []
        if (filter && filter.length > 0) {
          filter.forEach(term => {
            if (filterTermMatchesAsWord(mention.text, term)) {
              matchingTerms.push(term)
            }
          })
        }
        const shouldAdd = filter && filter.length > 0 ? matchingTerms.length > 0 : true
        if (shouldAdd) {
          mention.matchedTerms = filter && filter.length > 0 ? matchingTerms : []
          
          // Prepend to mentions (newest first)
          setMentions(prev => {
            // Check if already exists (avoid duplicates)
            const exists = prev.some(m => m.id === mention.id)
            if (exists) {
              return prev
            }
            return [mention, ...prev]
          })
        }
      }
    }

    const handleHistory = (_event: any, history: { type: 'HISTORY'; messages: any[] }) => {
      if (history.type === 'HISTORY' && history.messages) {
        logger.api(`Received ${history.messages.length} messages from WebSocket history`)
        
        // Convert and filter history messages
        const filteredMentions: MentionData[] = []
        
        const platform = primaryChatSourceId ?? ''
        const channel = primaryChatSourceMentionsChannel ?? primaryChatSourceId ?? ''
        history.messages.forEach(chatMsg => {
          const date = chatMsg.timestamp
          const nick = chatMsg.nick
          const mention: MentionData = {
            id: messageId(platform, channel, date, nick),
            date,
            text: chatMsg.data,
            nick,
            flairs: chatMsg.features?.join(',') || '',
            matchedTerms: [],
            isStreaming: false,
            platform,
            channel
          }

          const matchingTerms: string[] = []
          if (filter && filter.length > 0) {
            filter.forEach(term => {
              if (filterTermMatchesAsWord(mention.text, term)) {
                matchingTerms.push(term)
              }
            })
          }
          const shouldAdd = filter && filter.length > 0 ? matchingTerms.length > 0 : true
          if (shouldAdd) {
            mention.matchedTerms = filter && filter.length > 0 ? matchingTerms : []
            filteredMentions.push(mention)
          }
        })

        if (filteredMentions.length > 0) {
          // Set WebSocket history messages first (these are the newest)
          // Sort by date (newest first)
          const sortedHistory = filteredMentions.sort((a, b) => b.date - a.date)
          
          setMentions(prev => {
            // Only merge if there are existing mentions (from previous loads)
            // Otherwise, set as initial data
            if (prev.length === 0) {
              logger.api(`Setting initial ${sortedHistory.length} messages from WebSocket history`)
              return sortedHistory
            } else {
              // Merge with existing, avoiding duplicates
              const existingMap = new Map<string, MentionData>()
              prev.forEach(m => existingMap.set(m.id, m))
              
              sortedHistory.forEach(m => {
                if (!existingMap.has(m.id)) {
                  existingMap.set(m.id, m)
                }
              })
              
              const merged = Array.from(existingMap.values()).sort((a, b) => b.date - a.date)
              logger.api(`Merged ${sortedHistory.length} WebSocket history messages. Total now: ${merged.length}`)
              return merged
            }
          })
          
          logger.api(`Added ${filteredMentions.length} filtered messages from WebSocket history`)
        } else {
          logger.api('No WebSocket history messages matched filter terms')
        }
        
        // Mark WebSocket history as received, which will trigger mentions API fetch
        // Clear the timeout since we received history (even if no messages matched)
        if (websocketHistoryTimeoutRef.current) {
          clearTimeout(websocketHistoryTimeoutRef.current)
          websocketHistoryTimeoutRef.current = null
        }
        setWebsocketHistoryReceived(true)
      }
    }

    const handleConnected = () => {
      logger.api('Chat WebSocket connected')
    }

    const handleDisconnected = (_event: any, data: any) => {
      logger.api('Chat WebSocket disconnected', data)
    }

    const handleError = (_event: any, error: any) => {
      logger.error('Chat WebSocket error:', error)
    }

    // Register event listeners
    window.ipcRenderer.on('chat-websocket-message', handleMessage)
    window.ipcRenderer.on('chat-websocket-history', handleHistory)
    window.ipcRenderer.on('chat-websocket-connected', handleConnected)
    window.ipcRenderer.on('chat-websocket-disconnected', handleDisconnected)
    window.ipcRenderer.on('chat-websocket-error', handleError)

    // Cleanup on unmount
    return () => {
      window.ipcRenderer.off('chat-websocket-message', handleMessage)
      window.ipcRenderer.off('chat-websocket-history', handleHistory)
      window.ipcRenderer.off('chat-websocket-connected', handleConnected)
      window.ipcRenderer.off('chat-websocket-disconnected', handleDisconnected)
      window.ipcRenderer.off('chat-websocket-error', handleError)
      
      // Disconnect WebSocket when component unmounts
      window.ipcRenderer.invoke('chat-websocket-disconnect').catch((err) => {
        logger.error('Failed to disconnect chat WebSocket:', err)
      })
      
      // Clear timeout on cleanup
      if (websocketHistoryTimeoutRef.current) {
        clearTimeout(websocketHistoryTimeoutRef.current)
        websocketHistoryTimeoutRef.current = null
      }
    }
  }, [filter, websocketHistoryReceived, primaryChatEnabled])

  // Kick channel: set targets and listen for messages when Kick is enabled
  const kickEnabled = !!settings.channels?.kick?.enabled
  const kickSlug = (settings.channels?.kick?.channelSlug || '').trim()
  useEffect(() => {
    if (!kickEnabled || !kickSlug) {
      window.ipcRenderer.invoke('kick-chat-set-targets', { slugs: [] }).catch(() => {})
      return
    }
    window.ipcRenderer.invoke('kick-chat-set-targets', { slugs: [kickSlug] }).catch((err) => {
      logger.error('Failed to set Kick chat targets:', err)
    })
    // Delayed refetch so history is retried after initial fetch (e.g. if cookies weren't ready)
    const refetchTimer = window.setTimeout(() => {
      window.ipcRenderer.invoke('kick-chat-refetch-history', { slugs: [kickSlug] }).catch(() => {})
    }, 4500)
    const handleKickMessage = (_event: any, msg: { platform: 'kick'; slug: string; content: string; createdAt: string; sender?: { username?: string; slug?: string }; isHistory?: boolean; emotes?: KickEmote[] }) => {
      if (!msg || msg.platform !== 'kick') return
      const platform = 'kick'
      const channel = msg.slug || 'unknown'
      const date = Number.isFinite(Date.parse(msg.createdAt)) ? Date.parse(msg.createdAt) : Date.now()
      const nick = msg.sender?.username || msg.sender?.slug || 'kick'
      const mention: MentionData = {
        id: messageId(platform, channel, date, nick),
        date,
        text: msg.content ?? '',
        nick,
        flairs: '',
        matchedTerms: [],
        isStreaming: !msg.isHistory,
        platform,
        channel,
        kickEmotes: Array.isArray(msg.emotes) ? msg.emotes : undefined
      }
      const matchingTerms: string[] = []
      if (filter && filter.length > 0) {
        filter.forEach(term => {
          if (filterTermMatchesAsWord(mention.text, term)) matchingTerms.push(term)
        })
        if (matchingTerms.length === 0) return
        mention.matchedTerms = matchingTerms
      } else {
        mention.matchedTerms = []
      }
      setMentions(prev => {
        const exists = prev.some(m => m.id === mention.id)
        if (exists) return prev
        return [mention, ...prev]
      })
    }
    window.ipcRenderer.on('kick-chat-message', handleKickMessage)
    return () => {
      window.clearTimeout(refetchTimer)
      window.ipcRenderer.off('kick-chat-message', handleKickMessage)
      window.ipcRenderer.invoke('kick-chat-set-targets', { slugs: [] }).catch(() => {})
    }
  }, [kickEnabled, kickSlug, filter])

  // Handle load more button click (only when primary chat enabled; Kick has no long history)
  const handleLoadMore = useCallback(() => {
    if (!primaryChatEnabled || loadingMore || !hasMore || loading) return
    fetchMentions(filter, offset, true, primaryChatEnabled)
  }, [primaryChatEnabled, filter, offset, loadingMore, hasMore, loading, fetchMentions])

  // Dedicated scroll container for overview mode (so scrolling keeps working even if <body> is locked)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const handleScroll = useCallback(() => {
    if (!primaryChatEnabled || loadingMore || !hasMore || loading) return
    const el = scrollContainerRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchMentions(filter, offset, true, primaryChatEnabled)
    }
  }, [primaryChatEnabled, filter, offset, loadingMore, hasMore, loading, fetchMentions])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll)
    return () => {
      el.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  // Cache for card objects to prevent unnecessary re-renders
  const cardCacheRef = useRef<Map<string, LinkCard>>(new Map())
  
  // Process mentions into link cards
  const linkCards = useMemo(() => {
    const cards: LinkCard[] = []
    const newCache = new Map<string, LinkCard>()
    
    mentions.forEach((mention) => {
      // When filter terms are set, only show mentions that matched at least one term
      if (filter && filter.length > 0 && (!mention.matchedTerms || mention.matchedTerms.length === 0)) {
        return
      }

      // Filter out NSFW if toggle is off
      if (!showNSFW && containsNSFW(mention.text)) {
        return // Skip this mention entirely
      }

      // Filter out NSFL if toggle is off
      if (!showNSFL && containsNSFL(mention.text)) {
        return // Skip this mention entirely
      }

      // Filter out banned terms
      if (containsBannedTerms(mention.text, bannedTerms)) {
        return // Skip this mention entirely
      }

      // Filter out banned users
      if (isBannedUser(mention.nick, mention.platform ?? primaryChatSourceId ?? '', bannedUsers)) {
        return
      }

      // Filter out banned messages (whole message hidden)
      if (bannedMessages?.includes(mention.id)) {
        return
      }

      // Filter out muted users (mutes expire after 24 hours)
      if (isMutedUser(mention.nick, mutedUsers)) {
        return // Skip this mention entirely
      }

      const urls = extractUrls(mention.text)
      
      // If there are URLs, create cards for each URL
      if (urls.length > 0) {
        urls.forEach((url, urlIndex) => {
          // Check if this is a Reddit media link and extract the actual media URL
          let actualUrl = url
          let isRedditMedia = false
          if (isRedditMediaLink(url)) {
            try {
              const urlObj = new URL(url)
              const mediaUrl = urlObj.searchParams.get('url')
              if (mediaUrl) {
                actualUrl = decodeURIComponent(mediaUrl)
                isRedditMedia = true
              }
            } catch {
              // If parsing fails, use original URL
            }
          }
          
          const mediaInfo = isDirectMedia(actualUrl)
          const isYouTubeClip = isYouTubeClipLink(actualUrl)
          // Only treat as embeddable YouTube if it's not a clip
          const isYouTube = isYouTubeLink(actualUrl) && !isYouTubeClip
          const embedUrl = isYouTube ? getYouTubeEmbedUrl(actualUrl) : undefined
          const isTwitter = isTwitterStatusLink(actualUrl)
          const isTwitterTimeline = isTwitterTimelineLink(actualUrl)
          const isTikTok = isTikTokVideoLink(actualUrl)
          const isReddit = isRedditPostLink(actualUrl) && !isRedditMedia
          const isImgur = isImgurAlbumLink(url) // Check original URL, not actualUrl
          const isStreamable = isStreamableLink(actualUrl)
          const isWikipedia = isWikipediaLink(actualUrl)
          const isBluesky = isBlueskyLink(actualUrl)
          const isKick = isKickLink(actualUrl)
          const isLSF = isLSFLink(actualUrl)
          
          const linkType = getLinkType(url)
          
          // Filter out platforms set to 'filter'
          if (isPlatformFiltered(linkType, platformSettings)) {
            return
          }
          
          // Create unique ID using date, nick, urlIndex, and a hash of the URL
          // This ensures uniqueness even if the same URL appears multiple times
          // Note: Using mention.id (which is date-nick) instead of index for stability
          const urlHash = url.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
          const uniqueId = `${mention.id}-${urlIndex}-${urlHash}-${url.slice(-20)}`
          
          // Check if user is trusted
          const isTrusted = isTrustedUser(mention.nick, mention.platform ?? primaryChatSourceId ?? '', trustedUsers)
          
          // Check if we have a cached card with the same data
          const cachedCard = cardCacheRef.current.get(uniqueId)
          const cardData = {
            id: uniqueId,
            messageId: mention.id,
            platform: mention.platform,
            channel: mention.channel,
            kickEmotes: mention.kickEmotes,
            url: actualUrl,
            text: mention.text,
            nick: mention.nick,
            date: mention.date,
            isDirectMedia: mediaInfo.isMedia,
            mediaType: mediaInfo.type,
            linkType: linkType,
            embedUrl: embedUrl ?? undefined,
            isYouTube,
            isTwitter,
            isTwitterTimeline,
            isTikTok,
            isReddit,
            isImgur,
            isStreamable,
            isWikipedia,
            isBluesky,
            isKick,
            isLSF,
            isTrusted,
            isStreaming: mention.isStreaming,
          }
          
          // Reuse cached card if data matches, otherwise create new one
          let card: LinkCard
          if (cachedCard &&
              cachedCard.messageId === cardData.messageId &&
              cachedCard.url === cardData.url &&
              cachedCard.text === cardData.text &&
              cachedCard.nick === cardData.nick &&
              cachedCard.date === cardData.date &&
              cachedCard.isTrusted === cardData.isTrusted &&
              cachedCard.isStreaming === cardData.isStreaming) {
            card = cachedCard
          } else {
            card = cardData
          }
          if (card.url && bannedLinks?.includes(normalizeUrlForBan(card.url))) return
          cards.push(card)
          newCache.set(uniqueId, card)
        })
      } else if (showNonLinks) {
        // If no URLs and showNonLinks is enabled, create a card for the message
        // Use mention.id (date-nick) for stable ID
        const uniqueId = `${mention.id}-no-link`
        const isTrusted = isTrustedUser(mention.nick, mention.platform ?? primaryChatSourceId ?? '', trustedUsers)
        
        const cardData = {
          id: uniqueId,
          messageId: mention.id,
          platform: mention.platform,
          channel: mention.channel,
          kickEmotes: mention.kickEmotes,
          url: '',
          text: mention.text,
          nick: mention.nick,
          date: mention.date,
          isDirectMedia: false,
          linkType: undefined,
          isTrusted,
          isStreaming: mention.isStreaming,
        }
        
        // Check if we have a cached card with the same data
        const cachedCard = cardCacheRef.current.get(uniqueId)
        let card: LinkCard
        if (cachedCard &&
            cachedCard.messageId === cardData.messageId &&
            cachedCard.text === cardData.text &&
            cachedCard.nick === cardData.nick &&
            cachedCard.date === cardData.date &&
            cachedCard.isTrusted === cardData.isTrusted &&
            cachedCard.isStreaming === cardData.isStreaming) {
          card = cachedCard
        } else {
          card = cardData
        }
        cards.push(card)
        newCache.set(uniqueId, card)
      }
    })

    // Update cache for next render
    cardCacheRef.current = newCache
    
    return cards
  }, [mentions, filter, showNSFW, showNSFL, showNonLinks, bannedTerms, bannedUsers, bannedLinks, bannedMessages, platformSettings, trustedUsers, mutedUsers])

  const highlightedCard = linkCards.find(card => card.id === highlightedCardId)
  const highlightedIndex = highlightedCardId ? linkCards.findIndex(card => card.id === highlightedCardId) : -1
  
  // Memoize streaming and historical cards separately to prevent unnecessary recomputation
  // This ensures that when only streaming cards change, historical cards masonry doesn't recompute
  const streamingCards = useMemo(() => {
    const filtered = linkCards.filter(card => card.isStreaming === true)
    // Ensure streaming cards are sorted newest first (by date descending)
    // Lower timestamp = older, higher timestamp = newer
    // We want newest (higher timestamp) at top, so sort descending
    // IMPORTANT: dateB - dateA gives descending (newest first)
    const sorted = [...filtered].sort((a, b) => {
      // Dates should already be numbers (timestamps), but ensure they are
      const dateA = typeof a.date === 'number' ? a.date : new Date(a.date).getTime()
      const dateB = typeof b.date === 'number' ? b.date : new Date(b.date).getTime()
      // dateB - dateA: if dateB > dateA (newer), result is positive, so b comes before a
      // This gives descending order: [newest, ..., oldest]
      const result = dateB - dateA
      return result
    })
    return sorted
  }, [linkCards])
  const historicalCards = useMemo(() => {
    const filtered = linkCards.filter(card => card.isStreaming !== true)
    // Historical cards should be sorted newest first (by date descending)
    // Lower timestamp = older, higher timestamp = newer
    // We want newest (higher timestamp) at top, so sort descending
    return [...filtered].sort((a, b) => {
      // Ensure dates are numbers for proper comparison
      const dateA = typeof a.date === 'number' ? a.date : new Date(a.date).getTime()
      const dateB = typeof b.date === 'number' ? b.date : new Date(b.date).getTime()
      return dateB - dateA // Descending: newest first
    })
  }, [linkCards])

  // Fetch Imgur album data when an Imgur card is highlighted
  useEffect(() => {
    if (highlightedCard?.isImgur && highlightedCard.url) {
      console.log(`[Renderer] Fetching Imgur album for URL: ${highlightedCard.url}`)
      setLoadingImgurAlbum(true)
      setImgurAlbumError(null)
      setImgurAlbumData(null)
      
      const startTime = Date.now()
      window.ipcRenderer.invoke('fetch-imgur-album', highlightedCard.url)
        .then((result) => {
          const fetchTime = Date.now() - startTime
          logger.api(`Imgur album IPC call completed in ${fetchTime}ms`, {
            success: result.success,
            hasData: result.success && !!result.data,
            error: result.success ? null : result.error
          })
          
          if (result.success && result.data) {
            logger.api('Imgur album data received', {
              id: result.data.id,
              title: result.data.title,
              image_count: result.data.image_count,
              media_count: result.data.media?.length || 0
            })
            setImgurAlbumData(result.data)
            setImgurAlbumError(null)
          } else {
            const errorMsg = result.error || 'Failed to fetch Imgur album'
            logger.error(`Imgur album fetch failed: ${errorMsg}`)
            setImgurAlbumError(errorMsg)
            setImgurAlbumData(null)
          }
        })
        .catch((err) => {
          const fetchTime = Date.now() - startTime
          logger.error(`Error fetching Imgur album (took ${fetchTime}ms):`, err)
          setImgurAlbumError(err?.message || 'Unknown error occurred')
          setImgurAlbumData(null)
        })
        .finally(() => {
          setLoadingImgurAlbum(false)
        })
    } else {
      // Clear Imgur data when not viewing an Imgur card
      setImgurAlbumData(null)
      setImgurAlbumError(null)
      setLoadingImgurAlbum(false)
    }
  }, [highlightedCard?.id, highlightedCard?.isImgur, highlightedCard?.url])

  const navigateHighlight = useCallback(async (direction: 'prev' | 'next') => {
    if (highlightedIndex === -1) return
    
    if (direction === 'next') {
      // If we're at the end, try to load more
      if (highlightedIndex === linkCards.length - 1) {
        if (hasMore && primaryChatEnabled && !loadingMore && !loading) {
          logger.api('At end of list, loading more mentions...')
          waitingForMoreRef.current = true
          await fetchMentions(filter, offset, true, primaryChatEnabled)
          // The useEffect below will handle advancing to the next card after loading
        } else {
          // No more to load or already loading, loop around to beginning
          waitingForMoreRef.current = false
          setHighlightedCardId(linkCards[0].id)
        }
      } else {
        // Not at end, just move to next
        waitingForMoreRef.current = false
        setHighlightedCardId(linkCards[highlightedIndex + 1].id)
      }
    } else {
      // Previous direction
      waitingForMoreRef.current = false
      if (highlightedIndex === 0) {
        // At beginning, refresh to get latest content
        logger.api('At beginning of list, refreshing feed...')
        refreshingRef.current = true
        // Refresh the feed from the beginning
        setMentions([])
        setOffset(0)
        setHasMore(true)
        setLoading(true)
        setError(null)
        await fetchMentions(filter, 0, false, primaryChatEnabled)
        // The useEffect below will handle highlighting the first card after refresh
      } else {
        // Not at beginning, just move to previous
        setHighlightedCardId(linkCards[highlightedIndex - 1].id)
      }
    }
  }, [highlightedIndex, linkCards, hasMore, primaryChatEnabled, loadingMore, loading, filter, offset, fetchMentions])

  // Auto-advance to next card after loading more content when at the end
  useEffect(() => {
    if (waitingForMoreRef.current && !loadingMore && highlightedCardId) {
      const currentIndex = linkCards.findIndex(card => card.id === highlightedCardId)
      if (currentIndex !== -1 && currentIndex < linkCards.length - 1) {
        // There's a next card now, move to it
        logger.api('Auto-advancing to next card after loading more content')
        setHighlightedCardId(linkCards[currentIndex + 1].id)
        waitingForMoreRef.current = false
      } else if (currentIndex === linkCards.length - 1 && !hasMore) {
        // Still at end and no more to load, loop to beginning
        logger.api('No more content, looping to beginning')
        setHighlightedCardId(linkCards[0].id)
        waitingForMoreRef.current = false
      }
    }
  }, [linkCards, loadingMore, hasMore, highlightedCardId])

  // Auto-highlight first card after refreshing when at the beginning
  useEffect(() => {
    if (refreshingRef.current && !loading && linkCards.length > 0) {
      logger.api('Auto-highlighting first card after refresh')
      setHighlightedCardId(linkCards[0].id)
      refreshingRef.current = false
    }
  }, [linkCards, loading])

  // Auto-scroll sidebar to highlighted card
  useEffect(() => {
    if (highlightedCardId) {
      // Use a small delay to ensure the DOM has updated
      setTimeout(() => {
        const cardElement = document.getElementById(`sidebar-card-${highlightedCardId}`)
        if (cardElement) {
          cardElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
          })
        }
      }, 100)
    }
  }, [highlightedCardId])

  // Handle refresh - reset feed and fetch from beginning
  const handleRefresh = useCallback(() => {
    logger.api(`Refresh triggered at ${new Date().toISOString()}`)
    logger.debug('Current state before refresh:', {
      mentionsCount: mentions.length,
      offset,
      hasMore,
      highlightedCardId,
      filter
    })
    
    // If in highlight view, just scroll to top instead of exiting
    if (highlightedCardId) {
      const leftContent = document.querySelector('.w-\\[70\\%\\]')
      if (leftContent) {
        leftContent.scrollTo({ top: 0, behavior: 'smooth' })
      }
      return
    }
    
    setMentions([])
    setOffset(0)
    setHasMore(true)
    setHighlightedCardId(null)
    
    // Refetch Kick history when Kick is enabled so refresh includes latest Kick messages
    if (settings.channels?.kick?.enabled) {
      const slug = (settings.channels?.kick?.channelSlug || '').trim()
      if (slug) {
        window.ipcRenderer.invoke('kick-chat-refetch-history', { slugs: [slug] }).catch(() => {})
      }
    }
    
    logger.api(`State reset, calling fetchMentions with filter="${filter}", offset=0`)
    fetchMentions(filter, 0, false, primaryChatEnabled)
  }, [filter, fetchMentions, mentions.length, offset, hasMore, highlightedCardId, settings])

  // Helper function to navigate in overview modal
  const navigateOverviewModal = useCallback((direction: 'next' | 'prev') => {
    if (!expandedCardId) return
    
    const currentIndex = linkCards.findIndex(card => card.id === expandedCardId)
    if (currentIndex === -1) return
    
    if (direction === 'next') {
      if (currentIndex < linkCards.length - 1) {
        setExpandedCardId(linkCards[currentIndex + 1].id)
        // Scroll the card into view in the overview
        setTimeout(() => {
          const cardElement = document.getElementById(`card-${linkCards[currentIndex + 1].id}`)
          if (cardElement) {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 100)
      }
    } else {
      if (currentIndex > 0) {
        setExpandedCardId(linkCards[currentIndex - 1].id)
        // Scroll the card into view in the overview
        setTimeout(() => {
          const cardElement = document.getElementById(`card-${linkCards[currentIndex - 1].id}`)
          if (cardElement) {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 100)
      }
    }
  }, [expandedCardId, linkCards])

  // Handle keyboard shortcuts (must be after navigateHighlight, navigateOverviewModal, and handleRefresh are defined)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs or when settings modal is open
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || settingsOpen) {
        return
      }
      
      const keybind = settings.keybinds.find(kb => {
        const keyMatch = kb.key === e.key || (kb.key === 'Space' && e.key === ' ')
        return keyMatch && 
               kb.ctrl === e.ctrlKey && 
               kb.shift === e.shiftKey && 
               kb.alt === e.altKey
      })
      
      if (keybind) {
        e.preventDefault()
        switch (keybind.action) {
          case 'next':
            if (viewMode === 'highlight' && highlightedCardId) {
              navigateHighlight('next')
            } else if (viewMode === 'overview' && expandedCardId) {
              navigateOverviewModal('next')
            }
            break
          case 'previous':
            if (viewMode === 'highlight' && highlightedCardId) {
              navigateHighlight('prev')
            } else if (viewMode === 'overview' && expandedCardId) {
              navigateOverviewModal('prev')
            }
            break
          case 'toggleAutoplay':
            setAutoplayEnabled(!autoplayEnabled)
            break
          case 'toggleMute':
            setMuteEnabled(!muteEnabled)
            break
          case 'toggleLoop':
            setLoopEnabled(!loopEnabled)
            break
          case 'refresh':
            handleRefresh()
            break
          case 'settings':
            setSettingsOpen(true)
            break
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settings.keybinds, highlightedCardId, expandedCardId, viewMode, autoplayEnabled, muteEnabled, loopEnabled, settingsOpen, navigateHighlight, navigateOverviewModal, handleRefresh])

  // Get expanded card for overview modal
  const expandedCard = expandedCardId ? linkCards.find(card => card.id === expandedCardId) : null
  const expandedIndex = expandedCardId ? linkCards.findIndex(card => card.id === expandedCardId) : -1

  // Settings Modal - renders on top of both modes (outside both components)
  const settingsModal = settingsOpen && (
    <div className="modal modal-open z-[100]">
      <div className="modal-box max-w-4xl">
        <h3 className="font-bold text-lg mb-4 flex items-center justify-between">
          <span>Settings</span>
          <img src={manHoldsCatPng} alt="" className="w-16 h-16 object-contain" />
        </h3>
        
        {/* Tabs */}
        <div className="tabs tabs-bordered mb-4">
          <button
            className={`tab ${settingsTab === 'filtering' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('filtering')}
          >
            Filtering
          </button>
          <button
            className={`tab ${settingsTab === 'banned' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('banned')}
          >
            Banned
          </button>
          <button
            className={`tab ${settingsTab === 'channels' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('channels')}
          >
            Channels
          </button>
          <button
            className={`tab ${settingsTab === 'footer' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('footer')}
          >
            Styling
          </button>
          <button
            className={`tab ${settingsTab === 'keybinds' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('keybinds')}
          >
            Keybinds
          </button>
        </div>
        
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Filtering Tab */}
          {settingsTab === 'filtering' && (
            <div className="space-y-4">
              {/* Filter terms - list of usernames/terms */}
              <ListManager
                title="Filter Terms"
                items={tempSettings.filter}
                onItemsChange={(items) => setTempSettings({ ...tempSettings, filter: items })}
                placeholder="Enter username or term"
                helpText="Messages mentioning these usernames/terms will be shown"
              />

              {/* Show NSFW, NSFL, and non-links toggles - side by side */}
              <div className="grid grid-cols-3 gap-4">
                <div className="form-control">
                  <label className="label cursor-pointer">
                    <span className="label-text flex items-center gap-2">
                      Show NSFW
                      <img src={jorkingitGif} alt="" className="w-12 h-12 object-contain" />
                    </span>
                    <input
                      type="checkbox"
                      checked={tempSettings.showNSFW}
                      onChange={(e) => setTempSettings({ ...tempSettings, showNSFW: e.target.checked })}
                      className="toggle toggle-primary"
                    />
                  </label>
                </div>

                <div className="form-control">
                  <label className="label cursor-pointer">
                    <span className="label-text flex items-center gap-2">
                      Show NSFL
                      <img src={feelswierdmanPng} alt="" className="w-12 h-12 object-contain" />
                    </span>
                    <input
                      type="checkbox"
                      checked={tempSettings.showNSFL}
                      onChange={(e) => setTempSettings({ ...tempSettings, showNSFL: e.target.checked })}
                      className="toggle toggle-primary"
                    />
                  </label>
                </div>

                <div className="form-control">
                  <label className="label cursor-pointer" title="Include messages that don't contain any links in the feed">
                    <span className="label-text">Show non-links</span>
                    <input
                      type="checkbox"
                      checked={tempSettings.showNonLinks}
                      onChange={(e) => setTempSettings({ ...tempSettings, showNonLinks: e.target.checked })}
                      className="toggle toggle-primary"
                    />
                  </label>
                </div>
              </div>

              {/* Link opening behavior */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">Link click behavior</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={tempSettings.linkOpenAction || 'browser'}
                  onChange={(e) => setTempSettings({ ...tempSettings, linkOpenAction: e.target.value as LinkOpenAction })}
                >
                  <option value="none">Don't open the link</option>
                  <option value="clipboard">Copy link to clipboard</option>
                  <option value="browser">Open the link in default browser</option>
                  <option value="viewer">Open the link in Viewer window</option>
                </select>
                <label className="label">
                  <span className="label-text-alt">
                    Applies to clicking links in Link Scroller cards.
                  </span>
                </label>
              </div>

              {/* Banned terms */}
              <ListManager
                title="Banned Terms"
                items={tempSettings.bannedTerms}
                onItemsChange={(items) => setTempSettings({ ...tempSettings, bannedTerms: items })}
                placeholder="Enter term to ban"
                helpText="Messages containing these terms will be filtered out"
              />

              {/* Banned users (platform-specific: platform:nick) */}
              <div>
                <label className="label">
                  <span className="label-text font-semibold">Banned Users</span>
                </label>
                <p className="text-xs text-base-content/70 mb-2">Messages from these users will be filtered out. Bans are per platform (e.g. primary chat, Kick).</p>
                <div className="flex gap-2 mb-2 flex-wrap">
                  <select
                    className="select select-bordered select-sm w-24"
                    id="banned-user-platform"
                    defaultValue={primaryChatSourceId ?? 'kick'}
                  >
                    {primaryChatSourceId != null && <option value={primaryChatSourceId}>{primaryChatSourceDisplayLabel ?? primaryChatSourceId}</option>}
                    <option value="kick">Kick</option>
                  </select>
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1 min-w-[120px]"
                    placeholder="Username"
                    id="banned-user-nick"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const nick = (e.target as HTMLInputElement).value.trim()
                        const platform = (document.getElementById('banned-user-platform') as HTMLSelectElement)?.value || (primaryChatSourceId ?? 'kick')
                        if (nick) {
                          const entry = formatPlatformUser(platform, nick)
                          const current = tempSettings.bannedUsers || []
                          if (!current.some(e => parsePlatformUser(e)?.platform === platform && parsePlatformUser(e)?.nick.toLowerCase() === nick.toLowerCase())) {
                            setTempSettings({ ...tempSettings, bannedUsers: [...current, entry] })
                            ;(e.target as HTMLInputElement).value = ''
                          }
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      const nick = (document.getElementById('banned-user-nick') as HTMLInputElement)?.value?.trim()
                      const platform = (document.getElementById('banned-user-platform') as HTMLSelectElement)?.value || (primaryChatSourceId ?? 'kick')
                      if (nick) {
                        const entry = formatPlatformUser(platform, nick)
                        const current = tempSettings.bannedUsers || []
                        if (!current.some(e => parsePlatformUser(e)?.platform === platform && parsePlatformUser(e)?.nick.toLowerCase() === nick.toLowerCase())) {
                          setTempSettings({ ...tempSettings, bannedUsers: [...current, entry] })
                          ;(document.getElementById('banned-user-nick') as HTMLInputElement).value = ''
                        }
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
                {(tempSettings.bannedUsers?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(tempSettings.bannedUsers || []).map((entry, index) => {
                      const p = parsePlatformUser(entry)
                      return p ? (
                        <div key={index} className="badge badge-secondary badge-lg gap-2">
                          <span>{p.nick} ({p.platform})</span>
                          <button type="button" className="btn btn-xs btn-circle btn-ghost" onClick={() => setTempSettings({ ...tempSettings, bannedUsers: (tempSettings.bannedUsers || []).filter((_, i) => i !== index) })}>×</button>
                        </div>
                      ) : null
                    })}
                  </div>
                )}
              </div>

              {/* Trusted users (platform-specific: platform:nick) */}
              <div>
                <label className="label">
                  <span className="label-text font-semibold flex items-center gap-2">
                    Trusted Users
                    <img src={bennyLovePng} alt="" className="w-12 h-12 object-contain" />
                  </span>
                </label>
                <p className="text-xs text-base-content/70 mb-2">Cards from these users will have a golden outline. Trust is per platform (e.g. primary chat, Kick).</p>
                <div className="flex gap-2 mb-2 flex-wrap">
                  <select className="select select-bordered select-sm w-24" id="trusted-user-platform" defaultValue={primaryChatSourceId ?? 'kick'}>
                    {primaryChatSourceId != null && <option value={primaryChatSourceId}>{primaryChatSourceDisplayLabel ?? primaryChatSourceId}</option>}
                    <option value="kick">Kick</option>
                  </select>
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1 min-w-[120px]"
                    placeholder="Username"
                    id="trusted-user-nick"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const nick = (e.target as HTMLInputElement).value.trim()
                        const platform = (document.getElementById('trusted-user-platform') as HTMLSelectElement)?.value || (primaryChatSourceId ?? 'kick')
                        if (nick) {
                          const entry = formatPlatformUser(platform, nick)
                          const current = tempSettings.trustedUsers || []
                          if (!current.some(e => parsePlatformUser(e)?.platform === platform && parsePlatformUser(e)?.nick.toLowerCase() === nick.toLowerCase())) {
                            setTempSettings({ ...tempSettings, trustedUsers: [...current, entry] })
                            ;(e.target as HTMLInputElement).value = ''
                          }
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      const nick = (document.getElementById('trusted-user-nick') as HTMLInputElement)?.value?.trim()
                      const platform = (document.getElementById('trusted-user-platform') as HTMLSelectElement)?.value || (primaryChatSourceId ?? 'kick')
                      if (nick) {
                        const entry = formatPlatformUser(platform, nick)
                        const current = tempSettings.trustedUsers || []
                        if (!current.some(e => parsePlatformUser(e)?.platform === platform && parsePlatformUser(e)?.nick.toLowerCase() === nick.toLowerCase())) {
                          setTempSettings({ ...tempSettings, trustedUsers: [...current, entry] })
                          ;(document.getElementById('trusted-user-nick') as HTMLInputElement).value = ''
                        }
                      }
                    }}
                  >
                    Add
                  </button>
                </div>
                {(tempSettings.trustedUsers?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {(tempSettings.trustedUsers || []).map((entry, index) => {
                      const p = parsePlatformUser(entry)
                      return p ? (
                        <div key={index} className="badge badge-secondary badge-lg gap-2">
                          <span>{p.nick} ({p.platform})</span>
                          <button type="button" className="btn btn-xs btn-circle btn-ghost" onClick={() => setTempSettings({ ...tempSettings, trustedUsers: (tempSettings.trustedUsers || []).filter((_, i) => i !== index) })}>×</button>
                        </div>
                      ) : null
                    })}
                  </div>
                )}
              </div>

              {/* Muted users */}
              <div>
                <label className="label">
                  <span className="label-text font-semibold flex items-center gap-2">
                    Muted Users
                    <img src={achshullyRetardedPng} alt="" className="w-12 h-12 object-contain" />
                  </span>
                </label>
                <div className="text-xs text-base-content/70 mb-2">
                  Muted users are temporarily filtered out for 24 hours. Expired mutes are automatically removed.
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto border border-base-300 rounded-lg p-2">
                  {(() => {
                    // Show all mutes from tempSettings (cleanup happens on save)
                    const allMutes = tempSettings.mutedUsers || []
                    const activeMutes = cleanupExpiredMutes(allMutes)
                    
                    // Log for debugging
                    if (allMutes.length > 0) {
                      logger.api(`Muted users in tempSettings: ${allMutes.length}, active: ${activeMutes.length}`)
                    }
                    
                    if (allMutes.length === 0) {
                      return (
                        <div className="text-sm text-base-content/50 text-center py-4">
                          No active mutes
                        </div>
                      )
                    }
                    // Show all mutes, not just active ones (so user can see expired ones too)
                    return allMutes.map((muted, index) => {
                      const now = Date.now()
                      const timeRemaining = muted.muteUntil - now
                      const hoursRemaining = Math.ceil(timeRemaining / (60 * 60 * 1000))
                      const isExpired = timeRemaining <= 0
                      
                      return (
                        <div key={index} className="flex items-center justify-between p-2 bg-base-200 rounded">
                          <div className="flex-1">
                            <div className="font-semibold text-sm">{muted.nick}</div>
                            <div className="text-xs text-base-content/50">
                              {isExpired ? 'Expired' : `Muted for ${hoursRemaining} more hour${hoursRemaining !== 1 ? 's' : ''}`}
                            </div>
                          </div>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => {
                              const newMutedUsers = (tempSettings.mutedUsers || []).filter(m => m.nick !== muted.nick)
                              setTempSettings({ ...tempSettings, mutedUsers: newMutedUsers })
                            }}
                            title="Unmute"
                          >
                            Unmute
                          </button>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>

              {/* Platform display settings */}
              <div>
                <label className="label">
                  <span className="label-text">Platform Display Settings</span>
                </label>
                <div className="space-y-4">
                  {['YouTube', 'Twitter', 'TikTok', 'Reddit', 'Kick', 'Twitch', 'Streamable', 'Imgur', 'Wikipedia', 'Bluesky', 'LSF'].map((platform) => {
                    const currentMode = tempSettings.platformSettings?.[platform] || 'embed'
                    return (
                      <div key={platform} className="border border-base-300 rounded-lg p-3">
                        <div className="font-semibold mb-2">{platform}</div>
                        <div className="flex gap-4">
                          <label className="label cursor-pointer gap-2">
                            <input
                              type="radio"
                              name={`platform-${platform}`}
                              checked={currentMode === 'filter'}
                              onChange={() => {
                                setTempSettings({
                                  ...tempSettings,
                                  platformSettings: {
                                    ...tempSettings.platformSettings,
                                    [platform]: 'filter'
                                  }
                                })
                              }}
                              className="radio radio-primary radio-sm"
                            />
                            <span className="label-text">Filter out</span>
                          </label>
                          <label className="label cursor-pointer gap-2">
                            <input
                              type="radio"
                              name={`platform-${platform}`}
                              checked={currentMode === 'text'}
                              onChange={() => {
                                setTempSettings({
                                  ...tempSettings,
                                  platformSettings: {
                                    ...tempSettings.platformSettings,
                                    [platform]: 'text'
                                  }
                                })
                              }}
                              className="radio radio-primary radio-sm"
                            />
                            <span className="label-text">Text</span>
                          </label>
                          <label className="label cursor-pointer gap-2">
                            <input
                              type="radio"
                              name={`platform-${platform}`}
                              checked={currentMode === 'embed'}
                              onChange={() => {
                                setTempSettings({
                                  ...tempSettings,
                                  platformSettings: {
                                    ...tempSettings.platformSettings,
                                    [platform]: 'embed'
                                  }
                                })
                              }}
                              className="radio radio-primary radio-sm"
                            />
                            <span className="label-text">Embed</span>
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <label className="label">
                  <span className="label-text-alt">Choose how each platform should be displayed: Filter out (hide), Text (link only), or Embed (full embed)</span>
                </label>
              </div>
            </div>
          )}

          {/* Card footer tab: platform label and color */}
          {settingsTab === 'footer' && (
            <div className="space-y-4">
              <div className="border border-base-300 rounded-lg p-4">
                <div className="font-semibold mb-2">Card footer (posted by / platform)</div>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={tempSettings.footerDisplay?.showPlatformLabel !== false}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      footerDisplay: { ...tempSettings.footerDisplay, showPlatformLabel: e.target.checked, platformColorStyle: tempSettings.footerDisplay?.platformColorStyle ?? 'tint' },
                    })}
                  />
                  <span className="label-text">Show platform label (e.g. primary chat, Kick • channel)</span>
                </label>
                <div className="form-control gap-1 mt-2">
                  <span className="label-text">Platform color</span>
                  <div className="flex gap-4">
                    {(['tint', 'subtle', 'none'] as const).map((style) => (
                      <label key={style} className="label cursor-pointer gap-2">
                        <input
                          type="radio"
                          name="footer-platform-color"
                          className="radio radio-primary radio-sm"
                          checked={(tempSettings.footerDisplay?.platformColorStyle ?? 'tint') === style}
                          onChange={() => setTempSettings({
                            ...tempSettings,
                            footerDisplay: { ...tempSettings.footerDisplay, showPlatformLabel: tempSettings.footerDisplay?.showPlatformLabel !== false, platformColorStyle: style },
                          })}
                        />
                        <span className="label-text capitalize">{style}</span>
                      </label>
                    ))}
                  </div>
                  <span className="label-text-alt">Light tint = colored border/background by platform; subtle = muted; none = no color.</span>
                </div>
                <div className="form-control gap-1 mt-4">
                  <span className="label-text">Date/time in footer</span>
                  <div className="flex flex-wrap gap-4">
                    {(['timestamp', 'datetimestamp', 'none'] as const).map((mode) => (
                      <label key={mode} className="label cursor-pointer gap-2">
                        <input
                          type="radio"
                          name="footer-timestamp-display"
                          className="radio radio-primary radio-sm"
                          checked={(tempSettings.footerDisplay?.timestampDisplay ?? 'datetimestamp') === mode}
                          onChange={() => setTempSettings({
                            ...tempSettings,
                            footerDisplay: {
                              ...tempSettings.footerDisplay,
                              showPlatformLabel: tempSettings.footerDisplay?.showPlatformLabel !== false,
                              platformColorStyle: tempSettings.footerDisplay?.platformColorStyle ?? 'tint',
                              timestampDisplay: mode,
                            },
                          })}
                        />
                        <span className="label-text">
                          {mode === 'timestamp' ? 'Time only' : mode === 'datetimestamp' ? 'Date + time' : 'None'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <span className="label-text-alt">Show time only (e.g. 6:39 PM), date + time, or hide the timestamp in the card footer.</span>
                </div>
              </div>
            </div>
          )}

          {/* Banned tab: banned links and banned messages */}
          {settingsTab === 'banned' && (
            <div className="space-y-4">
              <ListManager
                title="Banned links"
                items={tempSettings.bannedLinks || []}
                onItemsChange={(items) => setTempSettings({ ...tempSettings, bannedLinks: items })}
                placeholder="Link will be added from right-click menu"
                helpText="Links added here are hidden. Right-click a card → Ban this link to add."
              />
              <ListManager
                title="Banned messages"
                items={tempSettings.bannedMessages || []}
                onItemsChange={(items) => setTempSettings({ ...tempSettings, bannedMessages: items })}
                placeholder="Message ID (platform:channel:date:nick) added from right-click"
                helpText="Whole messages are hidden. Right-click a card → Ban this message to add."
              />
            </div>
          )}

          {/* Channels tab: where to fetch incoming messages */}
          {settingsTab === 'channels' && (
            <div className="space-y-4">
              {primaryChatSourceId != null && (
              <div className="border border-base-300 rounded-lg p-4">
                <div className="font-semibold mb-2">{primaryChatSourceDisplayLabel ?? 'Primary chat'}</div>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={tempSettings.channels?.[primaryChatSourceId]?.enabled !== false}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      channels: {
                        ...tempSettings.channels,
                        [primaryChatSourceId]: { enabled: e.target.checked },
                        kick: tempSettings.channels?.kick ?? { enabled: false, channelSlug: undefined },
                      },
                    })}
                  />
                  <span className="label-text">Enable {primaryChatSourceDisplayLabel ?? primaryChatSourceId} (mentions, rustlesearch, chat history)</span>
                </label>
                <p className="text-xs text-base-content/60 mt-1">Filter terms apply to all enabled channels.</p>
              </div>
              )}
              <div className="border border-base-300 rounded-lg p-4">
                <div className="font-semibold mb-2">Kick</div>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={!!tempSettings.channels?.kick?.enabled}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      channels: {
                        ...tempSettings.channels,
                        ...(primaryChatSourceId ? { [primaryChatSourceId]: tempSettings.channels?.[primaryChatSourceId] ?? { enabled: true } } : {}),
                        kick: { enabled: e.target.checked, channelSlug: tempSettings.channels?.kick?.channelSlug ?? '' },
                      },
                    })}
                  />
                  <span className="label-text">Enable Kick channel</span>
                </label>
                <div className="form-control gap-1 mt-2">
                  <span className="label-text">Channel slug</span>
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full max-w-xs"
                    placeholder="e.g. streamer"
                    value={tempSettings.channels?.kick?.channelSlug ?? ''}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      channels: {
                        ...tempSettings.channels,
                        ...(primaryChatSourceId ? { [primaryChatSourceId]: tempSettings.channels?.[primaryChatSourceId] ?? { enabled: true } } : {}),
                        kick: { enabled: !!tempSettings.channels?.kick?.enabled, channelSlug: e.target.value.trim() || undefined },
                      },
                    })}
                  />
                  <span className="label-text-alt">Kick channel URL slug (e.g. streamer for kick.com/streamer)</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Keybinds Tab */}
          {settingsTab === 'keybinds' && (
            <KeybindsTab
              keybinds={tempSettings.keybinds}
              onKeybindsChange={(keybinds) => setTempSettings({ ...tempSettings, keybinds })}
            />
          )}
          
          {/* Theme settings moved to the main Menu */}
        </div>

        <div className="modal-action">
          <button
            className="btn btn-ghost"
            onClick={() => setSettingsOpen(false)}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSaveSettings}
          >
            Save
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}></div>
    </div>
  )

  // Main render - switch between overview and highlight modes
  // Only render highlight mode if we're in highlight mode AND have a valid card
  // If card is missing but we're in highlight mode, try to find a valid card or stay in highlight
  if (viewMode === 'highlight') {
    // Ensure we have a valid highlighted card if there are any cards available
    if (linkCards.length > 0) {
      // If no highlightedCardId is set, or the current highlightedCard doesn't exist, use the first card
      if (!highlightedCardId || !highlightedCard) {
        const firstCard = linkCards[0]
        if (firstCard) {
          setHighlightedCardId(firstCard.id)
          return null // Return null to trigger re-render with new highlightedCardId
        }
      }
    } else {
      // No cards available, can't render highlight mode
      return (
        <div className="min-h-full flex-1 bg-base-200 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-base-content/70 mb-4">No cards to display</p>
            <button
              onClick={() => setViewMode('overview')}
              className="btn btn-primary"
            >
              Switch to Overview Mode
            </button>
          </div>
        </div>
      )
    }
    
    // Only render highlight mode if we have a valid card
    if (highlightedCard) {
    return (
      <>
      <div className={`h-full min-h-0 flex overflow-hidden ${highlightedCard.isTrusted ? 'bg-base-300' : 'bg-base-200'}`}>
        {/* Left side - Content only (70%) */}
        <div className="w-[70%] overflow-y-auto p-6 border-r border-base-300">
          <div className="max-w-4xl mx-auto">
            {highlightedCard.isDirectMedia ? (
              <div>
                {highlightedCard.mediaType === 'image' ? (
                  <ImageEmbed 
                    url={highlightedCard.url} 
                    alt={highlightedCard.text}
                  />
                ) : (
                  <VideoEmbed 
                    url={highlightedCard.url}
                    autoplay={autoplayEnabled}
                    muted={autoplayEnabled ? muteEnabled : false}
                    controls={true}
                  />
                )}
              </div>
            ) : highlightedCard.isYouTube && highlightedCard.embedUrl ? (
              <div>
                <YouTubeEmbed 
                  url={highlightedCard.url} 
                  embedUrl={highlightedCard.embedUrl!}
                  autoplay={autoplayEnabled}
                  mute={autoplayEnabled ? muteEnabled : false}
                />
              </div>
            ) : highlightedCard.isTwitterTimeline ? (
              <TwitterTimelineEmbed url={highlightedCard.url} theme={getEmbedTheme()} />
            ) : highlightedCard.isTwitter ? (
              <div key={highlightedCard.id}>
                <TwitterEmbed url={highlightedCard.url} theme={getEmbedTheme()} />
              </div>
            ) : highlightedCard.isTikTok ? (
              <div>
                <TikTokEmbed 
                  url={highlightedCard.url} 
                  autoplay={autoplayEnabled}
                  mute={autoplayEnabled ? muteEnabled : false}
                  loop={loopEnabled}
                />
              </div>
            ) : highlightedCard.isReddit ? (
              <div>
                <RedditEmbed url={highlightedCard.url} theme={getEmbedTheme()} />
              </div>
            ) : highlightedCard.isStreamable ? (
              <div>
                <StreamableEmbed 
                  url={highlightedCard.url} 
                  autoplay={autoplayEnabled}
                  mute={autoplayEnabled ? muteEnabled : false}
                  loop={loopEnabled}
                />
              </div>
            ) : highlightedCard.isWikipedia ? (
              <div>
                <WikipediaEmbed url={highlightedCard.url} />
              </div>
            ) : highlightedCard.isBluesky ? (
              <div>
                <BlueskyEmbed url={highlightedCard.url} />
              </div>
            ) : highlightedCard.isKick ? (
              <div>
                <KickEmbed 
                  url={highlightedCard.url} 
                  autoplay={autoplayEnabled}
                  mute={autoplayEnabled ? muteEnabled : false}
                />
              </div>
            ) : highlightedCard.isLSF ? (
              <div>
                <LSFEmbed 
                  url={highlightedCard.url} 
                  autoplay={autoplayEnabled}
                  mute={autoplayEnabled ? muteEnabled : false}
                />
              </div>
            ) : highlightedCard.isImgur ? (
              <div>
                {loadingImgurAlbum ? (
                  <div className="flex justify-center items-center py-12">
                    <img 
                      src={loadingSpinner} 
                      alt="Loading..." 
                      className="w-16 h-16 object-contain"
                    />
                    <span className="ml-4">Loading Imgur album...</span>
                  </div>
                ) : imgurAlbumError ? (
                  <div className="bg-base-200 rounded-lg p-6 mb-4">
                    <p className="text-base-content/70 mb-2">Failed to load Imgur album</p>
                    <p className="text-sm text-error mb-3">{imgurAlbumError}</p>
                    <a
                      href={highlightedCard.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary break-all text-sm"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleOpenLink(highlightedCard.url)
                      }}
                    >
                      {highlightedCard.url}
                    </a>
                  </div>
                ) : imgurAlbumData ? (
                  <div className="space-y-4">
                    {imgurAlbumData.title && (
                      <h3 className="text-xl font-bold">{imgurAlbumData.title}</h3>
                    )}
                    {imgurAlbumData.description && (
                      <p className="text-base-content/70">{imgurAlbumData.description}</p>
                    )}
                    <div className="grid grid-cols-1 gap-4">
                      {imgurAlbumData.media.map((item, index) => (
                        <div key={item.id || index} className="bg-base-200 rounded-lg p-4">
                          {item.type === 'image' ? (
                            <ImageEmbed url={item.url} alt={item.title || item.description} />
                          ) : item.type === 'video' ? (
                            <VideoEmbed 
                              url={item.url} 
                              autoplay={autoplayEnabled}
                              muted={autoplayEnabled ? muteEnabled : false}
                            />
                          ) : (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link link-primary break-all"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleOpenLink(item.url)
                              }}
                            >
                              {item.url}
                            </a>
                          )}
                          {item.description && (
                            <p className="mt-2 text-sm text-base-content/70">{item.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="bg-base-200 rounded-lg p-6 mb-4 min-h-[200px]">
                <a
                  href={highlightedCard.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-primary break-all"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleOpenLink(highlightedCard.url)
                  }}
                >
                  {highlightedCard.url}
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Controls, text, and cards (30%) */}
        <div className="w-[30%] flex flex-col bg-base-200 border-l border-base-300">
          {/* Top section - Controls */}
          <div className="flex flex-col items-center gap-3 p-4 border-b border-base-300 flex-shrink-0">
            {/* Navigation arrows and counter */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => navigateHighlight('prev')}
                className="btn btn-circle btn-primary btn-sm"
                disabled={linkCards.length === 0}
              >
                ←
              </button>
              <div className="text-sm text-base-content/70 font-medium">
                {highlightedIndex + 1} / {linkCards.length}
              </div>
              <button
                onClick={() => navigateHighlight('next')}
                className="btn btn-circle btn-primary btn-sm"
                disabled={linkCards.length === 0}
              >
                →
              </button>
            </div>
            
            {/* Autoplay, Mute, and Loop toggles */}
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-base-content/50">Highlight view only (overview does not autoplay)</p>
              {/* Autoplay toggle */}
              <div className="flex items-center gap-2">
                <label className="label cursor-pointer gap-2">
                  <span className="label-text text-xs">Autoplay</span>
                  <input
                    type="checkbox"
                    checked={autoplayEnabled}
                    onChange={(e) => setAutoplayEnabled(e.target.checked)}
                    className="toggle toggle-primary toggle-sm"
                  />
                </label>
              </div>
              
              {/* Mute and Loop toggles (side by side) */}
              <div className="flex items-center gap-3">
                {/* Mute toggle (only shown when autoplay is enabled) */}
                {autoplayEnabled && (
                  <div className="flex items-center gap-2">
                    <label className="label cursor-pointer gap-2">
                      <span className="label-text text-xs">Mute</span>
                      <input
                        type="checkbox"
                        checked={muteEnabled}
                        onChange={(e) => setMuteEnabled(e.target.checked)}
                        className="toggle toggle-secondary toggle-sm"
                      />
                    </label>
                  </div>
                )}
                
                {/* Loop toggle */}
                <div className="flex items-center gap-2">
                  <label className="label cursor-pointer gap-2">
                    <span className="label-text text-xs">Loop</span>
                    <input
                      type="checkbox"
                      checked={loopEnabled}
                      onChange={(e) => setLoopEnabled(e.target.checked)}
                      className="toggle toggle-accent toggle-sm"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Middle section - Text content */}
          <div className="flex-shrink-0 p-4 border-b border-base-300">
            <div className={`bg-base-300 rounded-lg p-3 ${highlightedCard.isTrusted ? 'border-2 border-yellow-500' : ''}`}>
              <div className="mb-3 break-words overflow-wrap-anywhere">
                <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                  {highlightedCard.isYouTube 
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'YouTube link', emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                    : highlightedCard.isReddit
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Reddit link', emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                    : (highlightedCard.isTwitter || highlightedCard.isTwitterTimeline)
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Twitter link', emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                    : highlightedCard.isImgur
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Imgur link', emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                    : highlightedCard.isKick
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Kick link', emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                    : highlightedCard.isLSF
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'LSF link', emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                    : renderTextWithLinks(highlightedCard.text, undefined, undefined, emotesMap, handleOpenLink, highlightedCard.kickEmotes)
                  }
                </p>
              </div>
              <div className={`flex items-center gap-4 pt-1 px-3 pb-3 -mx-3 -mb-3 border-t border-base-content/20 rounded-b-lg ${getPlatformFooterColor(highlightedCard.platform, footerDisplay?.platformColorStyle, primaryChatSourceId)}`}>
                <div>
                  {footerDisplay?.showPlatformLabel !== false && getPlatformLabel(highlightedCard, primaryChatSourceId, primaryChatSourceDisplayLabel) && (
                    <span className="text-xs text-base-content/50 mr-2">{getPlatformLabel(highlightedCard, primaryChatSourceId, primaryChatSourceDisplayLabel)}</span>
                  )}
                  <span className="text-xs text-base-content/70">Posted by</span>
                  <a
                    href={highlightedCard.platform === primaryChatSourceId ? `https://rustlesearch.dev/?username=${encodeURIComponent(highlightedCard.nick)}&channel=${encodeURIComponent(highlightedCard.channel || primaryChatSourceMentionsChannel || primaryChatSourceId || '')}` : (highlightedCard.platform === 'kick' ? `https://kick.com/${encodeURIComponent(highlightedCard.channel || '')}` : '#')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-sm font-bold text-primary hover:underline"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      const url = highlightedCard.platform === primaryChatSourceId ? `https://rustlesearch.dev/?username=${encodeURIComponent(highlightedCard.nick)}&channel=${encodeURIComponent(highlightedCard.channel || primaryChatSourceMentionsChannel || primaryChatSourceId || '')}` : (highlightedCard.platform === 'kick' ? `https://kick.com/${encodeURIComponent(highlightedCard.channel || '')}` : highlightedCard.url || '#')
                      handleOpenLink(url)
                    }}
                  >
                    {highlightedCard.nick}
                  </a>
                </div>
                {footerDisplay?.timestampDisplay !== 'none' && (
                  <div className="text-xs text-base-content/50">
                    {footerDisplay?.timestampDisplay === 'timestamp'
                      ? new Date(highlightedCard.date).toLocaleTimeString()
                      : new Date(highlightedCard.date).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bottom section - Card list */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            <div className="space-y-3">
              {linkCards.map((card) => (
                <div
                  key={card.id}
                  id={`sidebar-card-${card.id}`}
                  onClick={() => setHighlightedCardId(card.id)}
                  onContextMenu={(e) => handleContextMenu(e, card)}
                  className={`card shadow-md cursor-pointer transition-all ${
                    card.id === highlightedCardId ? 'ring-2 ring-primary' : 'hover:shadow-lg'
                  }`}
                  style={card.isTrusted ? {
                    backgroundColor: 'rgba(234, 179, 8, 0.15)' // Slight golden background
                  } : {
                    backgroundColor: 'hsl(var(--b2))' // Regular background
                  }}
                >
                  <div className="card-body p-3 flex flex-row gap-3">
                    <div className="flex-shrink-0 flex items-center">
                      {card.isDirectMedia ? (
                        <div className="text-2xl">
                          {card.mediaType === 'image' ? '🖼️' : '🎥'}
                        </div>
                      ) : (
                        getLinkTypeIcon(card.linkType) ? (
                          <img 
                            src={getLinkTypeIcon(card.linkType)!} 
                            alt={card.linkType || 'Link'} 
                            className="w-5 h-5 object-contain"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center bg-primary text-primary-content rounded px-1.5 py-0.5">
                            {(!card.url || card.url === '' ? 'Text' : (card.linkType || 'Link')).split('').map((letter, index) => (
                              <span key={index} className="text-base leading-none block">{letter}</span>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                    <div className="flex-1 min-w-0 break-words overflow-wrap-anywhere">
                      <p className="text-xs line-clamp-3 break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{card.text}</p>
                      <div className="text-xs text-base-content/50 mt-1">
                        <span className="font-semibold">{card.nick}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Load More button in sidebar (only when primary chat is enabled; Kick has no long history) */}
            {hasMore && primaryChatEnabled && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="btn btn-primary btn-sm"
                >
                  {loadingMore ? (
                    <>
                      <img 
                        src={loadingSpinner} 
                        alt="Loading..." 
                        className="w-4 h-4 object-contain"
                      />
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
            {(!hasMore || !primaryChatEnabled) && linkCards.length > 0 && (
              <div className="mt-4 text-center">
                <img 
                  src={manHoldsCatPng} 
                  alt="No more links" 
                  className="mx-auto max-w-xs mb-2"
                />
                <p className="text-xs text-base-content/50">{primaryChatEnabled ? 'No more links to load' : 'Load more only available with primary chat enabled'}</p>
              </div>
            )}
          </div>
        </div>

        {/* Floating action buttons - bottom right */}
        <div className="fixed bottom-6 right-6 flex flex-row gap-3 z-50">
          {/* Back to Menu button */}
          {onBackToMenu && (
            <button
              onClick={onBackToMenu}
              className="btn btn-circle btn-primary shadow-lg"
              title="Back to Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
          )}
          
          {/* Mode toggle button */}
          <button
            onClick={() => {
              setViewMode('overview')
              setHighlightedCardId(null)
            }}
            className="btn btn-circle btn-primary shadow-lg"
            title="Switch to Overview Mode"
          >
            O
          </button>
          
          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            className="btn btn-circle btn-primary shadow-lg"
            title="Refresh feed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
          
          {/* Settings button */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-circle btn-primary shadow-lg"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
      {settingsModal}
      
      {/* Context Menu */}
      {contextMenu.visible && contextMenu.card && (
        <div
          className="fixed z-[100] bg-base-200 border border-base-300 rounded-lg shadow-xl py-2 min-w-[200px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            position: 'fixed',
            zIndex: 10000,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* User actions */}
          <div className="px-2 py-1 border-b border-base-300">
            <div className="text-xs text-base-content/50 px-2 py-1">User: {contextMenu.card.nick}</div>
            <button
              className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
              onClick={() => handleCopyUsername(contextMenu.card!.nick)}
            >
              Copy Username
            </button>
            {!isBannedUser(contextMenu.card.nick, contextMenu.card.platform ?? primaryChatSourceId ?? '', bannedUsers) && (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleBanUser(contextMenu.card!.nick, contextMenu.card!.platform ?? primaryChatSourceId ?? '')}
              >
                Ban User
              </button>
            )}
            {!isTrustedUser(contextMenu.card.nick, contextMenu.card.platform ?? primaryChatSourceId ?? '', trustedUsers) ? (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleTrustUser(contextMenu.card!.nick, contextMenu.card!.platform ?? primaryChatSourceId ?? '')}
              >
                Trust User
              </button>
            ) : (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleUntrustUser(contextMenu.card!.nick, contextMenu.card!.platform ?? primaryChatSourceId ?? '')}
              >
                Untrust User
              </button>
            )}
          </div>
          
          {/* Message actions */}
          <div className="px-2 py-1 border-b border-base-300">
            <button
              className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
              onClick={() => handleCopyMessage(contextMenu.card!)}
            >
              Copy Message
            </button>
            <button
              className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm text-warning"
              onClick={() => handleBanMessage(contextMenu.card!.messageId)}
            >
              Ban this message
            </button>
          </div>
          
          {/* Link actions */}
          {(() => {
            const urls = extractUrls(contextMenu.card.text)
            const hasLinks = urls.length > 0
            
            if (!hasLinks) return null
            
            return (
              <div className="px-2 py-1 border-b border-base-300">
                <div className="text-xs text-base-content/50 px-2 py-1">Links</div>
                {urls.length === 1 ? (
                  <>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                      onClick={() => handleCopyLink(urls[0])}
                    >
                      Copy Link
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                      onClick={() => { handleOpenLink(urls[0]); closeContextMenu() }}
                    >
                      Open Link
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm text-warning"
                      onClick={() => handleBanLink(urls[0])}
                    >
                      Ban this link
                    </button>
                  </>
                ) : (
                  <>
                    {urls.map((url, index) => (
                      <div key={index} className="border-t border-base-300 first:border-t-0">
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm truncate"
                          onClick={() => handleCopyLink(url)}
                          title={url}
                        >
                          Copy Link {index + 1}
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm truncate"
                          onClick={() => { handleOpenLink(url); closeContextMenu() }}
                          title={url}
                        >
                          Open Link {index + 1}
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm truncate text-warning"
                          onClick={() => handleBanLink(url)}
                          title={url}
                        >
                          Ban link {index + 1}
                        </button>
                      </div>
                    ))}
                    <div className="border-t border-base-300">
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                        onClick={() => handleOpenAllLinks(contextMenu.card!)}
                      >
                        Open All Links
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })()}
          
          {/* Embed actions */}
          {(() => {
            const hasEmbed = contextMenu.card.isDirectMedia || 
              (contextMenu.card.isYouTube && contextMenu.card.embedUrl) ||
              contextMenu.card.isTwitter ||
              contextMenu.card.isTwitterTimeline ||
              contextMenu.card.isTikTok ||
              contextMenu.card.isReddit ||
              contextMenu.card.isStreamable ||
              contextMenu.card.isWikipedia ||
              contextMenu.card.isBluesky ||
              contextMenu.card.isKick ||
              contextMenu.card.isLSF ||
              contextMenu.card.isImgur
            
            if (!hasEmbed) return null
            
            return (
              <div className="px-2 py-1">
                <button
                  className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                  onClick={() => handleReloadEmbed(contextMenu.card!.id)}
                >
                  Reload Embed
                </button>
              </div>
            )
          })()}
        </div>
      )}
      </>
    )
    }
    
    // If in highlight mode but no card, show overview instead
    // (This should rarely happen, but prevents getting stuck)
    return (
      <>
        <div className="min-h-full flex-1 bg-base-200 p-4 flex items-center justify-center">
          <div className="text-center">
            <p className="text-base-content/70 mb-4">No card selected</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (linkCards.length > 0) {
                  setHighlightedCardId(linkCards[0].id)
                } else {
                  setViewMode('overview')
                }
              }}
            >
              {linkCards.length > 0 ? 'Select First Card' : 'Switch to Overview'}
            </button>
          </div>
        </div>
        {settingsModal}
      </>
    )
  }

  // Overview Mode
  return (
    <>
      <div ref={scrollContainerRef} className="h-full min-h-0 overflow-y-auto bg-base-200 p-4">
      {loading && mentions.length === 0 && (
        <div className="flex justify-center items-center py-8">
          <img 
            src={loadingSpinner} 
            alt="Loading..." 
            className="w-16 h-16 object-contain"
          />
        </div>
      )}

      {error && (
        <div className="alert alert-error mb-4">
          <span>Error: {error}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="text-sm text-base-content/70">
          Found {linkCards.length} link{linkCards.length !== 1 ? 's' : ''} from {mentions.length} message{mentions.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Link Cards Masonry Layout */}
      {!loading && linkCards.length > 0 && (
        <>
          {/* Streaming messages (new incoming) - above separator */}
          {/* Stack upwards: newest at top, oldest streaming messages near divider */}
          {streamingCards.length > 0 && (
            <div className="max-w-7xl mx-auto mb-4">
              <MasonryGrid 
                cards={streamingCards} 
                onCardClick={(cardId) => setExpandedCardId(cardId)} 
                onOpenLink={handleOpenLink}
                getEmbedTheme={getEmbedTheme} 
                platformSettings={platformSettings} 
                emotesMap={emotesMap}
                embedReloadKeys={embedReloadKeys}
                onContextMenu={handleContextMenu}
                stackDirection="up"
                footerDisplay={footerDisplay}
                primaryChatSourceId={primaryChatSourceId}
                primaryChatSourceDisplayLabel={primaryChatSourceDisplayLabel}
                primaryChatSourceMentionsChannel={primaryChatSourceMentionsChannel}
              />
            </div>
          )}
          
          {/* Separator with refresh time */}
          {streamingCards.length > 0 && historicalCards.length > 0 && refreshTimestamp && (
            <div className="max-w-7xl mx-auto my-6 flex items-center">
              <div className="flex-1 border-t border-base-content/30"></div>
              <div className="px-4 text-sm text-base-content/60">
                Refreshed {new Date(refreshTimestamp).toLocaleTimeString()}
              </div>
              <div className="flex-1 border-t border-base-content/30"></div>
            </div>
          )}
          
          {/* Historical messages (from history/API) - below separator */}
          {/* Stack downwards: newest at top (near divider), oldest at bottom */}
          {historicalCards.length > 0 && (
            <div className="max-w-7xl mx-auto">
              <MasonryGrid 
                cards={historicalCards} 
                onCardClick={(cardId) => setExpandedCardId(cardId)} 
                onOpenLink={handleOpenLink}
                getEmbedTheme={getEmbedTheme} 
                platformSettings={platformSettings} 
                emotesMap={emotesMap}
                embedReloadKeys={embedReloadKeys}
                onContextMenu={handleContextMenu}
                stackDirection="down"
                footerDisplay={footerDisplay}
                primaryChatSourceId={primaryChatSourceId}
                primaryChatSourceDisplayLabel={primaryChatSourceDisplayLabel}
                primaryChatSourceMentionsChannel={primaryChatSourceMentionsChannel}
              />
            </div>
            )}
        </>
      )}
      
      {/* Load More button (only when primary chat is enabled; Kick has no long history) */}
      {!loading && hasMore && primaryChatEnabled && (
        <div className="flex justify-center py-8">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="btn btn-primary"
          >
            {loadingMore ? (
              <>
                <img 
                  src={loadingSpinner} 
                  alt="Loading..." 
                  className="w-4 h-4 object-contain"
                />
                Loading...
              </>
            ) : (
              'Load More'
            )}
          </button>
        </div>
      )}
      {!loading && (!hasMore || !primaryChatEnabled) && linkCards.length > 0 && (
        <div className="text-center py-8">
          <img 
            src={manHoldsCatPng} 
            alt="No more links" 
            className="mx-auto max-w-xs mb-4"
          />
          <p className="text-base-content/70">{primaryChatEnabled ? 'No more links to load' : 'Load more only available with primary chat enabled'}</p>
        </div>
      )}

      {!loading && !error && linkCards.length === 0 && mentions.length === 0 && (
        <div className="max-w-7xl mx-auto text-center py-12">
          <p className="text-base-content/70">No links found in the filtered messages.</p>
        </div>
      )}

      {/* Overview Modal */}
      {expandedCard && viewMode === 'overview' && (
        <div className="modal modal-open z-[90]">
          <div className="modal-box w-[90vw] h-[85vh] max-w-none p-0 flex flex-col">
            {/* Header with X button */}
            <div className="flex justify-between items-center p-4 border-b border-base-300 flex-shrink-0">
              <div className="text-sm text-base-content/70">
                {expandedIndex + 1} / {linkCards.length}
              </div>
              <button
                onClick={() => setExpandedCardId(null)}
                className="btn btn-sm btn-circle btn-ghost"
                title="Close"
              >
                ✕
              </button>
            </div>
            
            {/* Content area */}
            <div className="flex-1 flex overflow-hidden relative">
              {/* Left side - Message info */}
              <div className="w-80 border-r border-base-300 overflow-y-auto p-4 flex-shrink-0">
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-base-content/50 mb-1">User</div>
                    <div className="font-semibold">{expandedCard.nick}</div>
                  </div>
                  <div>
                    <div className="text-xs text-base-content/50 mb-1">Message</div>
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {renderTextWithLinks(expandedCard.text, undefined, undefined, emotesMap, handleOpenLink, expandedCard.kickEmotes)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-base-content/50 mb-1">Link</div>
                    <a
                      href={expandedCard.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary text-sm break-all"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleOpenLink(expandedCard.url)
                      }}
                    >
                      {expandedCard.url}
                    </a>
                  </div>
                  {expandedCard.date && footerDisplay?.timestampDisplay !== 'none' && (
                    <div>
                      <div className="text-xs text-base-content/50 mb-1">Time</div>
                      <div className="text-sm">
                        {footerDisplay?.timestampDisplay === 'timestamp'
                          ? new Date(expandedCard.date).toLocaleTimeString()
                          : new Date(expandedCard.date).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Center - Embed */}
              <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
                <div className="w-full max-w-4xl">
                  {expandedCard.isDirectMedia ? (
                    <div>
                      {expandedCard.mediaType === 'image' ? (
                        <ImageEmbed url={expandedCard.url} alt={expandedCard.text} />
                      ) : (
                        <VideoEmbed url={expandedCard.url} autoplay={false} muted={false} controls={true} />
                      )}
                    </div>
                  ) : expandedCard.isYouTube && expandedCard.embedUrl ? (
                    <YouTubeEmbed url={expandedCard.url} embedUrl={expandedCard.embedUrl as string} autoplay={false} mute={false} />
                  ) : expandedCard.isTwitterTimeline ? (
                    <TwitterTimelineEmbed url={expandedCard.url} theme={getEmbedTheme()} />
                  ) : expandedCard.isTwitter ? (
                    <TwitterEmbed url={expandedCard.url} theme={getEmbedTheme()} />
                  ) : expandedCard.isTikTok ? (
                    <TikTokEmbed url={expandedCard.url} autoplay={false} mute={false} loop={false} />
                  ) : expandedCard.isReddit ? (
                    <RedditEmbed url={expandedCard.url} theme={getEmbedTheme()} />
                  ) : expandedCard.isStreamable ? (
                    <StreamableEmbed url={expandedCard.url} autoplay={false} mute={false} loop={false} />
                  ) : expandedCard.isWikipedia ? (
                    <WikipediaEmbed url={expandedCard.url} />
                  ) : expandedCard.isBluesky ? (
                    <BlueskyEmbed url={expandedCard.url} />
                  ) : expandedCard.isKick ? (
                    <KickEmbed url={expandedCard.url} autoplay={false} mute={true} />
                  ) : expandedCard.isLSF ? (
                    <LSFEmbed url={expandedCard.url} autoplay={false} mute={false} />
                  ) : (
                    <div className="bg-base-200 rounded-lg p-6">
                      <a
                        href={expandedCard.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link link-primary break-all"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleOpenLink(expandedCard.url)
                        }}
                      >
                        {expandedCard.url}
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Navigation arrows - outside modal box */}
          <button
            onClick={() => navigateOverviewModal('prev')}
            disabled={expandedIndex <= 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 btn btn-circle btn-primary z-[91] shadow-lg"
            title="Previous"
          >
            ←
          </button>
          <button
            onClick={() => navigateOverviewModal('next')}
            disabled={expandedIndex >= linkCards.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 btn btn-circle btn-primary z-[91] shadow-lg"
            title="Next"
          >
            →
          </button>
          
          <div className="modal-backdrop" onClick={() => setExpandedCardId(null)}></div>
        </div>
      )}

      {/* Floating action buttons - bottom right */}
      <div className="fixed bottom-6 right-6 flex flex-row gap-3 z-50">
        {/* Back to Menu button */}
        {onBackToMenu && (
          <button
            onClick={onBackToMenu}
            className="btn btn-circle btn-primary shadow-lg"
            title="Back to Menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </button>
        )}
        
        {/* Mode toggle button */}
        <button
          onClick={() => {
            if (viewMode === 'overview') {
              setViewMode('highlight')
              if (linkCards.length > 0 && !highlightedCardId) {
                setHighlightedCardId(linkCards[0].id)
              }
            } else {
              setViewMode('overview')
              setHighlightedCardId(null)
            }
          }}
          className="btn btn-circle btn-primary shadow-lg"
          title={viewMode === 'overview' ? 'Switch to Highlight Mode' : 'Switch to Overview Mode'}
        >
          {viewMode === 'overview' ? 'H' : 'O'}
        </button>
        
        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          className="btn btn-circle btn-primary shadow-lg"
          title="Refresh feed"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
        
        {/* Settings button */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="btn btn-circle btn-primary shadow-lg"
          title="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          </button>
        </div>
      </div>
      {settingsModal}
      
      {/* Context Menu */}
      {contextMenu.visible && contextMenu.card && (
        <div
          className="fixed z-[100] bg-base-200 border border-base-300 rounded-lg shadow-xl py-2 min-w-[200px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            position: 'fixed',
            zIndex: 10000,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* User actions */}
          <div className="px-2 py-1 border-b border-base-300">
            <div className="text-xs text-base-content/50 px-2 py-1">User: {contextMenu.card.nick}</div>
            <button
              className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
              onClick={() => handleCopyUsername(contextMenu.card!.nick)}
            >
              Copy Username
            </button>
            {!isBannedUser(contextMenu.card.nick, contextMenu.card.platform ?? primaryChatSourceId ?? '', bannedUsers) && (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleBanUser(contextMenu.card!.nick, contextMenu.card!.platform ?? primaryChatSourceId ?? '')}
              >
                Ban User
              </button>
            )}
            {!isTrustedUser(contextMenu.card.nick, contextMenu.card.platform ?? primaryChatSourceId ?? '', trustedUsers) ? (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleTrustUser(contextMenu.card!.nick, contextMenu.card!.platform ?? primaryChatSourceId ?? '')}
              >
                Trust User
              </button>
            ) : (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleUntrustUser(contextMenu.card!.nick, contextMenu.card!.platform ?? primaryChatSourceId ?? '')}
              >
                Untrust User
              </button>
            )}
            {!isMutedUser(contextMenu.card.nick, mutedUsers) ? (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleMuteUser(contextMenu.card!.nick)}
              >
                Mute 1d
              </button>
            ) : (
              <button
                className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                onClick={() => handleUnmuteUser(contextMenu.card!.nick)}
              >
                Unmute
              </button>
            )}
          </div>
          
          {/* Message actions */}
          <div className="px-2 py-1 border-b border-base-300">
            <button
              className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
              onClick={() => handleCopyMessage(contextMenu.card!)}
            >
              Copy Message
            </button>
            <button
              className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm text-warning"
              onClick={() => handleBanMessage(contextMenu.card!.messageId)}
            >
              Ban this message
            </button>
          </div>
          
          {/* Link actions */}
          {(() => {
            const urls = extractUrls(contextMenu.card.text)
            const hasLinks = urls.length > 0
            
            if (!hasLinks) return null
            
            return (
              <div className="px-2 py-1 border-b border-base-300">
                <div className="text-xs text-base-content/50 px-2 py-1">Links</div>
                {urls.length === 1 ? (
                  <>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                      onClick={() => handleCopyLink(urls[0])}
                    >
                      Copy Link
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                      onClick={() => { handleOpenLink(urls[0]); closeContextMenu() }}
                    >
                      Open Link
                    </button>
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm text-warning"
                      onClick={() => handleBanLink(urls[0])}
                    >
                      Ban this link
                    </button>
                  </>
                ) : (
                  <>
                    {urls.map((url, index) => (
                      <div key={index} className="border-t border-base-300 first:border-t-0">
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm truncate"
                          onClick={() => handleCopyLink(url)}
                          title={url}
                        >
                          Copy Link {index + 1}
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm truncate"
                          onClick={() => { handleOpenLink(url); closeContextMenu() }}
                          title={url}
                        >
                          Open Link {index + 1}
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm truncate text-warning"
                          onClick={() => handleBanLink(url)}
                          title={url}
                        >
                          Ban link {index + 1}
                        </button>
                      </div>
                    ))}
                    <div className="border-t border-base-300">
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                        onClick={() => handleOpenAllLinks(contextMenu.card!)}
                      >
                        Open All Links
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })()}
          
          {/* Embed actions */}
          {(() => {
            const hasEmbed = contextMenu.card.isDirectMedia || 
              (contextMenu.card.isYouTube && contextMenu.card.embedUrl) ||
              contextMenu.card.isTwitter ||
              contextMenu.card.isTwitterTimeline ||
              contextMenu.card.isTikTok ||
              contextMenu.card.isReddit ||
              contextMenu.card.isStreamable ||
              contextMenu.card.isWikipedia ||
              contextMenu.card.isBluesky ||
              contextMenu.card.isKick ||
              contextMenu.card.isLSF ||
              contextMenu.card.isImgur
            
            if (!hasEmbed) return null
            
            return (
              <div className="px-2 py-1">
                <button
                  className="w-full text-left px-3 py-2 hover:bg-base-300 rounded text-sm"
                  onClick={() => handleReloadEmbed(contextMenu.card!.id)}
                >
                  Reload Embed
                </button>
              </div>
            )
          })()}
        </div>
      )}
    </>
  )
}

export default LinkScroller
