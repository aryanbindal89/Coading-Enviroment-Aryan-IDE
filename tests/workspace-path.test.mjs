import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isWithinRoot } = require('../src/main/workspace-path.cjs')

test('permits descendants and root only when requested', () => {
  const root = path.resolve('D:/work/project')
  assert.equal(isWithinRoot(root, path.join(root, 'src', 'main.ts')), true)
  assert.equal(isWithinRoot(root, root), false)
  assert.equal(isWithinRoot(root, root, true), true)
})

test('rejects traversal and sibling paths sharing a prefix', () => {
  const root = path.resolve('D:/work/project')
  assert.equal(isWithinRoot(root, path.resolve(root, '..', 'secrets.txt')), false)
  assert.equal(isWithinRoot(root, path.resolve('D:/work/project-copy/file.ts')), false)
})
