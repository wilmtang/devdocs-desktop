# Codebase Audit — devdocs-desktop

> **Status (2026-07-09):** Phases 1–5 implemented in the working tree. Exceptions:
> `release.yml` left untouched (changing the release pipeline is untestable here — see
> Part 3.1), and the optional smoke-test suite (Part 3.5) was not added. Verified: xo lint
> clean; app smoke-launched with no errors; webview preload confirmed working end-to-end
> (dark-mode sync wrote `mode` to config); shortcut config migrated to the new shape.

Audited: 2026-07-09. Scope: `app/` (main + renderer), build config, CI workflows.
Context: the app was recently migrated to Electron 43 ("Modernize toolchain" commit). Several
findings are regressions from that migration — APIs that were removed or tightened between
Electron versions. All Electron API claims below were verified against the bundled
`electron.d.ts` (43.x).

---

## Part 1 — Bugs

### P0: Features silently broken on Electron 43

#### 1.1 Webview preload never loads → zoom and dark-mode sync are dead
`app/renderer/main.js:102` sets `wv.preload = 'preload.js'`. Electron requires the webview
`preload` attribute to be a `file:` (or `asar:`) URL; a bare relative path is rejected.
Consequence: **everything in `app/renderer/preload.js` is dead code** — zoom in/out/reset,
persisted zoom factor, and dark-mode detection/sync never run.

**Fix:** since `index.html` is loaded from disk, resolve against the page URL:
```js
wv.preload = new URL('preload.js', location.href).href // file://…/app/renderer/preload.js
```
Verify zoom + dark mode end-to-end after the change.

#### 1.2 `new-window` webview event was removed in Electron 22 → new tabs from links never open
`app/renderer/main.js:147` listens for `new-window` on the webview. That DOM event no longer
exists; additionally, without an `allowpopups` attribute, `window.open`/`target=_blank` in the
guest page is silently blocked. The whole "open link in new tab" flow (`create-tab` IPC,
`createTabWindow`) is unreachable from links.

**Fix:** handle it in the main process where the webview contents are already intercepted
(`app/index.js:180`, `did-attach-webview`):
```js
webviewWC.setWindowOpenHandler(({url}) => {
  // devdocs URLs → new tab; anything else → default browser
  if (new URL(url).hostname === 'devdocs.io') createAndAttachTab(url)
  else shell.openExternal(url)
  return {action: 'deny'}
})
```
Remove the dead `new-window` listener in the renderer. (The `create-tab` IPC channel can then
be removed too, or kept for the renderer-initiated case.)

#### 1.3 Startup `navigate` race — deep links are dropped
The renderer registers `onIPC('navigate', …)` only **after** `await createWebView()` resolves
(`app/renderer/main.js:36` → `:75`), i.e. after devdocs.io has fully loaded over the network.
But the main process sends `navigate` much earlier: on the local page's `did-finish-load`
(`app/index.js:202`) and on `ready-to-show` (`app/index.js:317`). IPC messages sent before a
listener is registered are lost, so `devdocs://…` deep links and tab-open URLs are dropped on
slow connections (i.e. usually).

**Fix:** register all `onIPC` listeners *before* awaiting `createWebView()`. The
`pendingNavigate` buffer already exists (`main.js:17-34`) — the current ordering just defeats
it. Move the `api.onIPC(…)` block above `const webview = await createWebView()` and have
`navigateTo` keep buffering until `__ready`.

#### 1.4 Offline startup = permanently blank window
`createWebView()` rejects on `did-fail-load` (`app/renderer/main.js:153-157`). The rejection
propagates out of the top-level async IIFE: no error UI, no retry, no IPC listeners registered.
The user sees an empty window titled "Loading DevDocs..." forever.

**Fix:** don't reject the setup promise. On main-frame load failure, show a simple in-page
error state with a Retry button that re-sets `wv.src`. Also register the search/zoom/navigate
handlers regardless of load outcome (falls out of fix 1.3).

---

### P1: Windows/Linux is broken (macOS-only APIs called unconditionally)

