# Known issues

## Twitch embed autoplay does not work

Twitch enforces strict autoplay restrictions that block playback when the embed may be obscured by other page elements. Our app has overlay chat, popovers, and other UI that can render above embeds, which triggers Twitch's "style visibility" check and disables autoplay. This is a known limitation of Twitch's embed policy, not something we can work around without removing essential UI.

**Reference:** [Feedback on Autoplay Restrictions in Twitch Embeds (twitchdev/issues#1127)](https://github.com/twitchdev/issues/issues/1127)

## ~~Flash over video embeds (overlay + modals)~~ — fixed

**Root cause (found):** The flash was the **View Transitions API** (`document.startViewTransition`). On every `[Redacted]Api:embeds` message from the live websocket we wrapped the state update in `startViewTransitionIfSupported()`, which created a full-document `::view-transition` overlay for the duration of the transition. That overlay appeared in DevTools under `<html>` as `::view-transition` and matched the flash duration.

**Fix:** Removed the `startViewTransitionIfSupported()` wrapper from the live-websocket embed-list update path. Embed list updates now run the state updates directly with no view transition.

**Previous symptom (for reference):** Content over the embed grid (chat overlay, settings modal) flashed only in the screen region above the video; the `::view-transition` pseudo-element was visible in DevTools for the same duration.
