# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Connections / Accounts** (Menu → Connections): Central place to manage cookies per platform for DGG chat, embeds, and combined chat (DGG, YouTube, Kick, Twitch, Twitter, Reddit).
- **Simplified mode**: “Log in” opens an in-app browser; “Logged in” only when auth cookies are present (platform-specific cookie names; tracking cookies no longer count as logged in). Per-platform “Delete cookies” to clear that platform’s session.
- **Paranoid mode** toggle: Paste cookies manually (no password ever entered in the app); manual fields and paste blob; short explanation that you never type your password.
- **Clear options**: “Delete all sessions” (clears known platform domains) and “Clear entire cookie store” (clears every cookie in the app session). Success messages no longer show cookie counts (avoids confusion from embeds re-setting cookies).
- **Kick logged-in detection**: Uses `kick_session` and `session_token` so Kick shows “Logged in” when you have a real session.
- Manual cookie fields and paste area refresh when the login window closes, so you see updated values without reopening the modal.

### Changed
- Connections UI simplified: long explanation removed (details in code comments); “Log in in browser” label shortened to “Log in”.
- Auth detection is based on platform auth cookie names only (e.g. DGG: sid/rememberme; YouTube: SID, HSID, etc.; Twitter: auth_token/ct0; Reddit: reddit_session; Twitch: auth-token/unique_id; Kick: kick_session/session_token), so opening YouTube or clearing sessions no longer falsely shows “Logged in”.

## [1.7.2] - 2026-01-31

### Added
- LinkScroller Embeds recovered (Twitter, Reddit, YouTube, etc. render in overview again; Debug page uses same components with URL-derived embed fields).
- Release workflow populates GitHub release notes from CHANGELOG.md for the tagged version.

## [1.7.1] - 2026-01-31

### Added
- Sending whispers (DGG private messages via chat WebSocket).

## [1.7.0] - 2026-01-30

### Added
- Voting and debug page (poll voting, debug page with shared LinkScroller components).
- Auto update check at startup.
- Send DGG messages.

### Changed
- Better layout for pinned streamers.
- Omni screen layout fixed, combined chat improvements.
- Emote combos, pinned messages, better scrolling behavior.

## [1.6.6] - 2026-01-30

### Added
- Handle # links.

### Changed
- Emote rendering tweaks.

## [1.6.5] - 2026-01-30

### Changed
- Embed better link handling.

## [1.6.4] - 2026-01-30

### Fixed
- Bug vanishing embeds.

## [1.6.3] - 2026-01-30

### Changed
- Reworked embeds in omni screen.

## [1.6.2] - 2026-01-29

### Changed
- CSS fix.
- Readme updates.

## [1.6.1] - 2026-01-29

### Added
- Combined chat highlight.

### Changed
- Better split screen management.

## [1.6.0] - 2026-01-29

### Added
- User scripts for Kick and DGG chat.
- Youtube emotes.
- Omni Screen Cinema mode.

### Changed
- Destiny chat embed fixes.
- LinkScroller and title improvements.
- Custom titlebar.
- Link Scroller improved.

## [1.5.3] - 2026-01-28

### Added
- Omni screen combined chat feature.

## [1.5.2] - 2026-01-27

### Changed
- Workflow fix.

## [1.5.1] - 2026-01-27

### Changed
- Upscaled logo.

## [1.5.0] - 2026-01-27

### Added
- Omni Screen.

### Changed
- Testing different builds.
- Linkscroller order fixes.
- Pagination fix.
- Demo, docs.

## [1.4.0] - 2026-01-27

_(Release marker; see 1.5.0 for commits in this period.)_

## [1.3.0] - 2026-01-25

### Added
- Embed hacking.

### Changed
- Readme updates.

### Fixed
- Production local storage fix.

## [1.2.0] - 2026-01-25

### Added
- Added some flair.
- Muting.
- Websockets right click menu.
- Logging and backup API.
- Added Menu Screen.
- Multiple mentions.
- Emotes and better text.
- More embeds.
- Reimagined the modes.
- Twitter embed respects theme.
- Improved theming.
- Bluesky Embed.

### Fixed
- Twitter fixed.
- TikTok and Wikipedia embed fix, CORS issues in prod build fix.

## [1.1.1] - 2026-01-24

### Fixed
- Build fixes.

## [1.1.0] - 2026-01-24

### Added
- Streamable Embed.
- Link Scroller setup.

### Changed
- Better trusted user and settings text.
- Better loading maybe?
- Youtube timestamps.
- Testing new layout.
- Highlight view better scrolling behaviour.
- Better imgur handling.
- Better next page and small cards.
- Readme updates.

### Fixed
- Twitter height fix, Angelthump.
- Still working on embeds.

## [1.0.1] - 2026-01-24

### Added
- Cloned from electron-vite-react-boilerplate.
- Initial commit.

[Unreleased]: https://github.com/NickMarcha/omni-screen/compare/v1.7.2...HEAD
[1.7.2]: https://github.com/NickMarcha/omni-screen/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/NickMarcha/omni-screen/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/NickMarcha/omni-screen/compare/v1.6.6...v1.7.0
[1.6.6]: https://github.com/NickMarcha/omni-screen/compare/v1.6.5...v1.6.6
[1.6.5]: https://github.com/NickMarcha/omni-screen/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/NickMarcha/omni-screen/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/NickMarcha/omni-screen/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/NickMarcha/omni-screen/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/NickMarcha/omni-screen/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/NickMarcha/omni-screen/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/NickMarcha/omni-screen/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/NickMarcha/omni-screen/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/NickMarcha/omni-screen/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/NickMarcha/omni-screen/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/NickMarcha/omni-screen/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/NickMarcha/omni-screen/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/NickMarcha/omni-screen/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/NickMarcha/omni-screen/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/NickMarcha/omni-screen/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/NickMarcha/omni-screen/releases/tag/v1.0.1
