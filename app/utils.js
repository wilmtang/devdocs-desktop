const os = require('node:os')
const path = require('node:path')
const {globalShortcut} = require('electron')
const config = require('./config.js')

const home = os.homedir()

exports.configDir = function (...args) {
  return path.join(home, '.devdocs', ...args)
}

// Apply and persist a named global shortcut. The previously stored
// accelerator is released first so changing the combo never leaves a stale
// registration. Returns false (and keeps the old shortcut both registered
// and in config) when the OS rejects the new accelerator — e.g. it is
// already taken by another app.
exports.updateShortcut = function ({name, accelerator, enabled, action}) {
  const shortcuts = config.get('shortcut') || {}
  const previous = shortcuts[name] || {}

  if (previous.accelerator) {
    try {
      globalShortcut.unregister(previous.accelerator)
    } catch {}
  }

  if (accelerator && enabled) {
    let isRegistered = false
    try {
      // register() throws on malformed accelerator strings and returns
      // false when the combo is held by another application
      isRegistered = globalShortcut.register(accelerator, action)
    } catch {}

    if (!isRegistered) {
      console.error(`Failed to register ${accelerator}`)
      if (previous.accelerator && previous.enabled) {
        try {
          globalShortcut.register(previous.accelerator, action)
        } catch {}
      }

      return false
    }
  }

  shortcuts[name] = {
    accelerator: accelerator || previous.accelerator,
    enabled: Boolean(accelerator && enabled),
  }
  config.set('shortcut', shortcuts)
  return true
}
