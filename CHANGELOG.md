# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-27

### Added
- Initial release of Electron Vite React Boilerplate
- Vite 5+ with hot reload support
- React 18+ with TypeScript
- DaisyUI 5+ component library
- Auto-updater functionality with progress tracking
- Cross-platform build support (Windows, macOS, Linux)
- GitHub Actions workflow for automated releases
- Comprehensive documentation and configuration guides
- ESLint configuration for code quality
- Modern development tooling setup

### Features
- ⚡️ Lightning-fast development with Vite
- 🔄 Hot reload for instant feedback
- 📦 Auto-updater with progress tracking
- 🎨 Beautiful DaisyUI components
- 📱 Cross-platform builds
- 🔧 TypeScript for type safety
- 📚 Comprehensive documentation
- 🚀 GitHub Actions ready

## [Unreleased]

### Added
- **Pie chart (What’s being watched)**: Button in the embed dock opens a popup with a pie chart of who is watching what, using data from the embeds WebSocket only (no chatters count). Total is the sum of embed counts; “Not watching” slice removed. Tooltip floats above the chart; labels no longer cut off (viewBox + width); chart centered in popup.
- **DGG private messages (whispers)**: The list of users who have whispered you is **persisted in localStorage**; users are added from the initial unread API call when chat loads, from WebSocket PRIVMSG events, and when you **send** a whisper only if the subsequent **inbox fetch** (`GET /api/messages/usr/:username/inbox`) succeeds; users are removed only when you hit **Clear**. The 📫/📬 button is always clickable and opens the whisper list. In the list view, a **"Whisper To"** field (dropdown from whisper list + DGG nicks, or type any username) and message field sit at the bottom; message input is disabled until a recipient is entered (placeholder "whisper message.."). After sending, the app fetches inbox for that recipient; **only if that fetch succeeds** do we add the user to the list and open the conversation; otherwise we just clear the fields. In the conversation view, a sticky **← Back** header stays visible. Whispers are sent via the **chat WebSocket** (`PRIVMSG {"nick","data"}`). Per-user unread count and total badge on 📫/📬; send error shown above the recipient field when relevant.

### Changed
- **Combined chat poll**: Poll now dismisses correctly: if POLLSTART is for an already-ended poll (e.g. from HISTORY), it is shown as ended and the 15s dismiss timer runs; when the countdown reaches 0, `onPollTimeExpired` sets the poll over so it dismisses even if POLLSTOP is never received. Time left uses server time with support for `poll.start` / `poll.now` as Unix seconds. Vote feedback: “Sending vote…” and disabled buttons while pending; errors (e.g. “Already voted”) shown. POLLSTART/POLLSTOP/vote-counted/poll-vote-error logged in main and renderer.
- **Combo rendering**: DGG emote in combo rows now matches message emotes (same div + class, no fixed size, no `emotesMap.has` gate). Added `.msg-chat.msg-emote .emote { flex-shrink: 0 }` so combo emotes don’t shrink.
- **Private messages button**: Compact 32×32px button to the right of the DGG input; input uses flex-1 so it takes most space; row uses `flex-none` so it doesn’t grow in height.

### Fixed
- **Pie chart**: Data source is embeds WebSocket only; total is sum of embed counts; “Not watching” slice removed.
- **Poll**: Never disappears (POLLSTOP or time-expired); time left accurate (Unix seconds for start/now); vote feedback and logging.
- **Combined chat JSX**: Corrected fragment closing and missing `</div>` for scroll area so the layout no longer breaks.