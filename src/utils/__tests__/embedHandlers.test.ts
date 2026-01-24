/**
 * Tests for Embed Handlers
 * 
 * Run with: npm test -- embedHandlers
 * 
 * This demonstrates how to test embed functionality in isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TwitterEmbedHandler,
  TikTokEmbedHandler,
  RedditEmbedHandler,
  EmbedHandlerFactory,
} from '../embedHandlers'

// Mock fetch globally
global.fetch = vi.fn()

describe('TwitterEmbedHandler', () => {
  const handler = new TwitterEmbedHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch Twitter embed successfully', async () => {
    const mockResponse = {
      html: '<blockquote>Test tweet</blockquote>',
    }

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const result = await handler.fetchEmbed('https://twitter.com/user/status/123')

    expect(result.success).toBe(true)
    expect(result.data).toEqual(mockResponse)
  })

  it('should handle 403 error (age-restricted)', async () => {
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => '',
    })

    const result = await handler.fetchEmbed('https://twitter.com/user/status/123')

    expect(result.success).toBe(false)
    expect(result.error).toContain('age-restricted')
  })
})

describe('TikTokEmbedHandler', () => {
  const handler = new TikTokEmbedHandler()

  it('should extract video ID and username from URL', async () => {
    const result = await handler.fetchEmbed('https://www.tiktok.com/@user/video/1234567890')

    expect(result.success).toBe(true)
    expect(result.data?.html).toContain('data-video-id="1234567890"')
    expect(result.data?.html).toContain('@user')
  })

  it('should handle invalid URL format', async () => {
    const result = await handler.fetchEmbed('https://www.tiktok.com/invalid')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid TikTok URL')
  })
})

describe('RedditEmbedHandler', () => {
  const handler = new RedditEmbedHandler()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should construct Reddit embed from URL', async () => {
    // Mock oEmbed to fail, so it falls back to manual construction
    ;(global.fetch as any).mockResolvedValueOnce({
      ok: false,
    })

    const result = await handler.fetchEmbed(
      'https://www.reddit.com/r/test/comments/abc123/test_title/'
    )

    expect(result.success).toBe(true)
    expect(result.data?.html).toContain('test')
    expect(result.data?.html).toContain('abc123')
  })

  it('should handle media links', async () => {
    const result = await handler.fetchEmbed('https://www.reddit.com/media?url=test')

    expect(result.success).toBe(false)
    expect(result.error).toContain('media links cannot be embedded')
  })
})

describe('EmbedHandlerFactory', () => {
  it('should return correct handler for service', () => {
    const handler = EmbedHandlerFactory.getHandler('twitter')
    expect(handler).toBeInstanceOf(TwitterEmbedHandler)
  })

  it('should return null for unknown service', () => {
    const handler = EmbedHandlerFactory.getHandler('unknown')
    expect(handler).toBeNull()
  })
})
