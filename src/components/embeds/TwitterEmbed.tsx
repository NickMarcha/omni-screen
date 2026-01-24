import { useEffect, useRef, useState } from 'react'

interface TwitterEmbedProps {
  url: string
  onError?: (error: string) => void
}

export default function TwitterEmbed({ url, onError }: TwitterEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!url || !containerRef.current) return

    // Extract tweet ID from URL
    const tweetIdMatch = url.match(/\/status\/(\d+)/)
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : null

    if (!tweetId) {
      setError('Invalid Twitter URL - could not extract tweet ID')
      setLoading(false)
      if (onError) onError('Invalid Twitter URL')
      return
    }

    console.log('Creating Twitter embed for tweet ID:', tweetId)
    setLoading(true)
    setError(null)

    // Wait for the ref to be available, then load script and create embed
    const checkRefAndCreate = (attempts = 0) => {
      const container = containerRef.current
      if (!container) {
        if (attempts < 50) {
          setTimeout(() => checkRefAndCreate(attempts + 1), 100)
          return
        } else {
          setError('Embed container not found')
          setLoading(false)
          if (onError) onError('Embed container not found')
          return
        }
      }

      loadScriptAndCreate(container)
    }

    const loadScriptAndCreate = (container: HTMLDivElement) => {
      // Check if script is already loaded
      if (typeof window !== 'undefined' && (window as any).twttr) {
        // @ts-ignore
        if ((window as any).twttr.ready) {
          // @ts-ignore
          (window as any).twttr.ready(() => {
            createTweetEmbed(container)
          })
        } else {
          setTimeout(() => createTweetEmbed(container), 100)
        }
      } else {
        // Load the script
        console.log('Loading Twitter widgets.js script...')
        const script = document.createElement('script')
        script.src = 'https://platform.twitter.com/widgets.js'
        script.async = true
        script.charset = 'utf-8'
        script.onload = () => {
          console.log('Twitter widgets.js script loaded')
          // @ts-ignore
          if ((window as any).twttr && (window as any).twttr.ready) {
            // @ts-ignore
            (window as any).twttr.ready(() => {
              const currentContainer = containerRef.current || container
              createTweetEmbed(currentContainer)
            })
          } else {
            const currentContainer = containerRef.current || container
            setTimeout(() => createTweetEmbed(currentContainer), 100)
          }
        }
        script.onerror = () => {
          setError('Failed to load Twitter widgets script')
          setLoading(false)
          if (onError) onError('Failed to load Twitter widgets script')
        }
        document.head.appendChild(script)
      }
    }

    const createTweetEmbed = (container: HTMLDivElement) => {
      const currentContainer = containerRef.current || container
      if (!currentContainer) {
        setError('Embed container not found')
        setLoading(false)
        if (onError) onError('Embed container not found')
        return
      }

      // @ts-ignore
      const twttr = (window as any).twttr
      if (typeof window !== 'undefined' && twttr && twttr.widgets && twttr.widgets.createTweet) {
        // Clear the container first
        currentContainer.innerHTML = ''

        const timeout = setTimeout(() => {
          setError('Embed creation timed out. The tweet may be unavailable or require login.')
          setLoading(false)
          if (onError) onError('Embed creation timed out')
        }, 10000)

        try {
          // @ts-ignore
          const promise = twttr.widgets.createTweet(
            tweetId,
            currentContainer,
            {
              theme: 'dark',
              dnt: true,
              align: 'center'
            }
          )

          // Check if embed was created (sometimes promise doesn't resolve but embed appears)
          const checkEmbedCreated = () => {
            const iframe = currentContainer.querySelector('iframe')
            const embedDiv = currentContainer.querySelector('.twitter-tweet-rendered, .twitter-tweet')
            if (iframe || embedDiv) {
              clearTimeout(timeout)
              console.log('✅ Tweet embed detected in DOM')

              // Fix the HTML before storing - replace hidden iframe styles
              let fixedHtml = currentContainer.innerHTML
              fixedHtml = fixedHtml.replace(
                /(<iframe[^>]*\s+)style="[^"]*position:\s*absolute[^"]*visibility:\s*hidden[^"]*width:\s*0px[^"]*height:\s*0px[^"]*"/gi,
                '$1style="width: 100%; height: auto; min-height: 0; display: block; visibility: visible; position: relative;"'
              )
              fixedHtml = fixedHtml.replace(
                /(<iframe[^>]*\s+)style="[^"]*visibility:\s*hidden[^"]*"/gi,
                '$1style="width: 100%; height: auto; min-height: 0; display: block; visibility: visible; position: relative;"'
              )

              // Make iframe visible in DOM - let height adjust to content
              if (iframe) {
                iframe.style.cssText = 'width: 100%; height: auto; min-height: 0; display: block; visibility: visible; position: relative;'
              }

              setError(null)
              setLoading(false)
              setEmbedHtml(fixedHtml)
              return true
            }
            return false
          }

          // Check periodically
          let checkInterval: ReturnType<typeof setInterval> | null = null
          setTimeout(() => {
            if (checkEmbedCreated()) {
              return
            }
            checkInterval = setInterval(() => {
              if (checkEmbedCreated()) {
                if (checkInterval) clearInterval(checkInterval)
              }
            }, 500)
            setTimeout(() => {
              if (checkInterval) clearInterval(checkInterval)
            }, 10000)
          }, 100)

          // Also wait for promise
          promise.then(() => {
            clearTimeout(timeout)
            if (checkInterval) clearInterval(checkInterval)
            console.log('✅ Tweet embed created (promise resolved)')
            const iframe = currentContainer.querySelector('iframe')
            if (iframe) {
              iframe.style.cssText = 'width: 100%; height: auto; min-height: 0; display: block; visibility: visible; position: relative;'
            }
            setEmbedHtml(currentContainer.innerHTML)
            setError(null)
            setLoading(false)
          }).catch((error: Error) => {
            clearTimeout(timeout)
            if (checkInterval) clearInterval(checkInterval)
            console.error('❌ Error creating tweet embed:', error.message)
            if (!checkEmbedCreated()) {
              setError(error.message || 'Failed to create Twitter embed')
              setLoading(false)
              if (onError) onError(error.message || 'Failed to create Twitter embed')
            }
          })
        } catch (error) {
          clearTimeout(timeout)
          const errorMessage = error instanceof Error ? error.message : 'Failed to create Twitter embed'
          setError(errorMessage)
          setLoading(false)
          if (onError) onError(errorMessage)
        }
      } else {
        setError('Twitter widgets.js not available')
        setLoading(false)
        if (onError) onError('Twitter widgets.js not available')
      }
    }

    checkRefAndCreate()

    // Cleanup
    return () => {
      setEmbedHtml(null)
    }
  }, [url, onError])

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
        <p className="text-base-content/70 mb-2">Failed to load Twitter embed</p>
        <p className="text-sm text-error mb-3">{error}</p>
        <div className="flex gap-2 mb-3">
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              window.ipcRenderer.invoke('open-login-window', 'twitter')
              const handleLoginSuccess = () => {
                console.log('Twitter login successful, retrying embed...')
                setTimeout(() => {
                  setError(null)
                  setLoading(true)
                  if (containerRef.current) {
                    containerRef.current.innerHTML = ''
                  }
                }, 2000)
                window.ipcRenderer.off('twitter-login-success', handleLoginSuccess)
              }
              window.ipcRenderer.on('twitter-login-success', handleLoginSuccess)
            }}
          >
            Login to Twitter
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setError(null)
              setLoading(true)
              if (containerRef.current) {
                containerRef.current.innerHTML = ''
              }
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
    <>
      <div className="mb-4 flex justify-center">
        <div
          ref={containerRef}
          className="twitter-embed-container"
          style={{ width: '100%', maxWidth: '550px' }}
          dangerouslySetInnerHTML={embedHtml ? { __html: embedHtml } : undefined}
        />
      </div>
                      {/* CSS to override Twitter's hidden iframe styles and allow height to adjust */}
                      {embedHtml && (
                        <style dangerouslySetInnerHTML={{ __html: `
                          .twitter-embed-container iframe {
                            visibility: visible !important;
                            width: 100% !important;
                            height: auto !important;
                            min-height: 0 !important;
                            display: block !important;
                            position: relative !important;
                          }
                          .twitter-embed-container .twitter-tweet-rendered {
                            display: block !important;
                            visibility: visible !important;
                            width: 100% !important;
                            height: auto !important;
                          }
                        ` }} />
                      )}
    </>
  )
}
