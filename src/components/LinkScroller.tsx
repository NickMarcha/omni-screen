import { useState, useEffect, useMemo, useCallback } from 'react'
import TwitterEmbed from './embeds/TwitterEmbed'
import YouTubeEmbed from './embeds/YouTubeEmbed'
import TikTokEmbed from './embeds/TikTokEmbed'
import RedditEmbed from './embeds/RedditEmbed'
import VideoEmbed from './embeds/VideoEmbed'
import ImageEmbed from './embeds/ImageEmbed'
import twitterIcon from '../assets/icons/third-party/twitter.png'
import youtubeIcon from '../assets/icons/third-party/youtube.png'
import tiktokIcon from '../assets/icons/third-party/tiktok.png'
import kickIcon from '../assets/icons/third-party/kick.png'
import twitchIcon from '../assets/icons/third-party/twitch.png'
import redditIcon from '../assets/icons/third-party/reddit.png'
import streamableIcon from '../assets/icons/third-party/streamable.ico'
import imgurIcon from '../assets/icons/third-party/imgur.png'

interface MentionData {
  date: number
  text: string
  nick: string
  flairs: string
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
function containsBannedTerms(text: string, bannedTerms: string[]): boolean {
  if (bannedTerms.length === 0) return false
  const lowerText = text.toLowerCase()
  return bannedTerms.some(term => term.trim() && lowerText.includes(term.trim().toLowerCase()))
}

// Settings interface
interface Settings {
  filter: string
  showNSFW: boolean
  showNSFL: boolean
  bannedTerms: string
}

// Load settings from localStorage
function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem('omni-screen-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      console.log('Loaded settings from localStorage:', parsed)
      return parsed
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  const defaults = {
    filter: 'mrMouton',
    showNSFW: false,
    showNSFL: false,
    bannedTerms: '',
  }
  console.log('Using default settings:', defaults)
  return defaults
}

// Save settings to localStorage
function saveSettings(settings: Settings) {
  try {
    localStorage.setItem('omni-screen-settings', JSON.stringify(settings))
    console.log('Saved settings to localStorage:', settings)
    // Verify it was saved
    const verify = localStorage.getItem('omni-screen-settings')
    if (!verify) {
      console.error('Settings were not saved - localStorage may be disabled')
    }
  } catch (e) {
    console.error('Failed to save settings:', e)
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
    // Check for /@username/video/ID format
    return /\/@[\w.-]+\/video\/\d+/.test(pathname)
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

// Extract YouTube embed URL from various YouTube URL formats
function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    
    // Handle youtu.be short links: https://youtu.be/VIDEO_ID
    if (hostname === 'youtu.be') {
      const videoId = urlObj.pathname.slice(1).split('?')[0]
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}?rel=0`
      }
    }
    
    // Handle youtube.com URLs
    if (hostname.includes('youtube.com')) {
      // Check for playlist: youtube.com/playlist?list=PLAYLIST_ID
      const playlistId = urlObj.searchParams.get('list')
      if (playlistId) {
        return `https://www.youtube.com/embed/videoseries?list=${playlistId}&rel=0`
      }
      
      // Check for YouTube Shorts: youtube.com/shorts/VIDEO_ID
      if (urlObj.pathname.startsWith('/shorts/')) {
        const videoId = urlObj.pathname.split('/shorts/')[1]?.split('?')[0]
        if (videoId) {
          return `https://www.youtube.com/embed/${videoId}?rel=0`
        }
      }
      
      // Check for video ID in various formats
      // youtube.com/watch?v=VIDEO_ID
      const videoId = urlObj.searchParams.get('v')
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}?rel=0`
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
          return `https://www.youtube.com/embed/${embedId}?${params.toString()}`
        }
      }
      
      // youtube.com/v/VIDEO_ID
      if (urlObj.pathname.startsWith('/v/')) {
        const videoId = urlObj.pathname.split('/v/')[1]?.split('?')[0]
        if (videoId) {
          return `https://www.youtube.com/embed/${videoId}?rel=0`
        }
      }
    }
    
    return null
  } catch {
    return null
  }
}

