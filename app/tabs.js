exports.pickSequentialTab = function (windows, current, direction) {
  if (windows.length < 2) {
    return null
  }

  const index = windows.indexOf(current)
  if (index === -1) {
    return direction > 0 ? windows[0] : windows.at(-1)
  }

  return windows[(index + direction + windows.length) % windows.length]
}

exports.pickRecentTab = function (history, current, direction) {
  const candidates = history.filter((win) => win !== current)
  return direction > 0 ? candidates[0] : candidates.at(-1)
}
