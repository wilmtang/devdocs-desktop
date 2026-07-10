// Settings panel for the global "toggle window" shortcut. Dash-style UX:
// click the recorder field, press the desired combo, done. Recording
// temporarily suspends the active registration in the main process so
// pressing the current combo doesn't hide the window.
//
// Renderer scripts are classic <script> tags, so expose the class globally
// eslint-disable-next-line unicorn/no-global-object-property-assignment
globalThis.ShortcutPanel = class ShortcutPanel {
  // Modifier order follows the macOS convention (⌃⌥⇧⌘)
  static #MAC_SYMBOLS = {
    Control: '⌃',
    Alt: '⌥',
    Shift: '⇧',
    Command: '⌘',
    Super: '⌘',
  }
  // KeyboardEvent.code → Electron accelerator key, for codes that don't
  // follow the KeyX/DigitX/FX/NumpadX patterns handled in #keyFromEvent
  static #CODE_KEYS = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Comma: ',',
    Period: '.',
    Slash: '/',
  }
  #api
  #onClose
  #isMac
  #recording = false
  #accelerator = ''
  #enabled = false
  opened = false
  initialized = false
  $overlay
  $panel
  $recorder
  $enabled
  $error

  constructor(api, {onClose} = {}) {
    this.#api = api
    this.#onClose = onClose
    this.#isMac = api.platform === 'darwin'
  }

  async open() {
    if (!this.initialized) {
      this.#initialize()
    }

    const {accelerator, enabled} = await this.#api.getShortcut()
    this.#accelerator = accelerator
    this.#enabled = enabled
    this.#render()
    this.#showError(null)
    this.opened = true
    this.$overlay.classList.remove('shortcut-overlay__hidden')
    this.$recorder.focus()
  }

  async close() {
    if (!this.opened) {
      return
    }

    if (this.#recording) {
      await this.#stopRecording()
    }

    this.opened = false
    this.$overlay.classList.add('shortcut-overlay__hidden')
    if (this.#onClose) {
      this.#onClose()
    }
  }

  #initialize() {
    this.initialized = true
    const $wrapper = document.createElement('div')
    $wrapper.innerHTML =
      '<div class="shortcut-overlay shortcut-overlay__hidden">' +
      '<div class="shortcut-panel">' +
      '<h2 class="shortcut-title">Global Shortcut</h2>' +
      '<p class="shortcut-desc">Show or hide DevDocs from any app.</p>' +
      '<div class="shortcut-row">' +
      '<button type="button" class="shortcut-recorder"></button>' +
      '<label class="shortcut-enable">' +
      '<input type="checkbox" class="shortcut-enabled-input"> Enabled' +
      '</label>' +
      '</div>' +
      '<p class="shortcut-error" hidden></p>' +
      '<div class="shortcut-actions">' +
      '<button type="button" class="shortcut-done">Done</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    document.body.append($wrapper)

    this.$overlay = $wrapper.querySelector('.shortcut-overlay')
    this.$panel = $wrapper.querySelector('.shortcut-panel')
    this.$recorder = $wrapper.querySelector('.shortcut-recorder')
    this.$enabled = $wrapper.querySelector('.shortcut-enabled-input')
    this.$error = $wrapper.querySelector('.shortcut-error')

    this.$recorder.addEventListener('click', () => {
      if (this.#recording) {
        return
      }

      this.#startRecording()
    })

    // Clicking away cancels an in-progress recording
    this.$recorder.addEventListener('blur', () => {
      if (!this.#recording) {
        return
      }

      this.#stopRecording()
      this.#render()
    })

    this.$enabled.addEventListener('change', () => {
      this.#apply(this.#accelerator, this.$enabled.checked)
    })

    $wrapper
      .querySelector('.shortcut-done')
      .addEventListener('click', () => this.close())

    this.$overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.$overlay) {
        this.close()
      }
    })

    // Capture phase so recording beats any other keydown handling
    addEventListener('keydown', this.#onKeydown, {capture: true})
  }

  #onKeydown = (e) => {
    if (!this.opened) {
      return
    }

    if (!this.#recording) {
      if (e.key === 'Escape') {
        e.preventDefault()
        this.close()
      }

      return
    }

    e.preventDefault()
    e.stopPropagation()

    const modifiers = this.#modifiersFromEvent(e)

    if (e.key === 'Escape' && modifiers.length === 0) {
      this.#stopRecording()
      this.#render()
      return
    }

    const key = this.#keyFromEvent(e)
    if (!key) {
      // Only modifiers held so far — preview them in the field
      this.$recorder.textContent =
        modifiers.length > 0
          ? this.#formatParts(modifiers) + (this.#isMac ? '' : '+…')
          : 'Press shortcut…'
      return
    }

    if (modifiers.length === 0 && !/^F\d+$/v.test(key)) {
      this.#showError(
        this.#isMac
          ? 'Include a modifier key (⌘, ⌥, ⌃ or ⇧).'
          : 'Include a modifier key (Ctrl, Alt, Super or Shift).',
      )
      return
    }

    const accelerator = [...modifiers, key].join('+')
    this.#stopRecording()
    this.#apply(accelerator, true)
  }

  async #startRecording() {
    this.#recording = true
    this.#showError(null)
    this.$recorder.classList.add('shortcut-recorder__recording')
    this.$recorder.textContent = 'Press shortcut…'
    await this.#api.suspendShortcut(true)
  }

  async #stopRecording() {
    this.#recording = false
    this.$recorder.classList.remove('shortcut-recorder__recording')
    await this.#api.suspendShortcut(false)
  }

  async #apply(accelerator, enabled) {
    const result = await this.#api.setShortcut(accelerator, enabled)
    // On failure the main process keeps (and returns) the previous shortcut
    this.#accelerator = result.accelerator
    this.#enabled = result.enabled
    this.#render()
    this.#showError(result.ok ? null : result.error)
  }

  #render() {
    this.$recorder.textContent = this.#formatAccelerator(this.#accelerator)
    this.$enabled.checked = this.#enabled
  }

  #showError(message) {
    this.$error.hidden = !message
    this.$error.textContent = message || ''
  }

  #modifiersFromEvent(e) {
    const modifiers = []
    if (e.ctrlKey) {
      modifiers.push('Control')
    }

    if (e.altKey) {
      modifiers.push('Alt')
    }

    if (e.shiftKey) {
      modifiers.push('Shift')
    }

    if (e.metaKey) {
      modifiers.push(this.#isMac ? 'Command' : 'Super')
    }

    return modifiers
  }

  #keyFromEvent(e) {
    const {code} = e
    if (/^Key[A-Z]$/v.test(code)) {
      return code.slice(3)
    }

    if (/^Digit\d$/v.test(code)) {
      return code.slice(5)
    }

    if (/^F(?:[1-9]|1\d|2[0-4])$/v.test(code)) {
      return code
    }

    if (/^Numpad\d$/v.test(code)) {
      return 'num' + code.slice(6)
    }

    return ShortcutPanel.#CODE_KEYS[code] || null
  }

  // 'alt+space' → '⌥Space' on macOS, 'Alt+Space' elsewhere
  #formatAccelerator(accelerator) {
    if (!accelerator) {
      return 'Click to record'
    }

    const parts = accelerator.split('+').map((part) => {
      const canonical = {
        cmd: 'Command',
        command: 'Command',
        ctrl: 'Control',
        control: 'Control',
        alt: 'Alt',
        option: 'Alt',
        shift: 'Shift',
        super: 'Super',
        meta: 'Super',
        cmdorctrl: this.#isMac ? 'Command' : 'Control',
        commandorcontrol: this.#isMac ? 'Command' : 'Control',
      }[part.toLowerCase()]
      return canonical || part.charAt(0).toUpperCase() + part.slice(1)
    })

    return this.#formatParts(parts)
  }

  #formatParts(parts) {
    if (this.#isMac) {
      return parts
        .map((part) => ShortcutPanel.#MAC_SYMBOLS[part] || part)
        .join('')
    }

    return parts.map((part) => (part === 'Control' ? 'Ctrl' : part)).join('+')
  }
}
