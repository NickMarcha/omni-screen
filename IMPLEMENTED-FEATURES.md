# Implemented Features

This document outlines all features that have been implemented in the Omni Screen application, along with the current technical structure.

## Link Scroller Feature

The Link Scroller is the primary feature of the application, allowing users to browse through links shared in Destiny.gg chat mentions.

### Core Functionality

#### Mentions API Integration
- **Endpoint**: `https://polecat.me/api/mentions/{username}?size=150&offset=0`
- **Default Filter**: `mrMouton`
- **Pagination**: Infinite scrolling with `offset` parameter
- **Data Processing**: 
  - Each mention receives a unique ID (SHA-256 hash of date + username)
  - Mentions are sorted by date (newest first)
  - Cache-busting headers ensure fresh data on refresh

#### Link Detection and Processing
- **URL Extraction**: Automatically extracts URLs from mention text
- **Link Types Supported**:
  - Direct media (images: JPG, PNG, GIF, WebP, BMP, SVG)
  - Direct videos (MP4, WebM, OGG, MOV, AVI, MKV)
  - YouTube (including Shorts)
  - Twitter/X (tweet status links only)
  - TikTok (video links)
  - Reddit (post links)
  - Imgur (album/gallery links)
  - Generic links (fallback)

#### Display Modes

**Overview Mode** (Default):
- Grid/list view of all link cards
- Each card shows:
  - Link type icon
  - Preview text (truncated)
  - Username who posted
  - Click to enter highlight mode
- Infinite scrolling with "Load More" button as safeguard
- Auto-loads more content if viewport isn't filled

**Highlight Mode** (70/30 Split):
- **Left Panel (70%)**: Full content display
  - Embedded media (YouTube, Twitter, TikTok, Reddit, Imgur)
  - Direct images/videos with autoplay controls
  - Text content with clickable links
  - User info and timestamp in rounded dark grey box
  - Clickable username linking to RustleSearch
- **Right Sidebar (30%)**: Scrollable list of all cards
  - Smaller card previews
  - Current card highlighted with ring
  - Auto-scrolls to keep highlighted card visible
  - Icons for link types (vertical "Link" text for generic links)
- **Navigation Controls**:
  - Previous/Next arrows
  - Counter showing current position (e.g., "5 / 150")
  - Autoplay toggle (affects videos and YouTube embeds)
  - Mute toggle (only visible when autoplay is enabled)
  - Smart navigation:
    - At end + Next → Loads more content
    - At beginning + Previous → Refreshes feed with latest

### Filtering and Settings

#### Settings Modal
Accessible via floating cog button (bottom-right):
- **Username Filter**: Filter mentions by specific username
- **Show NSFW**: Toggle to show/hide NSFW content
- **Show NSFL**: Toggle to show/hide NSFL content
- **Banned Terms**: List of terms that filter out messages
- **Banned Users**: List of usernames whose messages are filtered
- **Disabled Platforms**: Checkboxes to disable specific platforms (YouTube, Twitter, TikTok, Reddit, Kick, Twitch, Streamable, Imgur)
- **Trusted Users**: List of users whose cards have brighter background

#### Settings Persistence
- All settings saved to `localStorage`
- Automatically loaded on application start
- Migration logic handles changes in settings structure

### Embed Support

#### YouTube Embeds
- Supports various URL formats:
  - `youtube.com/watch?v=VIDEO_ID`
  - `youtu.be/VIDEO_ID`
  - `youtube.com/shorts/VIDEO_ID`
  - `youtube.com/embed/VIDEO_ID`
- Features:
  - `rel=0` parameter to prevent related videos
  - Autoplay support (`autoplay=1`)
  - Mute support (`mute=1`)
  - Component: `src/components/embeds/YouTubeEmbed.tsx`

#### Twitter/X Embeds
- **Detection**: Only tweet status links (`/status/ID`), not profile links
- **Implementation**:
  - Uses hidden `BrowserView` in main process to bypass CORS
  - Fetches oEmbed HTML or extracts from DOM
  - Dynamically loads `widgets.js` script
  - Uses `twttr.widgets.createTweet()` for rendering
  - Handles age-restricted content via persistent session
- **Height Adjustment**: 
  - Listens for `twttr.private.resize` postMessage events
  - Extracts height from `params[0].height`
  - Automatically adjusts iframe height
  - **Critical Fix**: Uses `event.source === iframe.contentWindow` to ensure each embed only processes messages from its own iframe
  - Prevents all embeds from getting the same height when multiple embeds are present
- **Component**: `src/components/embeds/TwitterEmbed.tsx`

