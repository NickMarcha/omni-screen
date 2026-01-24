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
    console.log('TwitterEmbed useEffect triggered, url:', url)
    
    // Cleanup previous embed
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }
    setEmbedHtml(null)
    setError(null)
    setLoading(true)
    
    if (!url) {
      console.log('TwitterEmbed: No URL provided')
      setError('No URL provided')
      setLoading(false)
      return
    }

    // Extract tweet ID from URL
    const tweetIdMatch = url.match(/\/status\/(\d+)/)
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : null

    if (!tweetId) {
      console.log('TwitterEmbed: Could not extract tweet ID from URL:', url)
      setError('Invalid Twitter URL - could not extract tweet ID')
      setLoading(false)
      if (onError) onError('Invalid Twitter URL')
      return
    }

    console.log('Creating Twitter embed for tweet ID:', tweetId)
    
    let isCancelled = false

    const loadScriptAndCreate = (container: HTMLDivElement) => {
      if (isCancelled) return
      
      // Clear container before creating new embed
      if (container) {
        container.innerHTML = ''
      }
      
      // Check if script is already loaded
      if (typeof window !== 'undefined' && (window as any).twttr) {
        // @ts-ignore
        if ((window as any).twttr.ready) {
          // @ts-ignore
          (window as any).twttr.ready(() => {
            if (!isCancelled) {
              createTweetEmbed(container)
            }
          })
        } else {
          setTimeout(() => {
            if (!isCancelled) {
              createTweetEmbed(container)
            }
          }, 100)
        }
      } else {
        // Load the script
        console.log('Loading Twitter widgets.js script...')
        const script = document.createElement('script')
        script.src = 'https://platform.twitter.com/widgets.js'
        script.async = true
        script.charset = 'utf-8'
        script.onload = () => {
          if (isCancelled) return
          console.log('Twitter widgets.js script loaded')
          // @ts-ignore
          if ((window as any).twttr && (window as any).twttr.ready) {
            // @ts-ignore
            (window as any).twttr.ready(() => {
              if (isCancelled) return
              const currentContainer = containerRef.current || container
              if (currentContainer) {
                createTweetEmbed(currentContainer)
              }
            })
          } else {
            setTimeout(() => {
              if (!isCancelled) {
                const currentContainer = containerRef.current || container
                if (currentContainer) {
                  createTweetEmbed(currentContainer)
                }
              }
            }, 100)
          }
        }
        script.onerror = () => {
          if (isCancelled) return
          setError('Failed to load Twitter widgets script')
          setLoading(false)
          if (onError) onError('Failed to load Twitter widgets script')
        }
        document.head.appendChild(script)
      }
    }

    const createTweetEmbed = (container: HTMLDivElement) => {
      if (isCancelled) return
      
      const currentContainer = containerRef.current || container
      if (!currentContainer) {
        if (!isCancelled) {
          setError('Embed container not found')
          setLoading(false)
          if (onError) onError('Embed container not found')
        }
        return
      }

      // @ts-ignore
      const twttr = (window as any).twttr
      if (typeof window !== 'undefined' && twttr && twttr.widgets && twttr.widgets.createTweet) {
        // Clear the container first
        currentContainer.innerHTML = ''
        
        if (isCancelled) return

        const timeout = setTimeout(() => {
          if (!isCancelled) {
            setError('Embed creation timed out. The tweet may be unavailable or require login.')
            setLoading(false)
            if (onError) onError('Embed creation timed out')
          }
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
            if (isCancelled) return false
            
            const iframe = currentContainer.querySelector('iframe')
            const embedDiv = currentContainer.querySelector('.twitter-tweet-rendered, .twitter-tweet')
            if (iframe || embedDiv) {
              clearTimeout(timeout)
              console.log('✅ Tweet embed detected in DOM')

              // Fix the HTML before storing - replace hidden iframe styles
              let fixedHtml = currentContainer.innerHTML
              fixedHtml = fixedHtml.replace(
                /(<iframe[^>]*\s+)style="[^"]*position:\s*absolute[^"]*visibility:\s*hidden[^"]*width:\s*0px[^"]*height:\s*0px[^"]*"/gi,
                '$1style="width: 100%; min-height: 200px; display: block; visibility: visible; position: relative;"'
              )
              fixedHtml = fixedHtml.replace(
                /(<iframe[^>]*\s+)style="[^"]*visibility:\s*hidden[^"]*"/gi,
                '$1style="width: 100%; min-height: 200px; display: block; visibility: visible; position: relative;"'
              )

              // Make iframe visible in DOM - remove height constraint to let Twitter handle sizing
              if (iframe) {
                iframe.style.cssText = 'width: 100%; min-height: 200px; display: block; visibility: visible; position: relative;'
              }

              if (!isCancelled) {
                setError(null)
                setLoading(false)
                setEmbedHtml(fixedHtml)
              }
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
            if (isCancelled) return
            clearTimeout(timeout)
            if (checkInterval) clearInterval(checkInterval)
            console.log('✅ Tweet embed created (promise resolved)')
            const iframe = currentContainer.querySelector('iframe')
            if (iframe) {
              iframe.style.cssText = 'width: 100%; min-height: 200px; display: block; visibility: visible; position: relative;'
            }
            if (!isCancelled) {
              setEmbedHtml(currentContainer.innerHTML)
              setError(null)
              setLoading(false)
            }
          }).catch((error: Error) => {
            if (isCancelled) return
            clearTimeout(timeout)
            if (checkInterval) clearInterval(checkInterval)
            console.error('❌ Error creating tweet embed:', error.message)
            if (!checkEmbedCreated()) {
              if (!isCancelled) {
                setError(error.message || 'Failed to create Twitter embed')
                setLoading(false)
                if (onError) onError(error.message || 'Failed to create Twitter embed')
              }
            }
          })
        } catch (error) {
          if (isCancelled) return
          clearTimeout(timeout)
          const errorMessage = error instanceof Error ? error.message : 'Failed to create Twitter embed'
          if (!isCancelled) {
            setError(errorMessage)
            setLoading(false)
            if (onError) onError(errorMessage)
          }
        }
      } else {
        if (!isCancelled) {
          setError('Twitter widgets.js not available')
          setLoading(false)
          if (onError) onError('Twitter widgets.js not available')
        }
      }
    }

    // Wait for the ref to be available, then load script and create embed
    const checkRefAndCreate = (attempts = 0) => {
      if (isCancelled) return
      
      const container = containerRef.current
      console.log(`TwitterEmbed: checkRefAndCreate attempt ${attempts}, container:`, container)
      if (!container) {
        if (attempts < 50) {
          setTimeout(() => checkRefAndCreate(attempts + 1), 100)
          return
        } else {
          if (!isCancelled) {
            console.error('TwitterEmbed: Container not found after 50 attempts')
            setError('Embed container not found')
            setLoading(false)
            if (onError) onError('Embed container not found')
          }
          return
        }
      }

      console.log('TwitterEmbed: Container found, loading script and creating embed')
      loadScriptAndCreate(container)
    }

    // Start checking for the ref - don't require it to be available immediately
    checkRefAndCreate()

    // Cleanup function
    return () => {
      console.log('TwitterEmbed: Cleanup - cancelling embed creation')
      isCancelled = true
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
      setEmbedHtml(null)
      setError(null)
      setLoading(false)
    }
  }, [url, onError])

  // Reapply height styles when embedHtml changes (for when switching between tweets)
  useEffect(() => {
    if (!embedHtml || !containerRef.current) return

    // Listen for Twitter embed height updates via postMessage
    const handleMessage = (event: MessageEvent) => {
      // Twitter embeds send height updates via postMessage
      // Check if the message is from Twitter's embed domain
      if ((event.origin.includes('twitter.com') || event.origin.includes('x.com') || event.origin.includes('platform.twitter.com')) && 
          event.data && typeof event.data === 'object') {
        const iframe = containerRef.current?.querySelector('iframe')
        if (!iframe) return
        
        // Log the full structure to see what Twitter is sending
        console.log('Twitter postMessage received:', event.origin, JSON.stringify(event.data, null, 2))
        
        // Twitter sends height updates in various formats - try to extract height
        let height: number | null = null
        
        // Check for direct height property
        if (typeof event.data.height === 'number') {
          height = event.data.height
        }
        // Check for twttr.embed object with height
        else if (event.data['twttr.embed'] && typeof event.data['twttr.embed'] === 'object') {
          const embedData = event.data['twttr.embed']
          
          // Twitter sends resize messages with height in params[0]
          if (embedData.method === 'twttr.private.resize' && 
              Array.isArray(embedData.params) && 
              embedData.params.length > 0 &&
              embedData.params[0] &&
              typeof embedData.params[0].height === 'number') {
            height = embedData.params[0].height
            console.log('✅ Extracted height from twttr.private.resize:', height)
          }
          // Check for direct height property (fallback)
          else if (typeof embedData.height === 'number') {
            height = embedData.height
          } else if (typeof embedData.h === 'number') {
            height = embedData.h
          }
        }
        // Check for resize type messages
        else if (event.data.type === 'resize' && typeof event.data.height === 'number') {
          height = event.data.height
        }
        // Check if the data itself is a number (some Twitter messages are just the height)
        else if (typeof event.data === 'number' && event.data > 0) {
          height = event.data
        }
        
        if (height && height > 0 && height > 200) {
          iframe.style.height = `${height}px`
          console.log('✅ Twitter embed height updated via postMessage:', height, 'px')
        } else if (height && height > 0) {
          console.log('⚠️ Twitter sent height but it seems too small:', height, 'px')
        }
      }
    }

    window.addEventListener('message', handleMessage)

    const applyHeightStyles = () => {
      const iframe = containerRef.current?.querySelector('iframe')
      if (iframe) {
        // First, check if Twitter has already set a height on the iframe
        // Twitter's widgets.js might set it directly on the element
        const existingHeight = iframe.style.height || iframe.getAttribute('height')
        const computedHeight = window.getComputedStyle(iframe).height
        
        // If Twitter has set a height, preserve it; otherwise use min-height
        if (existingHeight && existingHeight !== 'auto' && !existingHeight.includes('min') && parseInt(existingHeight) > 200) {
          // Twitter has set a height, keep it but ensure visibility
          // Don't use !important on height so Twitter can update it
          iframe.style.width = '100%'
          iframe.style.height = existingHeight.includes('px') ? existingHeight : `${existingHeight}px`
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
          iframe.style.minHeight = '200px' // Fallback
          console.log('Preserving Twitter-set height:', existingHeight)
        } else if (computedHeight && computedHeight !== 'auto' && computedHeight !== '0px' && parseInt(computedHeight) > 200) {
          // Use computed height if available
          iframe.style.width = '100%'
          iframe.style.height = computedHeight
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
          iframe.style.minHeight = '200px' // Fallback
          console.log('Using computed height:', computedHeight)
        } else {
          // Fallback: just ensure visibility, Twitter should set height
          // Don't set height with !important - let Twitter control it
          iframe.style.width = '100%'
          iframe.style.minHeight = '200px'
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
        }
        
        // Also check for the parent container
        const tweetContainer = containerRef.current?.querySelector('.twitter-tweet-rendered, .twitter-tweet')
        if (tweetContainer) {
          ;(tweetContainer as HTMLElement).style.cssText = 'display: block !important; visibility: visible !important; width: 100% !important;'
        }
      }
    }

    // Check for height periodically - Twitter might set it after initial load
    const checkHeight = () => {
      const iframe = containerRef.current?.querySelector('iframe')
      if (iframe) {
        // Try to read the iframe's contentDocument height (might be blocked by CORS)
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
          if (iframeDoc) {
            const bodyHeight = iframeDoc.body?.scrollHeight || iframeDoc.documentElement?.scrollHeight
            if (bodyHeight && bodyHeight > 200) {
              iframe.style.height = `${bodyHeight}px`
              console.log('Set height from iframe content:', bodyHeight)
              return true
            }
          }
        } catch (e) {
          // CORS blocked, that's expected
        }
        
        // Check if Twitter set a height attribute or style
        const heightAttr = iframe.getAttribute('height')
        const heightStyle = iframe.style.height
        if (heightAttr && parseInt(heightAttr) > 200) {
          iframe.style.height = `${heightAttr}px`
          console.log('Set height from attribute:', heightAttr)
          return true
        } else if (heightStyle && !heightStyle.includes('min') && parseInt(heightStyle) > 200) {
          console.log('Height already set:', heightStyle)
          return true
        }
      }
      return false
    }

    // Apply styles after a short delay to ensure DOM is ready
    const timeout1 = setTimeout(() => {
      applyHeightStyles()
      checkHeight()
    }, 100)

    // Check again after Twitter's script has had time to load
    const timeout2 = setTimeout(() => {
      applyHeightStyles()
      checkHeight()
    }, 1000)

    // Check periodically for a few seconds
    const interval = setInterval(() => {
      if (checkHeight()) {
        clearInterval(interval)
      }
    }, 500)
    
    const timeout3 = setTimeout(() => {
      clearInterval(interval)
    }, 5000)

    // Cleanup function
    return () => {
      window.removeEventListener('message', handleMessage)
      clearTimeout(timeout1)
      clearTimeout(timeout2)
      clearTimeout(timeout3)
      clearInterval(interval)
    }
  }, [embedHtml])

  return (
    <>
      {/* Always render the container so the ref is available */}
      <div className="mb-4 flex justify-center">
        <div
          ref={containerRef}
          className="twitter-embed-container"
          style={{ width: '100%', maxWidth: '550px' }}
          dangerouslySetInnerHTML={embedHtml ? { __html: embedHtml } : undefined}
        />
      </div>
      
      {/* Show loading spinner if loading */}
      {loading && !embedHtml && (
        <div className="flex justify-center items-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      )}

      {/* Show error if there's an error */}
      {error && (
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
      )}

      {/* CSS to override Twitter's hidden iframe styles - note: don't use !important on height so Twitter can set it */}
      {embedHtml && (
        <style dangerouslySetInnerHTML={{ __html: `
          .twitter-embed-container iframe {
            visibility: visible !important;
            width: 100% !important;
            min-height: 200px !important;
            display: block !important;
            position: relative !important;
            /* Don't set height with !important - let Twitter control it */
          }
          .twitter-embed-container .twitter-tweet-rendered {
            display: block !important;
            visibility: visible !important;
            width: 100% !important;
          }
        ` }} />
      )}
    </>
  )
}