All three APIs below are `@platform darwin` and are **undefined at runtime** on Windows/Linux,
so each call throws `TypeError`. The build config ships win (nsis/zip/portable) and linux
(AppImage/deb/tar.xz) targets, so these are shipping bugs.

#### 2.1 Closing the last window throws and the window becomes unclosable
`app/index.js:197` calls `app.hide()` inside the `close` handler *after*
`e.preventDefault()` — on win/linux the exception fires every time and the window can never be
closed (only Quit works).
**Fix:** `process.platform === 'darwin' ? app.hide() : win.hide()` (the tray exists on
win/linux and already has a Toggle item, so hide-to-tray is coherent behavior).

#### 2.2 Global-shortcut toggle throws when the window is focused
`app/index.js:89` uses `Menu.sendActionToFirstResponder('hide:')`.
**Fix:** on non-darwin use `win.hide()`.

#### 2.3 "New Tab" / `create-tab` throw
`win.addTabbedWindow(tab)` at `app/index.js:74` and `:167` (native tabs are macOS-only).
On win/linux the tab window is created hidden and never shown (orphan) before the throw.
**Fix:** gate on platform — on darwin attach as a native tab; elsewhere just `tab.show()` as a
standalone window. Consider hiding the File → New Tab item on non-mac, or keeping it as
"New Window".

#### 2.4 `devdocs://` protocol does nothing on Windows/Linux
`open-url` (`app/index.js:356`) is macOS-only; on Windows the URL arrives in
`process.argv` / the `second-instance` argv.
**Fix:** parse `argv` in the `second-instance` handler and at startup for a `devdocs://` arg;
or explicitly document the protocol as macOS-only.

---

### P1: Global-shortcut config is stored in two conflicting shapes

The config uses a flat key-value store (`app/config.js` — no dotted-path support), but the code
disagrees about the shape:

- Defaults: nested — `shortcut: {toggleApp: 'alt+space'}` (`config.js:9`)
- Startup registration reads the **nested** object (`index.js:297-308`)
- `toggleGlobalShortcut` writes/deletes a **flat** literal key `'shortcut.toggleApp'`
  (`utils.js:20,23`)
- The menu reads the flat key with a **third** default, `'CmdOrCtrl+Shift+D'` (`menu.js:19-20`)

Observable bugs:
1. **"Disable Global Shortcut" doesn't survive restart** — disabling deletes only the flat key;
   the nested default re-registers the shortcut on next launch.
2. Menu enable/disable state is computed from the wrong accelerator whenever the flat key is
   absent, so the label can be wrong and "Enable" can register a *second* accelerator
   (`CmdOrCtrl+Shift+D`) alongside `alt+space`.
3. After first run, `config.json` contains both `"shortcut": {…}` and `"shortcut.toggleApp"`.

**Fix (pick one shape — suggested: nested object, enabled flag explicit):**
```js
// defaults
shortcut: {toggleApp: {accelerator: 'alt+space', enabled: true}}
```
- `toggleGlobalShortcut` reads/writes through the nested object (`config.get('shortcut')`,
  mutate, `config.set('shortcut', …)`).
- Menu and startup both derive accelerator + enabled from the same place; delete the stray
  `'CmdOrCtrl+Shift+D'` fallback.
- Migration: on load, if a legacy flat `'shortcut.toggleApp'` key exists, fold it in and delete it.

---

### P2: Smaller bugs

