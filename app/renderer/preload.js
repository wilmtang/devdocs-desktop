const {ipcRenderer} = require('electron')

let zoomFactor = 1

// Listen for zoom commands from host
ipcRenderer.on('set-zoom', (_event, factor) => {
  zoomFactor = factor
  applyZoom()
})

ipcRenderer.on('zoom-in', () => {
  zoomFactor = Math.min(zoomFactor + 0.1, 1.6)
  applyZoom()
  ipcRenderer.sendToHost('zoom-changed', zoomFactor)
})

ipcRenderer.on('zoom-out', () => {
  zoomFactor = Math.max(zoomFactor - 0.1, 0.8)
  applyZoom()
  ipcRenderer.sendToHost('zoom-changed', zoomFactor)
})

ipcRenderer.on('zoom-reset', () => {
  zoomFactor = 1
  applyZoom()
  ipcRenderer.sendToHost('zoom-changed', zoomFactor)
})

function applyZoom() {
  const node = document.querySelector('#zzz-devzoom')
  if (node) {
    node.textContent = 'body {zoom: ' + zoomFactor + ' !important}'
  }
}

// Dark mode detection
document.addEventListener('change', (e) => {
  if (e.target.name === 'dark') {
    ipcRenderer.sendToHost('switch-mode', e.target.checked ? 'dark' : 'light')
  }
})

// ---------------------------------------------------------------------------
// Global shortcut setting, grafted onto DevDocs' own Preferences page.
//
// The Preferences page (/settings) is remote devdocs.io content living in this
// webview, so we can't add the row server-side. Instead this preload — which
// has both DOM access to the page and ipcRenderer — injects a native-looking
// "Global Shortcut" fieldset and wires it to the app's shortcut IPC. The value
// lives in the main process (config.js), not DevDocs' own settings store, so
// nothing here touches `app.settings`.
// ---------------------------------------------------------------------------

