const assert = require('node:assert/strict')
const test = require('node:test')
const {
  findInPageOptions,
  findMarkerPositions,
} = require('../app/renderer/searcher.js')

test('omits findNext when starting an Electron find session', () => {
  assert.deepEqual(findInPageOptions({}, false), {})
  assert.deepEqual(findInPageOptions({forward: false}, true), {
    forward: false,
    findNext: true,
  })
})

test('positions visible content matches on the scrollbar', () => {
  const nodes = [
    {data: 'Alpha alpha', top: 120, visible: true},
    {data: 'alpha', top: 320, visible: false},
    {data: 'alpha', top: 520, visible: true},
  ]
  const root = {
    scrollHeight: 1000,
    scrollTop: 100,
    getBoundingClientRect: () => ({top: 20}),
  }
  const doc = {
    defaultView: {NodeFilter: {SHOW_TEXT: 4}},
    createTreeWalker() {
      let index = 0
      return {nextNode: () => nodes[index++] || null}
    },
    createRange() {
      let node
      return {
        setStart(value) {
          node = value
        },
        setEnd() {},
        getBoundingClientRect() {
          return {top: node.top, width: node.visible ? 10 : 0, height: 10}
        },
      }
    },
  }

  assert.deepEqual(findMarkerPositions(root, 'ALPHA', doc), [
    '20.000',
    '60.000',
  ])
})
