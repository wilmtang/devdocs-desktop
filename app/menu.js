const {Menu, shell, globalShortcut, BrowserWindow, dialog} = require('electron')
const {configDir, updateShortcut} = require('./utils.js')
const config = require('./config.js')
const pkg = require('./package.json')

const isMac = process.platform === 'darwin'

function sendAction(action, ...args) {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    win.restore()
    win.show()
    win.webContents.send(action, ...args)
  }
}

function updateMenu(options) {
  Menu.setApplicationMenu(createMenu(options))
}

function createMenu(options) {
  const shortcuts = config.get('shortcut') || {}
  const toggleAppAccelerator =
    (shortcuts.toggleApp && shortcuts.toggleApp.accelerator) || 'alt+space'
  const toggleAppAcceleratorRegistered =
    globalShortcut.isRegistered(toggleAppAccelerator)

  const preferences = [
    {
      label: 'Preferences',
      submenu: [
        {
          label: 'Custom CSS',
          async click() {
            shell.openPath(configDir('custom.css'))
          },
        },
        {
          label: 'Custom JS',
          async click() {
            shell.openPath(configDir('custom.js'))
          },
        },
        {
          type: 'separator',
        },
        {
          label: `Change Global Shortcut… (${toggleAppAccelerator})`,
          click() {
            sendAction('open-shortcut-settings')
          },
        },
        {
          label: `${
            toggleAppAcceleratorRegistered ? 'Disable' : 'Enable'
          } Global Shortcut`,
          click() {
            updateShortcut({
              name: 'toggleApp',
              accelerator: toggleAppAccelerator,
              enabled: !toggleAppAcceleratorRegistered,
              action: options.toggleWindow,
            })
            updateMenu(options)
          },
        },
      ],
    },
    {
      type: 'separator',
    },
  ]

  const checkForUpdates = {
    label: 'Check for Updates',
    async click(item, focusedWindow) {
      const win = focusedWindow || BrowserWindow.getAllWindows()[0]
      const showDialog = (dialogOptions) =>
        win
          ? dialog.showMessageBox(win, dialogOptions)
          : dialog.showMessageBox(dialogOptions)

      try {
        const res = await fetch(
          'https://api.github.com/repos/egoist/devdocs-desktop/releases/latest',
          {headers: {Accept: 'application/vnd.github.v3+json'}},
        )
        const latest = await res.json()
        const latestVersion = String(latest.tag_name || '').replace(/^v/v, '')

        if (latestVersion && compareSemver(latestVersion, pkg.version) === 1) {
          const {response} = await showDialog({
            type: 'info',
            message: 'New update available!',
            detail: 'A new release (' + latest.tag_name + ') is available.',
            buttons: ['View on GitHub', 'Cancel'],
            defaultId: 0,
          })
          if (response === 0) {
            shell.openExternal(
              'https://github.com/egoist/devdocs-desktop/releases/latest',
            )
          }
        } else {
          showDialog({
            message: 'No updates',
            detail: 'v' + pkg.version + ' is the latest version.',
          })
        }
      } catch {
        showDialog({
          message: 'Update check failed',
          detail: 'Could not reach GitHub. Try again later.',
        })
      }
    },
  }

  const template = [
    {
      label: 'DevDocs',
      submenu: [
        {
          role: 'about',
        },
        checkForUpdates,
        {
          type: 'separator',
        },
        ...preferences,
        {
          role: 'services',
          submenu: [],
        },
        {
          type: 'separator',
        },
        {
          role: 'hide',
        },
        {
          role: 'hideothers',
        },
        {
          role: 'unhide',
        },
        {
          type: 'separator',
        },
        {
          role: 'quit',
        },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: isMac ? 'New Tab' : 'New Window',
          accelerator: 'CmdOrCtrl+T',
          click() {
            const win = BrowserWindow.getFocusedWindow()
            if (win) {
              win.emit('new-window-for-tab')
            }
          },
        },
        {
          label: isMac ? 'Close Tab' : 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click() {
            const win = BrowserWindow.getFocusedWindow()
            if (win) {
              win.close()
            }
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          role: 'undo',
        },
        {
          role: 'redo',
        },
        {
          type: 'separator',
        },
        {
          role: 'cut',
        },
        {
          role: 'copy',
        },
        {
          role: 'paste',
        },
        {
          role: 'pasteandmatchstyle',
        },
        {
          role: 'delete',
        },
        {
          role: 'selectall',
        },
        {
          type: 'separator',
        },
        {
          label: 'Speech',
          submenu: [
            {
              role: 'startspeaking',
            },
            {
              role: 'stopspeaking',
            },
          ],
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reset Text Size',
          accelerator: 'CmdOrCtrl+0',
          click() {
            sendAction('zoom-reset')
          },
        },
        {
          label: 'Increase Text Size',
          accelerator: 'CmdOrCtrl+Plus',
          click() {
            sendAction('zoom-in')
          },
        },
        {
          // Alias: CmdOrCtrl+Plus needs Shift on most layouts
          label: 'Increase Text Size',
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click() {
            sendAction('zoom-in')
          },
        },
        {
          label: 'Decrease Text Size',
          accelerator: 'CmdOrCtrl+-',
          click() {
            sendAction('zoom-out')
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Search In Page',
          accelerator: 'CmdOrCtrl+F',
          click(item, focusedWindow) {
            focusedWindow.webContents.send('open-search')
          },
        },
        {
          type: 'separator',
        },
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click(item, focusedWindow) {
            if (focusedWindow) {
              focusedWindow.reload()
            }
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click(item, focusedWindow) {
            if (focusedWindow) {
              focusedWindow.webContents.toggleDevTools()
            }
          },
        },
      ],
    },
    {
      role: 'window',
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Report Issues',
          click() {
            shell.openExternal(
              'https://github.com/egoist/devdocs-desktop/issues/new',
            )
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

function compareSemver(a, b) {
  // Strip prerelease/build suffixes ('1.2.3-beta' -> '1.2.3'); missing or
  // unparseable parts count as 0 instead of poisoning the comparison as NaN
  const parse = (version) =>
    version.split(/[+\-]/v, 1)[0].split('.').map(Number)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) {
      return 1
    }

    if (x < y) {
      return -1
    }
  }

  return 0
}

module.exports = createMenu
