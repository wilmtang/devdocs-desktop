const os = require('node:os')
const path = require('node:path')
const {globalShortcut} = require('electron')
const config = require('./config.js')

const home = os.homedir()

exports.configDir = function (...args) {
  return path.join(home, '.devdocs', ...args)
}

exports.toggleGlobalShortcut = function ({
  name,
  registered,
  accelerator,
  action,
}) {
  if (registered) {
    globalShortcut.unregister(accelerator)
    config.delete(`shortcut.${name}`)
  } else {
    const returnValue = globalShortcut.register(accelerator, action)
    config.set(`shortcut.${name}`, accelerator)
    if (!returnValue) {
      console.error(`Failed to register ${accelerator}`)
    }
  }
}
