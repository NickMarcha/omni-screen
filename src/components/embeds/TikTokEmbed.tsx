import { useEffect, useState } from 'react'
import { loadScriptOnce } from '../../utils/scriptLoader'

interface TikTokEmbedProps {
  url: string
  onError?: (error: string) => void
}

export default function TikTokEmbed({ url, onError }: TikTokEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!url) return

    setLoading(true)
    setError(null)
    console.log('Fetching TikTok embed for:', url)

    window.ipcRenderer.invoke('fetch-tiktok-embed', url)
      .then((result) => {
        console.log('TikTok embed result:', result)
        if (result.success && result.data?.html) {
          console.log('Setting TikTok embed HTML')
          setEmbedHtml(result.data.html)
          setError(null)
        } else {
          const errorMsg = result.error || 'Failed to fetch TikTok embed'
          setError(errorMsg)
          if (onError) onError(errorMsg)
        }
      })
      .catch((err) => {
        console.error('Error fetching TikTok embed:', err)
        const errorMsg = err?.message || 'Unknown error occurred'
        setError(errorMsg)
        if (onError) onError(errorMsg)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [url, onError])

  // Load TikTok embed script when embed HTML is set
  useEffect(() => {
    if (embedHtml) {
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

      // Wait for DOM to update with the new HTML, then load script safely
      setTimeout(() => {
        loadScriptOnce('https://www.tiktok.com/embed.js', 'tiktok-embed')
          .then(() => {
            // Script loaded, TikTok should auto-process blockquotes
            // Restore original console.error after a delay
            setTimeout(() => {
              console.error = originalError
            }, 2000)
          })
          .catch((err) => {
            console.error = originalError
            console.error('Failed to load TikTok embed script:', err)
          })
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
        <p className="text-base-content/70 mb-2">Failed to load TikTok embed</p>
        <p className="text-sm text-error mb-3">{error}</p>
        <div className="flex gap-2 mb-3">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              window.ipcRenderer.invoke('open-login-window', 'tiktok')
            }}
          >
            Login to TikTok
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
        className="tiktok-embed-container"
        style={{ width: '100%', maxWidth: '605px' }}
        dangerouslySetInnerHTML={embedHtml ? { __html: embedHtml } : undefined}
      />
    </div>
  )
}
