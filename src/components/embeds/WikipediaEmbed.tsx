import { useEffect, useRef, useState } from 'react'
import { loadScriptOnce } from '../../utils/scriptLoader'

interface WikipediaEmbedProps {
  url: string
  onError?: (error: string) => void
}

export default function WikipediaEmbed({ url, onError }: WikipediaEmbedProps) {
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      if (onError) onError('No URL provided')
      return
    }

    // Validate Wikipedia URL
    try {
      const urlObj = new URL(url)
      if (!urlObj.hostname.includes('wikipedia.org')) {
        throw new Error('Invalid Wikipedia URL')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid Wikipedia URL'
      setError(errorMsg)
      if (onError) onError(errorMsg)
      return
    }

    // Load iframely script - it will auto-process elements with data-iframely-url
    loadScriptOnce('https://iframely.net/embed.js', 'iframely')
      .then(() => {
        setError(null)
        // Wait for DOM to be ready, then trigger iframely processing
        setTimeout(() => {
          if (linkRef.current) {
            // Check if iframely has already processed the element
            const iframe = containerRef.current?.querySelector('iframe')
            if (iframe) {
              return // Already processed
            }

            // Trigger iframely to process this specific element
            if (typeof window !== 'undefined' && (window as any).iframely) {
              const iframely = (window as any).iframely
              // Try different methods to trigger processing
              if (typeof iframely.load === 'function') {
                iframely.load()
              }
              if (typeof iframely.process === 'function' && linkRef.current) {
                iframely.process(linkRef.current)
              }
            }
          }
        }, 100)
      })
      .catch((err) => {
        console.error('Failed to load iframely script:', err)
        const errorMsg = 'Failed to load embed script'
        setError(errorMsg)
        if (onError) onError(errorMsg)
      })
  }, [url, onError])

  // Also trigger processing when linkRef becomes available
  useEffect(() => {
    if (!linkRef.current) return

    const checkAndProcess = () => {
      if (!linkRef.current) return

      // Check if already processed
      const iframe = containerRef.current?.querySelector('iframe')
      if (iframe) {
        return
      }

      // Try to trigger iframely processing
      if (typeof window !== 'undefined' && (window as any).iframely) {
        const iframely = (window as any).iframely
        if (typeof iframely.process === 'function') {
          iframely.process(linkRef.current)
        } else if (typeof iframely.load === 'function') {
          iframely.load()
        }
      }
    }

    // Try immediately
    const timeout1 = setTimeout(checkAndProcess, 100)
    // Try again after script has more time to load
    const timeout2 = setTimeout(checkAndProcess, 500)

    return () => {
      clearTimeout(timeout1)
      clearTimeout(timeout2)
    }
  }, [linkRef.current])

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">Failed to load Wikipedia embed</p>
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

  // Build iframely embed URL
  const iframelyUrl = `https://iframely.net/92YO8iPJ?theme=dark&url=${encodeURIComponent(url)}`

  return (
    <div className="mb-4 flex justify-center">
      <div
        ref={containerRef}
        className="wikipedia-embed-container"
        style={{ width: '100%', maxWidth: '100%' }}
      >
        <div className="iframely-embed">
          <div className="iframely-responsive" style={{ height: '140px', paddingBottom: 0 }}>
            <a 
              ref={linkRef}
              href={url} 
              data-iframely-url={iframelyUrl}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
