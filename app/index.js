const path = require('node:path')
const fs = require('node:fs/promises')
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  shell,
  globalShortcut,
} = require('electron')
const createMenu = require('./menu.js')
const config = require('./config.js')
const tray = require('./tray.js')
const updater = require('./updater.js')
const {configDir, updateShortcut} = require('./utils.js')
const {pickRecentTab, pickSequentialTab} = require('./tabs.js')
const {resolveDeepLink} = require('./deep-link.js')

process.title = 'DevDocs'
app.setName('DevDocs')
app.setAppUserModelId('sh.egoist.devdocs')

const isMac = process.platform === 'darwin'
const developmentIcon = app.isPackaged
  ? undefined
  : path.join(__dirname, '..', 'build', 'icon.png')

// Verification/CI runs launch with DEVDOCS_BACKGROUND=1 (see AGENT.md). Present
// the app as an accessory agent — the runtime equivalent of LSUIElement — so the
// launch never activates it, bounces the Dock, or pulls its Space to the front.
// showInactive() only stops the *window* from taking key focus; without this the
// *app* still becomes frontmost and steals the user's screen. Called before
// 'ready' so it applies before any window appears, and gated on the env var so
// normal launches keep their Dock icon and app menu.
if (isMac && process.env.DEVDOCS_BACKGROUND === '1') {
  app.setActivationPolicy('accessory')
}

let mainWindow
let isQuitting = false
let urlToOpen
let isShortcutSuspended = false
let shortcutResumeTimer
let shortcutRecorder

// Track all windows (native tabs create multiple BrowserWindows)
const allWindows = new Set()
const recentWindows = []

if (!app.requestSingleInstanceLock()) {
  // Exit immediately: app.quit() alone lets the rest of startup run first
  app.exit(0)
}

app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) {
      win.restore()
    }

    win.show()
    win.focus()
  }

  // On Windows/Linux protocol URLs arrive via the second instance's argv
  const url = argv.find((arg) => arg.startsWith('devdocs://'))
  if (url) {
    openDeepLink(url)
  }
})

// --- URL helpers ---