// Render text with clickable links
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
  const [tempSettings, setTempSettings] = useState<Settings>(settings)
  
  const { filter, showNSFW, showNSFL, bannedTerms } = settings
  const bannedTermsList = bannedTerms.split(',').map(t => t.trim()).filter(t => t.length > 0)
  
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mentions, setMentions] = useState<MentionData[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null)
  const [autoplayEnabled, setAutoplayEnabled] = useState(true) // Default to true for highlight mode
  const [muteEnabled, setMuteEnabled] = useState(false) // Default to false (sound on)

  // Update temp settings when settings modal opens
  useEffect(() => {
    if (settingsOpen) {
      setTempSettings(settings)
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
  }

  const SIZE = 150

  const fetchMentions = useCallback(async (username: string, currentOffset: number, append: boolean = false) => {
    console.log(`[Renderer] fetchMentions called:`, {
      username,
      currentOffset,
      append,
      size: SIZE,
      timestamp: new Date().toISOString()
    })
    
    if (append) {
      setLoadingMore(true)
      console.log(`[Renderer] Loading more mentions (offset: ${currentOffset})...`)
    } else {
      setLoading(true)
      setError(null)
      console.log(`[Renderer] Fetching fresh mentions (offset: ${currentOffset})...`)
    }
    
    try {
      const startTime = Date.now()
      console.log(`[Renderer] Invoking IPC: fetch-mentions with username="${username}", size=${SIZE}, offset=${currentOffset}`)
      
      const result = await window.ipcRenderer.invoke('fetch-mentions', username, SIZE, currentOffset)
      
      const fetchTime = Date.now() - startTime
      console.log(`[Renderer] IPC call completed in ${fetchTime}ms:`, {
        success: result.success,
        dataLength: result.success ? (Array.isArray(result.data) ? result.data.length : 'not an array') : 'N/A',
        error: result.success ? null : result.error
      })
      
      if (result.success) {
        const newData = result.data as MentionData[]
        console.log(`[Renderer] Processing ${newData.length} mentions`)
        
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
          console.log(`[Renderer] First 3 mentions:`, firstFew)
          console.log(`[Renderer] Last 3 mentions:`, lastFew)
          
          // Check if they're sorted (newest first or oldest first)
          const dates = newData.map(m => m.date)
          const isDescending = dates.every((date, i) => i === 0 || dates[i - 1] >= date)
          const isAscending = dates.every((date, i) => i === 0 || dates[i - 1] <= date)
          console.log(`[Renderer] Order check: ${isDescending ? 'DESCENDING (newest first)' : isAscending ? 'ASCENDING (oldest first)' : 'UNSORTED'}`)
        }
        
        // Sort by date descending (newest first) to ensure consistent ordering
        const sortedData = [...newData].sort((a, b) => b.date - a.date)
        console.log(`[Renderer] Sorted mentions by date (newest first)`)
        
        if (append) {
          setMentions(prev => {
            const combined = [...prev, ...sortedData]
            console.log(`[Renderer] Appended mentions. Total now: ${combined.length}`)
            return combined
          })
        } else {
          console.log(`[Renderer] Setting new mentions (replacing existing)`)
          setMentions(sortedData)
        }
        
        // If we got fewer results than requested, we've reached the end
        const hasMore = newData.length === SIZE
        setHasMore(hasMore)
        setOffset(currentOffset + newData.length)
        console.log(`[Renderer] Updated state: offset=${currentOffset + newData.length}, hasMore=${hasMore}`)
      } else {
        const errorMsg = result.error || 'Failed to fetch mentions'
        console.error(`[Renderer] Fetch failed: ${errorMsg}`)
        setError(errorMsg)
        setHasMore(false)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[Renderer] Exception in fetchMentions:`, err)
      console.error(`[Renderer] Error details:`, {
        message: errorMsg,
        stack: err instanceof Error ? err.stack : 'No stack trace'
      })
      setError(errorMsg)
      setHasMore(false)
    } finally {
      if (append) {
        setLoadingMore(false)
        console.log(`[Renderer] Finished loading more`)
      } else {
        setLoading(false)
        console.log(`[Renderer] Finished fetching`)
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

  // Handle scroll to load more
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
      if (containsBannedTerms(mention.text, bannedTermsList)) {
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
        
        // Create unique ID using date, index, urlIndex, and a hash of the URL
        // This ensures uniqueness even if the same URL appears multiple times
        const urlHash = url.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
        const uniqueId = `${mention.date}-${index}-${urlIndex}-${urlHash}-${url.slice(-20)}`
        
        cards.push({
          id: uniqueId,
          url: actualUrl, // Use the actual media URL if it's a Reddit media link
          text: mention.text,
          nick: mention.nick,
          date: mention.date,
          isDirectMedia: mediaInfo.isMedia,
          mediaType: mediaInfo.type,
          linkType: getLinkType(url), // Keep original URL for link type detection
          embedUrl: embedUrl || undefined,
          isYouTube,
          isTwitter,
          isTikTok,
          isReddit,
        })
      })
    })

    return cards
  }, [mentions, showNSFW, showNSFL, bannedTermsList])

  const highlightedCard = linkCards.find(card => card.id === highlightedCardId)
  const highlightedIndex = highlightedCardId ? linkCards.findIndex(card => card.id === highlightedCardId) : -1

  const navigateHighlight = (direction: 'prev' | 'next') => {
    if (highlightedIndex === -1) return
    
    const newIndex = direction === 'next' 
      ? (highlightedIndex + 1) % linkCards.length
      : (highlightedIndex - 1 + linkCards.length) % linkCards.length
    
    setHighlightedCardId(linkCards[newIndex].id)
  }

  // Handle refresh - reset feed and fetch from beginning
  const handleRefresh = useCallback(() => {
    console.log(`[Renderer] Refresh triggered at ${new Date().toISOString()}`)
    console.log(`[Renderer] Current state before refresh:`, {
      mentionsCount: mentions.length,
      offset,
      hasMore,
      highlightedCardId,
      filter
    })
    
    setMentions([])
    setOffset(0)
    setHasMore(true)
    setHighlightedCardId(null)
    
    console.log(`[Renderer] State reset, calling fetchMentions with filter="${filter}", offset=0`)
    fetchMentions(filter, 0, false)
  }, [filter, fetchMentions, mentions.length, offset, hasMore, highlightedCardId])

  // Highlight Layout Component
  if (highlightedCard) {
    return (
      <div className="h-screen flex flex-col bg-base-100">
        {/* Top bar with close button */}
        <div className="flex justify-between items-center p-4 border-b border-base-300">
          <h2 className="text-xl font-bold">Highlight View</h2>
          <button
            onClick={() => setHighlightedCardId(null)}
            className="btn btn-sm btn-ghost"
          >
            Close
          </button>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left side - Highlighted content (70%) */}
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
                <div>
                  <TwitterEmbed url={highlightedCard.url} />
                </div>
              ) : highlightedCard.isTikTok ? (
                <div>
                  <TikTokEmbed url={highlightedCard.url} />
                </div>
              ) : highlightedCard.isReddit ? (
                <div>
                  <RedditEmbed url={highlightedCard.url} theme="dark" />
                </div>
              ) : (
                <div className="bg-base-200 rounded-lg p-6 mb-4 min-h-[200px]">
                  <div className="mb-4 flex items-center gap-2">
                    {getLinkTypeIcon(highlightedCard.linkType) ? (
                      <img 
                        src={getLinkTypeIcon(highlightedCard.linkType)!} 
                        alt={highlightedCard.linkType || 'Link'} 
                        className="w-6 h-6 object-contain"
                      />
                    ) : (
                      <div className="badge badge-primary badge-lg">{highlightedCard.linkType}</div>
                    )}
                  </div>
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
              
              {/* Text content and metadata in rounded dark grey background */}
              <div className="mt-4 bg-base-300 rounded-lg p-4">
                <div className="mb-3 break-words overflow-wrap-anywhere">
                  <p className="text-base break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                    {highlightedCard.isYouTube 
                      ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'YouTube link')
                      : highlightedCard.isReddit
                      ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Reddit link')
                      : highlightedCard.isTwitter
                      ? renderTextWithLinks(highlightedCard.text, highlightedCard.url, 'Twitter link')
                      : renderTextWithLinks(highlightedCard.text)
                    }
                  </p>
                </div>
                <div className="flex items-center gap-4 pt-2 border-t border-base-content/20">
                  <div>
                    <span className="text-sm text-base-content/70">Posted by</span>
                    <a
                      href={`https://rustlesearch.dev/?username=${encodeURIComponent(highlightedCard.nick)}&channel=Destinygg`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-lg font-bold text-primary hover:underline"
                    >
                      {highlightedCard.nick}
                    </a>
                  </div>
                  <div className="text-sm text-base-content/50">
                    {new Date(highlightedCard.date).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Card list (30%) */}
          <div className="w-[30%] overflow-y-auto p-4 bg-base-200">
            <div className="space-y-3">
              {linkCards.map((card, index) => (
                <div
                  key={card.id}
                  onClick={() => setHighlightedCardId(card.id)}
                  className={`card bg-base-100 shadow-md cursor-pointer transition-all ${
                    card.id === highlightedCardId ? 'ring-2 ring-primary' : 'hover:shadow-lg'
                  }`}
                >
                  <div className="card-body p-3 flex flex-row gap-3">
                    <div className="flex-shrink-0 flex items-start">
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
                          <div className="badge badge-primary badge-sm">{card.linkType}</div>
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
          </div>
        </div>

        {/* Navigation arrows and controls */}
        <div className="flex justify-center items-center gap-4 p-4 border-t border-base-300">
          <button
            onClick={() => navigateHighlight('prev')}
            className="btn btn-circle btn-primary"
            disabled={linkCards.length === 0}
          >
            ←
          </button>
          <div className="text-sm text-base-content/70">
            {highlightedIndex + 1} / {linkCards.length}
          </div>
          <button
            onClick={() => navigateHighlight('next')}
            className="btn btn-circle btn-primary"
            disabled={linkCards.length === 0}
          >
            →
          </button>
          
          {/* Autoplay toggle */}
          <div className="divider divider-horizontal mx-2"></div>
          <div className="flex items-center gap-2">
            <label className="label cursor-pointer gap-2">
              <span className="label-text text-sm">Autoplay</span>
              <input
                type="checkbox"
                checked={autoplayEnabled}
                onChange={(e) => setAutoplayEnabled(e.target.checked)}
                className="toggle toggle-primary toggle-sm"
              />
            </label>
          </div>
          
          {/* Mute toggle (only shown when autoplay is enabled) */}
          {autoplayEnabled && (
            <div className="flex items-center gap-2">
              <label className="label cursor-pointer gap-2">
                <span className="label-text text-sm">Mute</span>
                <input
                  type="checkbox"
                  checked={muteEnabled}
                  onChange={(e) => setMuteEnabled(e.target.checked)}
                  className="toggle toggle-secondary toggle-sm"
                />
              </label>
            </div>
          )}
        </div>

        {/* Floating action buttons - bottom right */}
        <div className="fixed bottom-6 right-6 flex flex-row gap-3 z-50">
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
    )
  }

  return (
    <div className="min-h-screen bg-base-100 p-4">
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

      {/* Link Cards Grid */}
      {!loading && linkCards.length > 0 && (
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {linkCards.map((card) => (
              <div key={card.id} className="card bg-base-200 shadow-xl">
                {card.isDirectMedia ? (
                  <figure className="relative">
                    {card.mediaType === 'image' ? (
                      <ImageEmbed 
                        url={card.url} 
                        alt={card.text}
                        className="w-full h-48 object-cover"
                      />
                    ) : (
                      <VideoEmbed 
                        url={card.url}
                        autoplay={false}
                        muted={true}
                        controls={true}
                        className="w-full h-48 object-cover"
                      />
                    )}
                  </figure>
                ) : (
                  <div className="card-body break-words overflow-wrap-anywhere">
                    <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {renderTextWithLinks(card.text)}
                    </p>
                  </div>
                )}
                {card.isDirectMedia && (
                  <div className="card-body pt-2 break-words overflow-wrap-anywhere">
                    <p className="text-sm break-words" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                      {renderTextWithLinks(card.text)}
                    </p>
                  </div>
                )}
                <div className="card-body pt-2">
                  <div className="card-actions justify-between items-center mt-2">
                    <div className="flex flex-col">
                      <div className="text-sm font-bold text-primary">{card.nick}</div>
                      <div className="text-xs text-base-content/50">
                        {new Date(card.date).toLocaleString()}
                      </div>
                    </div>
                    <button
                      onClick={() => setHighlightedCardId(card.id)}
                      className="btn btn-sm btn-primary"
                    >
                      Highlight
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {loadingMore && (
            <div className="flex justify-center items-center py-8">
              <span className="loading loading-spinner loading-md"></span>
              <span className="ml-2 text-base-content/70">Loading more...</span>
            </div>
          )}
          {!hasMore && linkCards.length > 0 && (
            <div className="text-center py-8 text-base-content/70">
              No more links to load
            </div>
          )}
        </div>
      )}

      {!loading && !error && linkCards.length === 0 && mentions.length === 0 && (
        <div className="max-w-7xl mx-auto text-center py-12">
          <p className="text-base-content/70">No links found in the filtered messages.</p>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">Settings</h3>
            
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
              <div>
                <label className="label">
                  <span className="label-text">Banned Terms (comma-separated):</span>
                </label>
                <textarea
                  value={tempSettings.bannedTerms}
                  onChange={(e) => setTempSettings({ ...tempSettings, bannedTerms: e.target.value })}
                  placeholder="term1, term2, term3"
                  className="textarea textarea-bordered w-full"
                  rows={3}
                />
                <label className="label">
                  <span className="label-text-alt">Messages containing these terms will be filtered out</span>
                </label>
              </div>
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
      )}

      {/* Floating action buttons - bottom right */}
      <div className="fixed bottom-6 right-6 flex flex-row gap-3 z-50">
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
  )
}

export default LinkScroller
