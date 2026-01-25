interface YouTubeEmbedProps {
  url: string
  embedUrl: string | null | undefined
  autoplay?: boolean
  mute?: boolean
  showLink?: boolean
}

export default function YouTubeEmbed({ url, embedUrl, autoplay = false, mute = false, showLink = true }: YouTubeEmbedProps) {
  // Validate embedUrl before using it
  if (!embedUrl || typeof embedUrl !== 'string' || embedUrl.trim() === '') {
    return (
      <div className="bg-base-200 rounded-lg p-4">
        <p className="text-sm text-base-content/70 mb-2">Failed to generate YouTube embed URL</p>
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

  // Build the embed URL with autoplay and mute parameters
  const buildEmbedUrl = () => {
    try {
      const urlObj = new URL(embedUrl)
      
      if (autoplay) {
        urlObj.searchParams.set('autoplay', '1')
        if (mute) {
          urlObj.searchParams.set('mute', '1')
        } else {
          urlObj.searchParams.delete('mute')
        }
      } else {
        urlObj.searchParams.delete('autoplay')
        urlObj.searchParams.delete('mute')
      }
      
      // Add widget_referrer parameter for Electron apps (required by YouTube)
      // App ID: com.nickmarcha.omni-screen
      urlObj.searchParams.set('widget_referrer', 'https://com.nickmarcha.omni-screen')
      
      return urlObj.toString()
    } catch (error) {
      // If URL construction fails, return null to show error UI
      return null
    }
  }

  const finalEmbedUrl = buildEmbedUrl()
  
  // If buildEmbedUrl failed, show error
  if (!finalEmbedUrl) {
    return (
      <div className="bg-base-200 rounded-lg p-4">
        <p className="text-sm text-base-content/70 mb-2">Invalid YouTube embed URL</p>
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
    <div>
      <div className="aspect-video w-full mb-4 rounded-lg overflow-hidden bg-base-200">
        <iframe
          width="100%"
          height="100%"
          src={finalEmbedUrl}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="w-full h-full"
        />
      </div>
      {showLink && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="link link-primary break-all text-sm"
        >
          {url}
        </a>
      )}
    </div>
  )
}
