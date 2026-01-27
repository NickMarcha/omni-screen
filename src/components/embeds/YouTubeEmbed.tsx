import { memo } from 'react'

interface YouTubeEmbedProps {
  url: string
  embedUrl: string | null | undefined
  autoplay?: boolean
  mute?: boolean
  showLink?: boolean
  fit?: 'aspect' | 'fill'
}

function YouTubeEmbed({ url, embedUrl, autoplay = false, mute = false, showLink = true, fit = 'aspect' }: YouTubeEmbedProps) {
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
      
      // Convert youtube.com to youtube-nocookie.com to avoid Error 153
      if (urlObj.hostname.includes('youtube.com') && !urlObj.hostname.includes('youtube-nocookie.com')) {
        urlObj.hostname = urlObj.hostname.replace('youtube.com', 'youtube-nocookie.com')
      }
      
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
      // This must match the Referer header set in the main process
      // App ID: com.nickmarcha.omni-screen
      urlObj.searchParams.set('widget_referrer', 'https://com.nickmarcha.omni-screen')
      
      // Add origin parameter to help YouTube verify the embedder
      urlObj.searchParams.set('origin', 'https://com.nickmarcha.omni-screen')
      
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

  const isFill = fit === 'fill'

  return (
    <div className={isFill ? 'w-full h-full' : ''}>
      <div className={`${isFill ? 'w-full h-full' : 'aspect-video w-full mb-4'} rounded-lg overflow-hidden bg-base-200`}>
        <iframe
          width="100%"
          height="100%"
          src={finalEmbedUrl}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          title="YouTube video player"
          className="w-full h-full"
        />
      </div>
      {!isFill && showLink && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="link link-primary break-all text-sm">
          {url}
        </a>
      )}
    </div>
  )
}

export default memo(YouTubeEmbed, (prevProps, nextProps) => {
  // Only re-render if these props change
  return (
    prevProps.url === nextProps.url &&
    prevProps.embedUrl === nextProps.embedUrl &&
    prevProps.autoplay === nextProps.autoplay &&
    prevProps.mute === nextProps.mute &&
    prevProps.showLink === nextProps.showLink
  )
})
