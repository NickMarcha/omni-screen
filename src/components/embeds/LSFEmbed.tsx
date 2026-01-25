import { useEffect, useState } from 'react'

interface LSFEmbedProps {
  url: string
  autoplay?: boolean
  mute?: boolean
  onError?: (error: string) => void
}

export default function LSFEmbed({ url, autoplay = false, mute = false, onError }: LSFEmbedProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      setLoading(false)
      return
    }

    // Fetch video URL from LSF page
    const fetchVideoUrl = async () => {
      try {
        setLoading(true)
        setError(null)
        
        // Call IPC handler to fetch and parse the HTML
        const result = await window.ipcRenderer.invoke('fetch-lsf-video-url', url)
        
        if (result.success && result.data?.videoUrl) {
          setVideoUrl(result.data.videoUrl)
        } else {
          throw new Error(result.error || 'Failed to extract video URL from LSF page')
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load LSF video'
        setError(errorMsg)
        if (onError) onError(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    fetchVideoUrl()
  }, [url, onError])

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
        <p className="text-sm text-base-content/70">Failed to load LSF video</p>
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

  if (!videoUrl) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">No video URL found</p>
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

  return (
    <div className="mb-4 flex justify-center bg-base-200 rounded-lg overflow-hidden">
      <div
        className="lsf-embed-container relative w-full"
        style={{ 
          position: 'relative',
          width: '100%',
          height: '0px',
          paddingBottom: '56.250%', // 16:9 aspect ratio
          maxWidth: '100%'
        }}
      >
        <video
          src={videoUrl}
          controls
          preload="metadata"
          autoPlay={autoplay}
          muted={mute}
          style={{
            border: 'none',
            width: '100%',
            height: '100%',
            position: 'absolute',
            left: '0px',
            top: '0px',
            backgroundColor: 'rgb(var(--b2))'
          }}
          className="w-full h-full"
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  )
}
