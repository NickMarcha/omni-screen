# Implemented Features

This document outlines all features that have been implemented in the Omni Screen application, along with the current technical structure.

## OmniScreen Feature (main feature)

OmniScreen is the main feature: a split-screen view with Destiny.gg chat (via combined chat), live stream embeds (YouTube, Kick, Twitch), and a unified combined chat feed from all platforms.

### Core Functionality

#### Split-screen layout
- **Left/center**: Resizable chat pane (combined chat only; DGG is included in combined chat)
- **Center**: Embed grid + dock of live streams
- **Resizable**: Drag the divider to resize chat vs content area

#### Live embeds
- **Sources**: Embeds come from the DGG live WebSocket (`dggApi:embeds`, `dggApi:streamInfo`) and/or manual paste (Add link)
- **Dock**: Bottom dock lists available streams; click to show in grid. Each dock button can represent a single stream or a grouped streamer (YouTube + Kick + Twitch)
- **Add link**: Paste a YouTube/Kick/Twitch URL to add an embed (optional “live only” check via `url-is-live` IPC)
- **Pinned streamers**: Configure streamers (nickname + YouTube channel ID, Kick slug, Twitch login). Embeds for that streamer are grouped under one dock button. Hover shows all platforms with video/chat toggles and embed stats (viewers, embed count)
- **Pie chart (What’s being watched)**: Button in the embed dock opens a popup with a pie chart of who is watching what, using data from the embeds WebSocket only (sum of embed counts per stream; no “Not watching” slice). Tooltip floats above the chart; labels are not cut off (viewBox + width); chart centered in popup
- **Polling**: Pinned streamers’ YouTube/Kick/Twitch channels can be polled for live status; when live, embeds are added automatically
- **YouTube “live only”**: Add by YouTube channel URL only if the channel is currently live (uses `youtube-live-or-latest` + DGG embed list heuristic)

#### Combined chat
- **Unified feed**: Single scrollable list of messages from DGG, YouTube, Kick, and Twitch (for enabled chats)
- **Per-embed chat toggles**: Enable/disable each platform’s chat in the combined view via dock hover or settings
- **Settings**: Max messages, show timestamps, source labels, sort by timestamp or arrival, YouTube poll delay multiplier
- **Highlight term**: Optional text filter; messages whose **text** contains the term (case-insensitive) get a light blue background (e.g. your username)
- **Components**: `CombinedChat.tsx` consumes messages from main process (IPC events for DGG, YouTube, Kick, Twitch chat)
- **DGG private messages (whispers)**: The list of users who have whispered you is **persisted in localStorage** (`omni-screen:dgg-whisper-usernames`). Users are added when: (1) the app fetches unread via `GET /api/messages/unread` on first load when DGG chat is authenticated, (2) a WebSocket PRIVMSG event is received, (3) you send a whisper from the list view **only if** the subsequent **inbox fetch** (`GET /api/messages/usr/:username/inbox`) succeeds—otherwise the fields are just cleared. Users are **removed only** when you hit **Clear**. The 📫/📬 button is **always clickable** and opens the whisper list. In the list view, at the bottom: **"Whisper To"** field (combobox: suggestions from whisper list + DGG nicks, or type any username) and message field (placeholder "whisper message..", disabled until a recipient is entered). After sending a whisper we fetch inbox for that recipient; **only if that fetch succeeds** do we add the user to the list and open the conversation. Click a user in the list to view the conversation (inbox via `GET /api/messages/usr/:username/inbox`). In the conversation view, a **sticky "← Back"** header stays visible. Whispers are sent via the **chat WebSocket** (`PRIVMSG {"nick","data"}`). Per-user unread count and total badge on 📫/📬; send error shown above the recipient field when relevant.
- **Poll (DGG)**: POLLSTART/POLLSTOP/vote-counted/poll-vote-error handled. If POLLSTART is for an already-ended poll (e.g. from HISTORY), it is shown as ended and the 15s dismiss timer runs; when the countdown reaches 0, the poll is marked over so it dismisses even if POLLSTOP is never received. Time left uses server time with support for `poll.start` / `poll.now` as Unix seconds. Vote feedback: "Sending vote…" and disabled buttons while pending; errors (e.g. "Already voted") shown. Logging in main and renderer for poll events and vote attempts.
- **Combo rendering**: Consecutive single-emote messages (DGG or Kick) are grouped into a "C-C-C-COMBO" row. DGG combo emotes use the same rendering as message emotes (no fixed size; `.msg-chat.msg-emote .emote { flex-shrink: 0 }` in App.css).

