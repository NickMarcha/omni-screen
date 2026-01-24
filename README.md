# Omni Screen

A client application for the Destiny.gg (dgg) community, designed to enhance your viewing and chat experience across multiple platforms.

## 🎯 Overview

Omni Screen is a downloadable desktop application built on existing Destiny.gg community apps. The application is designed as a native client to bypass CORS restrictions from various backends, enabling seamless integration of multiple services and features.

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

### Link Scroller
- **Embed Card Navigation**: Scroll through cards displaying embedded content from links posted in DGG chat (with future support for YouTube and Kick chat links)
- **View Modes**:
  - **Card View**: Browse links as cards for quick preview
  - **Fullscreen View**: View links in fullscreen mode for immersive experience
- **Mentions API Integration**: Retrieve and display links from messages that mention specific users
  - API Endpoint: `polecat.me/api/mentions/{username}?size=150&offset=0`
  - Example: `polecat.me/api/mentions/mrMouton?size=150&offset=0`
  - Note: The API doesn't support empty strings; may integrate rustlesearch for broader search capabilities in the future
- **Link Filtering**: Whitelist/blacklist system to control which link types load and display as embed cards:
  - Twitter/X links
  - YouTube links
  - Streamable links
  - Reddit links
  - Direct MP4 links
  - And more...

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

**Note**: This project is currently in active development. Features listed above are planned and may be subject to change.
