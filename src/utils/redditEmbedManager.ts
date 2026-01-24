// Global Reddit Embed Manager
// Handles loading Reddit's embed script once and processing all blockquotes together
// Prevents race conditions and script reloads that break embeds

let scriptLoaded = false
let scriptLoadPromise: Promise<void> | null = null
let pendingBlockquotes = new Set<HTMLElement>()
let loadTimeout: NodeJS.Timeout | null = null
let lastLoadTime = 0
let reprocessTimeout: NodeJS.Timeout | null = null
const LOAD_DELAY = 800 // Wait 800ms to batch all blockquotes before loading script
const REPROCESS_COOLDOWN = 5000 // Don't reload script more than once every 5 seconds

/**
 * Registers a Reddit blockquote element and ensures the script is loaded
 * The script will load once after a delay to batch all blockquotes together
 */
export function registerRedditBlockquote(blockquote: HTMLElement): void {
  if (!blockquote) return
  
  pendingBlockquotes.add(blockquote)
  
  // If script is already loaded, we need to trigger reprocessing
  // Reddit's script doesn't automatically detect new blockquotes after initial load
  if (scriptLoaded) {
    console.log('[Reddit Manager] Script already loaded, new blockquote registered - will trigger reprocess')
    // Clear any existing reprocess timeout
    if (reprocessTimeout) {
      clearTimeout(reprocessTimeout)
    }
    
    // Wait a bit for the blockquote to be fully in the DOM, then check if processing is needed
    reprocessTimeout = setTimeout(() => {
      checkAndReprocessIfNeeded()
    }, 500) // Shorter delay since script is already loaded
    return
  }
  
  // Script not loaded yet - schedule loading after delay to batch all blockquotes
  if (loadTimeout) {
    clearTimeout(loadTimeout)
  }
  
  loadTimeout = setTimeout(() => {
    loadRedditScript()
  }, LOAD_DELAY)
}

/**
 * Unregisters a blockquote (when component unmounts)
 */
export function unregisterRedditBlockquote(blockquote: HTMLElement): void {
  if (blockquote) {
    pendingBlockquotes.delete(blockquote)
  }
}

/**
 * Checks if blockquotes need reprocessing and handles it
 * Only reloads if cooldown period has passed
 */
function checkAndReprocessIfNeeded(): void {
  const now = Date.now()
  
  const blockquotes = Array.from(pendingBlockquotes)
  const unprocessed = blockquotes.filter(blockquote => {
    // Check if this blockquote has been processed
    // Reddit's script replaces the blockquote with an iframe, or adds an iframe nearby
    const container = blockquote.parentElement
    if (!container) return true
    
    // Check multiple ways Reddit might have processed it:
    // 1. Iframe as sibling or in parent
    const iframe = container.querySelector('iframe[src*="embed.reddit.com"]')
    if (iframe) return false
    
    // 2. Check if blockquote itself was replaced (Reddit sometimes does this)
    if (!document.contains(blockquote)) return false
    
    // 3. Check if blockquote has been modified (Reddit adds data attributes)
    const hasRedditData = blockquote.hasAttribute('data-reddit-embed-id') || 
                         blockquote.classList.contains('reddit-embed-processed')
    
    return !hasRedditData && !iframe
  })
  
  if (unprocessed.length === 0) {
    console.log('[Reddit Manager] All blockquotes are processed')
    return // All processed
  }
  
  // Some blockquotes aren't processed
  console.log(`[Reddit Manager] ${unprocessed.length} blockquote(s) need processing`)
  
  // Check cooldown - but if we just registered a new blockquote, we should process it
  if (now - lastLoadTime < REPROCESS_COOLDOWN) {
    console.log('[Reddit Manager] Cooldown active, but new blockquotes detected - will wait and retry')
    // Wait a bit more, then retry
    setTimeout(() => {
      checkAndReprocessIfNeeded()
    }, 1000)
    return
  }
  
  // Reload script to trigger processing of all blockquotes
  console.log(`[Reddit Manager] Reloading script to process ${unprocessed.length} unprocessed blockquote(s)...`)
  lastLoadTime = Date.now()
  
  // Remove and reload script to trigger processing
  const existingScript = document.querySelector('script[src="https://embed.reddit.com/widgets.js"]')
  if (existingScript) {
    existingScript.remove()
    scriptLoaded = false
    scriptLoadPromise = null
    loadRedditScript()
  }
}

/**
 * Loads Reddit's embed script once
 * This should process all blockquotes that are in the DOM when it loads
 */
function loadRedditScript(): Promise<void> {
  if (scriptLoadPromise) {
    return scriptLoadPromise
  }
  
  if (scriptLoaded) {
    return Promise.resolve()
  }
  
  scriptLoadPromise = new Promise((resolve, reject) => {
    // Check if script already exists (shouldn't happen, but just in case)
    const existingScript = document.querySelector('script[src="https://embed.reddit.com/widgets.js"]')
    if (existingScript) {
      scriptLoaded = true
      resolve()
      return
    }
    
    // Count blockquotes before loading
    const blockquoteCount = document.querySelectorAll('blockquote.reddit-embed-bq').length
    console.log(`[Reddit Manager] Loading script with ${blockquoteCount} blockquote(s) in DOM`)
    
    // Create and load script
    const script = document.createElement('script')
    script.src = 'https://embed.reddit.com/widgets.js'
    script.async = true
    script.charset = 'UTF-8'
    
    script.onload = () => {
      scriptLoaded = true
      lastLoadTime = Date.now()
      console.log('[Reddit Manager] Script loaded successfully')
      
      // Verify processing after a delay (but don't trigger reload immediately)
      setTimeout(() => {
        const processedCount = document.querySelectorAll('iframe[src*="embed.reddit.com"]').length
        const blockquoteCount = document.querySelectorAll('blockquote.reddit-embed-bq').length
        console.log(`[Reddit Manager] ${processedCount} embed(s) processed out of ${blockquoteCount} blockquote(s)`)
        
        // Don't automatically reload - let checkAndReprocessIfNeeded handle it if needed
      }, 3000)
      
      resolve()
    }
    
    script.onerror = () => {
      scriptLoadPromise = null
      reject(new Error('Failed to load Reddit widgets script'))
    }
    
    document.head.appendChild(script)
  })
  
  return scriptLoadPromise
}

/**
 * Forces a reprocess of all blockquotes
 * Use this if embeds aren't loading after script is loaded
 */
export function forceReprocess(): void {
  if (!scriptLoaded) {
    console.warn('[Reddit Manager] Cannot reprocess - script not loaded')
    return
  }
  
  console.log('[Reddit Manager] Forcing reprocess')
  checkAndReprocessIfNeeded()
}
