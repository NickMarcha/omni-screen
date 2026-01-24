#!/usr/bin/env tsx
/**
 * Test script for embed handlers
 * 
 * Usage:
 *   npm run test:embeds -- twitter https://twitter.com/user/status/123
 *   npm run test:embeds -- tiktok https://www.tiktok.com/@user/video/123
 *   npm run test:embeds -- reddit https://www.reddit.com/r/test/comments/123
 * 
 * This allows you to test embed functionality in isolation
 */

import { EmbedHandlerFactory } from '../src/utils/embedHandlers'

async function main() {
  const service = process.argv[2]
  const url = process.argv[3]

  if (!service || !url) {
    console.error('Usage: npm run test:embeds -- <service> <url>')
    console.error('Services: twitter, tiktok, reddit')
    process.exit(1)
  }

  const handler = EmbedHandlerFactory.getHandler(service)
  if (!handler) {
    console.error(`Unknown service: ${service}`)
    process.exit(1)
  }

  console.log(`Testing ${handler.getServiceName()} embed handler...`)
  console.log(`URL: ${url}\n`)

  try {
    const result = await handler.fetchEmbed(url)
    
    if (result.success) {
      console.log('✅ Success!')
      console.log('HTML:', result.data?.html?.substring(0, 200) + '...')
    } else {
      console.log('❌ Failed!')
      console.log('Error:', result.error)
    }
  } catch (error) {
    console.error('Exception:', error)
    process.exit(1)
  }
}

main()
