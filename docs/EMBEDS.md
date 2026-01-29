# Embedded content: iframe, webview, and portal

This doc explains how embeds work in OmniScreen and why Destiny chat cannot run userscripts in-app.

## Why iframe can’t run userscripts

- **Same-origin policy**: The app (e.g. `http://localhost:5173` or your packaged origin) cannot execute or inject JavaScript into a **cross-origin** iframe (e.g. `https://www.destiny.gg`, `https://player.kick.com`). The browser blocks that for security.
- So with a plain **iframe** we can only **display** the page. We cannot inject d.gg utilities, Kickstiny, or any other script into that content.

## Why Kick “works” and Destiny chat doesn’t

- **Kick embeds**  
  - **Without userscript**: We use an **iframe** → page displays, no injection.  
  - **With Kickstiny**: We use a **webview** so Electron can run `webview.executeJavaScript(...)` and inject the script. That works because Electron’s webview gives the main process access to the guest page.
- **Destiny chat**  
  - We **only** use an **iframe**. Display works; we do **not** inject d.gg utilities.  
  - We tried using a **webview** for injection, but in this app the webview guest was not reliably created (e.g. `getAllWebContents()` didn’t show a separate WebContents for the DGG embed), so injection was unreliable.  
  - Electron also recommends avoiding the webview tag (see below). So we keep Destiny chat as iframe-only and do not support in-app userscript injection for it.

So the “difference” is: Kick has a working webview path when Kickstiny is enabled; Destiny chat does not, so we use iframe only and recommend Tampermonkey in a browser for d.gg utilities.

## Webview warning

Electron’s docs state:

> Electron's webview tag is based on Chromium's webview, which is undergoing dramatic architectural changes. This impacts the stability of webviews, including rendering, navigation, and event routing. We currently recommend to **not use the webview tag** and to consider alternatives, like **iframe**, a **WebContentsView**, or an architecture that avoids embedded content altogether.

- **Destiny chat**: We follow that recommendation and use **iframe only** (no webview).  
- **Kick**: We still use **webview** when the “Kickstiny” setting is on, because it’s the only way to inject the userscript and it works in practice. That’s why you may see the webview deprecation warning when Kickstiny is enabled.

## Why not &lt;portal&gt;?

The HTML **&lt;portal&gt;** element is an experimental API for **seamless navigation**: you embed another page in a portal and then “activate” it to navigate into it (SPA-like transitions). It is **not** for running or injecting scripts into embedded content. Same-origin / cross-origin rules still apply; you still cannot inject into a cross-origin portal. The feature is experimental, behind Chrome flags, and the spec has not moved to the standards track. So **&lt;portal&gt; is not appropriate** for userscript injection in embedded chat.

## Destiny embed: two requirements

For the Destiny chat embed, two things matter:

1. **Userscript** – inject d.gg utilities so the embedded chat has the same enhancements as in a browser with Tampermonkey.
2. **Login** – keep the user logged in so the embed shows their identity and permissions.

Login is handled by **session/partition**. The app uses a single persistent partition for the main window and the login window:

- Main window: `partition: 'persist:main'`
- Login window (Destiny): `partition: 'persist:main'`
- When the user logs in via **Login** → destiny.gg/login, cookies (`sid`, `rememberme`) are set in that partition and persist across restarts.

So for **login to work in the embed**, the embed must use the **same partition** (`persist:main`). Then it shares the cookie jar with the login window and stays logged in. (Note: “Discord can’t auth inside an iframe” refers to doing the Discord OAuth flow *inside* the embed; logging in via the separate login window and then loading the embed works.)

---

## Comparison: iframe vs webview vs WebContentsView

| Approach | Userscript injection | Login (same partition) | Drawbacks |
|--------|-----------------------|-------------------------|------------|
| **iframe** | ❌ No. Same-origin policy blocks the host from running or injecting script into a cross-origin iframe. | ✅ Yes. The iframe runs in the main window’s renderer, which uses `persist:main`, so it shares cookies with the login window. | Cannot inject d.gg utilities. |
| **webview** (`<webview>`) | ✅ Yes, in principle. Electron can run code in the guest via `webview.executeJavaScript()`. Use `partition="persist:main"` so the guest shares the session. | ✅ Yes. With `partition="persist:main"` the webview guest uses the same cookie jar as the login window. | (1) Electron recommends *not* using the webview tag (stability, future changes). (2) In our attempt for the Destiny embed the webview guest was not reliably created (e.g. no separate WebContents in `getAllWebContents()`), so injection didn’t work in practice. |
| **WebContentsView** (main process) | ✅ Yes. Main process creates a WebContents, loads the embed URL, and injects with `webContents.executeJavaScript()`. Use partition `persist:main`. | ✅ Yes. Same partition as login window → shared cookies. | More work: main process must create and embed the view, drive position/size (e.g. via IPC or setBounds), and handle lifecycle. No deprecated tag, but a larger refactor. |

**Summary**

- **iframe**: login ✅, userscript ❌. Good for “display only.”
- **webview**: login ✅ (same partition), userscript ✅ in theory; in our Destiny setup the guest wasn’t reliable, so we don’t use it for Destiny.
- **WebContentsView**: login ✅ (same partition), userscript ✅, no deprecated tag; cost is complexity and refactor.

So there *is* a good way to get both userscript and login: **webview** (if we can make the guest reliable) or **WebContentsView** (if we’re willing to do the main-process embed). The current Destiny embed uses iframe so we get login but not userscript; adding userscript means either fixing the webview path or implementing the WebContentsView path.

---

## What has been tested

