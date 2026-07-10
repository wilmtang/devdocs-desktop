const {contextBridge, ipcRenderer} = require('electron')

// Build config dir path without node modules (not available in sandboxed preload)
const home = process.env.HOME || process.env.USERPROFILE || ''
const sep = process.platform === 'win32' ? '\\' : '/'
function configDir(...parts) {
  return home + sep + '.devdocs' + sep + parts.join(sep)
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  getConfig(key) {
    return ipcRenderer.invoke('config:get', key)
  },
  setConfig(key, value) {
    return ipcRenderer.invoke('config:set', key, value)
  },

  configDir,

  onIPC(channel, callback) {
    const valid = [
      'open-search',
      'open-preferences',
      'focus-webview',
      'navigate',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
    ]
    if (valid.includes(channel)) {
      const listener = (_event, ...args) => {
        callback(...args)
      }

      ipcRenderer.on(channel, listener)
      return function () {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },

  fileExists(p) {
    return ipcRenderer.invoke('fs:exists', p)
  },
  readFile(p) {
    return ipcRenderer.invoke('fs:readFile', p)
  },
  writeFile(p, data) {
    return ipcRenderer.invoke('fs:writeFile', p, data)
  },
})
