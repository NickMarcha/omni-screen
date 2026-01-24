# Testing Guide

This document explains how to test different functionality in isolation.

## Modular Structure

The codebase is organized into modular components that can be tested independently:

### Embed Handlers (`src/utils/embedHandlers.ts`)

Embed functionality is separated into handler classes that implement the `EmbedHandler` interface:

- `TwitterEmbedHandler` - Handles Twitter/X embeds
- `TikTokEmbedHandler` - Handles TikTok embeds  
- `RedditEmbedHandler` - Handles Reddit embeds
- `EmbedHandlerFactory` - Factory for getting handlers by service name

Each handler can be tested independently without the full Electron app.

## Testing Embed Handlers

### Using the Test Script

You can test embed handlers directly using the test script:

```bash
# Test Twitter embed
npm run test:embeds -- twitter https://twitter.com/user/status/1234567890

# Test TikTok embed
npm run test:embeds -- tiktok https://www.tiktok.com/@user/video/1234567890

# Test Reddit embed
npm run test:embeds -- reddit https://www.reddit.com/r/test/comments/abc123/title/
```

### Unit Tests

Unit tests are located in `src/utils/__tests__/embedHandlers.test.ts`.

To run tests (requires a test framework like Vitest):

```bash
npm test -- embedHandlers
```

## Adding New Embed Handlers

1. Create a new class implementing `EmbedHandler`:

```typescript
export class NewServiceEmbedHandler implements EmbedHandler {
  getServiceName(): string {
    return 'NewService'
  }

  async fetchEmbed(url: string, options?: any): Promise<EmbedResult> {
    // Implementation
  }
}
```

2. Register it in `EmbedHandlerFactory`:

```typescript
EmbedHandlerFactory.registerHandler('newservice', new NewServiceEmbedHandler())
```

3. Add tests in `src/utils/__tests__/`

## Error Handling

All embed handlers return a consistent `EmbedResult` format:

```typescript
{
  success: boolean
  data?: { html: string }
  error?: string
}
```

Errors are descriptive and help users understand what went wrong:
- Age-restricted content
- Rate limiting
- Invalid URLs
- Network errors

## Future Modular Components

Consider extracting other functionality into testable modules:

- `src/utils/linkParsers.ts` - URL parsing and link type detection
- `src/utils/filters.ts` - Content filtering logic
- `src/utils/mentionsApi.ts` - Mentions API client
- `src/utils/settings.ts` - Settings management

Each module should:
- Have a clear interface
- Be testable in isolation
- Have corresponding test files
- Be documented
