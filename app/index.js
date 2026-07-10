const path = require('node:path')
const fs = require('node:fs')
const {app, BrowserWindow, Menu, ipcMain, shell, dialog} = require('electron')
const createMenu = require('./menu.js')
const config = require('./config.js')
const tray = require('./tray.js')
const updater = require('./updater.js')
const {toggleGlobalShortcut} = require('./utils.js')

app.setAppUserModelId('sh.egoist.devdocs')

let mainWindow
let isQuitting = false
let urlToOpen

// Track all windows (native tabs create multiple BrowserWindows)
const allWindows = new Set()

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) {
      win.restore()
    }

    win.show()
  }
})

// --- IPC handlers ---

ipcMain.handle('config:get', (_event, key) => config.get(key))

ipcMain.handle('config:set', (_event, key, value) => {
  config.set(key, value)
})

ipcMain.handle('shell:openExternal', (_event, url) => {
  shell.openExternal(url)
})

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) {
    win.maximize()
  }
})

ipcMain.handle('dialog:messageBox', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return dialog.showMessageBox(win, options)
})

ipcMain.handle('fs:readFile', (_event, filePath) =>
  fs.readFileSync(filePath, 'utf8'),
)

ipcMain.handle('fs:writeFile', (_event, filePath, data) => {
  fs.mkdirSync(path.dirname(filePath), {recursive: true})
  fs.writeFileSync(filePath, data, 'utf8')
})

ipcMain.handle('fs:exists', (_event, filePath) => fs.existsSync(filePath))

// Create a new tab window (triggered by renderer when a link wants a new window)
ipcMain.on('create-tab', (_event, url) => {
  const tab = createTabWindow(url)
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) {
    focused.addTabbedWindow(tab)
    tab.show()
  }
})

// --- Window creation ---

function toggleWindow() {
  const win =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (!win) {
    return
  }

  if (win.isFocused()) {
    Menu.sendActionToFirstResponder('hide:')
  } else {
    win.show()
    win.focus()
  }
}

function createTabWindow(url) {
  const lastWindowState = config.get('lastWindowState')
  const offset = allWindows.size * 24

  const win = new BrowserWindow({
    title: app.name,
    x: lastWindowState.x && lastWindowState.x + offset,
    y: lastWindowState.y && lastWindowState.y + offset,
    width: lastWindowState.width || 1000,
    height: lastWindowState.height || 700,
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
  })

  return win
}

function createMainWindow() {
  const lastWindowState = config.get('lastWindowState')

  const win = new BrowserWindow({
    title: app.name,
    x: lastWindowState.x,
    y: lastWindowState.y,
    width: lastWindowState.width,
    height: lastWindowState.height,
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

  win.on('closed', () => {
    allWindows.delete(win)
  })

  return win
}

function setupWindow(win, url) {
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // macOS native tabs: create a new tabbed window when Cmd+T or + button is clicked
  win.on('new-window-for-tab', () => {
    const tab = createTabWindow()
    win.addTabbedWindow(tab)
    tab.show()
  })

  // Context menu on the main window itself
  win.webContents.on('context-menu', (_event, parameters) => {
    const template = buildContextMenu(parameters)
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup()
    }
  })

  // Context menu for embedded webviews
  win.webContents.on('did-attach-webview', (_event, webviewWC) => {
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
    app.hide()
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
      click: () => shell.openExternal(parameters.linkURL),
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
  const shortcut = config.get('shortcut')
  for (const name in shortcut) {
    const accelerator = shortcut[name]
    if (accelerator) {
      toggleGlobalShortcut({
        name,
        accelerator,
        registered: false,
        action: toggleWindow,
      })
    }
  }

  Menu.setApplicationMenu(createMenu({toggleWindow}))
  mainWindow = createMainWindow()
  tray.create(mainWindow)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    updater.init()
    if (urlToOpen) {
      mainWindow.webContents.send('navigate', urlToOpen)
    }
  })
})

app.on('activate', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    win.show()
  } else {
    mainWindow = createMainWindow()
    tray.create(mainWindow)
  }
})

let hasOpenedOnce = false
app.on('browser-window-focus', () => {
  if (hasOpenedOnce) {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      win.webContents.send('focus-webview')
    }
  } else {
    hasOpenedOnce = true
  }
})

app.on('before-quit', () => {
  isQuitting = true
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isFullScreen()) {
    config.set('lastWindowState', win.getBounds())
  }
})

app.setAsDefaultProtocolClient('devdocs')

app.on('will-finish-launching', () => {
  app.on('open-url', (_e, url) => {
    const win =
      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('navigate', url)
    } else {
      urlToOpen = url
    }
  })
})
