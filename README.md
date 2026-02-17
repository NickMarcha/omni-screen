# Omni Screen [![Latest Build](https://github.com/NickMarcha/omni-screen/actions/workflows/build-publish.yml/badge.svg)](https://github.com/NickMarcha/omni-screen/actions/workflows/build-publish.yml)

<p align="center">
  <img src="./src/assets/logo-filled.svg" alt="Omni Screen" width="140" height="130" />
</p>

Cross-platform desktop app for **Windows**, **macOS**, and **Linux** that combines chat and live streams from multiple platforms (primary chat source, YouTube, Kick, Twitch) in one split-screen view. 

## Screenshot

![Omni Screen Screenshot](./docs/Screenshot%202026-02-17%20013214.png)

Main feature: split-screen with combined chat (primary chat, YouTube, Kick, Twitch) and live embeds (YouTube/Kick/Twitch).

## Download & Install

**Windows, macOS, Linux**: [Download from GitHub Releases](https://github.com/NickMarcha/omni-screen/releases/). Choose the installer or package for your OS (Windows `.exe`, macOS `.dmg`, Linux `.AppImage` or `.deb`).

**Arch Linux (AUR)**: Omni Screen is available on the [Arch User Repository](https://aur.archlinux.org/packages/omni-screen-bin) as **omni-screen-bin**.

Using an AUR helper (e.g. [yay](https://github.com/Jguer/yay)):

```bash
yay -S omni-screen-bin
```

Manual build (clone and install with pacman):

```bash
git clone https://aur.archlinux.org/omni-screen-bin.git
cd omni-screen-bin
makepkg -si
```

(`makepkg -si` builds the package and installs it plus dependencies via pacman.)

## FAQ

### Why is it an app and not a website?

Technical issues with using third-party websites/APIs can be bypassed with a native desktop application. Alternatively, I could run a server, but I ain't paying for that. The Electron app allows us to bypass CORS restrictions and access APIs that would otherwise be blocked in a browser. It also runs entirely on your machine—no reliance on our servers—so it won't randomly stop working if our infrastructure goes down.

### Windows SmartScreen Warning

If you see a Windows SmartScreen warning when installing, this is a standard issue with unsigned applications. Google it if you're worried; it's just Windows being cautious about apps that aren't code-signed. The application is safe to use.

## Overview

Omni Screen is a downloadable desktop application that aggregates chat and live streams from multiple platforms. It runs as a native client to bypass CORS restrictions from various backends, enabling a single split-screen view with combined chat and embeds.

## Current Features

### OmniScreen (main feature)

Split-screen view with combined chat, live stream embeds, and a unified chat feed.

#### Key Features

- **Split-screen layout**: Combined chat pane (primary chat + YouTube + Kick + Twitch) alongside embedded streams (YouTube, Kick, Twitch)
- **Live embeds**: Add streams by pasting links or from the live embed list; dock with grouped streamers
- **Combined chat**: Single feed aggregating chat from primary chat, YouTube, Kick, and Twitch (primary chat is available when a chat-source extension is loaded)
- **Primary chat private messages (whispers)**: Persistent list (localStorage); list grows from unread API, PRIVMSG events, and when you send a whisper only if the inbox fetch succeeds. List view: "Whisper To" + message at bottom (message disabled until recipient set). Add to list and open conversation only when the inbox API succeeds after sending; otherwise fields just clear. Send via WebSocket; sticky Back; unread count and badge on inbox icon
- **Embed chat toggles**: Show/hide chat per platform in the combined view
- **Highlight term**: Option to highlight messages containing a term (e.g. your username) in combined chat
- **Pinned streamers**: Group embeds by streamer (e.g. one streamer on YouTube + Kick) with one dock button per streamer
- **What's being watched**: Pie chart (embeds WebSocket data) in the dock
- **Bookmark sharing**: In Settings, Bookmarked streamers, use **Share** on a streamer to copy an `omnichat://add-streamer?...` link (with or without colors). Anyone opening the link in Omni Screen adds that streamer to their bookmarks.

#### Add-streamer protocol (bookmark via URL)

You can add a bookmarked streamer by opening a link with the `omnichat://` protocol. When the app is set as the handler for `omnichat://`, the link adds the streamer to the bookmarks list.

**URL form:** `omnichat://add-streamer?<params>`

**Parameters:**

| Param | Description |
|-------|-------------|
| `nickname` or `nick` | Display name (default: "Unnamed") |
| `youtube` or `youtubeChannelId` | YouTube channel ID (e.g. `UCxxxx`) |
| `kick` or `kickSlug` | Kick channel slug |
| `twitch` or `twitchLogin` | Twitch login name |
| `color` | Hex color for dock button (e.g. `#ff6b6b`; in URL use `%23` for `#`) |
| `youtubeColor`, `kickColor`, `twitchColor` | Per-platform hex for combined chat |
| `openWhenLive` | `true` or `1` = auto-open when live (default); `false` or `0` = off |
| `hideLabel` | `true` or `1` = hide source label in combined chat |

At least one of `youtube`, `kick`, or `twitch` is required. The alias `omnichat://bookmark?...` works the same as `add-streamer`.

**Examples:**

- Minimal (one platform):
  - `omnichat://add-streamer?nickname=MyStreamer&youtube=UCxxxxxxxx`
  - `omnichat://add-streamer?nickname=KickUser&kick=kickuser`
  - `omnichat://add-streamer?nickname=TwitchUser&twitch=twitchuser`
- With dock color: `omnichat://add-streamer?nickname=Streamer&youtube=UCxxxx&color=%23ff6b6b`
- Multiple platforms and per-platform colors: `omnichat://add-streamer?nickname=Multi&youtube=UCxxxx&kick=kickuser&twitch=twitchuser&youtubeColor=%2300ff00&kickColor=%230000ff&twitchColor=%23ff00ff`
- Options: `omnichat://add-streamer?nickname=Streamer&kick=user&openWhenLive=false&hideLabel=true`

### Link Scroller

Browse links shared in chat mentions (e.g. from your primary chat source and other enabled channels).

#### Key Features

- **Mentions API Integration**: Retrieve and display links from messages that mention specific users
- **Multiple View Modes**:
  - **Overview Mode**: Grid/list view of all link cards for quick browsing
  - **Highlight Mode**: Full-screen view with embedded content and navigation controls
- **Rich Embed Support**: YouTube (including Shorts), Twitter/X, TikTok, Reddit, Imgur, Bluesky, direct images and videos, and more
- **Advanced Filtering**: Filter by username/terms; show/hide NSFW/NSFL content; ban terms or users; mute users temporarily (24-hour expiration); trusted users (highlighted cards); platform-specific display modes
- **Customizable Settings**: Keyboard shortcuts, theme (system/light/dark), persistent across sessions
- **Smart Navigation**: Previous/Next arrows, position counter, autoplay and mute controls, infinite scrolling with auto-load

### Connections / Accounts

Log in once per platform so chat, embeds, and Link Scroller can use your session.

- **Where**: Menu, **Connections / Accounts**
- **Simplified mode**: Use **Log in** to open an in-app browser; the app shows "Logged in" only when real auth cookies are present. Use **Delete cookies** per platform to sign out.
- **Paranoid mode**: Paste cookies manually (e.g. from DevTools); you never type your password in the app.
- **Platforms**: Primary chat (when enabled via extension), YouTube (embeds + live chat), Kick, Twitch, Twitter/X (embeds), Reddit (embeds). Clear all sessions or the entire cookie store from the same screen.

For detailed feature documentation, see [IMPLEMENTED-FEATURES.md](./IMPLEMENTED-FEATURES.md).

## Planned Features

Additional features and improvements are in the pipeline. See [IMPLEMENTED-FEATURES.md](./IMPLEMENTED-FEATURES.md) for full details on what's available today.

## Technical Details

This project is built on a modern Electron + Vite + React + TypeScript boilerplate designed for cross-platform releases on Windows, macOS, and Linux.

For detailed technical information, build instructions, and development setup, see the [Electron Vite React Boilerplate README](./electron-vite-react-boilerplate-README.md).

### Quick Start

```bash
npm install
npm run dev
npm run build
```

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Tech Stack

- **Electron**: Cross-platform desktop application framework
- **Vite**: Build tool and dev server
- **React 18**: Modern React with hooks
- **TypeScript**: Type safety and developer experience
- **DaisyUI**: Component library built on Tailwind CSS

### Building & Distribution

The application can be built for:

- **Windows**: `.exe` installer
- **macOS**: `.dmg` disk image
- **Linux**: `.AppImage` and `.deb` packages

See the [boilerplate README](./electron-vite-react-boilerplate-README.md) for detailed build and release instructions.

### Auto Updates

The application includes built-in auto-update functionality. Updates are automatically checked and can be installed seamlessly.

## License

See [LICENSE](./LICENSE) for details.

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request.

---

*This project is in active development. Planned features may be subject to change.*
