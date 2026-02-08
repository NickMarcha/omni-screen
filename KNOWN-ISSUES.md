# Known issues

## ~~Flash over video embeds (overlay + modals)~~ — fixed

**Root cause (found):** The flash was the **View Transitions API** (`document.startViewTransition`). On every `dggApi:embeds` message from the live websocket we wrapped the state update in `startViewTransitionIfSupported()`, which created a full-document `::view-transition` overlay for the duration of the transition. That overlay appeared in DevTools under `<html>` as `::view-transition` and matched the flash duration.

**Fix:** Removed the `startViewTransitionIfSupported()` wrapper from the live-websocket embed-list update path. Embed list updates now run the state updates directly with no view transition.

**Previous symptom (for reference):** Content over the embed grid (chat overlay, settings modal) flashed only in the screen region above the video; the `::view-transition` pseudo-element was visible in DevTools for the same duration.
