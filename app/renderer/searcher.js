function findMarkerPositions(root, value, doc = document) {
  if (!value || root.scrollHeight === 0) {
    return []
  }

  const query = value.toLocaleLowerCase()
  const rootTop = root.getBoundingClientRect().top
  const positions = new Set()
  const walker = doc.createTreeWalker(
    root,
    doc.defaultView.NodeFilter.SHOW_TEXT,
  )

  // ponytail: DevDocs text-node matches cover its docs; build a rendered-text
  // index only if split-node phrases need scrollbar markers.
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data.toLocaleLowerCase()
    let start = text.indexOf(query)
    while (start !== -1) {
      const range = doc.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + query.length)
      const rect = range.getBoundingClientRect()
      if (rect.width && rect.height) {
        const top =
          ((rect.top - rootTop + root.scrollTop) / root.scrollHeight) * 100
        positions.add(Math.max(0, Math.min(100, top)).toFixed(3))
      }

      start = text.indexOf(query, start + query.length)
    }
  }

  return [...positions]
}

function findInPageOptions(options, isFindNext) {
  return isFindNext ? {...options, findNext: true} : options
}

function renderFindMarkers(value, getPositions) {
  const id = '__devdocs-find-markers'
  document.querySelector('#' + id)?.remove()

  const root = document.querySelector('._content')
  if (!root || !value) {
    return
  }

  const rootRect = root.getBoundingClientRect()
  const rail = document.createElement('div')
  rail.id = id
  rail.setAttribute('aria-hidden', 'true')
  Object.assign(rail.style, {
    position: 'fixed',
    top: rootRect.top + 'px',
    right: Math.max(0, innerWidth - rootRect.right) + 'px',
    width: '8px',
    height: rootRect.height + 'px',
    zIndex: '2147483647',
    pointerEvents: 'none',
  })

  for (const top of getPositions(root, value, document)) {
    const marker = document.createElement('span')
    Object.assign(marker.style, {
      position: 'absolute',
      top: top + '%',
      right: '2px',
      width: '6px',
      height: '2px',
      background: '#fbbc04',
      borderRadius: '1px',
      transform: 'translateY(-1px)',
    })
    rail.append(marker)
  }

  document.body.append(rail)
}

// Renderer scripts are classic <script> tags, so expose the class globally
// eslint-disable-next-line unicorn/no-global-object-property-assignment
globalThis.Searcher = class Searcher {
  #listeners = {}
  #activeQuery = null
  #markerRequestId = null
  target
  opened = false
  initialized = false
  $searcher
  $progress
  $input
  $prev
  $next
  $close

  constructor(target) {
    this.target = target
  }

  #emit(event) {
    for (const fn of this.#listeners[event] || []) {
      fn()
    }
  }

  on(event, fn) {
    ;(this.#listeners[event] ||= []).push(fn)
  }

  toggle() {
    return this.opened ? this.close() : this.open()
  }

  open() {
    if (!this.initialized) {
      this.#initialize()
    }

    this.opened = true
    this.$searcher.classList.remove('searcher__hidden')
    this.$input.focus()
    this.$input.select()
    this.#emit('open')
  }

  close() {
    this.opened = false
    this.#activeQuery = null
    this.#markerRequestId = null
    this.target.stopFindInPage('clearSelection')
    this.#updateMarkers('')
    this.#hideSearcher()
    this.#emit('close')
  }

  #initialize() {
    this.initialized = true
    const $wrapper = document.createElement('div')
    $wrapper.innerHTML =
      '<div class="searcher searcher__hidden">' +
      '<input autofocus type="search" class="searcher-input" aria-label="Search in page" placeholder="Search..." />' +
      '<span class="searcher-progress searcher-progress__disabled"></span>' +
      '<button type="button" class="searcher-action searcher-prev" aria-label="Previous match">' +
      '<svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentcolor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
      '<path d="M30 20 L16 8 2 20" /></svg></button>' +
      '<button type="button" class="searcher-action searcher-next" aria-label="Next match">' +
      '<svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentcolor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
      '<path d="M30 12 L16 24 2 12" /></svg></button>' +
      '<button type="button" class="searcher-action searcher-close" aria-label="Close search">' +
      '<svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentcolor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
      '<path d="M2 30 L30 2 M30 30 L2 2" /></svg></button></div>'
    document.body.append($wrapper)
    this.$searcher = $wrapper.querySelector('.searcher')
    this.$progress = this.$searcher.querySelector('.searcher-progress')
    this.$input = this.$searcher.querySelector('.searcher-input')
    this.$input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.#findNext(e.target.value)
      } else if (e.key === 'Escape') {
        this.close()
      }
    })
    this.$prev = this.$searcher.querySelector('.searcher-prev')
    this.$next = this.$searcher.querySelector('.searcher-next')
    this.$close = this.$searcher.querySelector('.searcher-close')
    this.$prev.addEventListener('click', () =>
      this.#findPrev(this.$input.value),
    )
    this.$next.addEventListener('click', () =>
      this.#findNext(this.$input.value),
    )
    this.$close.addEventListener('click', () => this.close())

    this.target.addEventListener('found-in-page', (e) => {
      if (!this.opened) {
        return
      }

      const r = e.result
      this.#showProgress(r.activeMatchOrdinal, r.matches)
      this.$input.focus()
      if (r.finalUpdate && r.requestId === this.#markerRequestId) {
        this.#markerRequestId = null
        this.#updateMarkers(this.#activeQuery)
      }
    })
    this.#emit('initialized')
  }

  #findNext(value) {
    return this.#find(value, {})
  }

  #findPrev(value) {
    return this.#find(value, {forward: false})
  }

  #find(value, options) {
    if (!value) {
      this.#activeQuery = null
      this.#markerRequestId = null
      this.target.stopFindInPage('clearSelection')
      this.#updateMarkers('')
      this.$progress.classList.add('searcher-progress__disabled')
      return this
    }

    // Omitting findNext starts a session; Electron 43 ignores explicit false.
    const isFindNext = value === this.#activeQuery
    this.#activeQuery = value
    const requestId = this.target.findInPage(
      value,
      findInPageOptions(options, isFindNext),
    )
    if (!isFindNext) {
      this.#markerRequestId = requestId
    }

    return this
  }

  #updateMarkers(value) {
    this.target
      .executeJavaScript(
        `(${renderFindMarkers})(${JSON.stringify(value)}, ${findMarkerPositions})`,
      )
      .catch(() => {})
  }

  #showProgress(current, total) {
    this.$progress.classList.remove('searcher-progress__disabled')
    this.$progress.textContent = current + '/' + total
  }

  #hideSearcher() {
    this.$progress.classList.add('searcher-progress__disabled')
    this.$searcher.classList.add('searcher__hidden')
    this.$input.value = ''
  }
}

if (typeof module !== 'undefined') {
  module.exports = {findInPageOptions, findMarkerPositions}
}
