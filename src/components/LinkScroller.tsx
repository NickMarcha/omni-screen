import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { logger } from '../utils/logger'
import TwitterEmbed from './embeds/TwitterEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import TikTokEmbed from './embeds/TikTokEmbed'
import RedditEmbed from './embeds/RedditEmbed'
import StreamableEmbed from './embeds/StreamableEmbed'
import WikipediaEmbed from './embeds/WikipediaEmbed'
import BlueskyEmbed from './embeds/BlueskyEmbed'
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

interface MentionData {
  id: string // Unique ID generated from hash of date and username
  date: number
  text: string
  nick: string
  flairs: string
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

interface LinkCard {
  id: string
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
  isTrusted?: boolean
}

// Extract URLs from text
function extractUrls(text: string): string[] {
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

// Check if text contains banned terms
function containsBannedTerms(text: string, bannedTerms: string[] | undefined): boolean {
  if (!bannedTerms || bannedTerms.length === 0) return false
  const lowerText = text.toLowerCase()
  return bannedTerms.some(term => term.trim() && lowerText.includes(term.trim().toLowerCase()))
}

// Check if user is banned
function isBannedUser(nick: string, bannedUsers: string[] | undefined): boolean {
  if (!bannedUsers || bannedUsers.length === 0) return false
  const lowerNick = nick.toLowerCase()
  return bannedUsers.some(user => user.trim() && lowerNick === user.trim().toLowerCase())
}

// Check if user is trusted
function isTrustedUser(nick: string, trustedUsers: string[] | undefined): boolean {
  if (!trustedUsers || trustedUsers.length === 0) return false
  const lowerNick = nick.toLowerCase()
  return trustedUsers.some(user => user.trim() && lowerNick === user.trim().toLowerCase())
}

// Check if platform is disabled
function isPlatformDisabled(linkType: string | undefined, disabledPlatforms: string[] | undefined): boolean {
  if (!linkType || !disabledPlatforms || disabledPlatforms.length === 0) return false
  const lowerLinkType = linkType.toLowerCase()
  return disabledPlatforms.some(platform => platform.trim() && lowerLinkType === platform.trim().toLowerCase())
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

interface ThemeSettings {
  mode: ThemeMode // system, light, or dark
  lightTheme: LightTheme // Selected light theme
  darkTheme: DarkTheme // Selected dark theme
  embedTheme: EmbedThemeMode // Embed theme: follow, light, or dark
}

// Settings interface
interface Settings {
  filter: string
  showNSFW: boolean
  showNSFL: boolean
  bannedTerms: string[] // Changed from string to array
  bannedUsers: string[] // New: list of banned usernames
  disabledPlatforms: string[] // New: list of disabled platforms
  trustedUsers: string[] // New: list of trusted usernames
  keybinds: Keybind[] // New: customizable keyboard shortcuts
  theme: ThemeSettings // New: theme settings
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
      
      const migrated: Settings = {
        filter: parsed.filter || 'mrMouton',
        showNSFW: parsed.showNSFW ?? false,
        showNSFL: parsed.showNSFL ?? false,
        bannedTerms: Array.isArray(parsed.bannedTerms) ? parsed.bannedTerms : [],
        bannedUsers: Array.isArray(parsed.bannedUsers) ? parsed.bannedUsers : [],
        disabledPlatforms: Array.isArray(parsed.disabledPlatforms) ? parsed.disabledPlatforms : [],
        trustedUsers: Array.isArray(parsed.trustedUsers) ? parsed.trustedUsers : [],
        keybinds: Array.isArray(parsed.keybinds) ? parsed.keybinds : defaultKeybinds,
        theme: parsed.theme && typeof parsed.theme === 'object' ? {
          mode: parsed.theme.mode || 'system',
          lightTheme: parsed.theme.lightTheme || 'retro',
          darkTheme: parsed.theme.darkTheme || 'business',
          embedTheme: parsed.theme.embedTheme || 'follow'
        } : { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
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
  
  const defaults: Settings = {
    filter: 'mrMouton',
    showNSFW: false,
    showNSFL: false,
    bannedTerms: [],
    bannedUsers: [],
    disabledPlatforms: [],
    trustedUsers: [],
    keybinds: defaultKeybinds,
    theme: { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
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
      return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
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
        return `https://www.youtube.com/embed/videoseries?${params.toString()}`
      }
      
      // Check for YouTube Shorts: youtube.com/shorts/VIDEO_ID
      if (urlObj.pathname.startsWith('/shorts/')) {
        const videoId = urlObj.pathname.split('/shorts/')[1]?.split('?')[0]
        if (videoId) {
          return buildEmbedUrl(videoId)
        }
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
          return `https://www.youtube.com/embed/${embedId}?${params.toString()}`
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

// Masonry Grid Component - distributes cards into columns based on estimated height
function MasonryGrid({ cards, onCardClick, getEmbedTheme }: { cards: LinkCard[], onCardClick: (cardId: string) => void, getEmbedTheme: () => 'light' | 'dark' }) {
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
    } else if (card.isTwitter) {
      // Twitter embeds have variable heights, use average
      return baseHeight + 350
    } else if (card.isTikTok) {
      return baseHeight + 600 // TikTok embeds are taller
    } else if (card.isReddit) {
      return baseHeight + 400
    } else if (card.isStreamable) {
      return baseHeight + 400
    } else if (card.isImgur) {
      return baseHeight + 100
    } else {
      // Generic link - estimate based on text length
      return baseHeight + Math.min(card.text.length / 10, 200)
    }
  }
  
  useEffect(() => {
    // Distribute cards into columns - add each card to the column with the smallest total height
    const newColumns: LinkCard[][] = Array.from({ length: columnCount }, () => [])
    const columnHeights: number[] = Array(columnCount).fill(0)
    
    cards.forEach((card) => {
      // Find the column with the smallest height
      let shortestColumn = 0
      let minHeight = columnHeights[0]
      
      for (let i = 1; i < columnCount; i++) {
        if (columnHeights[i] < minHeight) {
          minHeight = columnHeights[i]
          shortestColumn = i
        }
      }
      
      // Add card to shortest column
      newColumns[shortestColumn].push(card)
      // Use estimated height based on card type
      columnHeights[shortestColumn] += estimateCardHeight(card)
    })
    
    setColumns(newColumns)
  }, [cards, columnCount])
  
  return (
    <div className="flex gap-4">
      {columns.map((columnCards, columnIndex) => (
        <div 
          key={columnIndex} 
          className="flex-1 flex flex-col gap-4"
        >
          {columnCards.map((card) => (
            <div 
              key={card.id}
              id={`card-${card.id}`}
              className={`card shadow-xl flex flex-col border-2 ${card.isTrusted ? 'bg-base-200 border-yellow-500' : 'bg-base-200 border-base-300'}`}
            >
              {/* Embed content above - constrained to prevent overflow */}
              <div className="flex-shrink-0 overflow-hidden">
                {card.isDirectMedia ? (
                  <div>
                    {card.mediaType === 'image' ? (
                      <ImageEmbed 
                        url={card.url} 
                        alt={card.text}
                        className="w-full object-contain rounded-t-lg"
                      />
                    ) : (
                      <VideoEmbed 
                        url={card.url}
                        autoplay={false}
                        muted={true}
                        controls={true}
                        className="w-full rounded-t-lg"
                      />
                    )}
                  </div>
                ) : card.isYouTube && card.embedUrl ? (
                  <div className="p-2">
                    <YouTubeEmbed 
                      url={card.url} 
                      embedUrl={card.embedUrl}
                      autoplay={false}
                      mute={false}
                      showLink={false}
                    />
                  </div>
                ) : card.isTwitter ? (
                  <div className="p-2">
                    <TwitterEmbed url={card.url} theme={getEmbedTheme()} />
                  </div>
                ) : card.isTikTok ? (
                  <div className="p-2">
                    <TikTokEmbed url={card.url} autoplay={false} mute={false} loop={false} />
                  </div>
                ) : card.isReddit ? (
                  <div className="p-2">
                    <RedditEmbed url={card.url} theme={getEmbedTheme()} />
                  </div>
                ) : card.isStreamable ? (
                  <div className="p-2">
                    <StreamableEmbed url={card.url} autoplay={false} mute={false} />
                  </div>
                ) : card.isWikipedia ? (
                  <div className="p-2">
                    <WikipediaEmbed url={card.url} />
                  </div>
                ) : card.isBluesky ? (
                  <div className="p-2">
                    <BlueskyEmbed url={card.url} />
                  </div>
                ) : card.isImgur ? (
                  <div className="p-2">
                    <div className="bg-base-200 rounded-lg p-4 text-center">
                      <img 
                        src={imgurIcon} 
                        alt="Imgur" 
                        className="w-8 h-8 mx-auto mb-2"
                      />
                      <p className="text-sm text-base-content/70">Imgur Album</p>
                      <a
                        href={card.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link link-primary text-xs break-all"
                      >
                        {card.url}
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="card-body break-words overflow-wrap-anywhere">
                    <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {renderTextWithLinks(card.text)}
                    </p>
                  </div>
                )}
              </div>
              
              {/* Text content and metadata at bottom - always visible */}
              <div className="flex-shrink-0">
                {/* Message text with rounded dark grey background */}
                <div className="bg-base-300 rounded-lg p-4">
                  <div className="break-words overflow-wrap-anywhere mb-3">
                    <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {card.isYouTube 
                        ? renderTextWithLinks(card.text, card.url, 'YouTube link')
                        : card.isReddit
                        ? renderTextWithLinks(card.text, card.url, 'Reddit link')
                        : card.isTwitter
                        ? renderTextWithLinks(card.text, card.url, 'Twitter link')
                        : card.isStreamable
                        ? renderTextWithLinks(card.text, card.url, 'Streamable link')
                        : card.isImgur
                        ? renderTextWithLinks(card.text, card.url, 'Imgur link')
                        : card.isWikipedia
                        ? renderTextWithLinks(card.text, card.url, 'Wikipedia link')
                        : card.isBluesky
                        ? renderTextWithLinks(card.text, card.url, 'Bluesky link')
                        : renderTextWithLinks(card.text)
                      }
                    </p>
                  </div>
                  
                  {/* User info and expand button */}
                  <div className="flex items-center justify-between pt-2 border-t border-base-content/20">
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-xs text-base-content/70">Posted by</span>
                        <a
                          href={`https://rustlesearch.dev/?username=${encodeURIComponent(card.nick)}&channel=Destinygg`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-sm font-bold text-primary hover:underline"
                        >
                          {card.nick}
                        </a>
                      </div>
                      <div className="text-xs text-base-content/50">
                        {new Date(card.date).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => onCardClick(card.id)}
                      className="btn btn-sm btn-circle btn-primary flex-shrink-0"
                      title="Expand"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Render text with clickable links
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

// Theme Tab Component
function ThemeTab({ theme, onThemeChange }: { theme: ThemeSettings; onThemeChange: (theme: ThemeSettings) => void }) {
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

function renderTextWithLinks(text: string, replaceUrl?: string, replaceWith?: string): JSX.Element {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0
  let match
  let hasLinks = false

  while ((match = urlRegex.exec(text)) !== null) {
    hasLinks = true
    // Add text before the link
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    
    // Add the link
    const url = match[0]
    // If this URL should be replaced with a shorter text
    const shouldReplace = replaceUrl && url === replaceUrl
    const displayText = shouldReplace && replaceWith ? replaceWith : url
    
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="link link-primary break-words overflow-wrap-anywhere"
        onClick={(e) => e.stopPropagation()}
        style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
      >
        {displayText}
      </a>
    )
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }
  
  // If no links found, return plain text
  if (!hasLinks) {
    return <>{text}</>
  }
  
  return <>{parts}</>
}

function LinkScroller() {
  // Load settings on mount
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // View mode: 'overview' or 'highlight'
  const [viewMode, setViewMode] = useState<'overview' | 'highlight'>('overview')
  // Initialize tempSettings with safe defaults
  const [tempSettings, setTempSettings] = useState<Settings>(() => ({
    filter: settings.filter || 'mrMouton',
    showNSFW: settings.showNSFW ?? false,
    showNSFL: settings.showNSFL ?? false,
    bannedTerms: Array.isArray(settings.bannedTerms) ? settings.bannedTerms : [],
    bannedUsers: Array.isArray(settings.bannedUsers) ? settings.bannedUsers : [],
    disabledPlatforms: Array.isArray(settings.disabledPlatforms) ? settings.disabledPlatforms : [],
    trustedUsers: Array.isArray(settings.trustedUsers) ? settings.trustedUsers : [],
    keybinds: Array.isArray(settings.keybinds) ? settings.keybinds : settings.keybinds || [],
    theme: settings.theme || { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
  }))
  
  // Settings tab state
  const [settingsTab, setSettingsTab] = useState<'filtering' | 'keybinds' | 'theme'>('filtering')
  
  const { filter, showNSFW, showNSFL, bannedTerms, bannedUsers, disabledPlatforms, trustedUsers } = settings
  
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mentions, setMentions] = useState<MentionData[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null)
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

  // Update temp settings when settings modal opens
  useEffect(() => {
    if (settingsOpen) {
      // Ensure all fields are present with defaults
      setTempSettings({
        filter: settings.filter || 'mrMouton',
        showNSFW: settings.showNSFW ?? false,
        showNSFL: settings.showNSFL ?? false,
        bannedTerms: Array.isArray(settings.bannedTerms) ? settings.bannedTerms : [],
        bannedUsers: Array.isArray(settings.bannedUsers) ? settings.bannedUsers : [],
        disabledPlatforms: Array.isArray(settings.disabledPlatforms) ? settings.disabledPlatforms : [],
        trustedUsers: Array.isArray(settings.trustedUsers) ? settings.trustedUsers : [],
    keybinds: Array.isArray(settings.keybinds) ? settings.keybinds : [],
    theme: settings.theme || { mode: 'system', lightTheme: 'retro', darkTheme: 'business', embedTheme: 'follow' },
      })
    }
  }, [settingsOpen, settings])

  // Save settings when they change
  const updateSettings = (newSettings: Settings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
  }

  // Handle settings modal save
  const handleSaveSettings = () => {
    updateSettings(tempSettings)
    setSettingsOpen(false)
    // Apply theme immediately
    applyTheme(tempSettings.theme)
  }
  
  // Apply theme to document
  const applyTheme = useCallback((themeSettings: ThemeSettings) => {
    const html = document.documentElement
    const body = document.body
    
    // Clear any custom CSS variables first
    const varsToRemove = ['--b1', '--b2', '--b3', '--bc', '--p', '--pc', '--s', '--sc', '--a', '--ac', '--n', '--nc', '--in', '--inc', '--su', '--suc', '--wa', '--wac', '--er', '--erc']
    varsToRemove.forEach(v => html.style.removeProperty(v))
    
    let themeToApply: string
    
    if (themeSettings.mode === 'system') {
      // Use system preference
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      themeToApply = mediaQuery.matches ? themeSettings.darkTheme : themeSettings.lightTheme
    } else if (themeSettings.mode === 'light') {
      themeToApply = themeSettings.lightTheme
    } else {
      themeToApply = themeSettings.darkTheme
    }
    
    html.setAttribute('data-theme', themeToApply)
    body.setAttribute('data-theme', themeToApply)
    logger.theme(`Theme applied: ${themeToApply}`)
    
    // Also apply to root div for proper cascading
    const rootDiv = document.getElementById('root')
    if (rootDiv) {
      const themeValue = html.getAttribute('data-theme')
      if (themeValue) {
        rootDiv.setAttribute('data-theme', themeValue)
      }
    }
    
    // Verify theme was applied (only log in debug mode)
    logger.debug('Theme applied', {
      html: html.getAttribute('data-theme'),
      body: body.getAttribute('data-theme'),
      root: rootDiv?.getAttribute('data-theme')
    })
  }, [])
  
  // Helper function to get embed theme
  const getEmbedTheme = useCallback((): 'light' | 'dark' => {
    if (settings.theme.embedTheme === 'follow') {
      // Follow the current app theme
      if (settings.theme.mode === 'system') {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        return mediaQuery.matches ? 'dark' : 'light'
      } else if (settings.theme.mode === 'light') {
        return 'light'
      } else {
        return 'dark'
      }
    } else {
      // Override with explicit light or dark
      return settings.theme.embedTheme
    }
  }, [settings.theme])
  
  // Apply theme on mount and when settings change
  useEffect(() => {
    applyTheme(settings.theme)
    
    // Listen for system theme changes if using system mode
    if (settings.theme.mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
        applyTheme(settings.theme) // Re-apply theme to handle system changes
      }
      updateTheme(mediaQuery)
      mediaQuery.addEventListener('change', updateTheme)
      return () => mediaQuery.removeEventListener('change', updateTheme)
    }
  }, [settings.theme, applyTheme])
  

  const SIZE = 150

  const fetchMentions = useCallback(async (username: string, currentOffset: number, append: boolean = false) => {
    logger.api('fetchMentions called', {
      username,
      currentOffset,
      append,
      size: SIZE,
      timestamp: new Date().toISOString()
    })
    
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
      logger.api(`Invoking IPC: fetch-mentions`, { username, size: SIZE, offset: currentOffset })
      
      const result = await window.ipcRenderer.invoke('fetch-mentions', username, SIZE, currentOffset)
      
      const fetchTime = Date.now() - startTime
      logger.api(`IPC call completed in ${fetchTime}ms`, {
        success: result.success,
        dataLength: result.success ? (Array.isArray(result.data) ? result.data.length : 'not an array') : 'N/A',
        error: result.success ? null : result.error
      })
      
      if (result.success) {
        const newData = result.data as MentionData[]
        logger.api(`Processing ${newData.length} mentions`)
        
        // Log the order of mentions (first 3 and last 3)
        if (newData.length > 0) {
          const firstFew = newData.slice(0, 3).map(m => ({
            date: new Date(m.date).toISOString(),
            text: m.text.substring(0, 50) + '...'
          }))
          const lastFew = newData.slice(-3).map(m => ({
            date: new Date(m.date).toISOString(),
            text: m.text.substring(0, 50) + '...'
          }))
          logger.debug('First 3 mentions:', firstFew)
          logger.debug('Last 3 mentions:', lastFew)
          
          // Check if they're sorted (newest first or oldest first)
          const dates = newData.map(m => m.date)
          const isDescending = dates.every((date, i) => i === 0 || dates[i - 1] >= date)
          const isAscending = dates.every((date, i) => i === 0 || dates[i - 1] <= date)
          logger.debug(`Order check: ${isDescending ? 'DESCENDING (newest first)' : isAscending ? 'ASCENDING (oldest first)' : 'UNSORTED'}`)
        }
        
        // Sort by date descending (newest first) to ensure consistent ordering
        const sortedData = [...newData].sort((a, b) => b.date - a.date)
        logger.debug('Sorted mentions by date (newest first)')
        
        if (append) {
          setMentions(prev => {
            const combined = [...prev, ...sortedData]
            logger.api(`Appended mentions. Total now: ${combined.length}`)
            return combined
          })
        } else {
          logger.api('Setting new mentions (replacing existing)')
          setMentions(sortedData)
        }
        
        // If we got fewer results than requested, we've reached the end
        const hasMore = newData.length === SIZE
        setHasMore(hasMore)
        setOffset(currentOffset + newData.length)
        logger.api(`Updated state: offset=${currentOffset + newData.length}, hasMore=${hasMore}`)
      } else {
        const errorMsg = result.error || 'Failed to fetch mentions'
        logger.error(`Fetch failed: ${errorMsg}`)
        setError(errorMsg)
        setHasMore(false)
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
      if (append) {
        setLoadingMore(false)
        logger.api('Finished loading more')
      } else {
        setLoading(false)
        logger.api('Finished fetching')
      }
    }
  }, [])

  // Reset and fetch when filter changes
  useEffect(() => {
    if (filter) {
      setOffset(0)
      setHasMore(true)
      setMentions([])
      fetchMentions(filter, 0, false)
    }
  }, [filter, fetchMentions])

  // Handle load more button click
  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return
    fetchMentions(filter, offset, true)
  }, [filter, offset, loadingMore, hasMore, loading, fetchMentions])

  // Handle scroll to load more (automatic)
  const handleScroll = useCallback(() => {
    if (loadingMore || !hasMore || loading) return

    const scrollTop = window.scrollY || document.documentElement.scrollTop
    const scrollHeight = document.documentElement.scrollHeight
    const clientHeight = window.innerHeight
    
    // Trigger when within 200px of bottom
    if (scrollHeight - scrollTop - clientHeight < 200) {
      fetchMentions(filter, offset, true)
    }
  }, [filter, offset, loadingMore, hasMore, loading, fetchMentions])

  useEffect(() => {
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Process mentions into link cards
  const linkCards = useMemo(() => {
    const cards: LinkCard[] = []
    
    mentions.forEach((mention, index) => {
      // Filter out NSFW if toggle is off
      if (!showNSFW && containsNSFW(mention.text)) {
        return
      }

      // Filter out NSFL if toggle is off
      if (!showNSFL && containsNSFL(mention.text)) {
        return
      }

      // Filter out banned terms
      if (containsBannedTerms(mention.text, bannedTerms)) {
        return
      }

      // Filter out banned users
      if (isBannedUser(mention.nick, bannedUsers)) {
        return
      }

      const urls = extractUrls(mention.text)
      
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
        const isYouTube = isYouTubeLink(actualUrl)
        const embedUrl = isYouTube ? getYouTubeEmbedUrl(actualUrl) : undefined
        const isTwitter = isTwitterStatusLink(actualUrl)
        const isTikTok = isTikTokVideoLink(actualUrl)
        const isReddit = isRedditPostLink(actualUrl) && !isRedditMedia
        const isImgur = isImgurAlbumLink(url) // Check original URL, not actualUrl
        const isStreamable = isStreamableLink(actualUrl)
        const isWikipedia = isWikipediaLink(actualUrl)
        const isBluesky = isBlueskyLink(actualUrl)
        
        const linkType = getLinkType(url)
        
        // Filter out disabled platforms
        if (isPlatformDisabled(linkType, disabledPlatforms)) {
          return
        }
        
        // Create unique ID using date, index, urlIndex, and a hash of the URL
        // This ensures uniqueness even if the same URL appears multiple times
        const urlHash = url.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        const uniqueId = `${mention.date}-${index}-${urlIndex}-${urlHash}-${url.slice(-20)}`
        
        // Check if user is trusted
        const isTrusted = isTrustedUser(mention.nick, trustedUsers)
        
        cards.push({
          id: uniqueId,
          url: actualUrl, // Use the actual media URL if it's a Reddit media link
          text: mention.text,
          nick: mention.nick,
          date: mention.date,
          isDirectMedia: mediaInfo.isMedia,
          mediaType: mediaInfo.type,
          linkType: linkType, // Keep original URL for link type detection
          embedUrl: embedUrl || undefined,
          isYouTube,
          isTwitter,
          isTikTok,
          isReddit,
          isImgur,
          isStreamable,
          isWikipedia,
          isBluesky,
          isTrusted, // Add trusted flag
        })
      })
    })

    return cards
  }, [mentions, showNSFW, showNSFL, bannedTerms, bannedUsers, disabledPlatforms, trustedUsers])

  const highlightedCard = linkCards.find(card => card.id === highlightedCardId)
  const highlightedIndex = highlightedCardId ? linkCards.findIndex(card => card.id === highlightedCardId) : -1

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
        if (hasMore && !loadingMore && !loading) {
          logger.api('At end of list, loading more mentions...')
          waitingForMoreRef.current = true
          await fetchMentions(filter, offset, true)
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
        await fetchMentions(filter, 0, false)
        // The useEffect below will handle highlighting the first card after refresh
      } else {
        // Not at beginning, just move to previous
        setHighlightedCardId(linkCards[highlightedIndex - 1].id)
      }
    }
  }, [highlightedIndex, linkCards, hasMore, loadingMore, loading, filter, offset, fetchMentions])

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
    
    logger.api(`State reset, calling fetchMentions with filter="${filter}", offset=0`)
    fetchMentions(filter, 0, false)
  }, [filter, fetchMentions, mentions.length, offset, hasMore, highlightedCardId])

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
        <h3 className="font-bold text-lg mb-4">Settings</h3>
        
        {/* Tabs */}
        <div className="tabs tabs-bordered mb-4">
          <button
            className={`tab ${settingsTab === 'filtering' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('filtering')}
          >
            Filtering
          </button>
          <button
            className={`tab ${settingsTab === 'keybinds' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('keybinds')}
          >
            Keybinds
          </button>
          <button
            className={`tab ${settingsTab === 'theme' ? 'tab-active' : ''}`}
            onClick={() => setSettingsTab('theme')}
          >
            Theme
          </button>
        </div>
        
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Filtering Tab */}
          {settingsTab === 'filtering' && (
            <div className="space-y-4">
              {/* Filter input */}
              <div>
                <label className="label">
                  <span className="label-text">Filter (username):</span>
                </label>
                <input
                  type="text"
                  value={tempSettings.filter}
                  onChange={(e) => setTempSettings({ ...tempSettings, filter: e.target.value })}
                  placeholder="Enter username"
                  className="input input-bordered w-full"
                />
              </div>

              {/* Show NSFW toggle */}
              <div className="form-control">
                <label className="label cursor-pointer">
                  <span className="label-text">Show NSFW</span>
                  <input
                    type="checkbox"
                    checked={tempSettings.showNSFW}
                    onChange={(e) => setTempSettings({ ...tempSettings, showNSFW: e.target.checked })}
                    className="toggle toggle-primary"
                  />
                </label>
              </div>

              {/* Show NSFL toggle */}
              <div className="form-control">
                <label className="label cursor-pointer">
                  <span className="label-text">Show NSFL</span>
                  <input
                    type="checkbox"
                    checked={tempSettings.showNSFL}
                    onChange={(e) => setTempSettings({ ...tempSettings, showNSFL: e.target.checked })}
                    className="toggle toggle-primary"
                  />
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

              {/* Banned users */}
              <ListManager
                title="Banned Users"
                items={tempSettings.bannedUsers}
                onItemsChange={(items) => setTempSettings({ ...tempSettings, bannedUsers: items })}
                placeholder="Enter username"
                helpText="Messages from these users will be filtered out"
              />

              {/* Trusted users */}
              <ListManager
                title="Trusted Users"
                items={tempSettings.trustedUsers}
                onItemsChange={(items) => setTempSettings({ ...tempSettings, trustedUsers: items })}
                placeholder="Enter username"
                helpText="Cards from these users will have a golden outline"
              />

              {/* Show platforms */}
              <div>
                <label className="label">
                  <span className="label-text">Show Platforms</span>
                </label>
                <div className="space-y-2">
                  {['YouTube', 'Twitter', 'TikTok', 'Reddit', 'Kick', 'Twitch', 'Streamable', 'Imgur'].map((platform) => (
                    <label key={platform} className="label cursor-pointer justify-start gap-2">
                      <input
                        type="checkbox"
                        checked={!(tempSettings.disabledPlatforms || []).includes(platform)}
                        onChange={(e) => {
                          const currentDisabled = tempSettings.disabledPlatforms || []
                          if (e.target.checked) {
                            setTempSettings({
                              ...tempSettings,
                              disabledPlatforms: currentDisabled.filter(p => p !== platform)
                            })
                          } else {
                            setTempSettings({
                              ...tempSettings,
                              disabledPlatforms: [...currentDisabled, platform]
                            })
                          }
                        }}
                        className="checkbox checkbox-primary checkbox-sm"
                      />
                      <span className="label-text">{platform}</span>
                    </label>
                  ))}
                </div>
                <label className="label">
                  <span className="label-text-alt">Uncheck platforms to hide them</span>
                </label>
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
          
          {/* Theme Tab */}
          {settingsTab === 'theme' && (
            <ThemeTab
              theme={tempSettings.theme}
              onThemeChange={(theme) => setTempSettings({ ...tempSettings, theme })}
            />
          )}
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
  if (viewMode === 'highlight' && highlightedCard) {
    return (
      <>
      <div className={`h-screen flex overflow-hidden ${highlightedCard.isTrusted ? 'bg-base-300' : 'bg-base-200'}`}>
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
                  embedUrl={highlightedCard.embedUrl}
                  autoplay={autoplayEnabled}
                  mute={autoplayEnabled ? muteEnabled : false}
                />
              </div>
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
            ) : highlightedCard.isImgur ? (
              <div>
                {loadingImgurAlbum ? (
                  <div className="flex justify-center items-center py-12">
                    <span className="loading loading-spinner loading-lg"></span>
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
            <div className={`bg-base-300 rounded-lg p-4 ${highlightedCard.isTrusted ? 'border-2 border-yellow-500' : ''}`}>
              <div className="mb-3 break-words overflow-wrap-anywhere">
                <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                  {highlightedCard.isYouTube 
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'YouTube link')
                    : highlightedCard.isReddit
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Reddit link')
                    : highlightedCard.isTwitter
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Twitter link')
                    : highlightedCard.isImgur
                    ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Imgur link')
                    : renderTextWithLinks(highlightedCard.text)
                  }
                </p>
              </div>
              <div className="flex items-center gap-4 pt-2 border-t border-base-content/20">
                <div>
                  <span className="text-xs text-base-content/70">Posted by</span>
                  <a
                    href={`https://rustlesearch.dev/?username=${encodeURIComponent(highlightedCard.nick)}&channel=Destinygg`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-sm font-bold text-primary hover:underline"
                  >
                    {highlightedCard.nick}
                  </a>
                </div>
                <div className="text-xs text-base-content/50">
                  {new Date(highlightedCard.date).toLocaleString()}
                </div>
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
                            {(card.linkType || 'Link').split('').map((letter, index) => (
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
            
            {/* Load More button in sidebar */}
            {hasMore && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="btn btn-primary btn-sm"
                >
                  {loadingMore ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      Loading...
                    </>
                  ) : (
                    'Load More'
                  )}
                </button>
              </div>
            )}
            {!hasMore && linkCards.length > 0 && (
              <div className="mt-4 text-center text-xs text-base-content/50">
                No more links to load
              </div>
            )}
          </div>
        </div>

        {/* Floating action buttons - bottom right */}
        <div className="fixed bottom-6 right-6 flex flex-row gap-3 z-50">
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
      </>
    )
  }

  // Overview Mode
  return (
    <>
      <div className="min-h-screen bg-base-200 p-4">
      {loading && mentions.length === 0 && (
        <div className="flex justify-center items-center py-8">
          <span className="loading loading-spinner loading-lg"></span>
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
          <div className="max-w-7xl mx-auto">
            <MasonryGrid cards={linkCards} onCardClick={(cardId) => setExpandedCardId(cardId)} getEmbedTheme={getEmbedTheme} />
          </div>
          {/* Load More button */}
          {hasMore && (
            <div className="flex justify-center py-8">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="btn btn-primary"
              >
                {loadingMore ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Loading...
                  </>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
          {!hasMore && linkCards.length > 0 && (
            <div className="text-center py-8 text-base-content/70">
              No more links to load
            </div>
          )}
        </>
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
                    <div className="font-semibold">{expandedCard.username}</div>
                  </div>
                  <div>
                    <div className="text-xs text-base-content/50 mb-1">Message</div>
                    <div className="text-sm whitespace-pre-wrap break-words">{expandedCard.text}</div>
                  </div>
                  <div>
                    <div className="text-xs text-base-content/50 mb-1">Link</div>
                    <a
                      href={expandedCard.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary text-sm break-all"
                    >
                      {expandedCard.url}
                    </a>
                  </div>
                  {expandedCard.timestamp && (
                    <div>
                      <div className="text-xs text-base-content/50 mb-1">Time</div>
                      <div className="text-sm">{new Date(expandedCard.timestamp).toLocaleString()}</div>
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
                    <YouTubeEmbed url={expandedCard.url} embedUrl={expandedCard.embedUrl} autoplay={false} mute={false} />
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
                  ) : (
                    <div className="bg-base-200 rounded-lg p-6">
                      <a href={expandedCard.url} target="_blank" rel="noopener noreferrer" className="link link-primary break-all">
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
    </>
  )
}

export default LinkScroller
