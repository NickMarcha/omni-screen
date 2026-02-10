# Plan: Generic chat sources and removing dgg/destiny from the repo

**Goal:** All chat-source-specific behaviour is provided by extensions through generic APIs. The strings "dgg" and "destiny" do not appear anywhere in the omni-screen repo (no hardcoded ids, no comments, no docs, no placeholder examples).

---

## Migration status

**Done**

- **1.1 Context and types:** ChatSourceConfig, overlay.chatSources, getPrimaryChatSource(), getLiveMessageHandler(), getChatSourceApi(). Comments redacted in types. Extension API for mentions/rustlesearch in extension.
- **1.2 Main (partial):** App config uses chatSources from overlay; login URLs from connectionPlatforms (no hardcoded platform); fetch-mentions / fetch-rustlesearch delegated to extension. Comments and logs redacted (e.g. "DGG" → generic). useDggFallback kept as option name for IPC compat; internal var usePrimaryChatFallback.
- **1.3 Chat WebSocket:** Default origin/URL set to redacted placeholder; real values come from primary chat source config.
- **1.4 Env config:** Comments use "chat source" / "extension"; no "DGG" or "destiny".
- **1.5 Other electron:** liveWebSocket.ts, types.ts comments redacted.
- **2.1 OmniScreen:** Config uses chatSources, primaryChatSourceId, etc. parseHashLink; live-websocket-embeds / live-websocket-banned-embeds used (no dggApi in app). Legacy localStorage keys still read for backward compat.
- **2.2 CombinedChat:** Full rename done: PrimaryChat* types, primaryChat* state, PRIMARY_CHAT_WHISPER_USERS_KEY, PrimaryChatInputBar, primary-chat-autocomplete-list; all comments redacted. Only remaining "dgg" is localStorage key value (backward compat).
- **2.5 App.css / comments:** DGG → "Primary chat" / "extension". .primary-chat-autocomplete-list only (legacy .dgg-autocomplete-list removed; no backward compat).
- **Extension (omni-screen-dgg):** Sends live-websocket-embeds payload; fetchMentions/fetchRustlesearch in bundle.
- **2.5 LinkScroller (done):** Config from get-app-config; primaryChatSourceId, primaryChatSourceMentionsChannel, primaryChatSourceDisplayLabel. Channels type is generic (`Record<string, { enabled, channelSlug? }>`); primary chat toggle uses primaryChatSourceId; banned/trusted platform dropdowns and all platform/channel defaults use these; no "dgg"/"Destinygg" in code or copy. renderLinkCardOverviewContent and MasonryGrid receive primary-chat props.

**Remaining**

- **2.3 Menu:** Kickstiny link text → "Kickstiny (GitHub)" so "destiny" not in UI; manifest URL is extension repo (data).
- **2.5:** DebugPage, KickEmbed – grep and redact any "dgg"/"destiny".
- **3. Scripts and docs:** .md files, .env.example – replace or remove "dgg"/"destiny".
- **Final:** Grep for remaining "dgg"/"destiny"; document data-only uses (e.g. extension id in settings).

---

## 1. Extension / main process (electron)

### 1.1 Context and types (electron/extensions/context.ts, types.ts)

- **Rename `DggConfig` → `ChatSourceConfig`** (or keep a generic name; extension provides the shape). No type name or comment that says "DGG".
- **Renderer overlay:** Replace `overlay.dgg` with a generic shape, e.g. **`overlay.chatSources: Record<string, ChatSourceRendererConfig>`** where each key is the extension’s chat source id (the extension sets e.g. `chatSources['dgg']`; main never hardcodes the key).
- **Resolve config by iteration, not by id:** Replace `getDggConfigFromExtension()` with e.g. **`getPrimaryChatSourceConfig()`** that returns the first (or only) registered chat source config from the registry (iterate `chatSourceRegistry` and call `getConfig()` for the first entry). Same for **`getLiveMessageHandler()`**: return `onLiveMessage` from the same registration that provides `liveWssUrl` (the one used for the live WebSocket).
- **`isDggExtensionLoaded()`** → **`hasChatSourceWithLiveSocket()`** or **`getPrimaryChatSourceId()`**; no "dgg" in name or implementation.
- **Comments:** Remove all "e.g. DGG", "DGG extension", "destiny.gg" from context and types. Use "chat source", "extension", "primary chat source".

### 1.2 Main process (electron/main.ts)

