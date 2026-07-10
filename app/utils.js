const os = require('node:os')
const path = require('node:path')
const {globalShortcut} = require('electron')
const config = require('./config.js')

const home = os.homedir()

exports.configDir = function (...args) {
  return path.join(home, '.devdocs', ...args)
}

exports.toggleGlobalShortcut = function ({name, accelerator, enable, action}) {
  if (enable) {
    const registered = globalShortcut.register(accelerator, action)
    if (!registered) {
      console.error(`Failed to register ${accelerator}`)
    }
  } else {
    globalShortcut.unregister(accelerator)
  }

  const shortcuts = config.get('shortcut') || {}
  shortcuts[name] = {accelerator, enabled: enable}
  config.set('shortcut', shortcuts)
}
