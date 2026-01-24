// Utility to safely load external scripts only once
// Prevents multiple embeds from interfering with each other

interface ScriptLoadState {
  loading: boolean
  loaded: boolean
  error: boolean
  promise?: Promise<void>
}

const scriptStates = new Map<string, ScriptLoadState>()

/**
 * Clears the script state for a given script ID
 * This allows the script to be reloaded even if it was previously loaded
 */
export function clearScriptState(scriptId: string): void {
  scriptStates.delete(scriptId)
}

// Debounce map for script reloads
const reloadTimeouts = new Map<string, NodeJS.Timeout>()

/**
 * Debounced script reload - ensures only one reload happens within a time window
 * Useful for scripts that need to reprocess DOM (like Reddit)
 * 
 * @param waitForBlockquotes - If true, waits for all blockquotes to be in DOM before reloading
 */
export function debouncedReloadScript(
  src: string, 
  scriptId: string, 
  delay: number = 300,
  waitForBlockquotes: boolean = false
): Promise<void> {
  // Clear any existing timeout for this script
  const existingTimeout = reloadTimeouts.get(scriptId)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
  }
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reloadTimeouts.delete(scriptId)
      
      const doReload = () => {
        // Remove existing script if present
        const existingScript = document.querySelector(`script[src="${src}"]`)
        if (existingScript) {
          existingScript.remove()
        }
        
        // Clear the script state
        clearScriptState(scriptId)
        
        // Reload the script
        loadScriptOnce(src, scriptId)
          .then(resolve)
          .catch(reject)
      }
      
      if (waitForBlockquotes && src.includes('reddit.com/widgets.js')) {
        // Wait for all Reddit blockquotes to be in DOM
        const checkBlockquotes = () => {
          const allBlockquotes = document.querySelectorAll('blockquote.reddit-embed-bq')
          const processedBlockquotes = document.querySelectorAll('blockquote.reddit-embed-bq + iframe, iframe[src*="embed.reddit.com"]')
          
          // If we have blockquotes but no iframes, they need processing
          if (allBlockquotes.length > 0 && processedBlockquotes.length < allBlockquotes.length) {
            console.log(`[Reddit] Found ${allBlockquotes.length} blockquotes, ${processedBlockquotes.length} processed. Reloading script...`)
            doReload()
          } else if (allBlockquotes.length === 0) {
            // No blockquotes yet, wait a bit more
            setTimeout(checkBlockquotes, 200)
          } else {
            // All blockquotes are processed, no need to reload
            console.log(`[Reddit] All ${allBlockquotes.length} blockquotes are already processed`)
            resolve()
          }
        }
        
        // Start checking after a short delay
        setTimeout(checkBlockquotes, 100)
      } else {
        doReload()
      }
    }, delay)
    
    reloadTimeouts.set(scriptId, timeout)
  })
}

// Expose script states for clearing when needed
if (typeof window !== 'undefined') {
  (window as any).__redditScriptStates = scriptStates
}

/**
 * Loads a script only once, even if called multiple times
 * Returns a promise that resolves when the script is loaded
 */
export function loadScriptOnce(src: string, id?: string): Promise<void> {
  const scriptId = id || src
  
  // Check if already loaded
  const existingState = scriptStates.get(scriptId)
  if (existingState?.loaded) {
    return Promise.resolve()
  }
  
  // Check if currently loading
  if (existingState?.loading && existingState.promise) {
    return existingState.promise
  }
  
  // Check if script element already exists in DOM
  const existingScript = document.querySelector(`script[src="${src}"]`)
  if (existingScript) {
    // Script tag exists, wait for it to load
    const state: ScriptLoadState = {
      loading: true,
      loaded: false,
      error: false
    }
    
    const promise = new Promise<void>((resolve) => {
      // Check if script is already loaded (check for global objects)
      if (src.includes('twitter.com/widgets.js') && (window as any).twttr) {
        state.loaded = true
        state.loading = false
        scriptStates.set(scriptId, state)
        resolve()
        return
      }
      
      // Wait a bit for script to finish loading
      const checkInterval = setInterval(() => {
        if (src.includes('twitter.com/widgets.js') && (window as any).twttr) {
          clearInterval(checkInterval)
          state.loaded = true
          state.loading = false
          scriptStates.set(scriptId, state)
          resolve()
        }
      }, 100)
      
      setTimeout(() => {
        clearInterval(checkInterval)
        if (!state.loaded) {
          // Assume it's loaded if we can't detect it
          state.loaded = true
          state.loading = false
          scriptStates.set(scriptId, state)
          resolve()
        }
      }, 2000)
    })
    
    state.promise = promise
    scriptStates.set(scriptId, state)
    return promise
  }
  
  // Create new script
  const state: ScriptLoadState = {
    loading: true,
    loaded: false,
    error: false
  }
  
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.charset = 'utf-8'
    
    script.onload = () => {
      state.loaded = true
      state.loading = false
      scriptStates.set(scriptId, state)
      resolve()
    }
    
    script.onerror = () => {
      state.error = true
      state.loading = false
      scriptStates.set(scriptId, state)
      reject(new Error(`Failed to load script: ${src}`))
    }
    
    // Append to head (better than body for embed scripts)
    document.head.appendChild(script)
  })
  
  state.promise = promise
  scriptStates.set(scriptId, state)
  return promise
}

/**
 * Triggers a script to reprocess the DOM (for scripts that auto-detect embeds)
 * Only works for scripts that support this pattern
 */
export function triggerScriptReprocess(src: string): void {
  if (src.includes('tiktok.com/embed.js')) {
    // TikTok's script auto-processes blockquotes, but we can trigger it
    // by dispatching a custom event or waiting for it to detect changes
    // The script should automatically detect new blockquotes
    return
  }
  
  if (src.includes('reddit.com/widgets.js')) {
    // Reddit's script should auto-process, but we can try to trigger it
    // by dispatching a DOMContentLoaded-like event or waiting
    return
  }
  
  if (src.includes('twitter.com/widgets.js')) {
    // Twitter requires explicit createTweet calls, so no reprocess needed
    return
  }
}