#### DGG integration
- **Chat WebSocket**: `electron/chatWebSocket.ts` — connects to `wss://chat.destiny.gg/ws`, parses MSG, JOIN, QUIT, HISTORY, PIN, MUTE, UNMUTE, PRIVMSG, POLLSTART, POLLSTOP, VOTECAST, VOTECOUNTED, ERR (poll vote error), etc. Forwards to renderer via IPC (`chat-websocket-message`, `chat-websocket-privmsg`, `chat-websocket-poll-start`, etc.). DGG chat is shown in the combined chat pane only.
- **Live WebSocket**: `electron/liveWebSocket.ts` — connects to `wss://live.destiny.gg/`, receives `dggApi:embeds`, `dggApi:streamInfo`, `dggApi:bannedEmbeds`, etc. Drives the embed list and dock
- **DGG messages API**: IPC handlers `dgg-send-whisper` (sends via chat WebSocket as `PRIVMSG {"nick","data"}` when connected), `dgg-messages-unread` (GET `/api/messages/unread`), `dgg-messages-inbox` (GET `/api/messages/usr/:username/inbox`); unread and inbox use session cookies from `persist:main`

### OmniScreen technical notes

- **Main UI**: `src/components/OmniScreen.tsx` — chat pane, embed grid, dock, pinned streamers modal, combined chat settings
- **Combined chat**: `src/components/CombinedChat.tsx` — receives `highlightTerm`, `showTimestamps`, `showSourceLabels`, `sortMode`, etc.; renders message list with platform badges and optional highlight
- **IPC / main**: Chat and live WebSockets registered in `electron/main.ts`; handlers for `youtube-chat-set-targets`, `kick-chat-*`, `twitch-chat-*`, `url-is-live`, `youtube-live-or-latest`
- **YouTube chat**: `electron/youtubeChatManager.ts` — polls YouTube live chat API using continuation token from live_chat or watch page; fallback to watch page when live_chat page doesn’t include continuation
- **Persistence**: Combined chat settings (including highlight term, YT poll multiplier) and pinned streamers saved to localStorage

---

## Link Scroller Feature

The Link Scroller allows users to browse through links shared in Destiny.gg chat mentions.

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
  - Bluesky (post links)
  - Kick (stream links)
  - Twitch (stream links)
  - Streamable (video links)
  - Wikipedia (article links)
  - LSF (LivestreamFail post links)
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
Accessible via floating cog button (bottom-right) with three tabs:

**Filtering Tab**:
- **Filter Terms**: List of usernames/terms to filter mentions by (supports multiple terms)
- **Show NSFW**: Toggle to show/hide NSFW content
- **Show NSFL**: Toggle to show/hide NSFL content
- **Show Non-Links**: Toggle to include messages without links in the feed
- **Banned Terms**: List of terms that filter out messages
- **Banned Users**: List of usernames whose messages are filtered
- **Trusted Users**: List of users whose cards have a golden outline
- **Muted Users**: List of users temporarily filtered out for 24 hours (with expiration timestamps)
- **Platform Display Modes**: Per-platform settings (embed/text/filter) for:
  - YouTube, Twitter, TikTok, Reddit, Kick, Twitch, Streamable, Imgur, Wikipedia, Bluesky, LSF

**Keybinds Tab**:
- Customizable keyboard shortcuts for:
  - Navigation (previous/next card)
  - View mode switching
  - Settings toggle
  - Refresh feed
  - And more...

**Theme Tab**:
- **Theme Mode**: System/light/dark theme selection
- **Light Theme**: Choose light theme variant
- **Dark Theme**: Choose dark theme variant
- **Embed Theme**: Follow system, light, or dark for embeds

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
  - Automatic CORS bypass via proxy for blocked domains (4cdn.org, imgur.com, etc.)
  - Falls back to IPC proxy handler when direct loading fails
  - Supports all common image formats
