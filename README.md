# Omni Screen

A client application for the Destiny.gg (dgg) community, designed to enhance your viewing and chat experience across multiple platforms.

## 🎬 OmniScreen Demo

<video src="./docs/OmniScreen.mp4" controls width="640"></video>

*Main feature: split-screen with DGG chat, live embeds (YouTube/Kick/Twitch), and combined chat from all platforms.*

*([Open video directly](./docs/OmniScreen.mp4) if it doesn’t play above.)*

## 🎬 Link Scroller Demo

![Link Scroller Demo](./docs/LinkScroller.webp)

*Link Scroller: browse links shared in DGG chat mentions.*

## 📥 Download

**Latest Release**: [Download from GitHub Releases](https://github.com/NickMarcha/omni-screen/releases/)

## ❓ FAQ

### Why is it an app and not a website?

Technical issues with using third-party websites/APIs can be bypassed with a native desktop application. Alternatively, I could run a server, but I ain't paying for that. The Electron app allows us to bypass CORS restrictions and access APIs that would otherwise be blocked in a browser.

### Windows SmartScreen Warning

If you see a Windows SmartScreen warning when installing, this is a standard issue with unsigned applications. Google it if you're worried - it's just Windows being cautious about apps that aren't code-signed. The application is safe to use.

## 🎯 Overview

Omni Screen is a downloadable desktop application built for the Destiny.gg community. The application is designed as a native client to bypass CORS restrictions from various backends, enabling seamless integration of multiple services and features.

## ✨ Current Features

### OmniScreen (main feature)

Split-screen view with Destiny.gg chat, live stream embeds, and a unified chat feed.

#### Key Features:
- **Split-screen layout**: DGG chat alongside embedded streams (YouTube, Kick, Twitch)
- **Live embeds**: Add streams by pasting links or from the DGG live list; dock with grouped streamers
- **Combined chat**: Single feed aggregating chat from DGG, YouTube, Kick, and Twitch
- **DGG private messages (whispers)**: Persistent list (localStorage); list grows from unread API, PRIVMSG events, and when you send a whisper only if the inbox fetch succeeds. List view: "Whisper To" + message at bottom (message disabled until recipient set). Add to list and open conversation only when `GET /api/messages/usr/:username/inbox` succeeds after sending; otherwise fields just clear. Send via WebSocket; sticky Back; unread count and badge on 📫/📬
- **Embed chat toggles**: Show/hide chat per platform in the combined view
- **Highlight term**: Option to highlight messages containing a term (e.g. your username) in combined chat
- **Pinned streamers**: Group embeds by streamer (e.g. Destiny on YouTube + Kick) with one dock button per streamer
- **What’s being watched**: Pie chart (embeds WebSocket data) in the dock

### Link Scroller

Browse links shared in Destiny.gg chat mentions.

#### Key Features:
- **Mentions API Integration**: Retrieve and display links from messages that mention specific users
- **Multiple View Modes**:
  - **Overview Mode**: Grid/list view of all link cards for quick browsing
  - **Highlight Mode**: Full-screen view with embedded content and navigation controls
- **Rich Embed Support**:
  - YouTube (including Shorts)
  - Twitter/X (tweet embeds)
  - TikTok (video embeds)
  - Reddit (post embeds)
  - Imgur (album/gallery support)
  - Bluesky (post embeds)
  - Direct images and videos
  - And more...
- **Advanced Filtering**:
  - Filter by username/terms
  - Show/hide NSFW/NSFL content
  - Ban specific terms or users
  - Mute users temporarily (24-hour expiration)
  - Trusted users (highlighted cards)
  - Platform-specific display modes (embed/text/filter)
- **Customizable Settings**:
  - Customizable keyboard shortcuts
  - Theme settings (system/light/dark modes)
  - All settings persist across sessions
- **Smart Navigation**:
  - Previous/Next arrows
  - Position counter
  - Autoplay and mute controls
  - Infinite scrolling with auto-load

For detailed feature documentation, see [IMPLEMENTED-FEATURES.md](./IMPLEMENTED-FEATURES.md).

## 🚀 Planned Features

*Additional features and improvements are in the pipeline; see [IMPLEMENTED-FEATURES.md](./IMPLEMENTED-FEATURES.md) for full details on what’s available today.*

## 🛠️ Technical Details

This project is built on a modern Electron + Vite + React + TypeScript boilerplate designed for cross-platform releases on Windows, macOS, and Linux.

For detailed technical information, build instructions, and development setup, please refer to the [Electron Vite React Boilerplate README](./electron-vite-react-boilerplate-README.md).

### Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- Git

## 🎨 Tech Stack

- **Electron** - Cross-platform desktop application framework
- **Vite** - Lightning-fast build tool and dev server
- **React 18** - Modern React with hooks
- **TypeScript** - Type safety and better developer experience
- **DaisyUI** - Beautiful component library built on Tailwind CSS

## 📦 Building & Distribution

The application can be built for:
- **Windows**: `.exe` installer
- **macOS**: `.dmg` disk image
- **Linux**: `.AppImage` and `.deb` packages

See the [boilerplate README](./electron-vite-react-boilerplate-README.md) for detailed build and release instructions.

## 🔄 Auto Updates

The application includes built-in auto-update functionality. Updates are automatically checked and can be installed seamlessly.

## 📝 License

See [LICENSE](./LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Note**: This project is in active development. Planned features may be subject to change.
