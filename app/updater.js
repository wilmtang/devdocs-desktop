const {app} = require('electron')
const log = require('electron-log')
const {autoUpdater} = require('electron-updater')

exports.init = () => {
  // electron-updater requires a signed app on macOS and we ship unsigned
  // builds, so auto-update is Windows-only; other platforms use the manual
  // "Check for Updates" menu item
  if (!app.isPackaged || process.platform !== 'win32') {
    return
  }

  autoUpdater.logger = log
  autoUpdater.logger.transports.file.level = 'info'
  autoUpdater.checkForUpdatesAndNotify()
}