function isHttpUrl(url) {
  try {
    const {protocol} = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function isDevdocsUrl(url) {
  try {
    const parsed = new URL(url)
    return isHttpUrl(url) && parsed.hostname === 'devdocs.io'
  } catch {
    return false
  }
}

function openExternal(url) {
  if (isHttpUrl(url)) {
    shell.openExternal(url)
  }
}

function openDeepLink(url) {
  const targetUrl = resolveDeepLink(url)
  if (!targetUrl) {
    return
  }

  const win =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (win) {
    win.show()
    win.webContents.send('navigate', targetUrl)
  } else {
    urlToOpen = targetUrl
  }
}

// Renderer file access is limited to the ~/.devdocs config directory
function resolveConfigPath(filePath) {
  const base = configDir()
  const resolved = path.resolve(base, String(filePath))
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Access denied: path is outside ' + base)
  }

  return resolved
}

// --- IPC handlers ---

ipcMain.handle('config:get', (_event, key) => config.get(key))

ipcMain.handle('config:set', (_event, key, value) => {
  config.set(key, value)
})

ipcMain.handle('fs:readFile', (_event, filePath) =>
  fs.readFile(resolveConfigPath(filePath), 'utf8'),
)

ipcMain.handle('fs:writeFile', async (_event, filePath, data) => {
  const target = resolveConfigPath(filePath)
  await fs.mkdir(path.dirname(target), {recursive: true})
  await fs.writeFile(target, data, 'utf8')
})

ipcMain.handle('fs:exists', async (_event, filePath) => {
  try {
    await fs.access(resolveConfigPath(filePath))
    return true
  } catch {
    return false
  }
})

// --- Global shortcut (toggle window) ---

function getToggleShortcut() {
  const shortcuts = config.get('shortcut') || {}
  const {accelerator = config.DEFAULT_TOGGLE_ACCELERATOR, enabled = false} =
    shortcuts.toggleApp || {}
  return {accelerator, enabled}
}

function getToggleShortcutState() {
  const state = getToggleShortcut()
  let isRegistered = false
  try {
    isRegistered = globalShortcut.isRegistered(state.accelerator)
  } catch {}

  return {
    ...state,
    defaultAccelerator: config.DEFAULT_TOGGLE_ACCELERATOR,
    registered: isRegistered,
    suspended: isShortcutSuspended,
  }
}

function shortcutRegistrationError(accelerator) {
  return `Couldn't register "${accelerator}" — it may be taken by another app.`
}

function clearShortcutSuspension() {
  isShortcutSuspended = false
  clearTimeout(shortcutResumeTimer)
  shortcutResumeTimer = undefined
  if (shortcutRecorder) {
    shortcutRecorder.removeListener('destroyed', resumeToggleShortcut)
    shortcutRecorder.removeListener(
      'did-start-navigation',
      resumeToggleShortcut,
    )
    shortcutRecorder = undefined
  }
}

function resumeToggleShortcut() {
  if (!isShortcutSuspended) {
    const state = getToggleShortcutState()
    const ok = !state.enabled || state.registered
    return {
      ok,
      error: ok ? null : shortcutRegistrationError(state.accelerator),
      ...state,
    }
  }

  clearShortcutSuspension()
  const {accelerator, enabled} = getToggleShortcut()
  if (!accelerator || !enabled) {
    return {ok: true, error: null, ...getToggleShortcutState()}
  }

  const ok = updateShortcut({
    name: 'toggleApp',
    accelerator,
    enabled: true,
    action: toggleWindow,
  })
  return {
    ok,
    error: ok ? null : shortcutRegistrationError(accelerator),
    ...getToggleShortcutState(),
  }
}

ipcMain.handle('shortcut:get', () => {
  const state = getToggleShortcutState()
  const ok = !state.enabled || state.registered || state.suspended
  return {
    ok,
    error: ok ? null : shortcutRegistrationError(state.accelerator),
    ...state,
  }
})

ipcMain.handle('shortcut:set', (_event, accelerator, enabled) => {
  if (
    typeof accelerator !== 'string' ||
    accelerator.trim().length === 0 ||
    accelerator.length > 64
  ) {
    if (isShortcutSuspended) {
      resumeToggleShortcut()
    }

    return {ok: false, error: 'Invalid shortcut.', ...getToggleShortcutState()}
  }

  accelerator = accelerator.trim()
  const ok = updateShortcut({
    name: 'toggleApp',
    accelerator,
    enabled: Boolean(enabled),
    action: toggleWindow,
  })
  clearShortcutSuspension()
  return {
    ok,
    error: ok ? null : shortcutRegistrationError(accelerator),
    ...getToggleShortcutState(),
  }
})

// While the settings panel is recording a new combo, release the current
// registration so pressing the old combo doesn't hide the window mid-recording
ipcMain.handle('shortcut:suspend', (event, suspend) => {
  if (!suspend) {
    return resumeToggleShortcut()
  }

  if (isShortcutSuspended) {
    return {ok: true, error: null, ...getToggleShortcutState()}
  }

  const {accelerator, enabled} = getToggleShortcut()
  if (!accelerator || !enabled) {
    return {ok: true, error: null, ...getToggleShortcutState()}
  }

  try {
    globalShortcut.unregister(accelerator)
  } catch {
    return {
      ok: false,
      error: 'Could not pause the current shortcut for recording.',
      ...getToggleShortcutState(),
    }
  }

  isShortcutSuspended = true
  clearTimeout(shortcutResumeTimer)
  shortcutResumeTimer = setTimeout(resumeToggleShortcut, 5 * 60 * 1000)
  shortcutRecorder = event.sender
  shortcutRecorder.once('destroyed', resumeToggleShortcut)
  shortcutRecorder.once('did-start-navigation', resumeToggleShortcut)
  return {ok: true, error: null, ...getToggleShortcutState()}
})

ipcMain.on('shortcut:resume', resumeToggleShortcut)

// --- Tab navigation ---

function getTabNavigationMode() {
  return config.get('tabNavigation') === 'recent' ? 'recent' : 'sequential'
}

ipcMain.handle('tabs:get-navigation-mode', () => getTabNavigationMode())

ipcMain.handle('tabs:set-navigation-mode', (_event, mode) => {
  if (mode !== 'sequential' && mode !== 'recent') {
    return false
  }

  config.set('tabNavigation', mode)
  return true
})

function openWindows() {
  return [...allWindows].filter((win) => !win.isDestroyed())
}

function rememberWindow(win) {
  const index = recentWindows.indexOf(win)
  if (index !== -1) {
    recentWindows.splice(index, 1)
  }

  recentWindows.unshift(win)
}

function forgetWindow(win) {
  const index = recentWindows.indexOf(win)
  if (index !== -1) {
    recentWindows.splice(index, 1)
  }
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) {
    return
  }

  if (win.isMinimized()) {
    win.restore()
  }

  win.show()
  win.focus()
}