- **App config for renderer:** Build `platformUrls` and any "chat source" config from overlay generically: e.g. `chatSources: overlay.chatSources ?? {}`, and for each id in `chatSources` add that id to a list and expose `platformUrls[id] = chatSources[id].baseUrl`. So renderer gets `config.chatSources` (keyed by extension-chosen id) and `config.platformUrls` including those base URLs. No `config.dgg`; renderer uses `config.chatSources[someId]` where `someId` comes from "which chat sources are enabled" (e.g. from extension settings by id).
- **CSP / cookie domains / connections:** Use `getPrimaryChatSourceConfig()` (or iterate chat source configs) to get cookie domains, base URLs, login URLs. No variable or log message containing "dgg" or "destiny"; e.g. log "Found N cookies for chat source (configured domains)".
- **Connections:** `getConnectionsPlatforms()` already merges overlay `connectionPlatforms` with base list; ensure it never references "dgg" or "destiny" in code (only in data coming from the extension). Error messages: "Unknown platform" with list of keys from config, not a hardcoded "dgg, youtube, ...".
- **Cookie / login:** Remove `platform === 'dgg' ? 'destiny'`; platform list and aliases come from overlay or a generic map. Login window: login URL per platform from overlay or connection config, no "destiny" / "dgg" in main.
- **Chat WebSocket:** Create from `getPrimaryChatSourceConfig()` (or first config with `chatWssUrl`). Store which registration provided it and use that registration’s handler for messages. No "dgg" in logs or variable names (e.g. `chatWebSocket`, `primaryChatSourceConfig`).
- **Live WebSocket:** Already generic; URL from primary chat source config. Handler from same registration.
- **IPC handlers:** Replace fixed names with generic + source id:
  - **`dgg-send-whisper`** → **`chat-source-send-whisper`** with payload `{ sourceId: string, recipient: string, message: string }`. Main looks up config by `sourceId` (or uses primary) and uses that config’s baseUrl/origin for the request. Logs: "[chat-source-send-whisper]" or "[send-whisper]".
  - **`dgg-messages-unread`** → **`chat-source-messages-unread`** with optional `sourceId`; main uses primary or looked-up config. No "DGG extension not installed"; use "No chat source with messages API" or "Chat source not installed".
  - **`dgg-messages-inbox`** → **`chat-source-messages-inbox`** with `{ sourceId?: string, username: string }`.
  - **`add-embed-from-destiny-link`** → **`add-embed-from-chat-source-link`** (or generic name); payload can include sourceId. No "destiny" in channel name.
  - **`login-success`** payload: use generic platform id from connection/config (e.g. the extension’s connection platform id), not the string "destiny".
- **CONNECTIONS_AUTH_COOKIE_NAMES:** Today it’s a fixed map including `dgg`. Move to extension-provided data: e.g. each entry in `connectionPlatforms` includes `cookieNames` (or auth cookie names). Main builds the map from `connectionPlatforms` + base platforms, so no hardcoded "dgg" key in main (extension sends connection platform with id "dgg" and cookie names; main just stores by that id).
- **getConnectionsGetCookieUrls:** Already builds from config; ensure the "dgg" key comes only from overlay/connectionPlatforms (one entry per connection platform id). So main doesn’t type the string "dgg"; it iterates overlay or connection platforms.
- **youtube-live-or-latest:** Already uses generic `currentLiveEmbedKeys`; no "dgg" in main here. Keep as is.
- **Comments and logs:** Search and replace any remaining "DGG", "dgg", "destiny" in main (comments, log messages, error strings) with generic wording.

### 1.3 Chat WebSocket (electron/chatWebSocket.ts)

- Remove default URL/origin (e.g. `wss://chat.destiny.gg/ws`, `https://www.destiny.gg`). Constructor should require `(url, origin)` (no defaults) so only the extension provides them. No "destiny" in file.

### 1.4 Env config (electron/envConfig.ts)

- Comments already say "extension provides"; remove the words "DGG" and "destiny" from comments (e.g. "Extension-provided chat source URLs are not defined here").

### 1.5 Other electron (urlHandler, fileLogger, etc.)

- Any log or comment that says "dgg" or "destiny": reword to "extension" / "chat source" / "protocol".

---

## 2. Renderer: app config and extension settings

### 2.1 OmniScreen (src/components/OmniScreen.tsx)

