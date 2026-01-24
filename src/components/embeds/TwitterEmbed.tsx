import { useEffect, useRef, useState } from 'react'
import { loadScriptOnce } from '../../utils/scriptLoader'

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
        // Load the script safely (only once)
        console.log('Loading Twitter widgets.js script...')
        loadScriptOnce('https://platform.twitter.com/widgets.js', 'twitter-widgets')
          .then(() => {
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
          })
          .catch((err) => {
            if (isCancelled) return
            setError('Failed to load Twitter widgets script')
            setLoading(false)
            if (onError) onError('Failed to load Twitter widgets script')
          })
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
            // Check if iframe was created but might be showing an error
            const iframe = currentContainer.querySelector('iframe')
            if (iframe) {
              // Give it a bit more time - sometimes Twitter takes longer
              setTimeout(() => {
                if (!isCancelled && !currentContainer.querySelector('iframe[src*="embed"]')) {
                  setError('Tweet not found or unavailable')
                  setEmbedHtml(null) // Clear embed HTML so error shows
                  setLoading(false)
                  if (onError) onError('Tweet not found or unavailable')
                }
              }, 2000)
            } else {
              setError('Embed creation timed out. The tweet may be unavailable or require login.')
              setEmbedHtml(null) // Clear embed HTML so error shows
              setLoading(false)
              if (onError) onError('Embed creation timed out')
            }
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
              // Check if iframe has a very small height (likely error state)
              if (iframe) {
                const iframeHeight = parseInt(iframe.style.height || iframe.getAttribute('height') || '0')
                // Very small heights (like 76px) usually indicate an error state
                if (iframeHeight > 0 && iframeHeight < 150) {
                  console.log('⚠️ Tweet iframe has very small height, likely error:', iframeHeight, 'px')
                  // Don't mark as successful - wait to see if it updates
                  return false
                }
              }
              
              clearTimeout(timeout)
              console.log('✅ Tweet embed detected in DOM')

              // Fix the HTML before storing - replace hidden iframe styles
              let fixedHtml = currentContainer.innerHTML
              fixedHtml = fixedHtml.replace(
                /(<iframe[^>]*\s+)style="[^"]*position:\s*absolute[^"]*visibility:\s*hidden[^"]*width:\s*0px[^"]*height:\s*0px[^"]*"/gi,
                '$1style="width: 100%; min-height: 200px; display: block; visibility: visible; position: relative; background-color: rgb(var(--b2));"'
              )
              fixedHtml = fixedHtml.replace(
                /(<iframe[^>]*\s+)style="[^"]*visibility:\s*hidden[^"]*"/gi,
                '$1style="width: 100%; min-height: 200px; display: block; visibility: visible; position: relative; background-color: rgb(var(--b2));"'
              )

              // Make iframe visible in DOM - remove height constraint to let Twitter handle sizing
              if (iframe) {
                iframe.style.cssText = 'width: 100%; min-height: 200px; display: block; visibility: visible; position: relative; background-color: rgb(var(--b2));'
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
              // Check if height is suspiciously small (error state)
              const iframeHeight = parseInt(iframe.style.height || iframe.getAttribute('height') || '0')
              if (iframeHeight > 0 && iframeHeight < 150) {
                console.log('⚠️ Tweet iframe has very small height after promise, likely error:', iframeHeight, 'px')
                if (!isCancelled) {
                  setError('Tweet not found or unavailable')
                  setEmbedHtml(null)
                  setLoading(false)
                  if (onError) onError('Tweet not found or unavailable')
                }
                return
              }
              iframe.style.cssText = 'width: 100%; min-height: 200px; display: block; visibility: visible; position: relative; background-color: rgb(var(--b2));'
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

    // Track last processed message to avoid duplicates
    const lastProcessedMessages = new Set<string>()
    let lastHeightUpdate = 0
    let smallHeightDetected = false
    let smallHeightDetectedTime = 0
    const HEIGHT_UPDATE_THROTTLE = 100 // Throttle height updates to once per 100ms
    const SMALL_HEIGHT_ERROR_DELAY = 2000 // Wait 2 seconds before treating small height as error

    // Listen for Twitter embed height updates via postMessage
    const handleMessage = (event: MessageEvent) => {
      // Twitter embeds send height updates via postMessage
      // Check if the message is from Twitter's embed domain
      if ((event.origin.includes('twitter.com') || event.origin.includes('x.com') || event.origin.includes('platform.twitter.com')) && 
          event.data && typeof event.data === 'object') {
        const iframe = containerRef.current?.querySelector('iframe')
        if (!iframe) return
        
        // Create a unique key for this message to deduplicate
        const messageKey = JSON.stringify(event.data)
        if (lastProcessedMessages.has(messageKey)) {
          return // Skip duplicate messages
        }
        lastProcessedMessages.add(messageKey)
        
        // Clean up old message keys (keep last 50)
        if (lastProcessedMessages.size > 50) {
          const keysArray = Array.from(lastProcessedMessages)
          keysArray.slice(0, keysArray.length - 50).forEach(key => lastProcessedMessages.delete(key))
        }
        
        // Twitter sends height updates in various formats - try to extract height
        let height: number | null = null
        
        // Check for twttr.embed object with height
        if (event.data['twttr.embed'] && typeof event.data['twttr.embed'] === 'object') {
          const embedData = event.data['twttr.embed']
          
          // Twitter sends resize messages with height in params[0]
          if (embedData.method === 'twttr.private.resize' && 
              Array.isArray(embedData.params) && 
              embedData.params.length > 0 &&
              embedData.params[0] &&
              typeof embedData.params[0].height === 'number') {
            height = embedData.params[0].height
            
            // Throttle height updates
            const now = Date.now()
            if (now - lastHeightUpdate < HEIGHT_UPDATE_THROTTLE) {
              return // Skip if too soon since last update
            }
            lastHeightUpdate = now
            
            // Very small heights (like 76px) usually indicate an error state
            if (height < 150) {
              console.log('⚠️ Twitter sent very small height, likely error state:', height, 'px')
              if (!smallHeightDetected) {
                smallHeightDetected = true
                smallHeightDetectedTime = now
              } else if (now - smallHeightDetectedTime > SMALL_HEIGHT_ERROR_DELAY) {
                // Small height persisted for too long - treat as error
                console.log('⚠️ Small height persisted, showing error')
                setError('Tweet not found or unavailable')
                setEmbedHtml(null)
                setLoading(false)
                return
              }
              // Don't apply very small heights - keep min-height instead
              return
            } else {
              // Height is normal, reset error detection
              smallHeightDetected = false
              smallHeightDetectedTime = 0
            }
            
            iframe.style.height = `${height}px`
            console.log('✅ Twitter embed height updated via postMessage:', height, 'px')
          }
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
        const existingHeightNum = existingHeight ? parseInt(existingHeight) : 0
        const computedHeightNum = computedHeight ? parseInt(computedHeight) : 0
        
        // Check for very small heights (error state)
        if (existingHeightNum > 0 && existingHeightNum < 150) {
          console.log('⚠️ Twitter-set height is very small, likely error:', existingHeightNum, 'px')
          // Don't apply very small heights
          iframe.style.width = '100%'
          iframe.style.minHeight = '200px'
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
          iframe.style.background = 'rgb(var(--b2))'
        } else if (existingHeight && existingHeight !== 'auto' && !existingHeight.includes('min') && existingHeightNum >= 150) {
          // Twitter has set a height, keep it but ensure visibility
          // Don't use !important on height so Twitter can update it
          iframe.style.width = '100%'
          iframe.style.height = existingHeight.includes('px') ? existingHeight : `${existingHeight}px`
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
          iframe.style.minHeight = '200px' // Fallback
          iframe.style.background = 'rgb(var(--b2))'
          console.log('Preserving Twitter-set height:', existingHeight)
        } else if (computedHeight && computedHeight !== 'auto' && computedHeight !== '0px' && computedHeightNum >= 150) {
          // Use computed height if available
          iframe.style.width = '100%'
          iframe.style.height = computedHeight
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
          iframe.style.minHeight = '200px' // Fallback
          iframe.style.background = 'rgb(var(--b2))'
          console.log('Using computed height:', computedHeight)
        } else {
          // Fallback: just ensure visibility, Twitter should set height
          // Don't set height with !important - let Twitter control it
          iframe.style.width = '100%'
          iframe.style.minHeight = '200px'
          iframe.style.display = 'block'
          iframe.style.visibility = 'visible'
          iframe.style.position = 'relative'
          iframe.style.background = 'rgb(var(--b2))'
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
        const heightAttrNum = heightAttr ? parseInt(heightAttr) : 0
        const heightStyleNum = heightStyle ? parseInt(heightStyle) : 0
        
        // Check for very small heights (error state)
        if (heightAttrNum > 0 && heightAttrNum < 150) {
          console.log('⚠️ Height from attribute is very small, likely error:', heightAttrNum, 'px')
          iframe.style.background = 'rgb(var(--b2))'
          return false // Don't mark as successful
        } else if (heightAttrNum >= 150) {
          iframe.style.height = `${heightAttr}px`
          iframe.style.background = 'rgb(var(--b2))'
          console.log('Set height from attribute:', heightAttr)
          return true
        } else if (heightStyleNum > 0 && heightStyleNum < 150) {
          console.log('⚠️ Height from style is very small, likely error:', heightStyleNum, 'px')
          iframe.style.background = 'rgb(var(--b2))'
          return false // Don't mark as successful
        } else if (heightStyle && !heightStyle.includes('min') && heightStyleNum >= 150) {
          iframe.style.background = 'rgb(var(--b2))'
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
      {!error && (
        <div className="flex justify-center bg-base-200 rounded-lg">
          <div
            ref={containerRef}
            className="twitter-embed-container"
            style={{ width: '100%', maxWidth: '550px' }}
            dangerouslySetInnerHTML={embedHtml ? { __html: embedHtml } : undefined}
          />
        </div>
      )}
      
      {/* Show loading spinner if loading */}
      {loading && !embedHtml && !error && (
        <div className="flex justify-center items-center py-12 bg-base-200 rounded-lg">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      )}

      {/* Show error if there's an error - compact version */}
      {error && (
        <div className="bg-base-200 rounded-lg p-3">
          <p className="text-sm text-base-content/70">Tweet not found</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="link link-primary text-xs break-all"
          >
            {url}
          </a>
        </div>
      )}

      {/* CSS to override Twitter's hidden iframe styles - note: don't use !important on height so Twitter can set it */}
      {embedHtml && !error && (
        <style dangerouslySetInnerHTML={{ __html: `
          .twitter-embed-container {
            background-color: rgb(var(--b2)) !important;
            border-radius: 0.5rem;
            overflow: hidden;
          }
          .twitter-embed-container iframe {
            visibility: visible !important;
            width: 100% !important;
            min-height: 200px !important;
            display: block !important;
            position: relative !important;
            background-color: rgb(var(--b2)) !important;
            /* Don't set height with !important - let Twitter control it */
          }
          .twitter-embed-container .twitter-tweet-rendered {
            display: block !important;
            visibility: visible !important;
            width: 100% !important;
            background-color: rgb(var(--b2)) !important;
          }
        ` }} />
      )}
    </>
  )
}