function cycleTab(direction, isSequential = false) {
  const windows = openWindows()
  const current = BrowserWindow.getFocusedWindow()
  const mode = isSequential ? 'sequential' : getTabNavigationMode()

  if (isMac && mode === 'sequential' && current) {
    if (direction > 0) {
      current.selectNextTab()
    } else {
      current.selectPreviousTab()
    }

    return
  }

  const history = recentWindows.filter((win) => windows.includes(win))
  const target =
    (mode === 'recent' && pickRecentTab(history, current, direction)) ||
    pickSequentialTab(windows, current, direction)
  focusWindow(target)
}

function selectTabAtIndex(index) {
  focusWindow(openWindows()[index])
}

// --- Window creation ---

function toggleWindow() {
  const win =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (!win) {
    return
  }

  if (win.isFocused()) {
    if (isMac) {
      Menu.sendActionToFirstResponder('hide:')
    } else {
      win.hide()
    }
  } else {
    win.show()
    win.focus()
  }
}

function openUrlInTab(url, parentWin) {
  const tab = createTabWindow(url)
  const parent = parentWin || BrowserWindow.getFocusedWindow()
  // Native tabs only exist on macOS; elsewhere the tab is a plain window
  if (isMac && parent && !parent.isDestroyed()) {
    parent.addTabbedWindow(tab)
  }

  tab.show()
}

function createTabWindow(url) {
  const lastWindowState = config.get('lastWindowState')
  const offset = allWindows.size * 24
  const x =
    typeof lastWindowState.x === 'number'
      ? lastWindowState.x + offset
      : undefined
  const y =
    typeof lastWindowState.y === 'number'
      ? lastWindowState.y + offset
      : undefined

  const win = new BrowserWindow({
    title: app.name,
    icon: developmentIcon,
    x,
    y,
    width: lastWindowState.width || 800,
    height: lastWindowState.height || 600,
    minWidth: 600,
    minHeight: 400,
    show: false,
    titleBarStyle: 'default',
    tabbingIdentifier: 'devdocs-tabs',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'preload-window.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  })

  setupWindow(win, url)
  allWindows.add(win)

  win.on('closed', () => {
    allWindows.delete(win)
    forgetWindow(win)
  })

  return win
}

function createMainWindow() {
  const lastWindowState = config.get('lastWindowState')

  const win = new BrowserWindow({
    title: app.name,
    icon: developmentIcon,
    x: lastWindowState.x,
    y: lastWindowState.y,
    width: lastWindowState.width || 800,
    height: lastWindowState.height || 600,
    minWidth: 600,
    minHeight: 400,
    show: false,
    titleBarStyle: 'default',
    tabbingIdentifier: 'devdocs-tabs',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'preload-window.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  })

  setupWindow(win, null)
  allWindows.add(win)

  // Persist bounds whenever the main window is closed or hidden, so state
  // survives quitting from the tray (when no window is focused)
  win.on('close', () => {
    if (!win.isFullScreen()) {
      config.set('lastWindowState', win.getBounds())
    }
  })

  win.on('closed', () => {
    allWindows.delete(win)
    forgetWindow(win)
  })

  return win
}

function setupWindow(win, url) {
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // macOS native tabs: create a new tabbed window when Cmd+T or + button is clicked
  win.on('new-window-for-tab', () => {
    const tab = createTabWindow()
    if (isMac) {
      win.addTabbedWindow(tab)
    }

    tab.show()
  })

  // Context menu on the main window itself
  win.webContents.on('context-menu', (_event, parameters) => {
    const template = buildContextMenu(parameters)
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup()
    }
  })

  win.webContents.on('did-attach-webview', (_event, webviewWC) => {
    // Route new windows: devdocs links become tabs, everything else opens
    // in the default browser. (The webview `new-window` DOM event no longer
    // exists in modern Electron.)
    webviewWC.setWindowOpenHandler(({url: targetUrl}) => {
      if (isDevdocsUrl(targetUrl)) {
        openUrlInTab(targetUrl, win)
      } else {
        openExternal(targetUrl)
      }

      return {action: 'deny'}
    })

    // Keep the embedded view on devdocs.io; open other sites externally
    webviewWC.on('will-navigate', (event, targetUrl) => {
      if (isDevdocsUrl(targetUrl)) {
        return
      }

      event.preventDefault()
      openExternal(targetUrl)
    })

    // Context menu for embedded webviews
    webviewWC.on('context-menu', (_ev, parameters) => {
      const template = buildContextMenu(parameters, webviewWC)
      if (template.length > 0) {
        Menu.buildFromTemplate(template).popup()
      }
    })
  })

  win.on('close', (e) => {
    // Let the window close normally unless it's the last tab — macOS removes the tab
    if (isQuitting || allWindows.size > 1) {
      return
    }

    // Last tab: hide the app instead of closing the window
    e.preventDefault()
    if (isMac) {
      app.hide()
    } else {
      // app.hide() is macOS-only; hide to tray elsewhere
      win.hide()
    }
  })

  // Send URL after the window is ready
  if (url) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('navigate', url)
    })
  }
}

