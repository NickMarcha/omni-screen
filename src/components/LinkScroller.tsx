import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('Failed to load settings:', e)
  }
  return {
    filter: 'mrMouton',
    showNSFW: false,
    showNSFL: false,
    bannedTerms: '',
  }
}

// Save settings to localStorage
function saveSettings(settings: Settings) {
  try {
    localStorage.setItem('omni-screen-settings', JSON.stringify(settings))
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
function renderTextWithLinks(text: string): JSX.Element {
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
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="link link-primary"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
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
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }
    
    try {
      const result = await window.ipcRenderer.invoke('fetch-mentions', username, SIZE, currentOffset)
      if (result.success) {
        const newData = result.data as MentionData[]
        if (append) {
          setMentions(prev => [...prev, ...newData])
        } else {
          setMentions(newData)
        }
        
        // If we got fewer results than requested, we've reached the end
        setHasMore(newData.length === SIZE)
        setOffset(currentOffset + newData.length)
      } else {
        setError(result.error || 'Failed to fetch mentions')
        setHasMore(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setHasMore(false)
    } finally {
      if (append) {
        setLoadingMore(false)
      } else {
        setLoading(false)
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
          embedUrl,
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
  const [twitterEmbedHtml, setTwitterEmbedHtml] = useState<string | null>(null)
  const [loadingTwitterEmbed, setLoadingTwitterEmbed] = useState(false)
  const [twitterEmbedError, setTwitterEmbedError] = useState<string | null>(null)
  const [tiktokEmbedHtml, setTiktokEmbedHtml] = useState<string | null>(null)
  const [loadingTikTokEmbed, setLoadingTikTokEmbed] = useState(false)
  const [tiktokEmbedError, setTiktokEmbedError] = useState<string | null>(null)
  const [redditEmbedHtml, setRedditEmbedHtml] = useState<string | null>(null)
  const [loadingRedditEmbed, setLoadingRedditEmbed] = useState(false)
  const [redditEmbedError, setRedditEmbedError] = useState<string | null>(null)

  // Fetch Twitter embed when a Twitter link is highlighted
  useEffect(() => {
    if (highlightedCard?.isTwitter && !highlightedCard.twitterEmbedHtml) {
      setLoadingTwitterEmbed(true)
      setTwitterEmbedError(null)
      // Determine theme based on current theme (you can make this configurable)
      const theme = 'dark' // or 'light' - can be made configurable later
      
      window.ipcRenderer.invoke('fetch-twitter-embed', highlightedCard.url, theme)
        .then((result) => {
          if (result.success && result.data?.html) {
            setTwitterEmbedHtml(result.data.html)
            setTwitterEmbedError(null)
          } else {
            setTwitterEmbedHtml(null)
            setTwitterEmbedError(result.error || 'Failed to load Twitter embed')
          }
        })
        .catch((err) => {
          console.error('Error fetching Twitter embed:', err)
          setTwitterEmbedHtml(null)
          setTwitterEmbedError(err?.message || 'Unknown error occurred')
        })
        .finally(() => {
          setLoadingTwitterEmbed(false)
        })
    } else if (!highlightedCard?.isTwitter) {
      setTwitterEmbedHtml(null)
      setTwitterEmbedError(null)
    }
  }, [highlightedCard?.id, highlightedCard?.isTwitter, highlightedCard?.url])

  // Fetch TikTok embed when a TikTok link is highlighted
  useEffect(() => {
    if (highlightedCard?.isTikTok && !highlightedCard.tiktokEmbedHtml) {
      setLoadingTikTokEmbed(true)
      setTiktokEmbedError(null)
      console.log('Fetching TikTok embed for:', highlightedCard.url)
      
      window.ipcRenderer.invoke('fetch-tiktok-embed', highlightedCard.url)
        .then((result) => {
          console.log('TikTok embed result:', result)
          if (result.success && result.data?.html) {
            console.log('Setting TikTok embed HTML')
            setTiktokEmbedHtml(result.data.html)
            setTiktokEmbedError(null)
          } else {
            console.error('TikTok embed failed:', result.error)
            setTiktokEmbedHtml(null)
            setTiktokEmbedError(result.error || 'Failed to load TikTok embed')
          }
        })
        .catch((err) => {
          console.error('Error fetching TikTok embed:', err)
          setTiktokEmbedHtml(null)
          setTiktokEmbedError(err?.message || 'Unknown error occurred')
        })
        .finally(() => {
          setLoadingTikTokEmbed(false)
        })
    } else if (!highlightedCard?.isTikTok) {
      setTiktokEmbedHtml(null)
      setTiktokEmbedError(null)
    }
  }, [highlightedCard?.id, highlightedCard?.isTikTok, highlightedCard?.url])

  // Fetch Reddit embed when a Reddit link is highlighted
  useEffect(() => {
    if (highlightedCard?.isReddit && !highlightedCard.redditEmbedHtml) {
      setLoadingRedditEmbed(true)
      setRedditEmbedError(null)
      const theme = 'dark' // or 'light' - can be made configurable later
      
      window.ipcRenderer.invoke('fetch-reddit-embed', highlightedCard.url, theme)
        .then((result) => {
          console.log('Reddit embed result:', result)
          if (result.success && result.data?.html) {
            console.log('Setting Reddit embed HTML')
            setRedditEmbedHtml(result.data.html)
            setRedditEmbedError(null)
          } else {
            console.error('Reddit embed failed:', result.error)
            setRedditEmbedHtml(null)
            setRedditEmbedError(result.error || 'Failed to load Reddit embed')
          }
        })
        .catch((err) => {
          console.error('Error fetching Reddit embed:', err)
          setRedditEmbedHtml(null)
          setRedditEmbedError(err?.message || 'Unknown error occurred')
        })
        .finally(() => {
          setLoadingRedditEmbed(false)
        })
    } else if (!highlightedCard?.isReddit) {
      setRedditEmbedHtml(null)
      setRedditEmbedError(null)
    }
  }, [highlightedCard?.id, highlightedCard?.isReddit, highlightedCard?.url])

  // Load Twitter widgets script when Twitter embed is rendered
  useEffect(() => {
    if (twitterEmbedHtml) {
      // Check if script is already loaded
      if (!document.querySelector('script[src="https://platform.twitter.com/widgets.js"]')) {
        const script = document.createElement('script')
        script.src = 'https://platform.twitter.com/widgets.js'
        script.async = true
        script.charset = 'utf-8'
        document.body.appendChild(script)
      } else {
        // If script exists, trigger widget reload using the global twttr object
        // @ts-ignore - Twitter widgets.js adds twttr to window
        if (typeof window !== 'undefined' && (window as any).twttr && (window as any).twttr.widgets) {
          (window as any).twttr.widgets.load()
        }
      }
    }
  }, [twitterEmbedHtml])

  // Load TikTok embed script when TikTok embed is rendered
  useEffect(() => {
    if (tiktokEmbedHtml) {
      // Suppress TikTok SDK errors to reduce console noise
      const originalError = console.error
      const errorSuppressor = (...args: any[]) => {
        const errorMsg = args[0]?.toString() || ''
        // Suppress TikTok SDK specific errors
        if (
          errorMsg.includes('webmssdk') ||
          errorMsg.includes('Cannot read properties of undefined') ||
          errorMsg.includes('tiktok_web_embed')
        ) {
          return // Suppress these errors
        }
        originalError.apply(console, args)
      }
      
      // Temporarily replace console.error
      console.error = errorSuppressor
      
      // Wait for DOM to update with the new HTML, then load/process script
      setTimeout(() => {
        // Check if script is already loaded
        const existingScript = document.querySelector('script[src="https://www.tiktok.com/embed.js"]')
        if (!existingScript) {
          const script = document.createElement('script')
          script.src = 'https://www.tiktok.com/embed.js'
          script.async = true
          script.charset = 'utf-8'
          script.onerror = () => {
            // Restore original console.error on script error
            console.error = originalError
          }
          document.body.appendChild(script)
          // TikTok embed.js should automatically process blockquotes when it loads
        } else {
          // Script already exists - reload it to trigger processing of new embeds
          // This ensures TikTok's script processes the newly inserted blockquote
          existingScript.remove()
          const script = document.createElement('script')
          script.src = 'https://www.tiktok.com/embed.js'
          script.async = true
          script.charset = 'utf-8'
          script.onerror = () => {
            // Restore original console.error on script error
            console.error = originalError
          }
          document.body.appendChild(script)
        }
        
        // Restore original console.error after a delay
        setTimeout(() => {
          console.error = originalError
        }, 2000)
      }, 200)
    }
  }, [tiktokEmbedHtml])

  // Load Reddit embed script when Reddit embed is rendered
  useEffect(() => {
    if (redditEmbedHtml) {
      // Wait for DOM to update
      setTimeout(() => {
        // Check if script is already loaded
        const existingScript = document.querySelector('script[src="https://embed.reddit.com/widgets.js"]')
        if (!existingScript) {
          const script = document.createElement('script')
          script.src = 'https://embed.reddit.com/widgets.js'
          script.async = true
          script.charset = 'UTF-8'
          document.body.appendChild(script)
        } else {
          // Script already exists - reload it to trigger processing of new embeds
          existingScript.remove()
          const script = document.createElement('script')
          script.src = 'https://embed.reddit.com/widgets.js'
          script.async = true
          script.charset = 'UTF-8'
          document.body.appendChild(script)
        }
      }, 200)
    }
  }, [redditEmbedHtml])

  const navigateHighlight = (direction: 'prev' | 'next') => {
    if (highlightedIndex === -1) return
    
    const newIndex = direction === 'next' 
      ? (highlightedIndex + 1) % linkCards.length
      : (highlightedIndex - 1 + linkCards.length) % linkCards.length
    
    setHighlightedCardId(linkCards[newIndex].id)
  }

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
                    <img
                      src={highlightedCard.url}
                      alt={highlightedCard.text}
                      className="w-full max-h-[70vh] object-contain rounded-lg mb-4"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                      }}
                    />
                  ) : (
                    <video
                      src={highlightedCard.url}
                      className="w-full max-h-[70vh] rounded-lg mb-4"
                      controls
                      onError={(e) => {
                        const target = e.target as HTMLVideoElement
                        target.style.display = 'none'
                      }}
                    />
                  )}
                  <div className="mt-4 mb-4">
                    <p className="text-base">{renderTextWithLinks(highlightedCard.text)}</p>
                  </div>
                </div>
              ) : highlightedCard.isYouTube && highlightedCard.embedUrl ? (
                <div>
                  <div className="aspect-video w-full mb-4 rounded-lg overflow-hidden bg-base-200">
                    <iframe
                      width="100%"
                      height="100%"
                      src={highlightedCard.embedUrl}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="w-full h-full"
                    />
                  </div>
                  <div className="mt-4 mb-4">
                    <p className="text-base">{renderTextWithLinks(highlightedCard.text)}</p>
                  </div>
                  <a
                    href={highlightedCard.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-primary break-all text-sm"
                  >
                    {highlightedCard.url}
                  </a>
                </div>
              ) : highlightedCard.isTwitter ? (
                <div>
                  {loadingTwitterEmbed ? (
                    <div className="flex justify-center items-center py-12">
                      <span className="loading loading-spinner loading-lg"></span>
                    </div>
                  ) : twitterEmbedHtml ? (
                    <div className="mb-4 flex justify-center">
                      <div 
                        dangerouslySetInnerHTML={{ __html: twitterEmbedHtml }}
                        className="twitter-embed-container"
                      />
                    </div>
                  ) : (
                    <div className="bg-base-200 rounded-lg p-6 mb-4">
                      <p className="text-base-content/70 mb-2">Failed to load Twitter embed</p>
                      {twitterEmbedError && (
                        <p className="text-sm text-error mb-3">{twitterEmbedError}</p>
                      )}
                      <div className="flex gap-2 mb-3">
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => window.ipcRenderer.invoke('open-login-window', 'twitter')}
                        >
                          Login to Twitter
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setTwitterEmbedError(null)
                            setTwitterEmbedHtml(null)
                            // Trigger refetch
                            const theme = 'dark'
                            setLoadingTwitterEmbed(true)
                            window.ipcRenderer.invoke('fetch-twitter-embed', highlightedCard.url, theme)
                              .then((result) => {
                                if (result.success && result.data?.html) {
                                  setTwitterEmbedHtml(result.data.html)
                                  setTwitterEmbedError(null)
                                } else {
                                  setTwitterEmbedError(result.error || 'Failed to load Twitter embed')
                                }
                              })
                              .catch((err) => {
                                setTwitterEmbedError(err?.message || 'Unknown error occurred')
                              })
                              .finally(() => {
                                setLoadingTwitterEmbed(false)
                              })
                          }}
                        >
                          Retry
                        </button>
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
                  <div className="mt-4 mb-4">
                    <p className="text-base">{renderTextWithLinks(highlightedCard.text)}</p>
                  </div>
                  <a
                    href={highlightedCard.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-primary break-all text-sm"
                  >
                    {highlightedCard.url}
                  </a>
                </div>
              ) : highlightedCard.isTikTok ? (
                <div>
                  {loadingTikTokEmbed ? (
                    <div className="flex justify-center items-center py-12">
                      <span className="loading loading-spinner loading-lg"></span>
                    </div>
                  ) : tiktokEmbedHtml ? (
                    <div className="mb-4 flex justify-center">
                      <div 
                        dangerouslySetInnerHTML={{ __html: tiktokEmbedHtml }}
                        className="tiktok-embed-container"
                      />
                    </div>
                  ) : (
                    <div className="bg-base-200 rounded-lg p-6 mb-4">
                      <p className="text-base-content/70 mb-2">Failed to load TikTok embed</p>
                      {tiktokEmbedError && (
                        <p className="text-sm text-error mb-3">{tiktokEmbedError}</p>
                      )}
                      <div className="flex gap-2 mb-3">
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => window.ipcRenderer.invoke('open-login-window', 'tiktok')}
                        >
                          Login to TikTok
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setTiktokEmbedError(null)
                            setTiktokEmbedHtml(null)
                            setLoadingTikTokEmbed(true)
                            window.ipcRenderer.invoke('fetch-tiktok-embed', highlightedCard.url)
                              .then((result) => {
                                if (result.success && result.data?.html) {
                                  setTiktokEmbedHtml(result.data.html)
                                  setTiktokEmbedError(null)
                                } else {
                                  setTiktokEmbedError(result.error || 'Failed to load TikTok embed')
                                }
                              })
                              .catch((err) => {
                                setTiktokEmbedError(err?.message || 'Unknown error occurred')
                              })
                              .finally(() => {
                                setLoadingTikTokEmbed(false)
                              })
                          }}
                        >
                          Retry
                        </button>
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
                  <div className="mt-4 mb-4">
                    <p className="text-base">{renderTextWithLinks(highlightedCard.text)}</p>
                  </div>
                  <a
                    href={highlightedCard.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-primary break-all text-sm"
                  >
                    {highlightedCard.url}
                  </a>
                </div>
              ) : highlightedCard.isReddit ? (
                <div>
                  {loadingRedditEmbed ? (
                    <div className="flex justify-center items-center py-12">
                      <span className="loading loading-spinner loading-lg"></span>
                    </div>
                  ) : redditEmbedHtml ? (
                    <div className="mb-4 flex justify-center">
                      <div 
                        dangerouslySetInnerHTML={{ __html: redditEmbedHtml }}
                        className="reddit-embed-container"
                      />
                    </div>
                  ) : (
                    <div className="bg-base-200 rounded-lg p-6 mb-4">
                      <p className="text-base-content/70 mb-2">Failed to load Reddit embed</p>
                      {redditEmbedError && (
                        <p className="text-sm text-error mb-3">{redditEmbedError}</p>
                      )}
                      <div className="flex gap-2 mb-3">
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => window.ipcRenderer.invoke('open-login-window', 'reddit')}
                        >
                          Login to Reddit
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setRedditEmbedError(null)
                            setRedditEmbedHtml(null)
                            const theme = 'dark'
                            setLoadingRedditEmbed(true)
                            window.ipcRenderer.invoke('fetch-reddit-embed', highlightedCard.url, theme)
                              .then((result) => {
                                if (result.success && result.data?.html) {
                                  setRedditEmbedHtml(result.data.html)
                                  setRedditEmbedError(null)
                                } else {
                                  setRedditEmbedError(result.error || 'Failed to load Reddit embed')
                                }
                              })
                              .catch((err) => {
                                setRedditEmbedError(err?.message || 'Unknown error occurred')
                              })
                              .finally(() => {
                                setLoadingRedditEmbed(false)
                              })
                          }}
                        >
                          Retry
                        </button>
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
                  <div className="mt-4 mb-4">
                    <p className="text-base">{renderTextWithLinks(highlightedCard.text)}</p>
                  </div>
                  <a
                    href={highlightedCard.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-primary break-all text-sm"
                  >
                    {highlightedCard.url}
                  </a>
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
                  <p className="text-lg mb-4">{renderTextWithLinks(highlightedCard.text)}</p>
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
              
              <div className="mt-4">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-sm text-base-content/70">Posted by</span>
                    <span className="ml-2 text-lg font-bold text-primary">{highlightedCard.nick}</span>
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
                    <div className="flex-1 min-w-0">
                      <p className="text-xs line-clamp-3">{card.text}</p>
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

        {/* Navigation arrows */}
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
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base-100 p-4">
      {/* Header with settings button */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-circle btn-ghost"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

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
      </div>

      {/* Link Cards Grid */}
      {!loading && linkCards.length > 0 && (
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {linkCards.map((card) => (
              <div key={card.id} className="card bg-base-200 shadow-xl">
                {card.isDirectMedia ? (
                  <figure className="relative">
                    {card.mediaType === 'image' ? (
                      <img
                        src={card.url}
                        alt={card.text}
                        className="w-full h-48 object-cover"
                        onError={(e) => {
                          // Fallback if image fails to load
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                        }}
                      />
                    ) : (
                      <video
                        src={card.url}
                        className="w-full h-48 object-cover"
                        controls
                        onError={(e) => {
                          const target = e.target as HTMLVideoElement
                          target.style.display = 'none'
                        }}
                      />
                    )}
                  </figure>
                ) : (
                  <div className="card-body">
                    <p className="text-sm">{renderTextWithLinks(card.text)}</p>
                  </div>
                )}
                {card.isDirectMedia && (
                  <div className="card-body pt-2">
                    <p className="text-sm">{renderTextWithLinks(card.text)}</p>
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
    </div>
  )
}

export default LinkScroller
