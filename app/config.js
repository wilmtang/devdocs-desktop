const path = require('node:path')
const fs = require('node:fs')
const {app} = require('electron')

const configPath = path.join(app.getPath('userData'), 'config.json')

const defaults = {
  lastWindowState: {width: 800, height: 600},
  shortcut: {toggleApp: {accelerator: 'alt+space', enabled: true}},
  mode: 'dark',
}

let data

function load() {
  data = {...defaults}
  try {
    if (fs.existsSync(configPath)) {
      data = {...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8'))}
    }
  } catch (error) {
    console.error('Failed to load config, using defaults:', error.message)
  }

  migrate()
}

// Older versions stored shortcuts as plain strings ({toggleApp: 'alt+space'})
// and toggled them via flat 'shortcut.<name>' keys; fold both shapes into
// {accelerator, enabled}
function migrate() {
  if (data.shortcut && typeof data.shortcut === 'object') {
    for (const name of Object.keys(data.shortcut)) {
      const value = data.shortcut[name]
      if (typeof value === 'string') {
        data.shortcut[name] = {accelerator: value, enabled: true}
      }
    }
  }

  for (const key of Object.keys(data)) {
    if (!key.startsWith('shortcut.')) {
      continue
    }

    const name = key.slice('shortcut.'.length)
    if (typeof data[key] === 'string') {
      data.shortcut = {
        ...data.shortcut,
        [name]: {accelerator: data[key], enabled: true},
      }
    }

    delete data[key]
  }
}

function save() {
  try {
    // Write to a temp file and rename so a crash can't corrupt the config
    const tmpPath = configPath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmpPath, configPath)
  } catch (error) {
    console.error('Failed to save config, write error:', error.message)
  }
}

load()

module.exports = {
  get(key) {
    return data[key]
  },
  set(key, value) {
    data[key] = value
    save()
  },
}
