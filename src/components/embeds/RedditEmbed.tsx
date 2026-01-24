import { useEffect, useState } from 'react'

interface RedditEmbedProps {
  url: string
  theme?: 'light' | 'dark'
  onError?: (error: string) => void
}

export default function RedditEmbed({ url, theme = 'dark', onError }: RedditEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return

    setLoading(true)
    setError(null)
    console.log('Fetching Reddit embed for:', url)

    window.ipcRenderer.invoke('fetch-reddit-embed', url, theme)
      .then((result) => {
        console.log('Reddit embed result:', result)
        if (result.success && result.data?.html) {
          console.log('Setting Reddit embed HTML')
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

  // Load Reddit embed script when embed HTML is set
  useEffect(() => {
    if (embedHtml) {
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
        className="reddit-embed-container"
        style={{ width: '100%', maxWidth: '600px' }}
        dangerouslySetInnerHTML={embedHtml ? { __html: embedHtml } : undefined}
      />
    </div>
  )
}
