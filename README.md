# Omni Screen

A client application for the Destiny.gg (dgg) community, designed to enhance your viewing and chat experience across multiple platforms.

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

### Link Scroller

The primary feature of Omni Screen, allowing you to browse through links shared in Destiny.gg chat mentions.

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

### Split-Screen View
- **DGG Chat & Embeds**: View Destiny.gg chat alongside embedded content (YouTube, Kick, Twitch) in a split-screen layout
- **Embed Chat Integration**: Display chat from embedded streams (YouTube, Kick, Twitch) alongside the main DGG chat in split-screen mode

### Unified Chat Experience
- **Combined Chat Feed**: Aggregate chat messages from multiple sources:
  - Destiny.gg website
  - Destiny's YouTube streams
  - Destiny's Kick streams
- View all chat activity in one unified interface

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
