/**
 * Embed Handler Utilities
 * 
 * This module contains utilities for handling different embed types.
 * It's designed to be modular and testable.
 */

export interface EmbedResult {
  success: boolean
  data?: { html: string }
  error?: string
}

export interface EmbedHandler {
  fetchEmbed(url: string, options?: any): Promise<EmbedResult>
  getServiceName(): string
}

/**
 * Twitter Embed Handler
 */
export class TwitterEmbedHandler implements EmbedHandler {
  getServiceName(): string {
    return 'Twitter'
  }

  async fetchEmbed(url: string, theme: 'light' | 'dark' = 'dark'): Promise<EmbedResult> {
    try {
      const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&theme=${theme}&dnt=true&omit_script=true`
      const response = await fetch(oembedUrl)
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        let errorMessage = `HTTP error! status: ${response.status}`
        
        if (response.status === 401 || response.status === 403) {
          errorMessage = 'Content may be age-restricted or require login. Try logging in to Twitter.'
        } else if (response.status === 404) {
          errorMessage = 'Tweet not found or may have been deleted.'
        } else if (response.status === 429) {
          errorMessage = 'Rate limit exceeded. Please try again later.'
        } else if (errorText.includes('suspended') || errorText.includes('unavailable')) {
          errorMessage = 'Tweet is unavailable or account is suspended.'
        }
        
        throw new Error(errorMessage)
      }
      
      const data = await response.json()
      return { success: true, data }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

/**
 * TikTok Embed Handler
 */
export class TikTokEmbedHandler implements EmbedHandler {
  getServiceName(): string {
    return 'TikTok'
  }

  async fetchEmbed(url: string): Promise<EmbedResult> {
    try {
      // Use TikTok's oEmbed API for better reliability and extra info
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      const response = await fetch(oembedUrl, {
        headers: {
          'Accept': 'application/json',
        }
      })
      
      if (!response.ok) {
        throw new Error(`TikTok oEmbed API error: ${response.status}`)
      }
      
      const data = await response.json()
      
      if (data.html) {
        // Remove the script tag from the HTML - we'll load it separately via scriptLoader
        let html = data.html
        const scriptMatch = html.match(/<script[^>]*>.*?<\/script>/i)
        if (scriptMatch) {
          html = html.replace(/<script[^>]*>.*?<\/script>/gi, '')
        }
        
        return { success: true, data: { html } }
      } else {
        throw new Error('TikTok oEmbed API did not return HTML')
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

/**
 * Reddit Embed Handler
 */
export class RedditEmbedHandler implements EmbedHandler {
  getServiceName(): string {
    return 'Reddit'
  }

  async fetchEmbed(url: string, theme: 'light' | 'dark' = 'dark'): Promise<EmbedResult> {
    try {
      // Try Reddit's oEmbed API first
      try {
        const oembedUrl = `https://www.reddit.com/oembed?url=${encodeURIComponent(url)}`
        const response = await fetch(oembedUrl)
        if (response.ok) {
          const data = await response.json()
          if (data.html) {
            return { success: true, data: { html: data.html } }
          }
        }
      } catch (oembedError) {
        // Fall through to manual construction
      }
      
      // Check if this is a media link
      const urlObj = new URL(url)
      if (urlObj.pathname === '/media' && urlObj.searchParams.has('url')) {
        throw new Error('Reddit media links cannot be embedded as Reddit posts')
      }
      
      // Manual construction
      const urlMatch = url.match(/\/r\/([^/]+)\/comments\/([^/]+)\/([^/]+)/)
      if (!urlMatch) {
        throw new Error('Invalid Reddit URL format')
      }
      
      const subreddit = urlMatch[1]
      const titleSlug = urlMatch[3]
      const title = decodeURIComponent(titleSlug.replace(/_/g, ' '))
      
      const blockquoteHtml = `<blockquote class="reddit-embed-bq" style="height:500px" data-embed-theme="${theme}" data-embed-height="500"><a href="${url}">${title}</a><br> by<a href="https://www.reddit.com/user/USER/">u/USER</a> in<a href="https://www.reddit.com/r/${subreddit}/">${subreddit}</a></blockquote>`
      
      return { success: true, data: { html: blockquoteHtml } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

/**
 * Embed Handler Factory
 */
export class EmbedHandlerFactory {
  private static handlers: Map<string, EmbedHandler> = new Map([
    ['twitter', new TwitterEmbedHandler()],
    ['tiktok', new TikTokEmbedHandler()],
    ['reddit', new RedditEmbedHandler()],
  ])

  static getHandler(service: string): EmbedHandler | null {
    return this.handlers.get(service.toLowerCase()) || null
  }

  static registerHandler(service: string, handler: EmbedHandler): void {
    this.handlers.set(service.toLowerCase(), handler)
  }
}