- **Config shape:** Expect `config.chatSources` (Record<id, { baseUrl, platformIconUrl?, ... }>) and optionally a list of "enabled chat source ids" from extension settings. No `config.dgg`.
- **State names:** Replace all "dgg" in state and refs with generic names:
  - `dggExtensionAvailable` → e.g. **`primaryChatSourceAvailable`** (true if any chat source in config has baseUrl).
  - `dggPlatformIconUrl` → **`primaryChatSourceIconUrl`** or per-id: **`chatSourceIconUrls: Record<string, string>`** from config (each chat source in config can have platformIconUrl).
  - `dggExtSettings`, `combinedIncludeDgg`, `combinedDisableDggFlairsAndColors`, `dggLabelColorOverride`, `dggLabelText`, `setDggFlairsFromChat` → drive from **extension settings by extension id**. The "first" or "primary" chat source’s extension id can be derived from config (e.g. first key in `config.chatSources`). So we have e.g. `primaryChatSourceId = Object.keys(config.chatSources ?? {})[0]`, then `extensionSettings[primaryChatSourceId]` for includeInCombined, flairsAndColors, labelColor, labelText. No "dgg" in variable names.
  - **Focus keybind / input refs:** Rename `dggFocusKeybind` → **`chatInputFocusKeybind`**, `dggInputRef` → **`primaryChatInputRef`**, `dggChatActionsRef` → **`primaryChatActionsRef`**. Persist key e.g. `omni-screen:chat-input-focus-keybind`. No "dgg" in keys or names.
- **Migration (ext-settings):** Remove the block that migrates only for `extId === 'dgg'`. Either drop migration (user said not a concern) or make it generic (e.g. migrate from legacy keys to ext-settings for any id that has a matching legacy key map). Do not mention "dgg" in comments or keys in code (localStorage keys like `omni-screen:ext-settings:dgg` are data, not code; the id comes from the extension).
- **Live embed types:** Replace `type: 'dggApi:embeds'` / `'dggApi:bannedEmbeds'` in types with a generic, e.g. **`LiveWsMessage`** with `type: string` and `data: unknown`, or keep a union but name it e.g. `LiveFeedEmbedsMessage` without "dgg" in the name. The extension sends these message types; the app just forwards. So in OmniScreen, use generic type names (e.g. `liveApi:embeds`) or keep the type string as-is but don’t name variables "dgg" (e.g. `parsed.type === 'dggApi:embeds'` can stay as string comparison if the extension still sends that; variable names and comments should not say "dgg").
  - Actually: if we don’t want "dgg" in the repo at all, the app should not contain the string `'dggApi:embeds'` either. So the renderer should treat live WS messages as generic (type and data) and the extension could send a normalized event to the renderer (e.g. "live-feed-embeds" with payload) so the app only knows "live-feed-embeds", not "dggApi:embeds". That implies the extension’s onLiveMessage in main sends to renderer with a generic channel and payload (e.g. `live-websocket-embeds` with normalized data), and the renderer listens for `live-websocket-embeds` only. Then the app never references "dggApi". So: main’s handler (extension) already sends e.g. `live-websocket-message` with raw message; renderer can listen for that and parse `type === 'dggApi:embeds'` — but that puts "dggApi" in the repo. To remove "dgg" entirely, the extension should send a separate channel like `live-websocket-embeds` with already-parsed payload, and the renderer only subscribes to `live-websocket-embeds` (no string "dggApi" in app). So the DGG extension’s onLiveMessage would do `api.sendToRenderer('live-websocket-embeds', normalizedPayload)` in addition to or instead of the raw message; renderer then only uses `live-websocket-embeds`. Same for banned embeds: extension sends `live-websocket-banned-embeds`. So app never sees the string "dggApi".
- **Embed source icons:** Replace `dgg: boolean` with e.g. **`fromLiveFeed: boolean`** and "DGG embed" → **"Live feed embed"** or **"From live feed"**. No "dgg" in UI strings or types.
- **Link cards / whispers:** Replace `'dgg', 'Destinygg'` with source id and label from config (e.g. primary chat source id and its display name from config). No "Destinygg" or "dgg" literal.
- **IPC:** `add-embed-from-destiny-link` → **`add-embed-from-chat-source-link`** (or similar); payload can include sourceId.
- **Settings / Keybinds tab:** "Focus DGG chat input" → **"Focus chat input"**; no "dgg" in labels or keys.
- **Placeholders:** "e.g. destiny" for streamer names → **"e.g. streamer"** or **"e.g. channel"**.
- **Comments:** Remove every "dgg", "DGG", "destiny", "Destiny", "live.destiny.gg", etc.

### 2.2 CombinedChat (src/components/CombinedChat.tsx)

