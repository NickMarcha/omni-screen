interface YouTubeEmbedProps {
  url: string
  embedUrl: string
  autoplay?: boolean
  mute?: boolean
  showLink?: boolean
}

export default function YouTubeEmbed({ url, embedUrl, autoplay = false, mute = false, showLink = true }: YouTubeEmbedProps) {
  // Build the embed URL with autoplay and mute parameters
  const buildEmbedUrl = () => {
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
  }

  const finalEmbedUrl = buildEmbedUrl()

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
