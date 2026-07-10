const os = require('node:os')
const path = require('node:path')
const electron = require('electron')

const home = os.homedir()

exports.configDir = function (...args) {
  return path.join(home, '.devdocs', ...args)
}

function isShortcutRegistered(shortcutApi, accelerator) {
  try {
    return shortcutApi.isRegistered(accelerator)
  } catch {
    return false
  }
}

function registerShortcut(shortcutApi, accelerator, action) {
  try {
    return shortcutApi.register(accelerator, action)
  } catch {
    return false
  }
}

function unregisterShortcut(shortcutApi, accelerator) {
  try {
    shortcutApi.unregister(accelerator)
  } catch {}
}

function shouldRegisterShortcut(previous, accelerator, enabled, wasRegistered) {
  return Boolean(
    accelerator &&
    enabled &&
    (accelerator !== previous.accelerator || !wasRegistered),
  )
}

function shouldRestoreShortcut(previous, accelerator, wasRegistered) {
  return Boolean(
    previous.accelerator &&
    previous.accelerator !== accelerator &&
    previous.enabled &&
    !wasRegistered,
  )
}

function shouldUnregisterShortcut(previous, accelerator, enabled) {
  return Boolean(
    previous.accelerator &&
    previous.enabled &&
    (!enabled || previous.accelerator !== accelerator),
  )
}

// Apply and persist a named global shortcut. The previously stored
// accelerator is released first so changing the combo never leaves a stale
// registration. Returns false (and keeps the old shortcut both registered
// and in config) when the OS rejects the new accelerator — e.g. it is
// already taken by another app.
exports.updateShortcut = function ({
  name,
  accelerator,
  enabled,
  action,
  shortcutApi = electron.globalShortcut,
  store = require('./config.js'),
}) {
  const shortcuts = store.get('shortcut') || {}
  const previous = shortcuts[name] || {}
  const wasRegistered = Boolean(
    previous.accelerator &&
    previous.enabled &&
    isShortcutRegistered(shortcutApi, previous.accelerator),
  )

  if (shouldRegisterShortcut(previous, accelerator, enabled, wasRegistered)) {
    const isRegistered = registerShortcut(shortcutApi, accelerator, action)

    if (!isRegistered) {
      console.error(`Failed to register ${accelerator}`)
      if (shouldRestoreShortcut(previous, accelerator, wasRegistered)) {
        registerShortcut(shortcutApi, previous.accelerator, action)
      }

      return false
    }
  }

  if (shouldUnregisterShortcut(previous, accelerator, enabled)) {
    unregisterShortcut(shortcutApi, previous.accelerator)
  }

  shortcuts[name] = {
    accelerator: accelerator || previous.accelerator,
    enabled: Boolean(accelerator && enabled),
  }
  store.set('shortcut', shortcuts)
  return true
}