**Height Adjustment Troubleshooting (What Worked vs. What Didn't)**:
- ❌ **Didn't Work**: Trying to match messages using `embedId` or `tweetId` from message params - Twitter's resize messages don't include these identifiers
- ❌ **Didn't Work**: Height-based heuristics comparing message height to current heights - all embeds would accept the first message since none had heights yet
- ❌ **Didn't Work**: Complex proximity matching algorithms - too unreliable and caused all embeds to get the same height
- ✅ **What Worked**: Using `event.source` property to directly match messages to the correct iframe's `contentWindow`
  - Each embed component checks `if (event.source !== iframe.contentWindow) return` before processing
  - This ensures each embed only processes messages sent from its own iframe
  - Simple, reliable, and prevents cross-contamination between embeds

#### TikTok Embeds
- **Detection**: Video links (`/@username/video/ID`)
- **Implementation**:
  - Manually constructs blockquote HTML
  - Dynamically loads `embed.js` script
  - Suppresses console errors from TikTok SDK
- **Component**: `src/components/embeds/TikTokEmbed.tsx`

#### Reddit Embeds
- **Detection**: Post links (`/r/SUBREDDIT/comments/POST_ID/TITLE`)
- **Implementation**:
  - Tries Reddit's oEmbed API first
  - Falls back to manual blockquote construction
  - Dynamically loads `embed.reddit.com/widgets.js`
- **Component**: `src/components/embeds/RedditEmbed.tsx`

#### Imgur Albums
- **Detection**: Album/gallery links (`/a/ID` or `/gallery/ID`)
- **Implementation**:
  - Uses Imgur API: `https://api.imgur.com/post/v1/albums/{albumId}?client_id=d70305e7c3ac5c6&include=media%2Cadconfig%2Caccount%2Ctags`
  - Extracts album ID (case-sensitive) from URL
  - Returns album data with:
    - Title and description
    - Array of media items (images/videos)
    - Each item includes URL, description, dimensions, type
  - Falls back to BrowserView extraction if API fails
- **IPC Handler**: `fetch-imgur-album` in `electron/main.ts`
- **Display**: Shows all images/videos in album with descriptions

#### Direct Media Embeds
- **Images**: Component `src/components/embeds/ImageEmbed.tsx`
- **Videos**: Component `src/components/embeds/VideoEmbed.tsx`
  - Supports autoplay and mute controls
  - Different behavior in highlight vs overview mode

### UI Components

#### Floating Action Buttons
- **Location**: Fixed bottom-right corner
- **Refresh Button**: 
  - Resets feed and fetches from beginning
  - In highlight mode: scrolls content to top instead of exiting
- **Settings Button**: Opens settings modal

#### List Manager Component
- Reusable component for managing lists (banned terms, banned users, trusted users)
- Features:
  - Add items
  - Remove items
  - Placeholder text
  - Help text
- Component: `src/components/ListManager.tsx`

## Technical Architecture

### Electron Main Process (`electron/main.ts`)

#### IPC Handlers

**`fetch-mentions`**:
- Fetches mentions from polecat.me API
- Bypasses CORS restrictions
- Logs extensive debugging information
- Adds unique ID to each mention
- Returns sorted data (newest first)

**`fetch-twitter-embed`**:
- Creates hidden `BrowserView` with persistent session
- Loads tweet page directly
- Executes JavaScript in page context to fetch oEmbed or extract from DOM
- Returns embed HTML for rendering

**`fetch-tiktok-embed`**:
- Manually constructs TikTok embed HTML
- Returns blockquote structure

**`fetch-reddit-embed`**:
- Tries Reddit oEmbed API
- Falls back to manual construction
- Returns embed HTML

**`fetch-imgur-album`**:
- Extracts album ID from URL (case-sensitive)
- Calls Imgur API directly
- Falls back to BrowserView extraction if needed
- Returns structured album data

**`open-login-window`**:
- Opens new window for service login (Twitter, TikTok, Reddit)
- Uses persistent session partition
- Detects successful login via navigation events

#### Session Management
- **Persistent Session**: `session.fromPartition('persist:main')`
- Cookies persist across application restarts
- Shared between main window and login windows
- Enables authenticated embed fetching

#### BrowserView Usage
- Hidden `BrowserView` instances for:
  - Twitter embed fetching (bypasses CORS)
  - Imgur album extraction (fallback)
- Configured with persistent session
- Automatically cleaned up after use

### React Components Structure

#### Main Component
- **`src/components/LinkScroller.tsx`**: Main component (~1600 lines)
  - State management for mentions, settings, highlight view
  - Link processing and filtering logic
  - Render logic for both overview and highlight modes

#### Embed Components (`src/components/embeds/`)
- **`TwitterEmbed.tsx`**: Twitter/X tweet embeds
- **`YouTubeEmbed.tsx`**: YouTube video embeds
- **`TikTokEmbed.tsx`**: TikTok video embeds
- **`RedditEmbed.tsx`**: Reddit post embeds
- **`ImageEmbed.tsx`**: Direct image embeds
- **`VideoEmbed.tsx`**: Direct video embeds

#### Utility Components
- **`ListManager.tsx`**: Reusable list management component

### State Management

#### Settings State
- Stored in `localStorage`
- Structure:
  ```typescript
  {
    filter: string
    showNSFW: boolean
    showNSFL: boolean
    bannedTerms: string[]
    bannedUsers: string[]
    disabledPlatforms: string[]
    trustedUsers: string[]
  }
  ```

#### Link Cards State
- Processed from raw mentions via `useMemo`
- Applies all filters (NSFW, NSFL, banned terms, banned users, disabled platforms)
- Detects embeddable content
- Marks trusted users
- Generates unique IDs

### Data Flow

1. **Initial Load**:
   - Component mounts → Loads settings from localStorage
   - `useEffect` triggers `fetchMentions` with default filter
   - Mentions processed into `linkCards` via `useMemo`

2. **Link Processing**:
   - URLs extracted from mention text
   - Each URL analyzed for type (direct media, YouTube, Twitter, etc.)
   - LinkCard objects created with metadata
   - Filters applied (NSFW, NSFL, banned terms/users, disabled platforms)

3. **Highlight Mode**:
   - User clicks card → `setHighlightedCardId(card.id)`
   - Component re-renders with highlight layout
   - If embed type (Twitter, TikTok, Reddit, Imgur), IPC handler called
   - Embed component renders with fetched data
   - Sidebar auto-scrolls to highlighted card

4. **Navigation**:
   - Arrow buttons call `navigateHighlight(direction)`
   - At end + next → Loads more content
   - At beginning + prev → Refreshes feed
   - Auto-advances after loading completes

### Error Handling

#### Console Error Suppression
- Global overrides for `console.error` and `console.warn`
- Suppresses specific errors:
  - TikTok SDK errors
  - Chrome cookie warnings
  - Autofill API errors

#### Embed Error Handling
- Each embed component shows error messages
- "Login to [Service]" buttons for authentication issues
- Retry functionality
- Detailed error logging

### Performance Optimizations

- **useMemo**: Link cards processed only when dependencies change
- **useCallback**: Functions memoized to prevent unnecessary re-renders
- **Lazy Loading**: Embeds only fetched when card is highlighted
- **Infinite Scrolling**: Loads content on-demand

### Logging

#### Renderer Process Logging
- All IPC calls logged with timing
- State changes logged
- Navigation actions logged

#### Main Process Logging
- API calls logged with full details
- Response status and timing
- Error details with stack traces
- Cookie monitoring for authentication

## File Structure

```
omni-screen/
├── electron/
│   ├── main.ts              # Main process, IPC handlers
│   ├── preload.ts           # IPC bridge to renderer
│   └── update.ts            # Auto-update logic
├── src/
│   ├── components/
│   │   ├── LinkScroller.tsx        # Main component
│   │   ├── ListManager.tsx         # List management UI
│   │   └── embeds/
│   │       ├── TwitterEmbed.tsx
│   │       ├── YouTubeEmbed.tsx
│   │       ├── TikTokEmbed.tsx
│   │       ├── RedditEmbed.tsx
│   │       ├── ImageEmbed.tsx
│   │       └── VideoEmbed.tsx
│   ├── assets/
│   │   └── icons/
│   │       └── third-party/         # Platform icons
│   ├── utils/
│   │   └── embedHandlers.ts        # Embed utilities
│   └── main.tsx                    # React entry point
└── package.json
```

## Future Enhancements (Not Yet Implemented)

- Split-screen mode for multiple feeds
- Unified chat integration
- Additional embed types (Kick, Twitch, Streamable)
- Search functionality
- Bookmarking/favorites
- Export functionality

## Known Limitations

1. **Twitter Embeds**: 
   - Height adjustment now works correctly using `event.source` matching (fixed in v1.1.1)
   - May require login for age-restricted content
   - Some edge cases with React re-rendering

2. **Imgur Albums**:
   - API requires valid client_id (currently using public one)
   - Fallback extraction may fail for some album types

3. **Reddit Embeds**:
   - Media links (`/media?url=`) are not embedded as Reddit posts
   - Some subreddits may have restricted embeds

4. **Performance**:
   - Large numbers of mentions may impact rendering
   - Embed loading is sequential (could be parallelized)

## Development Notes

### Testing
- Modular testing structure in `scripts/test-embeds.ts`
- Unit tests in `src/utils/__tests__/embedHandlers.test.ts`
- Documentation in `docs/TESTING.md`

### Configuration
- Settings persisted in browser localStorage
- No external config files required
- All settings accessible via UI

### Dependencies
- React + TypeScript
- Electron
- Tailwind CSS + DaisyUI
- Vite for build tooling