- **Webview for Destiny chat**: Tried in-app. The webview guest was not reliably created (e.g. `getAllWebContents()` did not show a separate WebContents for the DGG embed in dev), so script injection did not run in the right context. Electron also recommends avoiding the webview tag. Not used for Destiny.
- **BrowserView for Destiny chat**: Implemented in `electron/destinyEmbedView.ts`. Main process creates a single BrowserView with partition `persist:main`, loads `destiny.gg/embed/chat`, fetches the d.gg utilities userscript and injects on `did-finish-load`. Renderer sends bounds via IPC (ResizeObserver on the slot). Detach: view is moved to a new window; closing that window re-attaches the view to the main window. Single instance only (one websocket). Tested: layout, injection, login (same partition), detach/reattach. **Electron #35994** (BrowserView setBounds inconsistent on Windows) was fixed in **Electron 27** (PR #38981, July 2023); with Electron 27+ we use BrowserView on all platforms when d.gg utilities is on. **Viewport scaling**: On Windows (and with DPI scaling), the renderer’s `innerWidth`/`innerHeight` often differ from the main process `getContentSize()`. We **must** send viewport size with bounds and scale in main (`final = bounds * (contentSize / viewportSize)`) so the BrowserView aligns with the slot. Do not remove viewport from the IPC payload or the scaling in `destiny-embed-set-bounds`; without it the embed renders in the wrong place.

### Findings (d.gg utilities injection)

- **GM API**: The d.gg utilities script expects the **Tampermonkey-style** API, not Greasemonkey `GM_*` globals. It uses:
  - **`GM_info.script.version`** – required at load; without it the script throws and never runs.
  - **`GM.xmlHttpRequest`** – used for phrases, nukes, mutelinks, providers, embeds; the callback expects an object with **`.response`** (body text), **`.status`**, and **`.responseHeaders`**, not only `responseText`.
  - **`GM.registerMenuCommand`** – used for “Check for updates” (we stub it as a no-op).
- We inject a **GM stub** (in `destinyEmbedView.ts`) before the userscript: `GM_info`, `GM` object with `xmlHttpRequest` (fetch-based, correct response shape), `registerMenuCommand`, and legacy `GM_*` for compatibility. No extra UI (e.g. no debug badge) is added; the script’s own “d.gg utilities settings” and tool buttons are from the userscript.
- Injection runs in **all frames** (`mainFrame.framesInSubtree`) and is **retried** at 0 ms, 800 ms, and 2500 ms after `did-finish-load` so late-loaded iframes get the script. The embed page currently has a single frame; multi-frame support is in place for future changes.

### Other notes

- **MaxListenersExceededWarning**: Node warns when more than 10 listeners are added to an EventEmitter (default `maxListeners` is 10). The main window and other created windows (login, viewer, Kick login, Destiny detached) can accumulate listeners (e.g. `closed`, webRequest, destiny-embed, etc.). We call `setMaxListeners(20)` (or `40` for the main window) on each `BrowserWindow` when created to avoid the warning.
- **Embed position when DevTools opens**: Opening the developer console changes the layout (window or pane resizes). The Destiny embed (BrowserView) bounds are driven by the renderer via a slot’s `getBoundingClientRect()` and `ResizeObserver`. `ResizeObserver` only fires when the **element’s size** changes, not when it **moves** (e.g. when DevTools takes space). We send bounds on **window `resize`** and defer the read (double `requestAnimationFrame` + 120 ms fallback) so layout and DevTools dock position have time to settle before we measure the slot. Bounds are taken only from the **slot div’s** `getBoundingClientRect()` (viewport-relative); bounds are sent as-is (no main-process offset). ResizeObserver and window resize are **throttled** to one update per animation frame so resizing the pane isn't choppy. **Inspect** (chat header) opens DevTools for the embed; or use **Detach** to inspect in its own window. **Known limitation**: When DevTools are docked on the left, the embed can be offset (viewport origin ≠ window origin). Correcting this with `getContentBounds()` / `getBounds()` in the main process broke normal rendering or didn't fix it, so we leave it as-is; use right/bottom/external dock or close DevTools if it bothers you.

## Manual embeds (Omni Screen dock)

- **Paste link**: In the Omni Screen dock, **+ Link** opens a dropdown. You can paste a **YouTube**, **Kick**, or **Twitch** URL and click **Add** to add that embed to the list and grid. Manual embeds are persisted in `localStorage` and merged with the DGG websocket list.
- **YouTube channel (live or latest)**: In the same dropdown, you can enter a **YouTube channel ID** (e.g. `UC...`), a **channel URL** (`youtube.com/channel/UC...`), or an **@handle** URL (e.g. `youtube.com/@AgendaFreeTV` or `@AgendaFreeTV`). Click **Add live/latest** to resolve the channel to the current **live stream** (or premiere) or, if not live, the **latest published video**, then add that video as an embed. No YouTube API key: the main process scrapes the channel page for `{"text":" watching"}` to get the live video ID, and falls back to the channel RSS feed (`/feeds/videos.xml?channel_id=...&orderby=published`) for the latest video. Implemented in `electron/youtubeLiveOrLatest.ts` and exposed via IPC `youtube-live-or-latest`.

## Summary (current app behavior)

| Embed            | Container   | Userscript injection in-app        |
|------------------|------------|------------------------------------|
| Destiny chat (d.gg utilities off) | iframe  | No                                 |
| Destiny chat (d.gg utilities on)  | BrowserView | Yes – injected from main process (all platforms; Electron 27+ fixed #35994) |
| Kick (Kickstiny off) | iframe  | No                                 |
| Kick (Kickstiny on)  | webview | Yes – script injected via Electron |
| Manual (paste link / YouTube channel) | iframe in grid | N/A – video embeds only |
