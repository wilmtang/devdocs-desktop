# DevDocs Desktop — Architecture & Inner Workings

This document explains how the app actually works, at the level of detail you'd
need to defend every design decision in a code review or interview. The app is
deliberately small — no bundler, no framework, ~1,500 lines of plain JS — but
almost every line encodes an Electron sharp edge. This is the map of those
edges.

- [1. The 30-second mental model](#1-the-30-second-mental-model)
- [2. The four JavaScript contexts](#2-the-four-javascript-contexts)
- [3. Startup sequence](#3-startup-sequence)
- [4. Why a `<webview>` and not a plain BrowserWindow](#4-why-a-webview-and-not-a-plain-browserwindow)
- [5. Security model](#5-security-model)
- [6. IPC catalogue](#6-ipc-catalogue)
- [7. Navigation policy and deep links](#7-navigation-policy-and-deep-links)
- [8. Windows, tabs, and the hide-don't-quit lifecycle](#8-windows-tabs-and-the-hide-dont-quit-lifecycle)
- [9. The zoom pipeline](#9-the-zoom-pipeline)
- [10. Dark mode sync](#10-dark-mode-sync)
- [11. Find-in-page (the Searcher)](#11-find-in-page-the-searcher)
- [12. Custom CSS / JS injection](#12-custom-css--js-injection)
- [13. Context menus](#13-context-menus)
- [14. Config store](#14-config-store)
- [15. Global shortcut and tray](#15-global-shortcut-and-tray)
- [16. Offline: what actually makes docs work without network](#16-offline-what-actually-makes-docs-work-without-network)
- [17. Updates](#17-updates)
- [18. Repo layout and packaging](#18-repo-layout-and-packaging)
- [19. Grilling round: the curveball questions](#19-grilling-round-the-curveball-questions)

## 1. The 30-second mental model

DevDocs Desktop ships **zero documentation content**. It is a hardened shell
around the devdocs.io web app:

```
┌─ Electron main process (app/index.js) ──────────────────────────────┐
│  windows/tabs · menu · tray · global shortcut · config.json ·       │
│  IPC handlers · URL policy · deep links · updater                   │
└──────────────┬──────────────────────────────────────────────────────┘
               │ loads (file://)
┌─ Host renderer: app/renderer/index.html + main.js ──────────────────┐
│  local page, CSP-locked. Owns the error overlay, the find-in-page   │
│  widget, dark-mode class, and creates…                              │
│  ┌─ <webview> guest: https://devdocs.io ─────────────────────────┐  │
│  │  the actual devdocs.io SPA, with preload.js injected.         │  │
│  │  Its own service worker + IndexedDB provide offline mode.     │  │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Everything interesting is in how these three layers talk (IPC), what each is
allowed to do (security), and what devdocs.io itself brings to the table
(search, offline storage).

## 2. The four JavaScript contexts

| Context | File(s) | Privileges | Job |
|---|---|---|---|
| Main process | `app/index.js`, `menu.js`, `tray.js`, `updater.js`, `config.js`, `utils.js` | Full Node + Electron | Window management, IPC handlers, URL policy, persistence |
| Host renderer | `app/renderer/index.html`, `main.js`, `searcher.js` | None (sandboxed, `contextIsolation: true`, `nodeIntegration: false`) — only the `electronAPI` bridge | UI chrome around the webview |
| Host preload | `app/renderer/preload-window.js` | Sandboxed preload: `ipcRenderer` + `contextBridge` only | Defines the *entire* API surface the host renderer gets |
| Guest preload | `app/renderer/preload.js` | Sandboxed preload inside the devdocs.io page | Zoom application, dark-mode detection; talks *only* to the host via `sendToHost` |

Plus a fifth context the repo doesn't own: **devdocs.io's service worker**
(`https://devdocs.io/service-worker.js`), registered by the site itself inside
the webview's session. It is what serves the app shell when offline (§16).

Key subtlety: sandboxed preloads cannot `require('node:path')` or anything
from `node_modules`. That's why `preload-window.js` hand-rolls the
`~/.devdocs` path join with `process.env.HOME`/`USERPROFILE` and a manual
separator instead of using `path.join` — the only modules available to a
sandboxed preload are a polyfilled subset (`electron`, events, timers).

## 3. Startup sequence

1. **Single-instance lock** — `app.requestSingleInstanceLock()`. On failure,
   `app.exit(0)`, *not* `app.quit()`: `quit()` merely emits lifecycle events
   and lets the rest of the module body keep executing (registering protocol
   handlers, creating windows) before teardown; `exit()` stops immediately.
2. Module-level registrations: IPC handlers, `app.setAsDefaultProtocolClient('devdocs')`,
   and on macOS an `open-url` listener installed inside `will-finish-launching`
   (the documented ordering requirement so URLs delivered at launch aren't
   missed). On Windows/Linux, a `devdocs://` URL arrives in `process.argv`
   instead and is stashed in `urlToOpen`.
3. **`ready`**: register the global shortcut(s) from config, build the
   application menu, create the main `BrowserWindow` (hidden, `show: false`),
   create the tray (Windows/Linux only — `tray.js` returns early on darwin).
4. **`ready-to-show`**: show the window (avoids the white flash of an
   unpainted window), start the auto-updater, and flush any buffered deep
   link with `webContents.send('navigate', urlToOpen)`.
5. The host renderer boots, registers its IPC listeners **before** creating
   the webview — a deliberate ordering (`main.js` has a comment about it):
   the main process can fire `navigate` while devdocs.io is still loading,
   and a message sent before a listener exists is silently lost.
6. The webview loads `https://devdocs.io`. On its `dom-ready`, the host
   injects base + custom CSS, runs custom JS, applies the saved zoom factor,
   and flushes `pendingNavigate` (a second buffering layer, see §7).

Two independent "message might arrive too early" buffers exist: `urlToOpen`
in the main process (window not created yet) and `pendingNavigate` in the
host renderer (webview not `dom-ready` yet). Both exist because deep links
race against startup.

## 4. Why a `<webview>` and not a plain BrowserWindow

The obvious implementation — `win.loadURL('https://devdocs.io')` — would give
remote web content the whole window. The `<webview>` architecture buys:

- **A trusted UI layer that remote content can't touch.** The find-in-page
  widget, the load-error overlay, and the dark backdrop live in a local
  `file://` page. devdocs.io renders inside a separate guest process and
  cannot script, restyle, or spoof them.
- **A second preload boundary.** The guest gets its own tiny preload
  (`preload.js`) whose only channel outward is `ipcRenderer.sendToHost` —
  it cannot reach the main process directly.
- **`findInPage` on someone else's page.** Chromium's native find API is
  exposed per-webContents; the host calls `webview.findInPage()` against the
  guest without devdocs.io cooperating (§11).
- **Failure UX.** `did-fail-load` on the webview toggles the local error
  overlay with a Retry button; the app itself never white-screens.

Costs accepted: `webviewTag: true` must be enabled (it's off by default and
Electron discourages it), and webview has quirks (e.g. the `preload`
attribute must be an absolute `file:` URL, which is why `main.js` builds it
with `new URL('preload.js', location.href).href`).

The host page also sets a strict CSP
(`default-src 'self'; script-src 'self'; style-src 'unsafe-inline' 'self'`)
— host chrome can only run local scripts. The CSP does not govern the guest;
the guest is confined by the webview process boundary instead.

## 5. Security model

Threat model: devdocs.io (or anything it links to) is remote content and must
not gain code execution or filesystem access on the user's machine.

**Renderer hardening.** Both the host window and the webview run with
`nodeIntegration: false`, `contextIsolation: true`, sandboxed preloads.
The host renderer's entire capability set is the `electronAPI` object exposed
via `contextBridge` — five `invoke` wrappers, a platform string, a path
helper, and an event subscription function.

**IPC allowlist.** `onIPC(channel, cb)` in `preload-window.js` checks the
channel against a hardcoded six-entry allowlist before subscribing. A
compromised host renderer can't listen on arbitrary channels. It returns an
unsubscribe closure (good hygiene, currently unused).

**Filesystem jail.** The only fs primitives exposed are
`fs:readFile` / `fs:writeFile` / `fs:exists`, and every path funnels through
`resolveConfigPath()` in `index.js`:

```js
const resolved = path.resolve(base, String(filePath))
if (resolved !== base && !resolved.startsWith(base + path.sep)) throw …
```

- `path.resolve` collapses `../` traversal and makes absolute inputs replace
  the base — so `/etc/passwd` resolves to itself and fails the prefix check.
- The `base + path.sep` concatenation prevents the classic sibling-directory
  bypass (`~/.devdocs-evil` starts with `~/.devdocs` but not with
  `~/.devdocs/`).
- `String(filePath)` coerces non-string payloads a hostile renderer might
  send through `invoke`.

Net result: the renderer can read/write only inside `~/.devdocs`.

**URL policy.** Three gates in the main process:

1. `setWindowOpenHandler` on the guest (installed in `did-attach-webview`)
   returns `{action: 'deny'}` for *everything* — no `window.open` ever
   creates an unmanaged Electron window. devdocs.io URLs are rerouted into a
   managed tab; everything else goes to `shell.openExternal`.
2. `will-navigate` on the guest blocks top-level navigation away from the
   `devdocs.io` hostname (checked by parsing with `new URL`, not string
   matching — `https://devdocs.io.evil.com` fails the `hostname ===` test).
3. `openExternal()` is wrapped by `isHttpUrl()`, so only `http:`/`https:`
   reach the OS. This blocks the `shell.openExternal('file://…')` /
   `smb://` / custom-protocol class of attacks even if a malicious link gets
   as far as the router.

The webview needs the `allowpopups` attribute for this to work at all —
without it, `window.open`/`target=_blank` are dropped inside the guest and
never reach `setWindowOpenHandler`, which would silently kill "open in new
tab".

## 6. IPC catalogue

**Renderer → main (`ipcMain.handle` / `invoke`):**

| Channel | Payload | Purpose |
|---|---|---|
| `config:get` | key | Read from the in-memory config |
| `config:set` | key, value | Write + atomic persist (§14) |
| `fs:readFile` | path (jailed) | Read `custom.css`/`custom.js` |
| `fs:writeFile` | path, data (jailed) | Seed empty custom files |
| `fs:exists` | path (jailed) | Existence check |
| `shortcut:get` | — | Current `toggleApp` `{accelerator, enabled}` |
| `shortcut:set` | accelerator, enabled | Re-register + persist; returns `{ok, error, accelerator, enabled}` (on failure the old combo stays) |
| `shortcut:suspend` | suspend | Release/re-acquire the combo while the settings panel records a new one |

**Main → host renderer (`webContents.send`):**

| Channel | Sender | Effect |
|---|---|---|
| `navigate` | deep links, tab creation | `navigateTo(url)` — sets `webview.src` (buffered until webview ready) |
| `open-search` | View ▸ Search In Page (Cmd/Ctrl+F) | `searcher.open()` |
| `open-shortcut-settings` | Preferences ▸ Change Global Shortcut… | `shortcutPanel.open()` |
| `focus-webview` | `browser-window-focus` | Refocus guest so devdocs keyboard shortcuts work |
| `zoom-in` / `zoom-out` / `zoom-reset` | View menu | Forwarded to guest via `webview.send` |

**Host ↔ guest (webview-scoped, never touches main):**

| Direction | Channel | Purpose |
|---|---|---|
| host → guest (`webview.send`) | `zoom-in/out/reset`, `set-zoom` | Adjust / restore zoom |
| guest → host (`ipcRenderer.sendToHost`, received as `ipc-message`) | `zoom-changed` | Host persists new factor |
| guest → host | `switch-mode` | Dark/light detected in the page (§10) |

The layering is strict: the guest never talks to main directly, and main never
addresses the guest — the host renderer is the relay in both directions.

## 7. Navigation policy and deep links

The app registers the `devdocs://` protocol. Delivery is wildly
platform-dependent, and the code handles all three shapes:

- **macOS, app running or not:** `open-url` event (registered inside
  `will-finish-launching`).
- **Windows/Linux, first instance:** the URL is an argv entry, found by
  `argv.find(arg => arg.startsWith('devdocs://'))`.
- **Windows/Linux, app already running:** the OS launches a second process;
  the single-instance lock bounces it, and its argv arrives in the first
  instance's `second-instance` event.

All paths converge on `openDeepLink()` → host `navigate` message →
`navigateTo()` in `main.js`, which understands one route:
`devdocs://search/<query>` becomes `https://devdocs.io/#q=<query>` (devdocs
runs a search on the `#q=` fragment at load). Plain https URLs (from
tab-routing) are assigned to `webview.src` directly.

## 8. Windows, tabs, and the hide-don't-quit lifecycle

**Tabs are windows.** Every "tab" is a full `BrowserWindow` with its own
host page and webview. On macOS they *look* like tabs because each window is
created with `tabbingIdentifier: 'devdocs-tabs'` and attached with
`parent.addTabbedWindow(tab)` — the native macOS window-tabbing mechanism
(the same one Finder/Terminal use, also enabled app-wide via
`AppleWindowTabbingMode: always` in the build's `extendInfo`). Cmd+T is a menu
item that re-emits Electron's own `new-window-for-tab` event (the event macOS
fires when the "+" button in the tab bar is clicked), so both entry points
share one code path. On Windows/Linux there is no native tabbing, so a "tab"
is just another window, cascaded by `allWindows.size * 24` pixels so stacked
windows stay visibly distinct.

**Close ≠ quit.** The `close` handler checks `isQuitting || allWindows.size > 1`.
Closing a non-last tab really closes it; closing the *last* window calls
`e.preventDefault()` and hides instead — `app.hide()` on macOS (returns focus
to the previously active app, which a bare `win.hide()` wouldn't) and
`win.hide()` elsewhere (into the tray). Actual quit paths (Cmd+Q, tray Quit)
set `isQuitting = true` in `before-quit`, which also persists window bounds —
guarded by `!win.isFullScreen()` so a fullscreen quit doesn't save
screen-sized bounds as the restore state.

Window state is additionally saved on main-window `close`; the redundancy is
intentional, since quitting from the tray means no window close event carries
useful geometry.

## 9. The zoom pipeline

Zoom is a five-hop round trip, and the state of record lives in the guest:

```
View menu (Cmd+Plus)
  → main: sendAction('zoom-in')            [webContents.send to host]
  → host: webview.send('zoom-in')          [forward into guest]
  → guest preload: clamp factor to 0.8–1.6 in 0.1 steps,
      write `body {zoom: X !important}` into <style id="zzz-devzoom">
  → guest: sendToHost('zoom-changed', X)
  → host: api.setConfig('zoomFactor', X)   [persist via config:set]
```

On every webview `dom-ready`, the host reads the saved factor and replays it
with `set-zoom`, so zoom survives restarts and page reloads.

Why CSS `zoom` on `<body>` instead of Electron's
`webContents.setZoomFactor()`? Chromium zoom is keyed per-origin and mutating
it can leak into other webContents on the same origin/session and reset
unpredictably across navigations; a style element owned by the preload is
dumb but fully deterministic, and replaying it on `dom-ready` is trivial. The
`zzz-` id prefix is just collision paranoia against devdocs.io's own DOM.

## 10. Dark mode sync

Two systems need to agree: devdocs.io's own theme (a `dark=1` cookie plus a
settings checkbox) and the host chrome (the backdrop behind the webview — if
it stayed white, every page load would flash white in dark mode).

The guest preload:
- On `DOMContentLoaded`, tests `document.cookie` against
  `/(?:^|;\s*)dark=1(?:;|$)/` (anchored so `notdark=1` or `dark=10` don't
  match, and tolerant of `dark=1` being the final cookie with no trailing
  semicolon) and reports `switch-mode`.
- Listens for `change` events on the page and forwards the state of the
  `name="dark"` checkbox — that's devdocs.io's settings toggle, observed
  from outside without hooking its code.

The host toggles `body.is-dark-mode` (styling the chrome) and persists
`mode` in config, which is read back at next startup *before* the webview
exists — so the backdrop is dark from the first paint. The config default is
`mode: 'dark'`.

## 11. Find-in-page (the Searcher)

devdocs.io's own search bar searches doc *entries*; Cmd+F text search within
the current page is provided by the shell. `searcher.js` is a dependency-free
widget class living in the host page:

- UI is lazily built on first open (constructor is cheap; `#initialize()`
  runs once) and docked to the host page's top-right edge.
- Wraps Chromium's find API on the guest: `webview.findInPage(text, opts)` /
  `stopFindInPage('clearSelection')`.
- The `findNext` flag semantics are the subtle part: omitting it starts a
  find session, while `findNext: true` advances within that session. Electron
  43 ignores a first request that explicitly passes `false`, so the Searcher
  only adds the option when the query matches `#activeQuery`.
- Match position ("3/17") comes back asynchronously via the webview's
  `found-in-page` event; the handler also refocuses the input because
  `findInPage` moves focus into the guest.
- After the native request's `finalUpdate`, the guest scans visible text-node
  matches in `._content`, deduplicates matches on the same line, and renders
  yellow location ticks over that pane's scrollbar. Waiting for `finalUpdate`
  matters: executing guest JavaScript earlier interrupts Chromium's find
  request. Empty queries and close remove both the selection and marker rail.
- On close it clears the selection and re-focuses the webview (via the
  `close` event → `webview.focus()` wiring in `main.js`).

The flow for Cmd+F: menu accelerator → main sends `open-search` to the
focused window's host renderer → `searcher.open()`.

## 12. Custom CSS / JS injection

At startup the host ensures `~/.devdocs/custom.css` and `~/.devdocs/custom.js`
exist (creating them empty through the jailed fs IPC). On every webview
`dom-ready`:

1. `webview.insertCSS(baseCSS + customCSS)` — `baseCSS` carries two in-house
   fixes for devdocs.io styling (focus outline, search-clear button offset).
2. If `custom.js` is non-blank, `webview.executeJavaScript(customJS)`.

The Preferences menu items just `shell.openPath()` those files in the user's
default editor. Note the trust asymmetry: custom JS runs in the guest's main
world with the user's blessing — it's user-authored, not remote, content.

## 13. Context menus

Both webContents get a `context-menu` listener in the main process, feeding
one builder (`buildContextMenu(params, webContents?)`):

- Spellcheck suggestions (guest only) with `replaceMisspelling()`.
- Editable fields: undo/redo/cut/copy/paste/select-all roles.
- Links: "Open Link in Browser" (through the `isHttpUrl` gate, like all
  external opens).
- Text selection: "Search Google/DuckDuckGo for …" via `shell.openExternal`.
- Inspect Element (guest menu only — the presence of the `webContents`
  argument is what distinguishes guest from host menus).

Menus are built from scratch per right-click, so they're always contextual.

## 14. Config store

`config.js` is a ~70-line synchronous JSON store — deliberate; the dataset is
four keys (`lastWindowState`, `shortcut`, `mode`, `zoomFactor`) and a
dependency like `electron-store` would be the heaviest thing in the app.

- Location: `<userData>/config.json`.
- Loaded once at require time, merged over defaults; reads are memory-only,
  every `set()` rewrites the file.
- **Atomic writes**: write to `config.json.tmp`, then `fs.renameSync` over
  the target. Rename is atomic on POSIX, so a crash mid-write can't leave a
  half-written (corrupt JSON) config; worst case the old file survives.
- Corrupt/unreadable config falls back to defaults instead of crashing.
- `migrate()` folds two historical shapes of shortcut storage
  (`{toggleApp: 'alt+space'}` strings and flat `'shortcut.toggleApp'` keys)
  into the current `{accelerator, enabled}` records, so ancient installs
  upgrade in place.

## 15. Global shortcut and tray

The `toggleApp` shortcut (default `Alt+Space`, stored with an `enabled` flag)
is registered on `ready`. Toggle logic: if the window is focused, hide it —
on macOS via `Menu.sendActionToFirstResponder('hide:')`, which is the trick
that returns focus to the previously frontmost app (plain `win.hide()`
leaves focus nowhere useful); otherwise show + focus. The menu item flips
registration at runtime and persists the flag, then rebuilds the menu so its
label updates.

The combo itself is user-configurable: Preferences ▸ *Change Global
Shortcut…* opens an in-window recorder panel (`renderer/shortcut-panel.js`,
Dash-style: click the field, press the combo). All registration flows through
`utils.updateShortcut`, which releases the previously stored accelerator
before registering the new one and, if the OS rejects the combo (taken by
another app, `register()` returns false or throws on malformed strings),
restores the old registration and reports failure so the panel can show an
error instead of silently losing the shortcut. While the panel records,
`shortcut:suspend` releases the live registration so pressing the current
combo doesn't hide the window mid-recording. The renderer maps
`KeyboardEvent.code` to Electron accelerator syntax and requires at least one
modifier for non-function keys; display is symbolic on macOS (`⌃⌥Space`),
`Ctrl+Alt+Space`-style elsewhere.

The tray exists only on Windows/Linux (`tray.js` returns early on darwin —
macOS already has the dock for the hide-don't-quit lifecycle). Click toggles
window visibility; the context menu has Toggle and Quit.

## 16. Offline: what actually makes docs work without network

**The Electron shell contributes exactly one thing here: persistence.** The
webview declares no `partition` attribute, so it uses the default session,
whose storage (cookies, IndexedDB, Cache Storage, service worker
registrations) lives on disk under `userData` and survives restarts. Had it
used an in-memory partition, offline mode would silently break. Everything
else is devdocs.io's own PWA machinery running inside the webview:

- **App shell**: devdocs.io registers `service-worker.js`, which caches the
  UI (HTML/JS/CSS/fonts). When the app starts with no network, the webview
  request for `https://devdocs.io` never reaches DNS — the service worker
  serves it from Cache Storage. The shell's `did-fail-load` overlay never
  fires because the load *succeeds*.
- **Doc content**: docs you install from devdocs.io ▸ menu ▸ *Offline* are
  downloaded as a single `db.json` per doc (~2–60 MB) and stored in
  IndexedDB. Page views hit IndexedDB before the network.
- **Search index**: the fuzzy search runs entirely client-side over locally
  stored entry indexes for every *enabled* doc — search never needs the
  network.

The critical user-facing distinction: **enabled ≠ installed.** Enabling a doc
stores its search index (search suggestions work offline); only *installing*
it stores page content. Offline, an enabled-but-not-installed doc yields
search hits whose pages fail with devdocs' "you could be offline" message.

This was verified empirically against this build (Electron 43): with all DNS
blackholed via `--host-resolver-rules="MAP * ~NOTFOUND"`, a cold app start
loaded the full UI from the service worker, search for `cache-control`
returned entries from an installed HTTP doc, and the page rendered ~19 KB of
content from IndexedDB; a non-installed doc's page failed gracefully.

Corollaries worth knowing: the first launch must happen online (to register
the service worker); and clearing the app's browsing data — or the OS
evicting storage under disk pressure — deletes the docs.

## 17. Updates

Two independent mechanisms:

- **Automatic** (`updater.js`): `electron-updater`'s
  `checkForUpdatesAndNotify()`, gated to `app.isPackaged && win32`. macOS is
  excluded because electron-updater requires a code-signed app to swap
  binaries and these builds ship unsigned (`notarize: false` in the build
  config); Linux users get distro-style updates.
- **Manual** (menu ▸ Check for Updates): fetches the latest GitHub release
  via the REST API and compares with `compareSemver()` — a hand-rolled
  3-component comparison that strips prerelease/build suffixes
  (`1.2.3-beta` → `1.2.3`) and coalesces missing/NaN parts to 0 so a
  malformed tag can't poison the comparison. If newer, offers to open the
  releases page; it never downloads anything itself.

## 18. Repo layout and packaging

electron-builder's **two-package.json structure**:

- Root `package.json`: devDependencies (electron, electron-builder, xo,
  prettier) and the `build` config. Never ships.
- `app/package.json` + `app/node_modules`: the four runtime deps
  (`electron-updater`, `electron-log`, `fs-extra`, `js-yaml`). Only this
  tree is packed into the asar.

The `postinstall: electron-builder install-app-deps` hook installs the app
tree's deps (compiled against Electron's ABI where needed). There is no build
step at all — no bundler, no transpiler; the renderer uses classic `<script>`
tags (which is why `searcher.js` assigns to `globalThis` instead of using
modules). Dev loop is `npm run app`, edit, Cmd+R.

Packaging targets: dmg (unsigned, hardened runtime with the entitlements in
`build/`), nsis/zip/portable on Windows, AppImage/deb/tar.xz on Linux.
`asar: true`, `compression: maximum`.

## 19. Grilling round: the curveball questions

**Q: Why `app.exit(0)` instead of `app.quit()` when the single-instance lock
fails?**
`quit()` is graceful: it emits events and returns, so the rest of `index.js`
would keep executing — registering IPC handlers, protocol clients, possibly
racing window creation — before the process dies. `exit()` terminates now.
For a duplicate instance there is nothing to clean up.

**Q: Why is `-3` special-cased in `did-fail-load`?**
`-3` is `ERR_ABORTED`, which Chromium reports for cancelled loads — including
ordinary in-page/hash navigations interrupting a pending load. Treating it as
failure would flash the error overlay during normal devdocs.io SPA usage.
Subframe failures (`!isMainFrame`) are ignored for the same reason: an ad-ish
iframe failing shouldn't nuke the whole UI.

**Q: A message sent with `webContents.send` before the renderer subscribed —
what happens?**
It's dropped silently; Electron IPC has no queueing or replay. That single
fact explains two pieces of the design: `urlToOpen` buffering in main, and
registering `api.onIPC` handlers in `main.js` *before* `createWebView()`.

**Q: Why does the fs jail compare against `base + path.sep` and also allow
`resolved === base`?**
`startsWith(base)` alone admits sibling directories like `~/.devdocsX`
(classic prefix-match bypass). Appending the separator fixes that but would
then reject the base directory itself, hence the equality escape hatch.

**Q: Why parse URLs with `new URL` instead of `url.startsWith('https://devdocs.io')`?**
String prefixes are spoofable: `https://devdocs.io.attacker.com` and
`https://devdocs.io@attacker.com` both pass a prefix check. Parsing and
comparing `hostname === 'devdocs.io'` is not spoofable, and the `try/catch`
around the constructor makes malformed URLs fail closed.

**Q: What breaks if you remove `allowpopups` from the webview?**
Every `window.open`/`target=_blank` inside devdocs.io is silently blocked in
the guest before `setWindowOpenHandler` runs — "open in new tab" and external
links die with no error. The attribute opts *in* to popups so the main
process can then police them (and it denies all of them, rerouting instead).

**Q: Why does the guest preload build the config path by hand instead of
`require('node:path')`?**
Sandboxed preloads (the default when the embedder is sandboxed) get only a
polyfilled module subset — no `node:path`, no `node_modules` resolution. So
`preload-window.js` joins `HOME`/`USERPROFILE` with a platform-picked
separator manually.

**Q: Two windows both write config on close — who wins?**
Last writer. Writes are synchronous whole-file replaces on the main process's
single thread, so there's no interleaving/corruption (and the tmp+rename
makes each write atomic against crashes), but the *value* is
last-write-wins. For `lastWindowState` that's acceptable by design.

**Q: Where would you look if offline mode "randomly" stopped working?**
In order: (1) did the session storage get cleared (userData deleted, or
storage evicted under disk pressure)? (2) did devdocs.io ship a
service-worker change that invalidated the cached shell while offline?
(3) is the doc merely *enabled* rather than *installed* — search entries
appear but pages 404 with the offline message. The Electron shell has no
code in this path; debugging happens in the webview's DevTools
(Application ▸ Service Workers / IndexedDB).

**Q: Why does zoom cap at 0.8–1.6?**
CSS `zoom` reflows the page; devdocs.io's fixed sidebar layout degrades
outside that band. The clamp lives in the guest preload because that's where
the factor is applied — the host just relays and persists.