- **Props:** Replace DGG-specific prop names with generic ones keyed by source id or "primary":
  - `enableDgg` → **`enabledPrimaryChatSource`** or **`enabledChatSourceIds: string[]`** and a single "primary" for the one that has the input (or pass per-source enable + refs by id).
  - `dggLabelColor`, `dggLabelText`, `dggPlatformIconUrl` → e.g. **`primaryChatSourceLabelColor`**, **`primaryChatSourceLabelText`**, **`primaryChatSourceIconUrl`**, or a single object **`primaryChatSourceStyle: { labelColor?, labelText?, iconUrl? }`**.
  - `dggInputRef`, `dggChatActionsRef` → **`primaryChatInputRef`**, **`primaryChatActionsRef`**.
  - Context menu: **`dgg?: { showInput, setShowInput }`** → **`primaryChatSource?: { showInput, setShowInput }`**.
- **Internal state and types:** Rename all variables and types that contain "dgg" to generic names: e.g. `dggConnected` → **`primaryChatConnected`**, `dggAuthenticated` → **`primaryChatAuthenticated`**, `dggUserNicks` → **`primaryChatUserNicks`**, `dggNicks` → **`primaryChatNicks`**, `dggInputValue` → **`primaryChatInputValue`**, `dggMeUser` / `dggMeNick` → **`primaryChatMeUser`** / **`primaryChatMeNick`**, `dggPublicSendError` → **`primaryChatPublicSendError`**, etc. Message source type: use a generic union, e.g. **`source: 'primary' | 'kick' | 'youtube' | 'twitch'`** or keep string literal `'dgg'` only if it’s the value coming from the extension (then the app doesn’t hardcode it; it would use e.g. `primaryChatSourceId` from config and compare `m.source === primaryChatSourceId`). So prefer: **primary chat source id from config**, then `m.source === primaryChatSourceId` and no literal `'dgg'` in code.
- **Storage key:** `DGG_WHISPER_USERS_KEY` → **`PRIMARY_CHAT_WHISPER_USERS_KEY`** or **`omni-screen:primary-chat-whisper-usernames`** (no "dgg" in constant name or key if we want zero "dgg" in repo; key could stay for backwards compat but constant name generic).
- **IPC calls:** `dgg-messages-unread`, `dgg-messages-inbox`, `dgg-send-whisper` → **`chat-source-messages-unread`**, **`chat-source-messages-inbox`**, **`chat-source-send-whisper`** with `sourceId` in payload (or omit if only one source).
- **CSS / class names:** `dgg-autocomplete-list` → **`chat-autocomplete-list`** or **`primary-chat-autocomplete-list`**.
- **Comments and JSDoc:** Remove "DGG", "dgg", "destiny"; use "primary chat source", "chat source", "emotes/flairs from chat source config".
- **Emote/flair loading:** Use `config.chatSources[primaryChatSourceId]` (or first entry) for emotesJsonUrl, emotesCssUrl, etc.; element ids like **`primary-chat-emotes-css`** instead of `destiny-emotes-css`.
- **Highlight text:** Comment that says "destiny doesn't match destinycool" → reword to "e.g. a short word doesn’t match a longer emote name".

### 2.3 Menu (src/components/Menu.tsx)

- Comment "Extension platforms (e.g. dgg)" → "Extension platforms (from connectionPlatforms)".
- Kickstiny link: `destinygg/kickstiny` is an external URL; keep the URL as-is (it’s the real org/repo) or don’t mention it in the plan—user said no "dgg/destiny" in the repo; the link is to github.com/destinygg/kickstiny. So either leave URL (it’s external) or change link text to "Kickstiny" only and keep href. Recommendation: keep href for correctness; link text can stay "github.com/destinygg/kickstiny" or be shortened to "Kickstiny (GitHub)" so the string "destiny" doesn’t appear in our UI text.

### 2.4 OmniScreen / CombinedChat: source id flow

- **Single primary source:** App assumes at most one "primary" chat source (the one with chat + live WebSocket). Config exposes `chatSources: { [id]: config }`; app picks first id as `primaryChatSourceId`. All "enable primary", "primary input", "primary nicks", etc. refer to that id. No literal "dgg" in code; only `primaryChatSourceId` which comes from config.
- **Extension settings:** Stored by extension id (e.g. `omni-screen:ext-settings:dgg`). App reads extension settings by id; the id is the one from `config.chatSources` (keys). So app never types "dgg"; it uses `Object.keys(config.chatSources)[0]` or similar to get the id for the primary chat source’s extension.

### 2.5 Utilities and shared code

- **omniColors.ts:** Remove "dgg", "destiny" from comments and from key checks. Use generic key: e.g. **`omniColorForKey(k)`** where the key for the primary chat source is the config id (e.g. `primaryChatSourceId`). So no `k === 'dgg'`; use `k === primaryChatSourceId` passed in or a reserved key like `'primary'`. Alternatively keep a single "primary" color constant and use it when `k === primaryChatSourceId` (id comes from config). No literal "dgg" or "destiny" in this file.
- **LinkScroller, DebugPage, KickEmbed, App.css:** Grep and replace any "dgg"/"destiny" in comments, class names, or code with generic names or remove.