- **Videos**: Component `src/components/embeds/VideoEmbed.tsx`
  - Supports autoplay and mute controls
  - Different behavior in highlight vs overview mode

#### Bluesky Embeds
- **Detection**: Post links (`bsky.app/profile/.../post/...`)
- **Implementation**:
  - Uses Bluesky oEmbed API: `https://embed.bsky.app/oembed`
  - Dynamically loads embed script
  - Component: `src/components/embeds/BlueskyEmbed.tsx`

#### Kick Embeds
- **Detection**: Stream links (`kick.com/username`)
- **Implementation**:
  - Embedded iframe support
  - Autoplay and mute controls
  - Component: `src/components/embeds/KickEmbed.tsx`

#### Streamable Embeds
- **Detection**: Video links (`streamable.com/...`)
- **Implementation**:
  - Embedded iframe support
  - Autoplay, mute, and loop controls
  - Component: `src/components/embeds/StreamableEmbed.tsx`

#### Wikipedia Embeds
- **Detection**: Article links (`wikipedia.org/wiki/...`)
- **Implementation**:
  - Embedded iframe support
  - Component: `src/components/embeds/WikipediaEmbed.tsx`

#### LSF (LivestreamFail) Embeds
- **Detection**: Post links (`livestreamfails.com/post/...`)
- **Implementation**:
  - Embedded iframe support
  - Autoplay and mute controls
  - Component: `src/components/embeds/LSFEmbed.tsx`

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

**`fetch-image`**:
- Proxies image requests through main process to bypass CORS
- Sets appropriate Referer headers for different image CDNs (4cdn.org, imgur.com, twimg.com)
- Returns images as base64 data URLs
- Used as fallback when direct image loading fails

**`open-login-window`**:
- Opens new window for service login (Twitter, TikTok, Reddit)
- Uses persistent session partition
- Detects successful login via navigation events

#### Session Management
- **Persistent Session**: `session.fromPartition('persist:main')`
- Cookies persist across application restarts
- Shared between main window and login windows
- Enables authenticated embed fetching

#### WebRequest Handlers
- **YouTube**: Sets Referer headers for YouTube API compliance
- **Image CDNs**: Sets appropriate Referer headers for 4cdn.org, imgur.com, twimg.com to bypass CORS
- **Reddit**: Modifies CSP headers to allow embeds from file:// protocol

#### BrowserView Usage
- Hidden `BrowserView` instances for:
  - Twitter embed fetching (bypasses CORS)
  - Imgur album extraction (fallback)
- Configured with persistent session
- Automatically cleaned up after use

### React Components Structure

#### OmniScreen / Combined Chat
- **`src/components/OmniScreen.tsx`**: Main OmniScreen UI
  - Split-screen layout (chat pane + embed grid), dock, pinned streamers modal
  - Combined chat settings (highlight term, timestamps, labels, sort, YT poll multiplier)
  - Subscribes to DGG/YouTube/Kick/Twitch chat via IPC; passes messages to CombinedChat
- **`src/components/CombinedChat.tsx`**: Combined chat feed
  - Receives messages from OmniScreen (DGG, YouTube, Kick, Twitch)
  - Renders unified list with platform badges, timestamps, optional highlight term (light blue background on matching message text)

#### Link Scroller
- **`src/components/LinkScroller.tsx`**: Link Scroller component
  - State management for mentions, settings, highlight view
  - Link processing and filtering logic
  - Render logic for both overview and highlight modes

#### Embed Components (`src/components/embeds/`)
- **`TwitterEmbed.tsx`**: Twitter/X tweet embeds
- **`YouTubeEmbed.tsx`**: YouTube video embeds
- **`TikTokEmbed.tsx`**: TikTok video embeds
- **`RedditEmbed.tsx`**: Reddit post embeds
- **`BlueskyEmbed.tsx`**: Bluesky post embeds
- **`KickEmbed.tsx`**: Kick stream embeds
- **`StreamableEmbed.tsx`**: Streamable video embeds
- **`WikipediaEmbed.tsx`**: Wikipedia article embeds
- **`LSFEmbed.tsx`**: LivestreamFail post embeds
- **`ImageEmbed.tsx`**: Direct image embeds (with CORS proxy support)
- **`VideoEmbed.tsx`**: Direct video embeds

