# DevDocs Desktop

[![version](https://img.shields.io/github/release/egoist/devdocs-desktop.svg?style=flat-square)](https://github.com/egoist/devdocs-desktop/releases)
[![downloads](https://img.shields.io/github/downloads/egoist/devdocs-desktop/total.svg?style=flat-square)](https://github.com/egoist/devdocs-desktop/releases)
[![downloads latest](https://img.shields.io/github/downloads/egoist/devdocs-desktop/latest/total.svg?style=flat-square)](https://github.com/egoist/devdocs-desktop/releases/latest)

[DevDocs.io](https://devdocs.io/) combines multiple API documentations in a fast, organized, and searchable interface. This is an unofficial desktop app for it.

![devdocs-preview](https://user-images.githubusercontent.com/8784712/27121730-11676ba8-511b-11e7-8c01-00444ee8501a.png)



## Features

### Background behavior

When closing the window, the app will continue running in the background, in the dock on macOS and the tray on Linux/Windows. Right-click the dock/tray icon and choose Quit to completely quit the app. On macOS, click the dock icon to show the window. On Linux, right-click the tray icon and choose Toggle to toggle the window. On Windows, click the tray icon to toggle the window.

### Build-in shortcuts

`devdocs` the website itself has great built-in shortcuts support, just check the `help` page in the app.

<img src="https://ooo.0o0.ooo/2017/06/14/59402442301b8.png" alt="help" width="300" />

### Global shortcut

Use <kbd>Alt+Space</kbd> to toggle the app from anywhere (show it when you're in another app, hide it when it's focused).

The combo is customizable: open **Preferences** (<kbd>⌘,</kbd>, or the app menu ▸ Settings) and scroll to the **Global Shortcut** section, then click the shortcut field and press the keys you want. The same section lets you enable/disable the shortcut, and it warns you if the combo is already taken by another app (your previous shortcut stays active in that case).

## Planned features

Please consider [sponsoring me](http://github.com/sponsors/egoist) to accelerate development.

- Menubar mode: switch beween desktop mode and menubar mode
- Tabs support: allow to open documentation in a new tab

## Install

### Using Homebrew

```
brew install --cask devdocs
```

### Manual download

You can manually download the latest release [here](https://github.com/egoist/devdocs-desktop/releases).

## Development

It's really easy to develop this app, no build tools like Webpack needed here, checkout [./app](/app) to get more:

```bash
npm install

npm run app
# edit files, save, refresh and it's done.
```

For a deep dive into how the app works internally (process model, IPC, security, offline mode), see [ARCHITECTURE.md](ARCHITECTURE.md).

## Distribute

```bash
npm run dist
```

## License

MIT &copy; [EGOIST](https://github.com/egoist)
