import { useEffect, useState, useRef } from 'react'
import { registerBlueskyBlockquote, unregisterBlueskyBlockquote } from '../../utils/blueskyEmbedManager'

interface BlueskyEmbedProps {
  url: string
  onError?: (error: string) => void
}

export default function BlueskyEmbed({ url, onError }: BlueskyEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      setLoading(false)
      if (onError) onError('No URL provided')
      return
    }

    // Validate Bluesky URL
    try {
      const urlObj = new URL(url)
      if (!urlObj.hostname.includes('bsky.app')) {
        throw new Error('Invalid Bluesky URL')
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid Bluesky URL'
      setError(errorMsg)
      setLoading(false)
      if (onError) onError(errorMsg)
      return
    }

    // Fetch oEmbed HTML
    const fetchEmbed = async () => {
      try {
        const oembedUrl = `https://embed.bsky.app/oembed?url=${encodeURIComponent(url)}&format=json&maxwidth=600`
        console.log('[BlueskyEmbed] Fetching oEmbed from:', oembedUrl)
        
        const response = await fetch(oembedUrl, {
          headers: {
            'Accept': 'application/json',
          }
        })

        if (!response.ok) {
          throw new Error(`oEmbed API returned status ${response.status}`)
        }

        const data = await response.json()
        console.log('[BlueskyEmbed] Got oEmbed response:', data)

        if (data.html) {
          // Remove the script tag from HTML - the manager will load it
          let html = data.html.replace(/<script[^>]*>.*?<\/script>/gi, '')
          setEmbedHtml(html)
          setLoading(false)
          setError(null)
          
          // The manager will handle script loading when blockquote is registered
        } else {
          throw new Error('oEmbed response did not contain HTML')
        }
      } catch (err) {
        console.error('[BlueskyEmbed] Error fetching embed:', err)
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch Bluesky embed'
        setError(errorMsg)
        setLoading(false)
        if (onError) onError(errorMsg)
      }
    }

    fetchEmbed()
  }, [url, onError])

  // Register blockquote with manager when embed HTML is set
  useEffect(() => {
    if (!embedHtml || !containerRef.current) return

    // Wait for DOM to update with the new HTML, then register
    const timeout = setTimeout(() => {
      const blockquote = containerRef.current?.querySelector('blockquote.bluesky-embed')
      if (blockquote && blockquote instanceof HTMLElement) {
        console.log('[BlueskyEmbed] Registering blockquote with manager')
        registerBlueskyBlockquote(blockquote)
      } else {
        console.warn('[BlueskyEmbed] Blockquote not found in container')
      }
    }, 50) // Shorter delay to register quickly
    
    // Cleanup: unregister blockquote when component unmounts or HTML changes
    return () => {
      clearTimeout(timeout)
      if (containerRef.current) {
        const blockquote = containerRef.current.querySelector('blockquote.bluesky-embed')
        if (blockquote && blockquote instanceof HTMLElement) {
          unregisterBlueskyBlockquote(blockquote)
        }
      }
    }
  }, [embedHtml])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12 bg-base-200 rounded-lg">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">Failed to load Bluesky embed</p>
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

  if (!embedHtml) {
    return null
  }

  return (
    <div className="mb-4 flex justify-center">
      <div
        ref={containerRef}
        className="bluesky-embed-container"
        style={{ width: '100%', maxWidth: '600px' }}
        dangerouslySetInnerHTML={{ __html: embedHtml }}
      />
    </div>
  )
}
