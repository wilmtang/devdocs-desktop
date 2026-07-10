// Renderer scripts are classic <script> tags, so expose the class globally
// eslint-disable-next-line unicorn/no-global-object-property-assignment
globalThis.Searcher = class Searcher {
  #listeners = {}
  #activeQuery = null
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
    this.target.stopFindInPage('clearSelection')
    this.#hideSearcher()
    this.#emit('close')
  }

  #initialize() {
    this.initialized = true
    const $wrapper = document.createElement('div')
    $wrapper.innerHTML =
      '<div class="searcher searcher__hidden">' +
      '<input autofocus type="search" class="searcher-input" placeholder="Search..." />' +
      '<span class="searcher-progress searcher-progress__disabled"></span>' +
      '<button class="searcher-action searcher-prev">' +
      '<svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentcolor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
      '<path d="M30 20 L16 8 2 20" /></svg></button>' +
      '<button class="searcher-action searcher-next">' +
      '<svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentcolor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
      '<path d="M30 12 L16 24 2 12" /></svg></button>' +
      '<button class="searcher-action searcher-close">' +
      '<svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentcolor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">' +
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
      const r = e.result
      this.#showProgress(r.activeMatchOrdinal, r.matches)
      this.$input.focus()
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
    if (value) {
      // findNext: false starts a new find session; true advances within it
      const isFindNext = value === this.#activeQuery
      this.#activeQuery = value
      this.target.findInPage(value, {...options, findNext: isFindNext})
    }

    return this
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