function buildContextMenu(parameters, webContents) {
  const template = []

  if (webContents && parameters.misspelledWord) {
    for (const suggestion of parameters.dictionarySuggestions || []) {
      template.push({
        label: suggestion,
        click: () => webContents.replaceMisspelling(suggestion),
      })
    }

    if (template.length > 0) {
      template.push({type: 'separator'})
    }
  }

  if (parameters.isEditable) {
    template.push(
      {role: 'undo'},
      {role: 'redo'},
      {type: 'separator'},
      {role: 'cut'},
      {role: 'copy'},
      {role: 'paste'},
      {role: 'selectAll'},
    )
  } else if (parameters.selectionText) {
    template.push({role: 'copy'})
  }

  if (parameters.linkURL) {
    if (template.length > 0) {
      template.push({type: 'separator'})
    }

    template.push({
      label: 'Open Link in Browser',
      click: () => openExternal(parameters.linkURL),
    })
  }

  if (parameters.selectionText && parameters.selectionText.trim().length > 0) {
    if (template.length > 0) {
      template.push({type: 'separator'})
    }

    template.push(
      {
        label: 'Search Google for "' + parameters.selectionText + '"',
        click: () =>
          shell.openExternal(
            'https://www.google.com/search?q=' +
              encodeURIComponent(parameters.selectionText),
          ),
      },
      {
        label: 'Search DuckDuckGo for "' + parameters.selectionText + '"',
        click: () =>
          shell.openExternal(
            'https://duckduckgo.com/?q=' +
              encodeURIComponent(parameters.selectionText),
          ),
      },
    )
  }

  if (webContents) {
    if (template.length > 0) {
      template.push({type: 'separator'})
    }

    template.push({
      label: 'Inspect Element',
      click() {
        if (webContents.isDevToolsOpened()) {
          webContents.devToolsWebContents.focus()
        } else {
          webContents.openDevTools()
        }
      },
    })
  }

  return template
}

// --- App lifecycle ---

app.on('ready', () => {
  if (isMac && developmentIcon) {
    app.dock.setIcon(developmentIcon)
  }

  const shortcuts = config.get('shortcut')
  for (const name in shortcuts) {
    const {accelerator, enabled} = shortcuts[name] || {}
    if (accelerator && enabled) {
      updateShortcut({name, accelerator, enabled: true, action: toggleWindow})
    }
  }

  Menu.setApplicationMenu(createMenu({cycleTab, selectTabAtIndex}))
  mainWindow = createMainWindow()
  tray.create()

  mainWindow.once('ready-to-show', () => {
    // Agent/CI verification runs (see AGENT.md): surface the window without
    // stealing focus from whatever the user is working in
    if (process.env.DEVDOCS_BACKGROUND === '1') {
      mainWindow.showInactive()
    } else {
      mainWindow.show()
    }

    updater.init()
    if (urlToOpen) {
      mainWindow.webContents.send('navigate', urlToOpen)
      urlToOpen = null
    }
  })
})

app.on('activate', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.show()
  } else {
    mainWindow = createMainWindow()
    tray.create()
  }
})

let hasOpenedOnce = false
app.on('browser-window-focus', (_event, win) => {
  rememberWindow(win)
  if (hasOpenedOnce) {
    win.webContents.send('focus-webview')
  } else {
    hasOpenedOnce = true
  }
})

app.on('before-quit', () => {
  isQuitting = true
  const win =
    (mainWindow && !mainWindow.isDestroyed() && mainWindow) ||
    BrowserWindow.getAllWindows()[0]
  if (win && !win.isFullScreen()) {
    config.set('lastWindowState', win.getBounds())
  }
})

app.setAsDefaultProtocolClient('devdocs')

if (isMac) {
  app.on('will-finish-launching', () => {
    // macOS-only event; Windows/Linux get the URL through argv instead
    app.on('open-url', (_e, url) => {
      openDeepLink(url)
    })
  })
} else {
  const url = process.argv.find((arg) => arg.startsWith('devdocs://'))
  if (url) {
    openDeepLink(url)
  }
}
