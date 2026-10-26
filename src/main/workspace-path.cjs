const path = require('node:path')

function isWithinRoot(root, target, allowRoot = false) {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  const relative = path.relative(resolvedRoot, resolvedTarget)
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return !outside && (allowRoot || relative !== '')
}

module.exports = { isWithinRoot }