const shortcut = (() => {
  const isMac = process.platform === 'darwin'
  const FIELDSET_ID = 'devdocs-desktop-shortcut'
  const STYLE_ID = 'devdocs-desktop-shortcut-style'

  // macOS modifier glyphs, in the conventional ⌃⌥⇧⌘ order
  const MAC_SYMBOLS = {
    Control: '⌃',
    Alt: '⌥',
    Shift: '⇧',
    Command: '⌘',
    Super: '⌘',
  }
  // KeyboardEvent.code → Electron accelerator key for codes that don't follow
  // the KeyX/DigitX/FX/NumpadX patterns handled in keyFromEvent
  const CODE_KEYS = {
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

  let isRecording = false
  let accelerator = ''
  let isEnabled = false
  let $recorder
  let $enabled
  let $error

  function modifiersFromEvent(e) {
    const mods = []
    if (e.ctrlKey) {
      mods.push('Control')
    }

    if (e.altKey) {
      mods.push('Alt')
    }

    if (e.shiftKey) {
      mods.push('Shift')
    }

    if (e.metaKey) {
      mods.push(isMac ? 'Command' : 'Super')
    }

    return mods
  }

  function keyFromEvent(e) {
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

    return CODE_KEYS[code] || null
  }

  function formatParts(parts) {
    if (isMac) {
      return parts.map((p) => MAC_SYMBOLS[p] || p).join('')
    }

    return parts.map((p) => (p === 'Control' ? 'Ctrl' : p)).join('+')
  }

  // 'alt+space' → '⌥Space' on macOS, 'Alt+Space' elsewhere
  function formatAccelerator(acc) {
    if (!acc) {
      return 'Click to record'
    }

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
      cmdorctrl: isMac ? 'Command' : 'Control',
      commandorcontrol: isMac ? 'Command' : 'Control',
    }
    const parts = acc.split('+').map((part) => {
      const key = part.toLowerCase()
      return canonical[key] || part.charAt(0).toUpperCase() + part.slice(1)
    })
    return formatParts(parts)
  }

  function render() {
    if ($recorder) {
      $recorder.textContent = isRecording
        ? 'Press shortcut…'
        : formatAccelerator(accelerator)
      $recorder.classList.toggle('_recording', isRecording)
    }

    if ($enabled) {
      $enabled.checked = isEnabled
    }
  }

  function showError(message) {
    if (!$error) {
      return
    }

    $error.hidden = !message
    $error.textContent = message || ''
  }

  async function apply(nextAccelerator, nextEnabled) {
    const result = await ipcRenderer.invoke(
      'shortcut:set',
      nextAccelerator,
      nextEnabled,
    )
    // On failure the main process keeps (and returns) the previous shortcut
    accelerator = result.accelerator
    isEnabled = result.enabled
    render()
    showError(result.ok ? null : result.error)
  }

  async function startRecording() {
    isRecording = true
    showError(null)
    render()
    // Release the current registration so pressing the old combo mid-record
    // doesn't hide the window
    await ipcRenderer.invoke('shortcut:suspend', true)
  }

  async function stopRecording() {
    isRecording = false
    render()
    await ipcRenderer.invoke('shortcut:suspend', false)
  }

  // One capture-phase listener, active only while recording
  function onKeydown(e) {
    if (!isRecording) {
      return
    }

    e.preventDefault()
    e.stopPropagation()

    const modifiers = modifiersFromEvent(e)

    if (e.key === 'Escape' && modifiers.length === 0) {
      stopRecording()
      return
    }

    const key = keyFromEvent(e)
    if (!key) {
      // Only modifiers held so far — preview them
      $recorder.textContent =
        modifiers.length > 0
          ? formatParts(modifiers) + (isMac ? '' : '+…')
          : 'Press shortcut…'
      return
    }

    if (modifiers.length === 0 && !/^F\d+$/v.test(key)) {
      showError(
        isMac
          ? 'Include a modifier key (⌘, ⌥, ⌃ or ⇧).'
          : 'Include a modifier key (Ctrl, Alt, Super or Shift).',
      )
      return
    }

    stopRecording()
    apply([...modifiers, key].join('+'), true)
  }

  function buildFieldset() {
    const fieldset = document.createElement('div')
    fieldset.className = '_settings-fieldset'
    fieldset.id = FIELDSET_ID
    fieldset.innerHTML =
      '<h2 class="_settings-legend">Global Shortcut:</h2>' +
      '<div class="_settings-inputs">' +
      '<label class="_settings-label">' +
      '<input type="checkbox" class="_dd-shortcut-enabled"> Enable global shortcut' +
      '<small>Show or hide DevDocs from any app, even when it’s in the background.</small>' +
      '</label>' +
      '<div class="_settings-label _dd-shortcut-row">' +
      '<button type="button" class="_btn _dd-shortcut-recorder"></button>' +
      '<small>Click the field, then press the key combination you want.</small>' +
      '</div>' +
      '<p class="_dd-shortcut-error" hidden></p>' +
      '</div>'
    return fieldset
  }

  function injectStyles() {
    if (document.querySelector('#' + STYLE_ID)) {
      return
    }

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent =
      '._dd-shortcut-row{display:flex;align-items:center;gap:.6em;margin-top:.5em}' +
      '._dd-shortcut-recorder{min-width:7em;font-family:monospace;cursor:pointer}' +
      '._dd-shortcut-recorder._recording{font-style:italic;opacity:.75}' +
      '._dd-shortcut-row small{margin:0;opacity:.65}' +
      '._dd-shortcut-error{color:#e25252;margin:.4em 0 0}' +
      '._dd-shortcut-error[hidden]{display:none}'
    document.head.append(style)
  }

  async function inject() {
    // Only on the Preferences page, and only once
    if (document.querySelector('#' + FIELDSET_ID)) {
      return
    }

    const reset = document.querySelector('._reset-btn')
    if (!reset) {
      return
    }

    const container = reset.closest('._static')
    if (!container) {
      return
    }

    injectStyles()
    const fieldset = buildFieldset()
    // Place it after the last existing group, before Export/Import & Reset
    // Spread to an array: NodeList has no .at()
    const groups = [...container.querySelectorAll('._settings-fieldset')]
    const last = groups.at(-1)
    if (last) {
      last.after(fieldset)
    } else {
      container.querySelector('._lined-heading').after(fieldset)
    }

    $recorder = fieldset.querySelector('._dd-shortcut-recorder')
    $enabled = fieldset.querySelector('._dd-shortcut-enabled')
    $error = fieldset.querySelector('._dd-shortcut-error')

    $recorder.addEventListener('click', () => {
      if (!isRecording) {
        startRecording()
      }
    })
    // Clicking away cancels an in-progress recording
    $recorder.addEventListener('blur', () => {
      if (isRecording) {
        stopRecording()
      }
    })
    $enabled.addEventListener('change', () => {
      apply(accelerator, $enabled.checked)
    })

    const current = await ipcRenderer.invoke('shortcut:get')
    accelerator = current.accelerator
    isEnabled = current.enabled
    render()
  }

  function start() {
    // Capture phase so recording beats DevDocs' own key handling
    document.addEventListener('keydown', onKeydown, {capture: true})
    inject()
    // DevDocs is a SPA; re-inject whenever the Preferences page re-renders
    const observer = new MutationObserver(() => {
      inject()
    })
    observer.observe(document.body, {childList: true, subtree: true})
  }

  return {start}
})()

document.addEventListener('DOMContentLoaded', () => {
  // Create zoom style element
  const style = document.createElement('style')
  style.id = 'zzz-devzoom'
  style.textContent = 'body {zoom: ' + zoomFactor + ' !important}'
  document.body.append(style)

  // Detect initial dark mode (dark=1 may be the last cookie, without a
  // trailing semicolon)
  if (/(?:^|;\s*)dark=1(?:;|$)/v.test(document.cookie)) {
    ipcRenderer.sendToHost('switch-mode', 'dark')
  } else {
    ipcRenderer.sendToHost('switch-mode', 'light')
  }

  shortcut.start()
})
