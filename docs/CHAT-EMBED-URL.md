# Chat Embed URL

The combined chat can be embedded via URL for the popout window and OBS Browser Source. As long as the app is open, the local HTTP server serves the app at `http://127.0.0.1:5173` (or fallback port).

## URL Format

```
http://127.0.0.1:5173/?<params>#chat-window
```

## Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `embedChats` | JSON | `{ selectedEmbedChatKeys: string[], selectedEmbedKeys: string[] }` – which chats to show |
| `chatTransparent` | `true`/`false` | Transparent background for overlay |
| `maxLines` | number | Max visible lines (default 70) |
| `maxLinesScroll` | number | Max lines when scrolled (default 5000) |
| `showTimestamps` | `1`/`0` | Show timestamps on messages |
| `showLabels` | `1`/`0` | Show source labels (badges) |
| `showPlatformIcons` | `1`/`0` | Show platform favicons |
| `highlightTerms` | JSON array | Terms to highlight (e.g. `["streamer"]`) |
| `pauseEmoteOffscreen` | `1`/`0` | Pause emote animations when off-screen |
| `showPrimaryChatFlairs` | `1`/`0` | Primary chat flairs/colors |
| `includePrimaryChat` | `1`/`0` | Include primary chat in combined |
| `chatBackgroundColor` | string | Background color (hex, rgba, or CSS var) |
| `chatBackgroundOpacity` | 0–1 | Opacity of chat background |
| `chatPanelOpacity` | 0–1 | Overall opacity of chat panel |

## Example

```
http://127.0.0.1:5173/?embedChats=%7B%22selectedEmbedChatKeys%22%3A%5B%22kick%3Astreamer%22%2C%22youtube%3AvideoId%22%5D%2C%22selectedEmbedKeys%22%3A%5B%5D%7D&chatTransparent=true&maxLines=50#chat-window
```

Decoded `embedChats`: `{"selectedEmbedChatKeys":["kick:streamer","youtube:videoId"],"selectedEmbedKeys":[]}`

## OBS Browser Source

1. Add a Browser Source in OBS
2. Set URL to `http://127.0.0.1:5173/#chat-window?embedChats=...` (with your params)
3. Ensure the Omni Screen app is running

**Note**: OBS Browser Source runs in a browser context without Electron IPC. Chat delivery requires a WebSocket bridge (planned). For now, use the popout window for chat overlay.