| # | Location | Problem | Fix |
|---|----------|---------|-----|
| 3.1 | `index.js:19-21` | `app.quit()` without gating — the second instance keeps executing (registers handlers, may flash a window) before quit completes | Wrap startup in `if (gotLock) { … }` or `app.quit(); return` pattern via early `process.exit(0)` alternative — simplest: put the rest of startup in an `else` |
| 3.2 | `index.js:23-32` | `second-instance` shows but doesn't focus the window | Add `win.focus()` |
| 3.3 | `index.js:345-351` | Window bounds saved only if a window is focused at quit (quit from tray → state lost). Tab windows are offset +24px, so quitting from a tab saves the drifted position as the new base | Save bounds on main-window `close`/`moved`/`resized` (debounced), not only at quit; save the untabbed/base bounds |
| 3.4 | `preload.js:51` | Dark-cookie regex `/dark=1;/` requires a trailing `;` — fails when `dark=1` is the last cookie → reports light mode | `/(?:^|;\s*)dark=1(?:;|$)/` (moot until 1.1 is fixed) |
| 3.5 | `menu.js:288-302` | `compareSemver` NaN-compares prerelease/short tags (`v1.0`, `v1.0.0-beta`) → returns 0 → "No updates" | Guard `Number.isNaN` parts; treat unparseable remote tag as "no update" explicitly |
| 3.6 | `searcher.js:98-112` | Repeated Enter re-issues `findInPage` without `findNext: true`, restarting the find session instead of advancing to the next match | Track session state: first call plain, subsequent calls `{findNext: true}` (and `{forward:false, findNext:true}` for prev); reset on input change/close |
| 3.7 | `renderer/index.html:1` | Missing `<!DOCTYPE html>` → quirks mode | Add doctype (+ `lang="en"`) |
| 3.8 | `main.js:44-50` | Every window resize triggers a full `webview.reload()` after 1s — loses scroll position and page state | Almost certainly a legacy layout workaround; remove it and verify devdocs reflows correctly (it does — it's a responsive SPA) |
| 3.9 | `updater.js` | `checkForUpdatesAndNotify` runs on unsigned macOS builds (`notarize: false`, no identity) — electron-updater cannot apply updates without a signature; it will error in logs every launch | Gate auto-update to `win32` (or to signed builds); rely on the manual "Check for Updates" menu on mac |
| 3.10 | `menu.js:63-66` | "Check for Updates" silently no-ops when no window is focused | Fall back to `BrowserWindow.getAllWindows()[0]` or parent-less dialog |
| 3.11 | `index.js:102-104` | `x: lastWindowState.x && lastWindowState.x + offset` — falsy-0 idiom skips the offset when x is 0; tab default width 1000 disagrees with main default 800 | `typeof x === 'number' ? x + offset : undefined`; unify defaults |
| 3.12 | `tray.js:13-19` | Tray toggle uses a captured `win` with no destroyed-check → throws if the window is ever destroyed | Guard `win.isDestroyed()` / look up windows dynamically |

---

## Part 2 — Security hardening

The window preload (`preload-window.js`) is only exposed to the local, CSP-protected
`index.html`, and the remote webview only gets the minimal `preload.js` — the isolation model
is sound. But defense-in-depth is weak:

| # | Issue | Fix |
|---|-------|-----|
| S1 | `fs:readFile` / `fs:writeFile` / `fs:exists` (`index.js:58-67`) accept **any absolute path** — a compromised renderer gets arbitrary file read/write | In main, resolve the path and require it to be inside `~/.devdocs/` (`path.resolve` + prefix check against `configDir()`); reject otherwise. Then the preload can expose `readCustomFile(name)` instead of raw paths |
| S2 | `sendIPC(...args)` (`preload-window.js:51-53`) is a blanket `ipcRenderer.send` passthrough | Replace with an explicit `createTab(url)` method (whitelist one channel), or drop entirely if 1.2 moves tab-opening into main |
| S3 | `shell:openExternal` (`index.js:42-44`) accepts any URL/protocol (e.g. `file:`, `smb:`) | Allow only `http:`/`https:` in the main-process handler |
| S4 | Unused exposed surface: `maximize`, `showMessageBox`, `openExternal` in the preload and their `window:maximize` / `dialog:messageBox` handlers in main are referenced nowhere in the renderer | Delete them |
| S5 | No navigation guard on the webview — the guest can be navigated anywhere and stays inside the app chrome | In `did-attach-webview`, add `will-navigate`: allow `devdocs.io`, send everything else to `shell.openExternal` + `preventDefault` |
| S6 | Sync `fs.readFileSync`/`writeFileSync` inside `ipcMain.handle` blocks the main process | Switch to `node:fs/promises` while touching these handlers |

---

## Part 3 — Improvements (non-bug)

1. **CI** (`.github/workflows/`):
   - `test.yml` only runs `xo` lint (`npm test` → lint). Fine, but both workflows also trigger
     on tag pushes, duplicating work; drop `tags` from `test.yml`.
   - Use `npm ci` + `actions/setup-node` `cache: npm` instead of bare `npm install`.
   - `samuelmeuli/action-electron-builder@v1` is unmaintained (last release 2020) and runs its
     own install/build; consider replacing with a plain `npx electron-builder --publish …` step.
2. **Config atomicity** (`config.js:28`): `writeFileSync` in place can corrupt `config.json` on
   crash (load already falls back to defaults, so impact is low). Write to a temp file +
   `renameSync` if desired.
3. **Zoom accelerator**: `CmdOrCtrl+Plus` requires Shift on most layouts; add `CmdOrCtrl+=`
   as an additional item (visible: false) like browsers do.
4. **Dead markup**: `<div id="app">` in `index.html` is unused.
5. **Tests**: there are none (app `npm test` exits 1). A minimal Playwright-for-Electron smoke
   test (app launches, webview attaches, title updates) would catch the whole class of
   "Electron upgrade silently killed feature X" regressions found in Part 1.

---

## Part 4 — Implementation plan

Ordered so each phase is independently shippable and verifiable.

### Phase 1 — Restore features broken by the Electron 43 migration (P0)
1. Fix webview preload URL (1.1) — 1 line + manual verify of zoom/dark-mode.
2. Replace dead `new-window` listener with `setWindowOpenHandler` in `did-attach-webview`,
   including external-URL handling (1.2, S5 fold-in).
3. Reorder renderer startup: register IPC listeners before creating the webview (1.3).
4. Add load-failure UI + retry instead of rejecting (1.4).
5. Remove the resize-reload hack (3.8) and verify.

*Verify:* deep link `open -a DevDocs "devdocs://search/map"` while app closed; target=_blank
link opens tab; zoom persists across restart; dark mode syncs; airplane-mode launch shows retry.

### Phase 2 — Cross-platform correctness (P1)
1. Platform-gate `app.hide` / `sendActionToFirstResponder` / `addTabbedWindow`
   (2.1–2.3) with `win.hide()` / plain-window fallbacks.
2. Handle `devdocs://` via argv on Windows/Linux or document as mac-only (2.4).
3. `second-instance`: add `focus()` (3.2); gate startup on the instance lock (3.1).
4. Tray destroyed-window guard (3.12).

*Verify:* lint passes; smoke-run on a Linux VM or CI `xvfb-run npm run app` if feasible.

### Phase 3 — Shortcut/config refactor (P1)
1. Normalize `shortcut` config to one nested shape with an `enabled` flag; migrate legacy
   flat keys on load.
2. Update `utils.toggleGlobalShortcut`, startup registration, and menu to the single shape;
   remove the stray `CmdOrCtrl+Shift+D` fallback.

*Verify:* enable → restart → still enabled; disable → restart → still disabled; menu label
matches actual registration state on first run.

### Phase 4 — Security hardening
1. Scope fs IPC to `~/.devdocs` (S1) and switch handlers to async fs (S6).
2. Whitelist `openExternal` to http(s) (S3).
3. Remove unused preload/IPC surface (S4) and the generic `sendIPC` passthrough (S2).

### Phase 5 — Polish & hygiene (P2)
1. Doctype (3.7), dark-cookie regex (3.4), `compareSemver` guard (3.5),
   searcher `findNext` state (3.6), window-state saving (3.3), bounds-offset idiom (3.11),
   update-check fallback window (3.10), gate mac auto-update (3.9).
2. CI cleanup (npm ci, cache, drop tag trigger from test.yml, reconsider the builder action).
3. Optional: zoom `=` accelerator, atomic config writes, remove `#app` div, smoke test.

Estimated effort: Phases 1–3 are each a small PR (~1–3 hours incl. manual verification);
Phases 4–5 are mechanical (~1–2 hours combined).
