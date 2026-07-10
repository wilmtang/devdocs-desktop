const assert = require('node:assert/strict')
const test = require('node:test')
const {updateShortcut} = require('../app/utils.js')

function setup({registered = true, accepts = true} = {}) {
  const operations = []
  const registrations = new Set(registered ? ['Alt+Space'] : [])
  const shortcuts = {
    toggleApp: {accelerator: 'Alt+Space', enabled: true},
  }
  const shortcutApi = {
    isRegistered(accelerator) {
      return registrations.has(accelerator)
    },
    register(accelerator) {
      operations.push(['register', accelerator])
      if (accepts) {
        registrations.add(accelerator)
      }

      return accepts
    },
    unregister(accelerator) {
      operations.push(['unregister', accelerator])
      registrations.delete(accelerator)
    },
  }
  const store = {
    get() {
      return shortcuts
    },
    set(_key, value) {
      operations.push(['set', value.toggleApp])
    },
  }
  return {operations, registrations, shortcutApi, store, shortcuts}
}

test('keeps the old shortcut active when its replacement is rejected', (t) => {
  t.mock.method(console, 'error', () => {})
  const state = setup({accepts: false})
  const ok = updateShortcut({
    name: 'toggleApp',
    accelerator: 'CommandOrControl+Shift+D',
    enabled: true,
    action() {},
    shortcutApi: state.shortcutApi,
    store: state.store,
  })

  assert.equal(ok, false)
  assert.deepEqual(state.operations, [['register', 'CommandOrControl+Shift+D']])
  assert.equal(state.registrations.has('Alt+Space'), true)
  assert.equal(state.shortcuts.toggleApp.accelerator, 'Alt+Space')
})

test('restores a suspended shortcut when a replacement is rejected', (t) => {
  t.mock.method(console, 'error', () => {})
  const state = setup({registered: false, accepts: false})
  let attempts = 0
  state.shortcutApi.register = (accelerator) => {
    state.operations.push(['register', accelerator])
    attempts++
    if (attempts === 2) {
      state.registrations.add(accelerator)
    }

    return attempts === 2
  }

  const ok = updateShortcut({
    name: 'toggleApp',
    accelerator: 'CommandOrControl+Shift+D',
    enabled: true,
    action() {},
    shortcutApi: state.shortcutApi,
    store: state.store,
  })

  assert.equal(ok, false)
  assert.deepEqual(state.operations, [
    ['register', 'CommandOrControl+Shift+D'],
    ['register', 'Alt+Space'],
  ])
  assert.equal(state.registrations.has('Alt+Space'), true)
})

test('registers a replacement before releasing the old shortcut', () => {
  const state = setup()
  const ok = updateShortcut({
    name: 'toggleApp',
    accelerator: 'CommandOrControl+Shift+D',
    enabled: true,
    action() {},
    shortcutApi: state.shortcutApi,
    store: state.store,
  })

  assert.equal(ok, true)
  assert.deepEqual(state.operations, [
    ['register', 'CommandOrControl+Shift+D'],
    ['unregister', 'Alt+Space'],
    ['set', {accelerator: 'CommandOrControl+Shift+D', enabled: true}],
  ])
})
