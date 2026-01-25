import { useEffect, useState, useRef, memo } from 'react'

interface TikTokEmbedProps {
  url: string
  autoplay?: boolean
  mute?: boolean
  loop?: boolean
  onError?: (error: string) => void
}

// Extract TikTok video ID from URL
function extractTikTokVideoId(url: string): string | null {
  try {
    // Handle short URLs like /t/ZP8fVnL8s/ - these need to be resolved first
    // But for now, we'll try to extract from standard format
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    
    // Standard format: /@username/video/VIDEO_ID
    const standardMatch = pathname.match(/\/@[^/]+\/video\/(\d+)/)
    if (standardMatch && standardMatch[1]) {
      return standardMatch[1]
    }
    
    // Short link format: /t/VIDEO_ID (but this might not work, need to resolve)
    const shortMatch = pathname.match(/^\/t\/([\w-]+)/)
    if (shortMatch && shortMatch[1]) {
      // For short links, we'd need to resolve them first
      // For now, return null and let the oEmbed API handle it
      return null
    }
    
    // Direct video ID in path: /video/VIDEO_ID
    const videoMatch = pathname.match(/\/video\/(\d+)/)
    if (videoMatch && videoMatch[1]) {
      return videoMatch[1]
    }
    
    return null
  } catch {
    return null
  }
}

function TikTokEmbed({ url, autoplay = false, mute = false, loop = false, onError }: TikTokEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playerUrl, setPlayerUrl] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [playerReady, setPlayerReady] = useState(false)

  // Extract video ID and build player URL
  useEffect(() => {
    if (!url) return

    setLoading(true)
    setError(null)
    console.log('TikTokEmbed: Processing URL:', url)

    // Try to extract video ID directly
    let videoId = extractTikTokVideoId(url)
    
    if (!videoId) {
      // If we can't extract directly (e.g., short link), use oEmbed API to get the full URL
      console.log('TikTokEmbed: Could not extract video ID directly, using oEmbed API')
      window.ipcRenderer.invoke('fetch-tiktok-embed', url)
        .then((result) => {
          if (result.success && result.data?.html) {
            // Extract video ID from the oEmbed HTML blockquote
            // Try multiple patterns to find the video ID
            let extractedId: string | null = null
            
            // Pattern 1: data-video-id attribute
            const blockquoteMatch = result.data.html.match(/data-video-id="(\d+)"/)
            if (blockquoteMatch && blockquoteMatch[1]) {
              extractedId = blockquoteMatch[1]
            }
            
            // Pattern 2: cite URL with video ID
            if (!extractedId) {
              const citeMatch = result.data.html.match(/cite="[^"]*\/video\/(\d+)/)
              if (citeMatch && citeMatch[1]) {
                extractedId = citeMatch[1]
              }
            }
            
            // Pattern 3: Direct video ID in URL pattern
            if (!extractedId) {
              const urlMatch = result.data.html.match(/tiktok\.com\/[^"]*\/video\/(\d+)/)
              if (urlMatch && urlMatch[1]) {
                extractedId = urlMatch[1]
              }
            }
            
            if (extractedId) {
              console.log('TikTokEmbed: Extracted video ID from oEmbed:', extractedId)
              buildPlayerUrl(extractedId)
            } else {
              throw new Error('Could not extract video ID from oEmbed response')
            }
          } else {
            throw new Error(result.error || 'Failed to fetch TikTok embed')
          }
        })
        .catch((err) => {
          console.error('Error fetching TikTok embed:', err)
          const errorMsg = err?.message || 'Unknown error occurred'
          setError(errorMsg)
          if (onError) onError(errorMsg)
          setLoading(false)
        })
    } else {
      buildPlayerUrl(videoId)
    }

    function buildPlayerUrl(id: string) {
      const params = new URLSearchParams()
      params.set('autoplay', autoplay ? '1' : '0')
      params.set('loop', loop ? '1' : '0')
      // Note: mute is controlled via postMessage, not URL parameter
      
      const playerUrl = `https://www.tiktok.com/player/v1/${id}?${params.toString()}`
      console.log('TikTokEmbed: Built player URL:', playerUrl)
      setPlayerUrl(playerUrl)
      setLoading(false)
    }
  }, [url, autoplay, loop, onError])

  // Handle mute/unmute via postMessage
  useEffect(() => {
    if (!playerReady || !iframeRef.current) return

    const iframe = iframeRef.current
    const message = {
      'x-tiktok-player': true,
      value: mute ? void 0 : void 0, // void 0 is undefined
      type: mute ? 'mute' : 'unMute'
    }

    iframe.contentWindow?.postMessage(message, 'https://www.tiktok.com')
    console.log('TikTokEmbed: Sent', mute ? 'mute' : 'unMute', 'message')
  }, [mute, playerReady])

  // Listen for player messages
  useEffect(() => {
    if (!playerUrl) return

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from TikTok
      if (!event.origin.includes('tiktok.com')) return

      if (event.data && typeof event.data === 'object' && event.data['x-tiktok-player']) {
        const messageType = event.data.type
        console.log('TikTokEmbed: Received message:', messageType, event.data.value)

        switch (messageType) {
          case 'onPlayerReady':
            console.log('TikTokEmbed: Player is ready')
            setPlayerReady(true)
            // Apply initial mute state
            if (iframeRef.current) {
              const muteMessage = {
                'x-tiktok-player': true,
                value: void 0,
                type: mute ? 'mute' : 'unMute'
              }
              iframeRef.current.contentWindow?.postMessage(muteMessage, 'https://www.tiktok.com')
            }
            break
          case 'onStateChange':
            console.log('TikTokEmbed: State changed:', event.data.value)
            break
          case 'onError':
            console.error('TikTokEmbed: Player error:', event.data.value)
            setError('Failed to load TikTok video')
            if (onError) onError('Failed to load TikTok video')
            break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [playerUrl, mute, onError])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-6 mb-4">
        <p className="text-base-content/70 mb-2">Failed to load TikTok embed</p>
        <p className="text-sm text-error mb-3">{error}</p>
        <div className="flex gap-2 mb-3">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setError(null)
              setLoading(true)
              setPlayerUrl(null)
            }}
          >
            Retry
          </button>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="link link-primary break-all text-sm"
        >
          {url}
        </a>
      </div>
    )
  }

  if (!playerUrl) {
    return null
  }

  return (
    <div className="mb-4 flex justify-center">
      <div
        className="tiktok-embed-container"
        style={{ width: '100%', maxWidth: '605px', aspectRatio: '9/16', position: 'relative' }}
      >
        <iframe
          ref={iframeRef}
          src={playerUrl}
          width="100%"
          height="100%"
          frameBorder="0"
          allow="autoplay; encrypted-media"
          allowFullScreen
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            border: 'none',
            borderRadius: '8px'
          }}
        />
      </div>
    </div>
  )
}

export default memo(TikTokEmbed, (prevProps, nextProps) => {
  return (
    prevProps.url === nextProps.url &&
    prevProps.autoplay === nextProps.autoplay &&
    prevProps.mute === nextProps.mute &&
    prevProps.loop === nextProps.loop
  )
})
