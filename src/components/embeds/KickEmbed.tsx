import { useEffect, useState } from 'react'

interface KickEmbedProps {
  url: string
  autoplay?: boolean
  mute?: boolean
  onError?: (error: string) => void
}

// Extract username from Kick livestream URL (clips are not supported)
function parseKickUrl(url: string): { username: string | null } {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    
    // Check if it's a clip - these should not be processed
    if (pathname.includes('/clips/')) {
      return { username: null }
    }
    
    // For player.kick.com URLs: player.kick.com/username
    if (urlObj.hostname.includes('player.kick.com')) {
      const username = pathname.replace(/^\//, '').split('/')[0]
      if (username) {
        return { username }
      }
    }
    
    // For regular kick.com URLs: kick.com/username
    const usernameMatch = pathname.match(/^\/([^\/]+)$/)
    if (usernameMatch) {
      return {
        username: usernameMatch[1]
      }
    }
    
    return { username: null }
  } catch {
    return { username: null }
  }
}

export default function KickEmbed({ url, autoplay = false, mute = false, onError }: KickEmbedProps) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      return
    }

    try {
      const { username } = parseKickUrl(url)
      
      if (!username) {
        throw new Error('Could not extract username from Kick URL or URL is a clip (clips cannot be embedded)')
      }

      // Build embed URL with parameters for livestreams only
      const params = new URLSearchParams()
      if (autoplay) {
        params.set('autoplay', 'true')
      }
      if (mute) {
        params.set('muted', 'true')
      }
      
      // For livestreams: player.kick.com/username
      const embedUrl = `https://player.kick.com/${username}${params.toString() ? `?${params.toString()}` : ''}`
      
      setEmbedUrl(embedUrl)
      setError(null)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid Kick URL or clip (clips cannot be embedded)'
      setError(errorMsg)
      if (onError) onError(errorMsg)
    }
  }, [url, autoplay, mute, onError])

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">Failed to load Kick content</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="link link-primary text-xs break-all"
        >
          {url}
        </a>
      </div>
    )
  }

  if (!embedUrl) {
    return (
      <div className="flex justify-center items-center py-12 bg-base-200 rounded-lg">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  return (
    <div className="mb-4 flex justify-center bg-base-200 rounded-lg overflow-hidden">
      <div
        className="kick-embed-container relative w-full"
        style={{ 
          position: 'relative',
          width: '100%',
          height: '0px',
          paddingBottom: '56.250%', // 16:9 aspect ratio
          maxWidth: '100%'
        }}
      >
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          frameBorder="0"
          scrolling="no"
          allowFullScreen
          style={{
            border: 'none',
            width: '100%',
            height: '100%',
            position: 'absolute',
            left: '0px',
            top: '0px',
            overflow: 'hidden',
            backgroundColor: 'rgb(var(--b2))'
          }}
          title="Kick stream or clip"
        />
      </div>
    </div>
  )
}
