const SAFE_MODIFIERS = new Set([
  'alt',
  'option',
  'command',
  'cmd',
  'control',
  'ctrl',
  'super',
  'meta',
  'commandorcontrol',
  'cmdorctrl',
])
const ALL_MODIFIERS = new Set([...SAFE_MODIFIERS, 'shift'])

exports.isSafeAccelerator = function (accelerator) {
  if (typeof accelerator !== 'string') {
    return false
  }

  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase())
  const key = parts.at(-1)
  return Boolean(
    key &&
    !ALL_MODIFIERS.has(key) &&
    (/^f(?:[1-9]|1\d|2[0-4])$/v.test(key) ||
      parts.slice(0, -1).some((part) => SAFE_MODIFIERS.has(part))),
  )
}
