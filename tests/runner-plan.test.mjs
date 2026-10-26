import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const { buildExecutionPlan } = require('../src/main/runner-plan.cjs')

test('builds safe direct-execution plans for interpreted languages', () => {
  assert.deepEqual(buildExecutionPlan('D:/My Project/main.py', 'python'), {
    compile: null, run: { executable: 'python', args: ['D:/My Project/main.py'] }
  })
  assert.deepEqual(buildExecutionPlan('D:/My Project/app.mjs', 'javascript', { javascript: 'C:/Node/node.exe' }), {
    compile: null, run: { executable: 'C:/Node/node.exe', args: ['D:/My Project/app.mjs'] }
  })
})

test('runs JavaScript with direct argument-array execution in a path containing spaces', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'aryan runner '))
  try {
    const source = path.join(directory, 'hello world.js')
    writeFileSync(source, "process.stdout.write('runner-ok')", 'utf8')
    const plan = buildExecutionPlan(source, 'javascript', { javascript: process.execPath })
    const result = spawnSync(plan.run.executable, plan.run.args, { cwd: directory, encoding: 'utf8', shell: false })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, 'runner-ok')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('compiles C and C++ into isolated temporary output paths', () => {
  const buildDirectory = path.resolve('D:/temp/aryan build/run-1')
  for (const [language, source, compiler] of [['c', 'D:/project/main.c', 'gcc'], ['cpp', 'D:/project/main.cpp', 'g++']]) {
    const plan = buildExecutionPlan(source, language, {}, buildDirectory)
    assert.equal(plan.compile.executable, compiler)
    assert.deepEqual(plan.compile.args.slice(0, 2), ['-g', source])
    assert.equal(plan.compile.args[2], '-o')
    assert.equal(plan.compile.args[3], path.join(buildDirectory, process.platform === 'win32' ? 'program.exe' : 'program'))
    assert.equal(plan.run.executable, plan.compile.args[3])
  }
})

test('runs packaged Java classes using their declared package name', () => {
  const plan = buildExecutionPlan('D:/project/src/demo/Main.java', 'java', { javaRuntime: 'C:/Java/bin/java.exe' }, 'D:/temp/build 1', 'package demo;\npublic class Main {}')
  assert.deepEqual(plan.compile.args, ['-encoding', 'UTF-8', '-d', 'D:/temp/build 1', 'D:/project/src/demo/Main.java'])
  assert.deepEqual(plan.run, { executable: 'C:/Java/bin/java.exe', args: ['-cp', 'D:/temp/build 1', 'demo.Main'] })
})

test('reports unsupported languages and extension mismatches', () => {
  assert.throws(() => buildExecutionPlan('main.cpp', 'c', {}, 'build'), /does not match/)
  assert.throws(() => buildExecutionPlan('main.rs', 'rust', {}, 'build'), /Unsupported language/)
})
