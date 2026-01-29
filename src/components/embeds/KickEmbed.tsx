import { useEffect, useState } from 'react'
import { getAppPreferences } from '../../utils/appPreferences'

interface KickEmbedProps {
  url: string
  autoplay?: boolean
  mute?: boolean
  onError?: (error: string) => void
  fit?: 'aspect' | 'fill'
  /** When true, always use iframe (no webview/userscript). Use in overview mode to avoid autoplay. */
  useIframeOnly?: boolean
}

// Extract username from Kick livestream URL (clips are not supported)
function parseKickUrl(url: string): { username: string | null } {
  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    
    // Check if it's a clip - these should not be processed
    if (pathname.includes('/clips/')) {
      return { username: null }
    }
    
    // For player.kick.com URLs: player.kick.com/username
    if (urlObj.hostname.includes('player.kick.com')) {
      const username = pathname.replace(/^\//, '').split('/')[0]
      if (username) {
        return { username }
      }
    }
    
    // For regular kick.com URLs: kick.com/username
    const usernameMatch = pathname.match(/^\/([^\/]+)$/)
    if (usernameMatch) {
      return {
        username: usernameMatch[1]
      }
    }
    
    return { username: null }
  } catch {
    return { username: null }
  }
}

export default function KickEmbed({ url, autoplay = false, mute = false, onError, fit = 'aspect', useIframeOnly = false }: KickEmbedProps) {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kickstinyEnabled = (() => {
    if (useIframeOnly) return false
    try {
      return getAppPreferences().userscripts.kickstiny
    } catch {
      return true
    }
  })()

  useEffect(() => {
    if (!url) {
      setError('No URL provided')
      return
    }

    try {
      const { username } = parseKickUrl(url)
      
      if (!username) {
        throw new Error('Could not extract username from Kick URL or URL is a clip (clips cannot be embedded)')
      }

      // Build embed URL with parameters for livestreams only
      // When not autoplaying, set autoplay=false and muted so Kick player doesn't autostart with sound
      const params = new URLSearchParams()
      params.set('autoplay', autoplay ? 'true' : 'false')
      if (mute || !autoplay) {
        params.set('muted', 'true')
      }
      
      // For livestreams: player.kick.com/username
      const embedUrl = `https://player.kick.com/${username}${params.toString() ? `?${params.toString()}` : ''}`
      
      setEmbedUrl(embedUrl)
      setError(null)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid Kick URL or clip (clips cannot be embedded)'
      setError(errorMsg)
      if (onError) onError(errorMsg)
    }
  }, [url, autoplay, mute, onError, useIframeOnly])

  if (error) {
    return (
      <div className="bg-base-200 rounded-lg p-3">
        <p className="text-sm text-base-content/70">Failed to load Kick content</p>
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
        className="kick-embed-container relative w-full"
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
        {kickstinyEnabled ? (
          <webview
            src={embedUrl}
            title="Kick stream"
            className="w-full h-full"
            style={
              {
                border: 'none',
                width: '100%',
                height: '100%',
                position: 'absolute',
                left: '0px',
                top: '0px',
                overflow: 'hidden',
                backgroundColor: 'rgb(var(--b2))',
              } as any
            }
            allowpopups="true"
            partition="persist:main"
            ref={(el: any) => {
              if (!el) return
              const key = '__omni_kickstiny_injected'
              const inject = async () => {
                try {
                  const injected = await el.executeJavaScript(`Boolean(window.${key})`, true)
                  if (injected) return
                  const scriptUrl = 'https://r2cdn.destiny.gg/kickstiny/kickstiny.user.js'
                  const code = `
(() => {
  try {
    if (window.${key}) return;
    window.${key} = true;
    const s = document.createElement("script");
    s.src = "${scriptUrl}";
    s.async = true;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}
})();
`
                  await el.executeJavaScript(code, true)
                } catch {
                  // ignore
                }
              }
              el.removeEventListener?.('dom-ready', inject)
              el.addEventListener?.('dom-ready', inject)
            }}
          />
        ) : (
          <iframe
            src={embedUrl}
            width="100%"
            height="100%"
            frameBorder="0"
            scrolling="no"
            allowFullScreen
            allow={autoplay && !mute ? 'autoplay; fullscreen' : 'fullscreen'}
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
            title="Kick stream"
          />
        )}
      </div>
    </div>
  )
}
