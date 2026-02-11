# Extensions

Extensions let you add **chat sources** and other integrations to Omni Screen. A chat source extension provides WebSocket URLs, API paths, cookie domains, and optional features (mentions search, log search, live feed handling). The app loads one **primary** chat source: the first registered source with a valid config is used for the main chat pane, Connections UI, and related IPC.

---

## Installing extensions

- **From a manifest URL:** Use **Settings → Extensions** and enter the URL of an extension manifest (JSON). The app fetches the manifest, downloads the entry bundle, and adds the extension to the installed list. You can also open a link like `omnichat://install?url=https://example.com/manifest.json` if the app is registered as the handler for `omnichat://`.
- **Enable/disable:** Installed extensions can be toggled on or off in Settings → Extensions. Disabled extensions are not loaded at startup.
- **Reload:** Use **Extensions → Reload extensions** in the menu bar (or after installing) to reload all enabled extensions without restarting the app.
- **Uninstall:** Remove an extension from Settings → Extensions; its folder is deleted and it is removed from the list.

Extensions are stored under the app’s user data directory in an `extensions` folder. The list of installed extensions is persisted in `extensions/extensions.json`.

---

## Extension manifest

The manifest is a JSON file fetched from the URL you provide. Required and optional fields:

| Field        | Required | Description |
|-------------|----------|-------------|
| `id`        | Yes      | Unique extension id (e.g. chat source id). Used as the extension folder name and in registries. |
| `name`      | Yes      | Display name. |
| `version`   | Yes      | Semantic version (used for update checks). |
| `updateUrl` | Yes      | URL of this manifest; the app can re-fetch it to check for updates. |
| `entry`     | Yes      | URL of the extension bundle to download (single JS file). The filename in the URL should be `bundle.js` so the loader can find it after install. |
| `description` | No    | Short description shown in the Extensions UI. |
| `tags`      | No       | Array of tags (e.g. `["chat", "embeds"]`). |
| `icon`      | No       | URL of an icon image. |
| `capabilities` | No    | Optional list of capability strings. |

Example:

```json
{
  "id": "my-chat-source",
  "name": "My Chat Source",
  "version": "1.0.0",
  "updateUrl": "https://example.com/extensions/my-chat-source/manifest.json",
  "entry": "https://example.com/extensions/my-chat-source/bundle.js",
  "description": "Chat and embeds for My Platform.",
  "tags": ["chat", "embeds"]
}
```

---

## Extension bundle and registration

The **entry** URL must point to a single JavaScript bundle. After install, the app expects that file to be named `bundle.js` in the extension folder (the downloaded file keeps the basename from the URL, so the entry URL should end with `bundle.js`).

The bundle is loaded in the main process via `require()`. It must export a **register** function that receives a **context** object:

```js
function register(context) {
  // context.extensionPath, context.extensionId, context.log(...)
  // context.registerChatSource(id, { getConfig, onLiveMessage? })
  // context.setRendererConfig({ chatSources, connectionPlatforms })
  // context.registerSettings(sections)
  // context.registerChatSourceApi(chatSourceId, api)
}
```

If `register` is not a function, the extension is loaded but does nothing. Any exception during `register` is logged and the extension is skipped; other extensions still load.

---

## Context API

