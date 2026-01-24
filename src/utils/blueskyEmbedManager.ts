// Global Bluesky Embed Manager
// Handles loading Bluesky's embed script once and processing all blockquotes together
// Prevents race conditions and ensures new embeds are processed

let scriptLoaded = false
let scriptLoadPromise: Promise<void> | null = null
let pendingBlockquotes = new Set<HTMLElement>()
let loadTimeout: NodeJS.Timeout | null = null
let lastLoadTime = 0
let reprocessTimeout: NodeJS.Timeout | null = null
const LOAD_DELAY = 500 // Wait 500ms to batch all blockquotes before loading script
const REPROCESS_COOLDOWN = 3000 // Don't reload script more than once every 3 seconds

/**
 * Registers a Bluesky blockquote element and ensures the script is loaded
 * The script will load once after a delay to batch all blockquotes together
 */
export function registerBlueskyBlockquote(blockquote: HTMLElement): void {
  if (!blockquote) return
  
  pendingBlockquotes.add(blockquote)
  
  // If script is already loaded, we need to trigger reprocessing
  // Bluesky's script doesn't automatically detect new blockquotes after initial load
  if (scriptLoaded) {
    console.log('[Bluesky Manager] Script already loaded, new blockquote registered - will trigger reprocess')
    // Clear any existing reprocess timeout
    if (reprocessTimeout) {
      clearTimeout(reprocessTimeout)
    }
    
    // Wait a bit for the blockquote to be fully in the DOM, then check if processing is needed
    reprocessTimeout = setTimeout(() => {
      checkAndReprocessIfNeeded()
    }, 300)
    return
  }
  
  // Script not loaded yet - schedule loading after delay to batch all blockquotes
  if (loadTimeout) {
    clearTimeout(loadTimeout)
  }
  
  loadTimeout = setTimeout(() => {
    loadBlueskyScript()
  }, LOAD_DELAY)
}

/**
 * Unregisters a blockquote (when component unmounts)
 */
export function unregisterBlueskyBlockquote(blockquote: HTMLElement): void {
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
    // Bluesky's script replaces the blockquote with an iframe or adds an iframe nearby
    const container = blockquote.parentElement || blockquote.closest('.bluesky-embed-container')
    if (!container) return true
    
    // Check multiple ways Bluesky might have processed it:
    // 1. Iframe as sibling or in parent
    const iframe = container.querySelector('iframe[src*="embed.bsky.app"]')
    if (iframe) return false
    
    // 2. Check if blockquote itself was replaced (Bluesky sometimes does this)
    if (!document.contains(blockquote)) return false
    
    // 3. Check if blockquote has been modified (Bluesky adds data attributes or classes)
    const hasBlueskyData = blockquote.hasAttribute('data-bluesky-processed') || 
                         blockquote.classList.contains('bluesky-embed-processed')
    
    return !hasBlueskyData && !iframe
  })
  
  if (unprocessed.length === 0) {
    console.log('[Bluesky Manager] All blockquotes are processed')
    return // All processed
  }
  
  // Some blockquotes aren't processed
  console.log(`[Bluesky Manager] ${unprocessed.length} blockquote(s) need processing`)
  
  // Check cooldown - but if we just registered a new blockquote, we should process it
  if (now - lastLoadTime < REPROCESS_COOLDOWN) {
    console.log('[Bluesky Manager] Cooldown active, but new blockquotes detected - will wait and retry')
    // Wait a bit more, then retry
    setTimeout(() => {
      checkAndReprocessIfNeeded()
    }, 1000)
    return
  }
  
  // Reload script to trigger processing of all blockquotes
  console.log(`[Bluesky Manager] Reloading script to process ${unprocessed.length} unprocessed blockquote(s)...`)
  lastLoadTime = Date.now()
  scriptLoaded = false
  scriptLoadPromise = null
  
  // Remove existing script
  const existingScript = document.querySelector('script[src*="embed.bsky.app"]')
  if (existingScript) {
    existingScript.remove()
  }
  
  // Reload the script
  loadBlueskyScript()
}

/**
 * Loads the Bluesky embed script
 */
function loadBlueskyScript(): void {
  if (scriptLoadPromise) {
    return // Already loading
  }
  
  const scriptSrc = 'https://embed.bsky.app/static/embed.js'
  
  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = scriptSrc
    script.async = true
    script.charset = 'utf-8'
    
    script.onload = () => {
      console.log('[Bluesky Manager] Script loaded successfully')
      scriptLoaded = true
      lastLoadTime = Date.now()
      
      // Wait a bit for Bluesky's script to process blockquotes
      setTimeout(() => {
        // Check if any blockquotes still need processing
        checkAndReprocessIfNeeded()
        resolve()
      }, 1000)
    }
    
    script.onerror = () => {
      console.error('[Bluesky Manager] Failed to load script')
      scriptLoadPromise = null
      scriptLoaded = false
      reject(new Error('Failed to load Bluesky embed script'))
    }
    
    document.head.appendChild(script)
  })
}
