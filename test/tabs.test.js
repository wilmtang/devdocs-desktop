const assert = require('node:assert/strict')
const test = require('node:test')
const {pickRecentTab, pickSequentialTab} = require('../app/tabs.js')

const tabs = ['one', 'two', 'three']

test('sequential tab selection wraps in both directions', () => {
  assert.equal(pickSequentialTab(tabs, 'three', 1), 'one')
  assert.equal(pickSequentialTab(tabs, 'one', -1), 'three')
  assert.equal(pickSequentialTab(['one'], 'one', 1), null)
})

test('sequential tab selection starts at the nearest edge', () => {
  assert.equal(pickSequentialTab(tabs, null, 1), 'one')
  assert.equal(pickSequentialTab(tabs, null, -1), 'three')
})

test('recent tab selection skips the current tab', () => {
  assert.equal(pickRecentTab(['two', 'one', 'three'], 'two', 1), 'one')
  assert.equal(pickRecentTab(['two', 'one', 'three'], 'two', -1), 'three')
})
