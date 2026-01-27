import { useEffect, useState } from 'react'

interface TwitchEmbedProps {
  url: string
  autoplay?: boolean
  mute?: boolean
  onError?: (error: string) => void
  fit?: 'aspect' | 'fill'
}

function parseTwitchUrl(url: string): { channel: string | null } {
  try {
    const urlObj = new URL(url)

    // player.twitch.tv/?channel=...
    if (urlObj.hostname.includes('player.twitch.tv')) {
      const channel = urlObj.searchParams.get('channel')
      return { channel: channel || null }
    }

    // twitch.tv/<channel>
    const parts = urlObj.pathname.split('/').filter(Boolean)
    if (parts.length >= 1) {
      // ignore common non-channel paths (best effort)
      const first = parts[0].toLowerCase()
      if (['videos', 'directory', 'p', 'downloads', 'subscriptions'].includes(first)) {
        return { channel: null }
      }
      return { channel: parts[0] }
    }

    return { channel: null }
  } catch {
    return { channel: null }
  }
}

function getTwitchParentParams(): string[] {
  // Twitch requires explicit parent domains. Our Electron app serves from local HTTP (127.0.0.1 / localhost).
  // Including both avoids dev/prod mismatches.
  return ['localhost', '127.0.0.1']
}

export default function TwitchEmbed({ url, autoplay = true, mute = true, onError, fit = 'aspect' }: TwitchEmbedProps) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      return
    }

    try {
      const { channel } = parseTwitchUrl(url)
      if (!channel) {
        throw new Error('Could not extract channel from Twitch URL')
      }

      const params = new URLSearchParams()
      params.set('channel', channel)
      params.set('autoplay', autoplay ? 'true' : 'false')
      params.set('muted', mute ? 'true' : 'false')

      getTwitchParentParams().forEach(parent => params.append('parent', parent))

      setEmbedUrl(`https://player.twitch.tv/?${params.toString()}`)
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid Twitch URL'
      setError(msg)
      if (onError) onError(msg)
    }
  }, [url, autoplay, mute, onError])

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">Failed to load Twitch content</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="link link-primary text-xs break-all">
          {url}
        </a>
      </div>
    )
  }

  if (!embedUrl) {
    return (
      <div className="flex justify-center items-center py-12 bg-base-200 rounded-lg">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    )
  }

  const isFill = fit === 'fill'

  return (
    <div className={`${isFill ? '' : 'mb-4'} flex justify-center bg-base-200 rounded-lg overflow-hidden w-full ${isFill ? 'h-full' : ''}`}>
      <div
        className="twitch-embed-container relative w-full"
        style={
          isFill
            ? {
                position: 'relative',
                width: '100%',
                height: '100%',
                maxWidth: '100%',
              }
            : {
                position: 'relative',
                width: '100%',
                height: '0px',
                paddingBottom: '56.25%', // 16:9
                maxWidth: '100%',
              }
        }
      >
        <iframe
          src={embedUrl}
          width="100%"
          height="100%"
          frameBorder="0"
          scrolling="no"
          allowFullScreen
          allow="autoplay; fullscreen"
          style={{
            border: 'none',
            width: '100%',
            height: '100%',
            position: 'absolute',
            left: '0px',
            top: '0px',
            overflow: 'hidden',
            backgroundColor: 'rgb(var(--b2))',
          }}
          title="Twitch stream"
        />
      </div>
    </div>
  )
}

