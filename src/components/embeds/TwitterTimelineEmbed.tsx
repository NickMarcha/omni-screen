import { useEffect, useRef, useState, memo } from 'react'
import { loadScriptOnce } from '../../utils/scriptLoader'

interface TwitterTimelineEmbedProps {
  url: string
  theme?: 'light' | 'dark'
  onError?: (error: string) => void
}

function TwitterTimelineEmbed({ url, theme = 'dark', onError }: TwitterTimelineEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (containerRef.current) containerRef.current.innerHTML = ''
    setError(null)
    setLoading(true)

    if (!url) {
      setError('No URL provided')
      setLoading(false)
      return
    }

    let isCancelled = false

    const run = async () => {
      try {
        const result = await (window as any).ipcRenderer?.invoke?.('fetch-twitter-timeline-oembed', url, theme)
        if (isCancelled || !mountedRef.current || !containerRef.current) return
        if (!result?.success || !result.html) {
          setError(result?.error || 'Failed to load timeline')
          setLoading(false)
          onError?.(result?.error || 'Failed to load timeline')
          return
        }
        containerRef.current.innerHTML = result.html
        await loadScriptOnce('https://platform.twitter.com/widgets.js', 'twitter-widgets')
        if (isCancelled || !mountedRef.current || !containerRef.current) return
        const twttr = (window as any).twttr
        if (twttr?.widgets?.load) {
          twttr.widgets.load(containerRef.current)
        }
        setLoading(false)
      } catch (e) {
        if (!mountedRef.current) return
        const msg = e instanceof Error ? e.message : 'Unknown error'
        setError(msg)
        setLoading(false)
        onError?.(msg)
      }
    }

    run()
    return () => {
      isCancelled = true
      mountedRef.current = false
    }
  }, [url, theme, onError])

  if (error) {
    return (
      <div className="rounded-lg bg-base-200 p-4 text-base-content">
        <p className="text-sm text-error">{error}</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="link link-primary text-sm mt-2 inline-block">
          Open on X
        </a>
      </div>
    )
  }

  return (
    <div className="twitter-timeline-embed-container min-h-[400px] w-full">
      {loading && (
        <div className="flex items-center justify-center p-8 text-base-content/60">
          Loading timeline…
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  )
}

export default memo(TwitterTimelineEmbed)
