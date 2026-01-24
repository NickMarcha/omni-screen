import { useEffect, useRef, useState } from 'react'

interface StreamableEmbedProps {
  url: string
  autoplay?: boolean
  mute?: boolean
  loop?: boolean
  onError?: (error: string) => void
}

export default function StreamableEmbed({ url, autoplay = false, mute = false, loop = false, onError }: StreamableEmbedProps) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      return
    }

    try {
      // Extract video ID from Streamable URL
      // Format: https://streamable.com/w2wdyg or https://streamable.com/e/w2wdyg
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      
      // Extract ID from pathname (remove leading slash and 'e/' if present)
      let videoId = pathname.replace(/^\/e\//, '').replace(/^\//, '')
      
      if (!videoId) {
        throw new Error('Could not extract video ID from URL')
      }

      // Build embed URL with parameters
      const params = new URLSearchParams()
      if (autoplay) {
        params.set('autoplay', '1')
      }
      if (mute) {
        params.set('muted', '1')
      }
      if (loop) {
        params.set('loop', '1')
      }
      
      const queryString = params.toString()
      const embedUrl = `https://streamable.com/e/${videoId}${queryString ? `?${queryString}` : ''}`
      setEmbedUrl(embedUrl)
      setError(null)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid Streamable URL'
      setError(errorMsg)
      if (onError) onError(errorMsg)
    }
  }, [url, autoplay, mute, loop, onError])

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">Failed to load Streamable video</p>
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
        ref={containerRef}
        className="streamable-embed-container relative w-full"
        style={{ 
          position: 'relative',
          width: '100%',
          height: '0px',
          paddingBottom: '56.250%',
          maxWidth: '100%'
        }}
      >
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          frameBorder="0"
          allow="fullscreen;autoplay"
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
          title="Streamable video"
        />
      </div>
    </div>
  )
}
