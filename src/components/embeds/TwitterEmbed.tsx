import { useEffect, useRef, useState, memo } from 'react'
import { loadScriptOnce } from '../../utils/scriptLoader'

interface TwitterEmbedProps {
  url: string
  theme?: 'light' | 'dark'
  onError?: (error: string) => void
}

function TwitterEmbed({ url, theme = 'dark', onError }: TwitterEmbedProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }
    setEmbedHtml(null)
    setError(null)
    setLoading(true)
    
    if (!url) {
      setError('No URL provided')
      setLoading(false)
      return
    }

    const tweetIdMatch = url.match(/\/status\/(\d+)/)
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : null

    if (!tweetId) {
      setError('Invalid Twitter URL - could not extract tweet ID')
      setLoading(false)
      if (onError) onError('Invalid Twitter URL')
      return
    }

    let isCancelled = false

    const loadScriptAndCreate = (container: HTMLDivElement) => {
      if (container) container.innerHTML = ''
      
      if (typeof window !== 'undefined' && (window as any).twttr) {
        if ((window as any).twttr.ready) {
          (window as any).twttr.ready(() => {
            const currentContainer = containerRef.current || container
            if (currentContainer && !isCancelled) createTweetEmbed(currentContainer)
          })
        } else {
          setTimeout(() => {
            const currentContainer = containerRef.current || container
            if (currentContainer && !isCancelled) createTweetEmbed(currentContainer)
          }, 100)
        }
      } else {
        loadScriptOnce('https://platform.twitter.com/widgets.js', 'twitter-widgets')
          .then(() => {
            const currentContainer = containerRef.current || container
            if (!currentContainer || isCancelled) return
            if ((window as any).twttr && (window as any).twttr.ready) {
              (window as any).twttr.ready(() => {
                const c = containerRef.current || currentContainer
                if (c && !isCancelled) createTweetEmbed(c)
              })
            } else {
              setTimeout(() => {
                const c = containerRef.current || currentContainer
                if (c && !isCancelled) createTweetEmbed(c)
              }, 100)
            }
          })
          .catch(() => {
            if (!mountedRef.current) return
            setError('Failed to load Twitter widgets script')
            setLoading(false)
            if (onError) onError('Failed to load Twitter widgets script')
          })
      }
    }

    const createTweetEmbed = (container: HTMLDivElement) => {
      const currentContainer = containerRef.current || container
      if (!currentContainer) return

      // @ts-ignore
      const twttr = (window as any).twttr
      if (typeof window !== 'undefined' && twttr && twttr.widgets && twttr.widgets.createTweet) {
        // Clear the container first
        currentContainer.innerHTML = ''
        
        if (isCancelled) return

        const timeout = setTimeout(() => {
          if (!mountedRef.current) return
          const iframe = currentContainer.querySelector('iframe')
          if (iframe) {
            setTimeout(() => {
              if (mountedRef.current && !currentContainer.querySelector('iframe[src*="embed"]')) {
                setError('Tweet not found or unavailable')
                setEmbedHtml(null)
                setLoading(false)
                if (onError) onError('Tweet not found or unavailable')
              }
            }, 2000)
          } else {
            setError('Embed creation timed out. The tweet may be unavailable or require login.')
            setEmbedHtml(null)
            setLoading(false)
            if (onError) onError('Embed creation timed out')
          }
        }, 10000)

        try {
          // Store tweet ID and theme on the container for later reference
          if (currentContainer) {
            currentContainer.setAttribute('data-tweet-id', tweetId)
            currentContainer.setAttribute('data-theme', theme)
            currentContainer.setAttribute('data-dnt', 'true')
          }
          
          // @ts-ignore
          const promise = twttr.widgets.createTweet(
            tweetId,
            currentContainer,
            {
              theme: theme,
              dnt: true,
              align: 'center'
            }
          )

          // Check if embed was created (sometimes promise doesn't resolve but embed appears)
          const checkEmbedCreated = () => {
            if (!mountedRef.current) return false
            
            const iframe = currentContainer.querySelector('iframe')
            const embedDiv = currentContainer.querySelector('.twitter-tweet-rendered, .twitter-tweet')
            const blockquote = currentContainer.querySelector('blockquote.twitter-tweet')
            
            // Ensure blockquote has data-theme attribute
            if (blockquote && !blockquote.getAttribute('data-theme')) {
              blockquote.setAttribute('data-theme', theme)
              blockquote.setAttribute('data-dnt', 'true')
            }
            
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

              if (mountedRef.current) {
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
            if (!mountedRef.current) return
            clearTimeout(timeout)
            if (checkInterval) clearInterval(checkInterval)
            console.log('✅ Tweet embed created (promise resolved)')
            const iframe = currentContainer.querySelector('iframe')
            if (iframe) {
              // Check if height is suspiciously small (error state)
              const iframeHeight = parseInt(iframe.style.height || iframe.getAttribute('height') || '0')
              if (iframeHeight > 0 && iframeHeight < 150) {
                if (mountedRef.current) {
                  setError('Tweet not found or unavailable')
                  setEmbedHtml(null)
                  setLoading(false)
                  if (onError) onError('Tweet not found or unavailable')
                }
                return
              }
              iframe.style.cssText = 'width: 100%; min-height: 200px; display: block; visibility: visible; position: relative; background-color: rgb(var(--b2));'
            }
            if (mountedRef.current) {
              setEmbedHtml(currentContainer.innerHTML)
              setError(null)
              setLoading(false)
            }
          }).catch((error: Error) => {
            if (!mountedRef.current) return
            clearTimeout(timeout)
            if (checkInterval) clearInterval(checkInterval)
            if (!checkEmbedCreated()) {
              if (mountedRef.current) {
                setError(error.message || 'Failed to create Twitter embed')
                setLoading(false)
                if (onError) onError(error.message || 'Failed to create Twitter embed')
              }
            }
          })
        } catch (error) {
          if (!mountedRef.current) return
          clearTimeout(timeout)
          const errorMessage = error instanceof Error ? error.message : 'Failed to create Twitter embed'
          if (mountedRef.current) {
            setError(errorMessage)
            setLoading(false)
            if (onError) onError(errorMessage)
          }
        }
      } else {
        if (mountedRef.current) {
          setError('Twitter widgets.js not available')
          setLoading(false)
          if (onError) onError('Twitter widgets.js not available')
        }
      }
    }

    const checkRefAndCreate = (attempts = 0) => {
      if (isCancelled) return
      const container = containerRef.current
      if (!container) {
        if (attempts < 50) {
          setTimeout(() => checkRefAndCreate(attempts + 1), 100)
          return
        }
        if (mountedRef.current) {
          setError('Embed container not found')
          setLoading(false)
          if (onError) onError('Embed container not found')
        }
        return
      }
      loadScriptAndCreate(container)
    }

    checkRefAndCreate()

    return () => {
      isCancelled = true
      mountedRef.current = false
      if (containerRef.current) containerRef.current.innerHTML = ''
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

    // Get the iframe for this specific embed instance
    const getThisIframe = () => {
      return containerRef.current?.querySelector('iframe')
    }

    // Extract tweet ID from URL for this embed instance
    const extractTweetId = (): string | null => {
      try {
        const tweetIdMatch = url.match(/\/status\/(\d+)/)
        return tweetIdMatch ? tweetIdMatch[1] : null
      } catch {
        return null
      }
    }
    
    const thisTweetId = extractTweetId()
    
    // Also try to get tweet ID from container data attribute (set during embed creation)
    const getTweetIdFromContainer = (): string | null => {
      if (containerRef.current) {
        const tweetId = containerRef.current.getAttribute('data-tweet-id')
        return tweetId
      }
      return null
    }
    
    // Use container tweet ID if available, otherwise use URL extraction
    const effectiveTweetId = getTweetIdFromContainer() || thisTweetId
    
    console.log(`[TwitterEmbed] Component initialized for tweet ID: ${effectiveTweetId || 'unknown'}, URL: ${url.substring(0, 80)}`)

    // Listen for Twitter embed height updates via postMessage
    const handleMessage = (event: MessageEvent) => {
      // Twitter embeds send height updates via postMessage
      // Check if the message is from Twitter's embed domain
      if ((event.origin.includes('twitter.com') || event.origin.includes('x.com') || event.origin.includes('platform.twitter.com')) && 
          event.data && typeof event.data === 'object') {
        const iframe = getThisIframe()
        if (!iframe) {
          console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] No iframe found, ignoring message`)
          return
        }
        
        // CRITICAL: Only process messages that came from THIS iframe's contentWindow
        // This is the key to preventing all embeds from processing all messages
        if (event.source !== iframe.contentWindow) {
          // Message is from a different iframe - ignore it
          // Don't log this to avoid spam, but it's working correctly
          return
        }
        
        console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] ✅ Message source matches this iframe, processing...`)
        
        // Verify this iframe is actually in the DOM and visible
        if (!document.contains(iframe) || iframe.offsetParent === null) {
          console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Iframe not visible, ignoring message`)
          return // This iframe is not visible/active, ignore message
        }
        
        // Get the iframe's src to identify this specific embed
        const iframeSrc = iframe.getAttribute('src') || iframe.src || ''
        const iframeId = iframe.getAttribute('id') || ''
        
        // Extract embedId from iframe src (e.g., embedId=twitter-widget-3)
        const embedIdMatch = iframeSrc.match(/embedId=([^&]+)/)
        const thisEmbedId = embedIdMatch ? embedIdMatch[1] : iframeId
        
        console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Received message from ${event.origin}`, {
          iframeId,
          thisEmbedId,
          iframeSrc: iframeSrc.substring(0, 150),
          messageData: event.data
        })
        
        // Twitter sends height updates in various formats - try to extract height
        let height: number | null = null
        
        // Check for twttr.embed object with height
        if (event.data['twttr.embed'] && typeof event.data['twttr.embed'] === 'object') {
          const embedData = event.data['twttr.embed']
          
          console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Processing twttr.embed message:`, {
            method: embedData.method,
            params: embedData.params,
            thisEmbedId
          })
          
          // Twitter sends 'rendered' messages first, then 'resize' messages with height
          if (embedData.method === 'twttr.private.rendered') {
            console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Rendered message received (waiting for resize message)`)
            // Rendered messages don't have height, just log them for debugging
            return // Don't process rendered messages, wait for resize
          }
          
          // Twitter sends resize messages with height in params[0]
          if (embedData.method === 'twttr.private.resize' && 
              Array.isArray(embedData.params) && 
              embedData.params.length > 0 &&
              embedData.params[0] &&
              typeof embedData.params[0].height === 'number') {
            height = embedData.params[0].height
            
            // Log the full params to see what Twitter actually sends
            console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Resize message received - FULL PARAMS:`, {
              height,
              fullParams: embedData.params[0],
              messageTweetId: embedData.params[0]?.tweetId,
              messageEmbedId: embedData.params[0]?.embedId || embedData.params[0]?.id,
              thisTweetId: effectiveTweetId,
              thisIframeId: iframeId,
              thisEmbedId: thisEmbedId,
              allKeys: embedData.params[0] ? Object.keys(embedData.params[0]) : []
            })
            
            // Since we've already verified event.source matches this iframe, we can process the message
            // The event.source check above ensures only messages from THIS iframe are processed
            const currentHeight = parseInt(iframe.style.height || iframe.getAttribute('height') || '0')
            
            console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Processing resize message:`, {
              currentHeight,
              newHeight: height,
              heightDiff: height !== null ? Math.abs(height - currentHeight) : null
            })
            
            // Create a unique key for this message to deduplicate (include iframe src to make it per-embed)
            const messageKey = `${iframeSrc}-${JSON.stringify(event.data)}`
            if (lastProcessedMessages.has(messageKey)) {
              return // Skip duplicate messages for this specific embed
            }
            lastProcessedMessages.add(messageKey)
            
            // Clean up old message keys (keep last 50)
            if (lastProcessedMessages.size > 50) {
              const keysArray = Array.from(lastProcessedMessages)
              keysArray.slice(0, keysArray.length - 50).forEach(key => lastProcessedMessages.delete(key))
            }
            
            // Throttle height updates
            const now = Date.now()
            if (now - lastHeightUpdate < HEIGHT_UPDATE_THROTTLE) {
              return // Skip if too soon since last update
            }
            lastHeightUpdate = now
            
            // Very small heights (like 76px) usually indicate an error state
            if (height && height < 150) {
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
            
            // Only update if the height is significantly different (avoid unnecessary updates)
            // currentHeight is already declared above
            const heightDiff = height !== null ? Math.abs(height - currentHeight) : 0
            console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Final check before update:`, {
              currentHeight,
              newHeight: height,
              heightDiff,
              willUpdate: heightDiff > 10
            })
            
            if (heightDiff > 10) {
              iframe.style.height = `${height}px`
              console.log(`✅ [TwitterEmbed ${effectiveTweetId || 'unknown'}] HEIGHT UPDATED: ${currentHeight}px -> ${height}px`)
            } else {
              console.log(`[TwitterEmbed ${effectiveTweetId || 'unknown'}] Skipping update - height difference too small (${heightDiff}px)`)
            }
          }
        }
      }
    }

    window.addEventListener('message', handleMessage)

    const applyHeightStyles = () => {
      const iframe = getThisIframe()
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
      const iframe = getThisIframe()
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

export default memo(TwitterEmbed, (prevProps, nextProps) => {
  return (
    prevProps.url === nextProps.url &&
    prevProps.theme === nextProps.theme
    // Note: onError callback is not compared as it may change reference
  )
})