| Method | Description |
|--------|-------------|
| `registerChatSource(id, registration)` | Register a chat source. `registration.getConfig()` must return a [ChatSourceConfig](#chat-source-config). Optional: `registration.onLiveMessage(message, api)` for the live WebSocket. The first registered source with a valid config becomes the **primary** chat source. |
| `registerChatSourceApi(chatSourceId, api)` | Register optional APIs for a chat source: `fetchMentions(username, size, offset)` and/or `fetchRustlesearch(filterTerms, searchAfter, size)` for mentions and log search. |
| `setRendererConfig(partial)` | Merge config for the renderer: `chatSources`, `connectionPlatforms`. See [Renderer config](#renderer-config). |
| `registerSettings(sections)` | Register settings sections for the Extensions UI. Each section has `id`, `label`, `placement`, and `fields`. |
| `log(level, message, ...args)` | Log from the extension. `level`: `'info' | 'warn' | 'error' | 'debug'`. Messages are prefixed with `[ext:extensionId]` and written to the app log. |

---

## Chat source config

**ChatSourceConfig** (returned by `getConfig()`) is used by the main process to connect to chat and live WebSockets and to call APIs:

- **WebSocket / origins:** `chatWssUrl`, `chatOrigin`, `liveWssUrl`, `liveOrigin`
- **Base URL:** `baseUrl` (e.g. `https://example.com`)
- **API paths:** `apiMe`, `apiUserinfo`, `apiUnread`, `apiInboxPath`
- **Assets:** `emotesJsonUrl`, `emotesCssUrl`, `flairsJsonUrl`, `flairsCssUrl`
- **Auth / connections:** `cookieDomains`, `loginUrl`

**ChatSourceRendererConfig** is what you pass under `setRendererConfig({ chatSources: { [id]: { ... } } })`. It supplies the renderer with:

- `baseUrl`, `loginUrl`, `emotesJsonUrl`, `emotesCssUrl`, `flairsJsonUrl`, `flairsCssUrl`
- Optional: `platformIconUrl`, `mentionsChannelLabel`

The app uses the **primary** chat source for the main chat pane, cookie domains for the Connections UI, and for IPC such as mentions and log search when the extension registers the corresponding API.

---

## Connection platforms

Extensions can add entries to the **Connections** (login/cookies) UI via `setRendererConfig({ connectionPlatforms: [...] })`. Each platform has:

- `id`, `label`, `loginUrl`, `loginService`, `description`
- `cookieNames`: cookie names that indicate auth (the app uses these to detect and show “logged in” state)
- `snippet`, optional `namePrefix`, `httpOnlyNote`, `manualCookieNames`

Built-in platforms (e.g. YouTube, Kick, Twitch) are always present; extension platforms are appended. The app uses `loginUrl` to open a login window and stores cookies in the same session used by chat and embeds.

---

## Live message handler

If the primary chat source config has `liveWssUrl` and the registration has `onLiveMessage`, the app connects to the live WebSocket and calls `onLiveMessage(message, api)` for each message. The **api** object provides:

- **sendToRenderer(channel, ...args)** – Send to the renderer over IPC.
- **setLiveEmbeds(keys, byKey?)** – Update the current set of “live” embed keys (and optional display names). Used so the app can treat certain embeds (e.g. a given platform) as live when they appear in the feed.

The main process does not parse the message; the extension is responsible for interpreting it and updating state or forwarding to the renderer as needed.

---

## Optional chat source APIs

- **fetchMentions(username, size, offset)** – Return a list of mentions for the given username. The main process may add ids and cache results; it exposes this via IPC for the renderer.
- **fetchRustlesearch(filterTerms, searchAfter?, size?)** – Search chat logs. Returns `{ success, data?, searchAfter?, hasMore?, error? }`. Used for log search UI.

These are registered with `registerChatSourceApi(chatSourceId, api)`. The main process looks up the API by the primary chat source id when handling mentions/search IPC.

---

## Extension settings

Extensions can register **settings sections** with `registerSettings(sections)`. Each section has:

- **id** – Unique within the extension.
- **label** – Shown in the UI.
- **placement** – Where the section appears:
  - **omni_screen** – Settings → Extensions, under this extension.
  - **link_scroller** – Reserved for Link Scroller–specific settings.
  - **connections** – Reserved for Connections-related settings (e.g. adding a platform to the list).
- **fields** – Array of `{ key, type, label, default, description?, placeholder? }`. `type`: `'boolean' | 'string' | 'number'`.

The renderer receives `extensionSettingsSchemas` from the app config and renders forms accordingly. Field values are stored and restored by the app (e.g. in extension-specific storage or settings).

---

## Lifecycle and storage

- **Load:** At startup, the main process loads all extensions whose `enabled` flag is true. For each, it `require()`s the entry bundle (expected as `bundle.js` in the extension folder) and calls `mod.register(context)`.
- **Reload:** “Reload extensions” clears extension-provided config (chat sources, APIs, renderer overlay, settings), then runs the same load sequence again. Installed list and enabled flags are unchanged.
- **Install:** Fetch manifest, download entry bundle into a new folder named by `manifest.id`, append to `extensions.json` with `enabled: true` by default (or keep previous enabled state if upgrading). Reload is triggered after install.
- **Uninstall:** Remove the extension folder and its entry from `extensions.json`, then reload.
- **Enable/disable:** Toggling enabled in the UI updates `extensions.json` and triggers a reload so only enabled extensions are loaded.

Extensions run in the main process. They do not get a Node.js VM or sandbox; the host trusts the extension code. Install only extensions from sources you trust.
