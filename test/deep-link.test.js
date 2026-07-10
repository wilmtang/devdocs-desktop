const assert = require('node:assert/strict')
const test = require('node:test')
const {resolveDeepLink} = require('../app/deep-link.js')

test('normalizes encoded search deep links exactly once', () => {
  assert.equal(
    resolveDeepLink('devdocs://search/array%20map'),
    'https://devdocs.io/#q=array%20map',
  )
  assert.equal(
    resolveDeepLink('devdocs://search/C%2B%2B'),
    'https://devdocs.io/#q=C%2B%2B',
  )
})

test('rejects unsupported or malformed deep links', () => {
  assert.equal(resolveDeepLink('devdocs://settings/'), null)
  assert.equal(resolveDeepLink('https://search/array'), null)
  assert.equal(resolveDeepLink('devdocs://search/%'), null)
})
