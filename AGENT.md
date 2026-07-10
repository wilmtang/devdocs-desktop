# Agent notes

Guidance for AI agents (and humans) working on this repo.

## Launching the app for verification/screenshots

Never launch the app straight onto the user's screen or steal their focus.
No `screencapture` of the whole display, no AppleScript `activate` /
`set frontmost to true`.

Instead:

1. **Launch in background mode with a CDP port** (run as a background task):

   ```sh
   DEVDOCS_BACKGROUND=1 npx electron --remote-debugging-port=9223 app/index.js
   ```

   `DEVDOCS_BACKGROUND=1` does two things (both in `app/index.js`): the window
   appears via `showInactive()` (no keyboard focus), and the app sets
   `setActivationPolicy('accessory')` so it launches as a menu-bar agent
   (LaunchServices `type="UIElement"`, like `LSUIElement`) — it never becomes
   the frontmost app, bounces the Dock, or pulls its Space forward.
   `showInactive()` alone does NOT prevent this: the *window* stays unfocused
   but the *app* still activates and steals the screen. Verify with
   `lsappinfo info <pid> | grep type=` → should read `UIElement`, not
   `Foreground`.

   **Arg order matters:** `--remote-debugging-port` must come *before*
   `app/index.js`. Anything after the app path is passed to the app as argv,
   not to Chromium, so the port never binds and `curl :9223/json/list` returns
   nothing.

2. **Inspect and drive the UI over CDP**, not the user's screen:
   - Targets: `curl http://127.0.0.1:9223/json/list` — the host renderer is
     the `page` target with a `file://…/renderer/index.html` URL; devdocs.io
     runs in a separate `webview` target.
   - Use `Runtime.evaluate` for DOM checks and synthetic events
     (Node ≥22 has a native `WebSocket` client; no deps needed).
   - The preload API is reachable from evaluate as `globalThis.electronAPI`
     (e.g. `electronAPI.getShortcut()`).

3. **Screenshot via CDP**, not `screencapture`: `Page.captureScreenshot` on
   the host page target captures the window content even while the app stays
   in the background.

4. Menu items can still be clicked without focusing the app — AppleScript
   `click menu item … of process "Electron"` works on a background process;
   just never set it frontmost. (In dev the process and app menu are named
   "Electron", not "DevDocs".)

5. Kill the instance when done: `pkill -f "electron app/index.js"`.

An example driver script for the global-shortcut panel lives in the session
scratchpad pattern: connect WS → evaluate → `Page.captureScreenshot` →
restore config.
