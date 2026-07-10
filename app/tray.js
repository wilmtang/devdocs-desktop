const path = require('node:path')
const {app, BrowserWindow, Menu, Tray} = require('electron')

let tray = null

exports.create = () => {
  if (process.platform === 'darwin' || tray) {
    return
  }

  const iconPath = path.join(__dirname, 'static/tray.png')

  const toggleWin = () => {
    const win =
      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) {
      return
    }

    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
    }
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Toggle',
      click() {
        toggleWin()
      },
    },
    {
      type: 'separator',
    },
    {
      role: 'quit',
    },
  ])

  tray = new Tray(iconPath)
  tray.setToolTip(app.name)
  tray.setContextMenu(contextMenu)
  tray.on('click', toggleWin)
}
