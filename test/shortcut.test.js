const assert = require('node:assert/strict')
const test = require('node:test')
const {isSafeAccelerator} = require('../app/shortcut.js')

test('requires a non-Shift modifier for ordinary keys', () => {
  assert.equal(isSafeAccelerator('Shift+A'), false)
  assert.equal(isSafeAccelerator('A'), false)
  assert.equal(isSafeAccelerator('Control+Shift'), false)
  assert.equal(isSafeAccelerator('Control+'), false)
  assert.equal(isSafeAccelerator('Control+Shift+A'), true)
  assert.equal(isSafeAccelerator('CommandOrControl+Shift+D'), true)
})

test('allows bare function keys', () => {
  assert.equal(isSafeAccelerator('F1'), true)
  assert.equal(isSafeAccelerator('F24'), true)
  assert.equal(isSafeAccelerator('F25'), false)
})
