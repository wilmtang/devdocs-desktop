const HOME_URL = 'https://devdocs.io'

exports.resolveDeepLink = function (url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'devdocs:' || parsed.hostname !== 'search') {
      return null
    }

    const query = decodeURIComponent(parsed.pathname.slice(1))
    return query ? HOME_URL + '/#q=' + encodeURIComponent(query) : null
  } catch {
    return null
  }
}