---

## 3. Scripts and docs

- **scripts/chat-upstream-baseline.json**, **scripts/check-chat-upstream.ts**, **scripts/chat-upstream.config.json:** Generic names; config holds upstream repo (data). Extension repo may keep its own upstream check if needed.
- **.env.example:** Remove any DGG/destiny example or comment.
- **README, CHANGELOG, KNOWN-ISSUES, IMPLEMENTED-FEATURES, docs/EMBEDS.md:** Replace all mentions of "dgg", "DGG", "destiny", "Destiny.gg" with "chat source", "extension", "primary chat source", or remove the sentence. External links (e.g. destiny.gg) can stay as URLs if needed for accuracy, or be replaced with "install the chat source extension" and let the extension repo document the URL.

---

## 4. Extension (omni-screen-dgg) responsibilities after migration

- Registers chat source with id **'dgg'** (only place that names "dgg").
- Sets **`overlay.chatSources.dgg`** (or whatever key it uses) with baseUrl, loginUrl, emotesJsonUrl, flairsJsonUrl, platformIconUrl, etc.
- Provides **connectionPlatforms** with one entry (id **'dgg'**, label "Destiny.gg (DGG)", etc.).
- **onLiveMessage** parses dggApi:* and calls api.setLiveEmbeds, api.sendToRenderer with generic channels (e.g. live-websocket-embeds, live-websocket-banned-embeds) so the app never needs to know "dggApi".
- Registers extension settings (includeInCombined, flairsAndColors, labelColor, labelText) under its extension id.
- Main app will call generic IPC **chat-source-send-whisper**, **chat-source-messages-unread**, **chat-source-messages-inbox** with **sourceId: 'dgg'** (or omit and main uses primary); the extension’s config is the one that provides the API base URLs and cookie domains for that source.

---

## 5. Implementation order (suggested)

1. **Phase A – Context and main (generic config and registry)**  
   - Rename DggConfig → ChatSourceConfig; overlay.dgg → overlay.chatSources; getDggConfigFromExtension → getPrimaryChatSourceConfig (iterate registry); getLiveMessageHandler from same registration.  
   - main.ts: use getPrimaryChatSourceConfig() everywhere, no "dgg"/"destiny" in variable names or logs.  
   - CONNECTIONS_AUTH_COOKIE_NAMES and getConnectionsGetCookieUrls built from connectionPlatforms + base only (no hardcoded "dgg" key).

2. **Phase B – IPC and cookie/login**  
   - Rename IPC to chat-source-* with sourceId; login-success and add-embed-from-destiny-link to generic names/payloads.  
   - Cookie domain and CSP logic use only config from registry/overlay.

3. **Phase C – Renderer config and OmniScreen**  
   - App config returns chatSources; OmniScreen uses primaryChatSourceId = first key in chatSources, primaryChatSourceAvailable, primaryChatSourceIconUrl, extensionSettings[primaryChatSourceId], etc.  
   - Remove all "dgg"/"destiny" from state names, refs, keybinds, and comments.  
   - Live feed: use channels like live-websocket-embeds (extension sends normalized payload); remove dggApi:* from app code.

4. **Phase D – CombinedChat**  
   - Props and state use primary chat source id from config; no literal "dgg"; IPC chat-source-* with sourceId.  
   - Rename constants, classes, and comments.

5. **Phase E – Cleanup**  
   - omniColors, Menu, LinkScroller, DebugPage, KickEmbed, CSS.  
   - Scripts and docs: rename files and replace or remove all "dgg"/"destiny" text.  
   - Final grep for "dgg" and "destiny" in repo (excluding extension repo and node_modules) and fix any remaining hits.

---

## 6. Summary

- **Main app:** No references to "dgg" or "destiny". Config, registry, and IPC are keyed by extension-chosen ids (e.g. chatSources[id], connectionPlatforms[].id). Primary chat source = first or only registered source; all behaviour is "primary chat source" or "by sourceId".
- **Extension (omni-screen-dgg):** Only place that uses the id "dgg" and the Destiny.gg URLs; implements onLiveMessage, registerChatSource, setRendererConfig, connectionPlatforms; can send normalized live events so the app never sees "dggApi" strings.
- **Renderer:** Uses config.chatSources and primaryChatSourceId; no "dgg" or "destiny" in code, comments, or UI strings; placeholders like "e.g. streamer" instead of "e.g. destiny".