#### Utility Components
- **`ListManager.tsx`**: Reusable list management component

### State Management

#### Settings State
- Stored in `localStorage`
- Structure:
  ```typescript
  {
    filter: string[]  // Array of usernames/terms
    showNSFW: boolean
    showNSFL: boolean
    showNonLinks: boolean
    bannedTerms: string[]
    bannedUsers: string[]
    platformSettings: Record<string, PlatformDisplayMode>  // 'embed' | 'text' | 'filter'
    trustedUsers: string[]
    mutedUsers?: MutedUser[]  // With expiration timestamps
    keybinds: Keybind[]
    theme: ThemeSettings  // { mode, lightTheme, darkTheme, embedTheme }
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
│   ├── main.ts              # Main process, IPC handlers, chat/live WebSockets
│   ├── preload.ts           # IPC bridge to renderer
│   ├── update.ts            # Auto-update logic
│   ├── chatWebSocket.ts     # DGG chat WebSocket (MSG, JOIN, UNMUTE, etc.)
│   ├── liveWebSocket.ts     # DGG live WebSocket (embeds, streamInfo)
│   ├── youtubeChatManager.ts # YouTube live chat polling
│   ├── kickChatManager.ts   # Kick chat (Pusher)
│   ├── twitchChatManager.ts # Twitch IRC chat
│   ├── youtubeLiveOrLatest.ts # YouTube channel/video live detection
│   ├── urlIsLive.ts         # URL live check (YouTube/Kick/Twitch)
│   ├── mentionCache.ts     # Mention cache for Link Scroller
│   └── fileLogger.ts       # Session log files
├── src/
│   ├── components/
│   │   ├── OmniScreen.tsx         # Main OmniScreen (split-screen, dock, combined chat)
│   │   ├── CombinedChat.tsx       # Combined chat feed (DGG + YT + Kick + Twitch)
│   │   ├── LinkScroller.tsx        # Link Scroller (mentions → link cards)
│   │   ├── ListManager.tsx        # List management UI
│   │   └── embeds/
│   │       ├── TwitterEmbed.tsx
│   │       ├── YouTubeEmbed.tsx
│   │       ├── KickEmbed.tsx
│   │       ├── TwitchEmbed.tsx
│   │       ├── TikTokEmbed.tsx
│   │       ├── RedditEmbed.tsx
│   │       ├── ImageEmbed.tsx
│   │       ├── VideoEmbed.tsx
│   │       └── ... (Bluesky, Streamable, Wikipedia, LSF)
│   ├── assets/
│   │   └── icons/
│   │       └── third-party/       # Platform icons
│   ├── utils/
│   │   └── embedHandlers.ts       # Embed utilities
│   └── main.tsx                   # React entry point (OmniScreen vs LinkScroller)
└── package.json
```

### Application Menu

#### Custom Menu Bar
- **File Menu**: Quit option
- **Edit Menu**: Standard editing options (cut, copy, paste, etc.)
- **View Menu**: Reload, dev tools, zoom controls, fullscreen
- **Window Menu**:
  - **Always On Top**: Toggle window to stay above other windows
  - **Transparency**: Submenu with opacity levels (100%, 75%, 50%, 25%)
  - Minimize, close options
- **Help Menu**:
  - **Production**: Links to GitHub repository, issues page
  - **Development**: Includes Electron documentation links plus GitHub links

#### Window Options
- **Always On Top**: Keep window above other applications
- **Transparency**: Adjustable opacity levels (25%, 50%, 75%, 100%)
- **Transparent Background**: Enabled in webPreferences for transparency support

### Image CORS Bypass

#### Automatic Proxy System
- **WebRequest Handlers**: Set Referer headers for common image CDNs
  - 4cdn.org → Sets Referer to 4chan.org
  - imgur.com → Sets Referer to imgur.com
  - twimg.com → Sets Referer to twitter.com
- **IPC Proxy Handler**: `fetch-image` handler in main process
  - Fetches images through main process (no CORS restrictions)
  - Returns base64 data URLs
  - Automatic fallback when direct loading fails
- **ImageEmbed Component**: Automatically uses proxy for known CORS-prone domains

## Future Enhancements (Not Yet Implemented)

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
