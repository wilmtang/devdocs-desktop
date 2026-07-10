;(async function () {
  const api = globalThis.electronAPI

  // Ensure custom CSS/JS files exist
  await ensureCustomFiles()

  // Platform class
  document.body.classList.add('is-' + api.platform)

  // Dark mode
  const mode = await api.getConfig('mode')
  if (mode === 'dark') {
    document.body.classList.add('is-dark-mode')
  }

  // WebView
  let pendingNavigate

  function navigateTo(url) {
    if (webview && webview.__ready) {
      if (url.startsWith('devdocs://')) {
        const route = url.replace('devdocs://', '')
        const match = route.match(/^search\/(?<query>.+)$/v)
        if (match) {
          webview.src =
            'https://devdocs.io/#q=' + encodeURIComponent(match.groups.query)
        }
      } else {
        webview.src = url
      }
    } else {
      pendingNavigate = url
    }
  }

  const webview = await createWebView()

  if (pendingNavigate) {
    navigateTo(pendingNavigate)
    pendingNavigate = null
  }

  // Debounced resize
  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      webview.reload()
    }, 1000)
  })

  // Searcher for in-page find
  const searcher = new globalThis.Searcher(webview)
  searcher.on('close', () => {
    webview.focus()
  })

  // IPC from main process
  api.onIPC('open-search', () => {
    searcher.open()
  })
  api.onIPC('focus-webview', () => {
    webview.focus()
  })
  api.onIPC('zoom-in', () => {
    webview.send('zoom-in')
  })
  api.onIPC('zoom-out', () => {
    webview.send('zoom-out')
  })
  api.onIPC('zoom-reset', () => {
    webview.send('zoom-reset')
  })

  api.onIPC('navigate', (url) => {
    navigateTo(url)
  })

  // Tab creation for new-window events from webview
  function createTab(url) {
    api.sendIPC('create-tab', url)
  }

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
    return new Promise((resolve, reject) => {
      const wv = document.createElement('webview')
      wv.className = 'webview'
      wv.src = 'https://devdocs.io'
      wv.preload = 'preload.js'

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
        wv.__ready = true
        resolve(wv)
      })

      wv.addEventListener('did-stop-loading', () => {
        document.title = wv.getTitle()
      })

      wv.addEventListener('page-title-updated', (e) => {
        document.title = e.title
      })

      wv.addEventListener('new-window', (e) => {
        e.preventDefault()
        // Create a new native tab on macOS
        createTab(e.url)
      })

      wv.addEventListener('did-fail-load', (e) => {
        if (e.isMainFrame && e.errorCode !== -3) {
          reject(new Error('Page load failed: ' + e.errorDescription))
        }
      })

      document.body.append(wv)
    })
  }
})()
