import { useEffect, useState, useRef, memo } from 'react'
import { registerRedditBlockquote, unregisterRedditBlockquote } from '../../utils/redditEmbedManager'

interface RedditEmbedProps {
  url: string
  theme?: 'light' | 'dark'
  onError?: (error: string) => void
}

function RedditEmbed({ url, theme = 'dark', onError }: RedditEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const blockquoteRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!url) return

    setLoading(true)
    setError(null)

    window.ipcRenderer.invoke('fetch-reddit-embed', url, theme)
      .then((result) => {
        if (result.success && result.data?.html) {
          console.log('[RedditEmbed] Got HTML from API, length:', result.data.html.length)
          console.log('[RedditEmbed] HTML preview:', result.data.html.substring(0, 200))
          setEmbedHtml(result.data.html)
          setError(null)
        } else {
          const errorMsg = result.error || 'Failed to fetch Reddit embed'
          setError(errorMsg)
          if (onError) onError(errorMsg)
        }
      })
      .catch((err) => {
        console.error('Error fetching Reddit embed:', err)
        const errorMsg = err?.message || 'Unknown error occurred'
        setError(errorMsg)
        if (onError) onError(errorMsg)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [url, theme, onError])

  // Register blockquote with global manager when HTML is set
  useEffect(() => {
    if (!embedHtml || !containerRef.current) return
    
    // Wait for DOM to update with the blockquote
    const timeout = setTimeout(() => {
      // Try multiple selectors - Reddit oEmbed might use different class names
      let blockquote = containerRef.current?.querySelector('blockquote.reddit-embed-bq') as HTMLElement
      
      if (!blockquote) {
        // Try without class name
        blockquote = containerRef.current?.querySelector('blockquote') as HTMLElement
      }
      
      if (!blockquote) {
        // Check what's actually in the container
        console.log('[RedditEmbed] No blockquote found, container HTML:', containerRef.current?.innerHTML?.substring(0, 200))
        // Retry after a longer delay
        setTimeout(() => {
          let retryBlockquote = containerRef.current?.querySelector('blockquote.reddit-embed-bq') as HTMLElement
          if (!retryBlockquote) {
            retryBlockquote = containerRef.current?.querySelector('blockquote') as HTMLElement
          }
          if (retryBlockquote) {
            console.log('[RedditEmbed] Found blockquote on retry')
            blockquoteRef.current = retryBlockquote
            registerRedditBlockquote(retryBlockquote)
          } else {
            console.warn('[RedditEmbed] Blockquote still not found after retry')
          }
        }, 300)
        return
      }
      
      console.log('[RedditEmbed] Found blockquote, registering with manager')
      blockquoteRef.current = blockquote
      // Register with global manager - it will handle script loading and processing
      registerRedditBlockquote(blockquote)
    }, 100)
    
    return () => {
      clearTimeout(timeout)
      // Unregister on unmount
      if (blockquoteRef.current) {
        unregisterRedditBlockquote(blockquoteRef.current)
        blockquoteRef.current = null
      }
    }
  }, [embedHtml])

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
        <p className="text-base-content/70 mb-2">Failed to load Reddit embed</p>
        <p className="text-sm text-error mb-3">{error}</p>
        <div className="flex gap-2 mb-3">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              window.ipcRenderer.invoke('open-login-window', 'reddit')
            }}
          >
            Login to Reddit
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setError(null)
              setLoading(true)
              setEmbedHtml(null)
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

  return (
    <div className="mb-4 flex justify-center">
      <div
        ref={containerRef}
        className="reddit-embed-container"
        style={{ width: '100%', maxWidth: '600px' }}
        dangerouslySetInnerHTML={embedHtml ? { __html: embedHtml } : undefined}
      />
    </div>
  )
}

export default memo(RedditEmbed, (prevProps, nextProps) => {
  return (
    prevProps.url === nextProps.url &&
    prevProps.theme === nextProps.theme
  )
})
