;(async function () {
  const api = globalThis.electronAPI

  const HOME_URL = 'https://devdocs.io'

  // Platform class
  document.body.classList.add('is-' + api.platform)

  let webview = null
  let searcher = null
  let pendingNavigate = null

  function navigateTo(url) {
    if (!webview || !webview.__ready) {
      pendingNavigate = url
      return
    }

    if (url.startsWith('devdocs://')) {
      const route = url.replace('devdocs://', '')
      const match = route.match(/^search\/(?<query>.+)$/v)
      if (match) {
        webview.src = HOME_URL + '/#q=' + encodeURIComponent(match.groups.query)
      }
    } else {
      webview.src = url
    }
  }

  // Register IPC listeners before the webview exists: the main process can
  // send messages (deep links, tab URLs) while devdocs.io is still loading,
  // and anything sent before a listener is registered would be lost.
  api.onIPC('open-search', () => {
    if (searcher) {
      searcher.open()
    }
  })
  api.onIPC('focus-webview', () => {
    if (webview) {
      webview.focus()
    }
  })
  api.onIPC('zoom-in', () => {
    if (webview) {
      webview.send('zoom-in')
    }
  })
  api.onIPC('zoom-out', () => {
    if (webview) {
      webview.send('zoom-out')
    }
  })
  api.onIPC('zoom-reset', () => {
    if (webview) {
      webview.send('zoom-reset')
    }
  })
  api.onIPC('navigate', navigateTo)

  // Dark mode
  const mode = await api.getConfig('mode')
  if (mode === 'dark') {
    document.body.classList.add('is-dark-mode')
  }

  // Ensure custom CSS/JS files exist
  await ensureCustomFiles()

  webview = createWebView()

  // Searcher for in-page find
  searcher = new globalThis.Searcher(webview)
  searcher.on('close', () => {
    webview.focus()
  })

  async function ensureCustomFiles() {
    const cssPath = api.configDir('custom.css')
    const jsPath = api.configDir('custom.js')

    if (!(await api.fileExists(cssPath))) {
      await api.writeFile(cssPath, '')
    }

    if (!(await api.fileExists(jsPath))) {
      await api.writeFile(jsPath, '')
    }
  }

  function createWebView() {
    const wv = document.createElement('webview')
    wv.className = 'webview'
    // Popups must be enabled for window.open/target=_blank to reach the main
    // process, which routes them to new tabs or the default browser
    wv.setAttribute('allowpopups', '')
    // The preload attribute requires an absolute file: URL
    wv.preload = new URL('preload.js', location.href).href
    wv.src = HOME_URL

    const $error = document.querySelector('#load-error')
    const $errorDetail = $error.querySelector('.load-error-detail')
    $error.querySelector('.load-error-retry').addEventListener('click', () => {
      $error.hidden = true
      wv.src = HOME_URL
    })

    wv.addEventListener('ipc-message', async (e) => {
      if (e.channel === 'switch-mode') {
        const m = e.args[0]
        await api.setConfig('mode', m)
        document.body.classList.toggle('is-dark-mode', m === 'dark')
      } else if (e.channel === 'zoom-changed') {
        await api.setConfig('zoomFactor', e.args[0])
      }
    })

    wv.addEventListener('dom-ready', async () => {
      // Insert custom CSS
      const baseCSS =
        '._app button:focus { outline: none; }\n' +
        '._app button._search-clear { top: .5rem; }\n'
      const customCSS = await api.readFile(api.configDir('custom.css'))
      wv.insertCSS(baseCSS + customCSS)

      // Inject custom JS
      const customJS = await api.readFile(api.configDir('custom.js'))
      if (customJS.trim()) {
        wv.executeJavaScript(customJS)
      }

      // Apply saved zoom
      const zoomFactor = await api.getConfig('zoomFactor')
      if (zoomFactor && zoomFactor !== 1) {
        wv.send('set-zoom', zoomFactor)
      }

      wv.focus()

      if (!wv.__ready) {
        wv.__ready = true
        if (pendingNavigate) {
          const url = pendingNavigate
          pendingNavigate = null
          navigateTo(url)
        }
      }
    })

    wv.addEventListener('did-start-loading', () => {
      $error.hidden = true
    })

    wv.addEventListener('did-stop-loading', () => {
      document.title = wv.getTitle()
    })

    wv.addEventListener('page-title-updated', (e) => {
      document.title = e.title
    })

    wv.addEventListener('did-fail-load', (e) => {
      // -3 is ERR_ABORTED (in-page navigation cancels etc.), not a failure
      if (!e.isMainFrame || e.errorCode === -3) {
        return
      }

      $errorDetail.textContent = e.errorDescription || 'Network error'
      $error.hidden = false
    })

    document.body.append(wv)
    return wv
  }
})()
