import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { IPty } from 'node-pty'
import type { RunLanguage } from '../shared/types'
import { isWithinRoot } from './workspace-path.cjs'
import { buildExecutionPlan } from './runner-plan.cjs'

const execFileAsync = promisify(execFile)
let mainWindow: BrowserWindow | null = null
let workspaceRoot: string | null = null
const runs = new Map<string, ReturnType<typeof spawn>>()
const terminals = new Map<string, IPty | ReturnType<typeof spawn>>()
const appStatePath = () => path.join(app.getPath('userData'), 'settings.json')
const aiSecretsPath = () => path.join(app.getPath('userData'), 'ai-credentials.json')

type AppState = { theme?: 'dark' | 'light'; runtimes?: Record<string, string>; extensionEnabled?: Record<string, boolean>; extensionSettings?: Record<string, Record<string, string>>; extensionTheme?: { name: string; id: string } | null }
async function readState(): Promise<AppState> {
  try { return JSON.parse(await readFile(appStatePath(), 'utf8')) as AppState } catch { return {} }
}
async function writeState(next: AppState) {
  await mkdir(app.getPath('userData'), { recursive: true })
  const current = await readState()
  await writeFile(appStatePath(), JSON.stringify({ ...current, ...next }, null, 2), 'utf8')
}
const extensionRoots = () => [path.join(app.getAppPath(), 'extensions'), path.join(app.getPath('userData'), 'extensions')]
async function readExtensionManifest(name: string, themeId?: string) {
  for (const root of extensionRoots()) {
    let directories
    try { directories = await readdir(root, { withFileTypes: true }) } catch { continue }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue
      try {
        const manifestFile = path.join(root, directory.name, 'manifest.json')
        if ((await stat(manifestFile)).size > 256 * 1024) continue
        const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
        if (manifest.name !== name) continue
        if (themeId) {
          const themes = Array.isArray(manifest.contributions?.themes) ? manifest.contributions.themes : []
          if (!themes.some((theme: any) => theme && theme.id === themeId && (theme.base === 'dark' || theme.base === 'light') && typeof theme.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(theme.accent))) continue
        }
        return manifest
      } catch { /* ignore invalid extension files */ }
    }
  }
  return null
}
function send(channel: string, payload: unknown) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload) }
function assertText(value: unknown, label: string, max = 2000): asserts value is string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(`Invalid ${label}.`)
}
function assertName(value: unknown) {
  assertText(value, 'name', 255)
  if (!value.trim() || value === '.' || value === '..' || /[\\/:*?"<>|]/.test(value)) throw new Error('Use a valid file or folder name.')
}
function resolveWorkspacePath(target: string, allowRoot = false): string {
  if (!workspaceRoot) throw new Error('Open a workspace folder first.')
  assertText(target, 'path', 32768)
  const resolved = path.resolve(target)
  if (!isWithinRoot(workspaceRoot, resolved, allowRoot)) throw new Error('That path is outside the active workspace.')
  return resolved
}
async function existingWorkspacePath(target: string, allowRoot = false): Promise<string> {
  const resolved = resolveWorkspacePath(target, allowRoot)
  const real = await (await import('node:fs/promises')).realpath(resolved)
  const base = await (await import('node:fs/promises')).realpath(workspaceRoot!)
  if (!isWithinRoot(base, real, allowRoot)) throw new Error('That path resolves outside the active workspace.')
  return real
}
function validRoot(value: unknown): string {
  assertText(value, 'workspace path', 32768)
  const root = path.resolve(value)
  if (!workspaceRoot || root !== workspaceRoot) throw new Error('The requested workspace is not active.')
  return root
}
function emitRun(id: string, text: string, kind: 'stdout' | 'stderr' | 'system' | 'exit') { send('run:output', { id, text, kind }) }
function killProcessTree(child: ReturnType<typeof spawn>) {
  if (!child.pid || child.killed) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else child.kill('SIGTERM')
}

async function runCommand(executable: string, args: string[], cwd: string, id: string, label: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
    runs.set(id, child)
    const finish = (code: number) => { if (settled) return; settled = true; clearTimeout(timer); runs.delete(id); resolve(code) }
    child.stdout?.on('data', (data: Buffer) => emitRun(id, data.toString(), 'stdout'))
    child.stderr?.on('data', (data: Buffer) => emitRun(id, data.toString(), 'stderr'))
    child.on('error', (error) => {
      const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `${label} executable was not found (${executable}). Configure its path in Settings.`
        : `${label}: ${error.message}`
      emitRun(id, `${message}\r\n`, 'system'); finish(127)
    })
    child.on('close', (code) => finish(code ?? 1))
    const timer = setTimeout(() => { emitRun(id, 'Process stopped after the 15 minute safety limit.\r\n', 'system'); killProcessTree(child) }, 15 * 60 * 1000)
  })
}

async function startRun(file: string, language: RunLanguage, runtimeConfig: Record<string, string> = {}) {
  const source = await existingWorkspacePath(file)
  const info = await stat(source)
  if (!info.isFile()) throw new Error('Choose a source file to run.')
  const id = randomUUID()
  const cwd = workspaceRoot!
  const compiled = language === 'c' || language === 'cpp' || language === 'java'
  const buildDirectory = path.join(app.getPath('temp'), 'aryan-ide-build', id)
  const sourceText = language === 'java' ? await readFile(source, 'utf8') : ''
  const plan = buildExecutionPlan(source, language, runtimeConfig, compiled ? buildDirectory : undefined, sourceText)
  if (plan.compile) await mkdir(buildDirectory, { recursive: true })
  emitRun(id, `Starting ${path.basename(source)}…\r\n`, 'system')
  void (async () => {
    try {
      let code = plan.compile
        ? await runCommand(plan.compile.executable, plan.compile.args, cwd, id, language === 'java' ? 'Java compiler' : language === 'c' ? 'GCC' : 'G++')
        : 0
      if (code === 0) code = await runCommand(plan.run.executable, plan.run.args, cwd, id, language === 'javascript' ? 'Node.js' : language === 'python' ? 'Python' : 'Program')
      emitRun(id, code === 0 ? '\r\nProcess finished with exit code 0.\r\n' : `\r\nProcess finished with exit code ${code}.\r\n`, 'exit')
    } catch (error) { emitRun(id, `${error instanceof Error ? error.message : String(error)}\r\n`, 'system'); emitRun(id, 'Process could not start.\r\n', 'exit') }
    finally { if (plan.compile) await rm(buildDirectory, { recursive: true, force: true }).catch(() => {}) }
  })()
  return id
}

async function gitExec(root: string, args: string[]) {
  try {
    const result = await execFileAsync('git', args, { cwd: validRoot(root), timeout: 30000, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' })
    return (result.stdout || '') + (result.stderr || '')
  } catch (error) {
    const e = error as Error & { stderr?: string }
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Git was not found. Install Git for Windows and restart Aryan IDE.')
    throw new Error((e.stderr || e.message || 'Git command failed').trim())
  }
}

function registerHandlers() {
  ipcMain.handle('workspace:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    workspaceRoot = path.resolve(result.filePaths[0])
    const escapedRoot = workspaceRoot.replace(/'/g, "''")
    for (const terminal of terminals.values()) {
      const command = `Set-Location -LiteralPath '${escapedRoot}'\r`
      if ('write' in terminal) terminal.write(command)
      else terminal.stdin?.write(command)
    }
    return workspaceRoot
  })
  ipcMain.handle('workspace:list', async (_, target: string) => {
    const dir = target === workspaceRoot ? workspaceRoot : await existingWorkspacePath(target, true)
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => !['.git', 'node_modules', 'dist', 'out', 'release', '.next', '.cache', '.venv'].includes(e.name)).map((e) => ({ name: e.name, path: path.join(dir!, e.name), isDirectory: e.isDirectory() })).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  })
  ipcMain.handle('workspace:search-text', async (_, rawQuery: string) => {
    assertText(rawQuery, 'search query', 200)
    if (!workspaceRoot) throw new Error('Open a workspace folder first.')
    const query = rawQuery.trim().toLocaleLowerCase()
    if (!query) return []
    const results: { path: string; name: string; lineNumber: number; line: string }[] = []
    const ignored = new Set(['.git', 'node_modules', 'dist', 'out', 'release', '.next', '.cache', '.venv'])
    const stack = [workspaceRoot]
    let filesScanned = 0
    let bytesScanned = 0
    while (stack.length && results.length < 100 && filesScanned < 2500 && bytesScanned < 40 * 1024 * 1024) {
      const directory = stack.pop()!
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch { continue }
      for (const entry of entries) {
        if (results.length >= 100 || filesScanned >= 2500 || bytesScanned >= 40 * 1024 * 1024) break
        if (entry.isDirectory()) { if (!ignored.has(entry.name)) stack.push(path.join(directory, entry.name)); continue }
        if (!entry.isFile()) continue
        const candidate = path.join(directory, entry.name)
        let real: string
        let info
        try { real = await existingWorkspacePath(candidate); info = await stat(real) } catch { continue }
        if (info.size > 1024 * 1024) continue
        filesScanned++; bytesScanned += info.size
        let content: string
        try {
          const data = await readFile(real)
          if (data.includes(0)) continue
          content = data.toString('utf8')
        } catch { continue }
        const lines = content.split(/\r?\n/)
        for (let index = 0; index < lines.length && results.length < 100; index++) {
          if (lines[index].toLocaleLowerCase().includes(query)) results.push({ path: real, name: entry.name, lineNumber: index + 1, line: lines[index].trim().slice(0, 240) })
        }
      }
    }
    return results
  })
  ipcMain.handle('workspace:read', async (_, target: string) => {
    const file = await existingWorkspacePath(target)
    const info = await stat(file)
    if (!info.isFile()) throw new Error('Choose a file to open.')
    if (info.size > 5 * 1024 * 1024) throw new Error('Files larger than 5 MiB cannot be opened in the editor.')
    const data = await readFile(file)
    if (data.includes(0)) throw new Error('This looks like a binary file and cannot be shown in the text editor.')
    return data.toString('utf8')
  })
  ipcMain.handle('workspace:save', async (_, target: string, content: string) => {
    assertText(content, 'file content', 30_000_000)
    const file = await existingWorkspacePath(target)
    await writeFile(file, content, 'utf8')
  })
  ipcMain.handle('workspace:create', async (_, parent: string, name: string, directory: boolean) => {
    assertName(name)
    const base = await existingWorkspacePath(parent, true)
    const dest = resolveWorkspacePath(path.join(base, name))
    if (existsSync(dest)) throw new Error('An item with that name already exists.')
    if (directory) await mkdir(dest)
    else await writeFile(dest, '', { flag: 'wx', encoding: 'utf8' })
    return dest
  })
  ipcMain.handle('workspace:rename', async (_, target: string, name: string) => {
    assertName(name)
    const source = await existingWorkspacePath(target)
    const dest = resolveWorkspacePath(path.join(path.dirname(source), name))
    if (existsSync(dest)) throw new Error('An item with that name already exists.')
    await rename(source, dest)
    return dest
  })
  ipcMain.handle('workspace:delete', async (_, target: string) => rm(await existingWorkspacePath(target), { recursive: true, force: false }))
  ipcMain.handle('run:start', async (_, target: string, language: RunLanguage, config: Record<string, string>) => {
    if (!['c', 'cpp', 'python', 'java', 'javascript'].includes(language)) throw new Error('Unsupported language.')
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid runtime configuration.')
    for (const [key, value] of Object.entries(config)) { if (!['c', 'cpp', 'python', 'java', 'javaRuntime', 'javascript'].includes(key)) throw new Error('Unsupported runtime setting.'); assertText(value, 'runtime path', 1000) }
    return startRun(target, language, config)
  })
  ipcMain.handle('run:stop', async (_, id: string) => { assertText(id, 'run id', 64); const process = runs.get(id); if (process) killProcessTree(process) })
  ipcMain.handle('run:write', async (_, id: string, data: string) => { assertText(id, 'run id', 64); assertText(data, 'program input', 32768); const child = runs.get(id); if (!child?.stdin?.writable) throw new Error('The running program does not accept input.'); child.stdin.write(data) })

  ipcMain.handle('terminal:start', async () => {
    const id = randomUUID()
    const cwd = workspaceRoot || app.getPath('home')
    const shellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    try {
      try {
        const { spawn: spawnPty } = await import('node-pty')
        const terminal = spawnPty(shellPath, ['-NoLogo', '-NoProfile'], { name: 'xterm-256color', cols: 100, rows: 28, cwd, env: process.env as { [key: string]: string } })
        terminals.set(id, terminal)
        terminal.onData((data) => send('terminal:data', { id, data }))
        terminal.onExit(({ exitCode }) => { terminals.delete(id); send('terminal:data', { id, data: `\r\n[PowerShell exited: ${exitCode}]\r\n`, exit: exitCode }) })
      } catch (ptyError) {
        const child = spawn(shellPath, ['-NoLogo', '-NoProfile'], { cwd, shell: false, windowsHide: true, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] })
        terminals.set(id, child)
        child.stdout?.on('data', (data: Buffer) => send('terminal:data', { id, data: data.toString() }))
        child.stderr?.on('data', (data: Buffer) => send('terminal:data', { id, data: data.toString() }))
        child.on('error', (error) => send('terminal:data', { id, data: `\r\nPowerShell could not start: ${error.message}\r\n`, exit: 1 }))
        child.on('close', (code) => { terminals.delete(id); send('terminal:data', { id, data: `\r\n[PowerShell exited: ${code ?? 1}]\r\n`, exit: code ?? 1 }) })
        send('terminal:data', { id, data: `\r\n[PTY mode unavailable; PowerShell is using standard streams. Configure Visual Studio C++ Build Tools for a resizable PTY.]\r\n` })
      }
      return id
    } catch (error) { throw new Error(`Could not start PowerShell: ${error instanceof Error ? error.message : String(error)}`) }
  })
  ipcMain.handle('terminal:write', (_, id: string, data: string) => { assertText(id, 'terminal id', 64); assertText(data, 'terminal input', 32768); const terminal = terminals.get(id); if (!terminal) throw new Error('Terminal session is closed.'); if ('write' in terminal) terminal.write(data); else terminal.stdin?.write(data) })
  ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) => { if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 300) throw new Error('Invalid terminal size.'); const terminal = terminals.get(id); if (terminal && 'resize' in terminal) terminal.resize(cols, rows) })
  ipcMain.handle('terminal:stop', (_, id: string) => { assertText(id, 'terminal id', 64); terminals.get(id)?.kill(); terminals.delete(id) })

  ipcMain.handle('git:status', async (_, root: string) => {
    const out = await gitExec(root, ['status', '--porcelain=v1', '--branch'])
    const lines = out.split(/\r?\n/).filter(Boolean)
    const header = lines.shift() || '## (unknown)'
    const branch = header.slice(3).split('...')[0] || '(detached)'
    const files = lines.map((line) => {
      const index = line[0] || ' ', working = line[1] || ' ', status = line.slice(3).replace(/^"|"$/g, '')
      return { index, working, path: status.includes(' -> ') ? status.split(' -> ').pop()! : status, status }
    })
    return { branch, files }
  })
  ipcMain.handle('git:diff', async (_, root: string, file?: string) => gitExec(root, ['diff', '--', ...(file ? [file] : [])]))
  ipcMain.handle('git:action', async (_, root: string, action: string, args: string[] = []) => {
    const safe = (value: unknown, label: string) => { assertText(value, label, 2000); return value }
    let command: string[]
    switch (action) {
      case 'stage': command = ['add', '--', safe(args[0], 'file path')]; break
      case 'stage-all': command = ['add', '-A']; break
      case 'unstage': command = ['restore', '--staged', '--', safe(args[0], 'file path')]; break
      case 'commit': { const message = safe(args[0], 'commit message'); if (!message.trim()) throw new Error('Enter a commit message.'); command = ['commit', '-m', message]; break }
      case 'branch': { const name = safe(args[0], 'branch name'); if (!/^[\w./-]+$/.test(name)) throw new Error('Invalid branch name.'); command = ['switch', '-c', name]; break }
      case 'checkout': { const name = safe(args[0], 'branch name'); if (!/^[\w./-]+$/.test(name)) throw new Error('Invalid branch name.'); command = ['switch', name]; break }
      case 'pull': command = ['pull', '--ff-only']; break
      case 'push': command = ['push']; break
      case 'branches': command = ['branch', '--format=%(HEAD) %(refname:short)']; break
      default: throw new Error('Unsupported Git action.')
    }
    return gitExec(root, command)
  })

  ipcMain.handle('ai:config', async () => {
    let secrets: { endpoint?: string; model?: string; encryptedKey?: string } = {}
    try { secrets = JSON.parse(await readFile(aiSecretsPath(), 'utf8')) } catch { /* no saved credentials yet */ }
    return { endpoint: secrets.endpoint || 'https://api.openai.com/v1/chat/completions', model: secrets.model || 'gpt-4o-mini', hasKey: Boolean(secrets.encryptedKey) }
  })
  ipcMain.handle('ai:save-config', async (_, value: { endpoint: string; model: string; apiKey?: string }) => {
    assertText(value.endpoint, 'AI endpoint', 1000); assertText(value.model, 'AI model', 200)
    const url = new URL(value.endpoint)
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Use HTTPS for hosted AI providers. Local HTTP endpoints are allowed.')
    let current: { encryptedKey?: string } = {}
    try { current = JSON.parse(await readFile(aiSecretsPath(), 'utf8')) } catch { /* first save */ }
    if (value.apiKey?.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this Windows account.')
      current.encryptedKey = safeStorage.encryptString(value.apiKey.trim()).toString('base64')
    }
    await writeFile(aiSecretsPath(), JSON.stringify({ endpoint: value.endpoint, model: value.model, encryptedKey: current.encryptedKey }), 'utf8')
  })
  ipcMain.handle('ai:chat', async (_, messages: { role: 'user' | 'assistant'; content: string }[], selectedCode?: string) => {
    if (!Array.isArray(messages) || !messages.length || messages.length > 40) throw new Error('Invalid chat history.')
    for (const message of messages) { if (!['user', 'assistant'].includes(message.role)) throw new Error('Invalid chat role.'); assertText(message.content, 'message', 20000) }
    let settings: { endpoint?: string; model?: string; encryptedKey?: string }
    try { settings = JSON.parse(await readFile(aiSecretsPath(), 'utf8')) } catch { throw new Error('Configure an AI provider in Settings before chatting.') }
    if (!settings.encryptedKey || !safeStorage.isEncryptionAvailable()) throw new Error('Configure an AI API key in Settings before chatting.')
    const key = safeStorage.decryptString(Buffer.from(settings.encryptedKey, 'base64'))
    const last = messages[messages.length - 1]
    const content = selectedCode && last.role === 'user' ? `${last.content}\n\nSelected code:\n\`\`\`\n${selectedCode.slice(0, 12000)}\n\`\`\`` : last.content
    const body = { model: settings.model, stream: true, messages: [{ role: 'system', content: 'You are Aryan IDE, a concise coding assistant. Explain tradeoffs. Never tell the desktop app to execute code automatically.' }, ...messages.slice(0, -1), { role: 'user', content }] }
    try {
      const response = await fetch(settings.endpoint!, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
      if (!response.ok || !response.body) throw new Error(`AI provider returned ${response.status}: ${(await response.text()).slice(0, 1000)}`)
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() || ''
        for (const line of lines) if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try { const event = JSON.parse(line.slice(6)); const text = event.choices?.[0]?.delta?.content; if (text) send('ai:chunk', { text }) } catch { /* skip malformed provider event */ }
        }
      }
      send('ai:chunk', { done: true })
    } catch (error) { send('ai:chunk', { done: true, error: error instanceof Error ? error.message : String(error) }) }
  })
  ipcMain.handle('settings:theme', async () => (await readState()).theme || 'dark')
  ipcMain.handle('settings:set-theme', async (_, theme: string) => { if (theme !== 'dark' && theme !== 'light') throw new Error('Invalid theme.'); await writeState({ theme }) })
  ipcMain.handle('settings:runtimes', async () => (await readState()).runtimes || {})
  ipcMain.handle('settings:set-runtimes', async (_, runtimes: Record<string, string>) => {
    if (!runtimes || typeof runtimes !== 'object') throw new Error('Invalid runtime configuration.')
    for (const [key, value] of Object.entries(runtimes)) { if (!['c', 'cpp', 'python', 'java', 'javaRuntime', 'javascript'].includes(key)) throw new Error('Unsupported runtime setting.'); assertText(value, 'runtime path', 1000) }
    await writeState({ runtimes })
  })
  ipcMain.handle('extensions:list', async () => {
    const roots = extensionRoots()
    const state = await readState(); const results = [] as { name: string; version: string; description: string; enabled: boolean; settings: { id: string; label: string; value: string }[]; commands: { id: string; title: string; snippet: string }[]; editorActions: { id: string; title: string; snippet: string }[]; themes: { id: string; name: string; base: 'dark' | 'light'; accent: string }[] }[]
    const seen = new Set<string>()
    for (const root of roots) {
      try { for (const dir of await readdir(root, { withFileTypes: true })) if (dir.isDirectory()) {
        try {
          const manifestFile = path.join(root, dir.name, 'manifest.json')
          if ((await stat(manifestFile)).size > 256 * 1024) continue
          const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
          if (typeof manifest.name === 'string' && manifest.name.length > 0 && manifest.name.length <= 100 && typeof manifest.version === 'string' && manifest.version.length <= 40 && typeof manifest.description === 'string' && manifest.description.length <= 500 && !seen.has(manifest.name)) {
            seen.add(manifest.name)
            const settings = Array.isArray(manifest.settings) ? manifest.settings.filter((item: any) => item && typeof item.id === 'string' && typeof item.label === 'string' && item.type === 'string').slice(0, 20).map((item: any) => ({ id: item.id.slice(0, 80), label: item.label.slice(0, 120), value: String(state.extensionSettings?.[manifest.name]?.[item.id] ?? (typeof item.default === 'string' ? item.default : '')).slice(0, 1000) })) : []
            const safeSnippets = (value: unknown) => Array.isArray(value) ? value.filter((item: any) => item && typeof item.id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(item.id) && typeof item.title === 'string' && item.title.length <= 100 && typeof item.snippet === 'string' && item.snippet.length <= 5000 && !item.snippet.includes('\0')).slice(0, 30).map((item: any) => ({ id: item.id, title: item.title, snippet: item.snippet })) : []
            const themes = Array.isArray(manifest.contributions?.themes) ? manifest.contributions.themes.filter((item: any) => item && typeof item.id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(item.id) && typeof item.name === 'string' && item.name.length <= 100 && ['dark', 'light'].includes(item.base) && typeof item.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.accent)).slice(0, 20).map((item: any) => ({ id: item.id, name: item.name, base: item.base as 'dark' | 'light', accent: item.accent })) : []
            results.push({ name: manifest.name, version: manifest.version, description: manifest.description, enabled: state.extensionEnabled?.[manifest.name] !== false, settings, commands: safeSnippets(manifest.contributions?.commands), editorActions: safeSnippets(manifest.contributions?.editorActions), themes })
          }
        } catch { /* malformed extension manifests are ignored */ }
      } } catch { /* extension directory may not exist */ }
    }
    return results
  })
  ipcMain.handle('extensions:set-enabled', async (_, name: string, enabled: boolean) => {
    assertText(name, 'extension name', 200)
    if (typeof enabled !== 'boolean') throw new Error('Invalid extension state.')
    const state = await readState(); const extensionEnabled = { ...(state.extensionEnabled || {}), [name]: enabled }
    const extensionTheme = !enabled && state.extensionTheme?.name === name ? null : state.extensionTheme
    await writeState({ extensionEnabled, extensionTheme })
  })
  ipcMain.handle('extensions:set-setting', async (_, name: string, id: string, value: string) => {
    assertText(name, 'extension name', 200); assertText(id, 'extension setting id', 80); assertText(value, 'extension setting', 1000)
    const state = await readState(); const extensionSettings = { ...(state.extensionSettings || {}), [name]: { ...(state.extensionSettings?.[name] || {}), [id]: value } }
    await writeState({ extensionSettings })
  })
  ipcMain.handle('extensions:active-theme', async () => (await readState()).extensionTheme || null)
  ipcMain.handle('extensions:set-active-theme', async (_, theme: { name: string; id: string } | null) => {
    if (theme === null) { await writeState({ extensionTheme: null }); return }
    if (!theme || typeof theme !== 'object') throw new Error('Invalid extension theme.')
    assertText(theme.name, 'extension name', 200); assertText(theme.id, 'theme id', 80)
    const manifest = await readExtensionManifest(theme.name, theme.id)
    if (!manifest) throw new Error('That theme is missing or invalid.')
    const state = await readState()
    if (state.extensionEnabled?.[theme.name] === false) throw new Error('Enable the extension before applying its theme.')
    await writeState({ extensionTheme: { name: theme.name, id: theme.id } })
  })
  ipcMain.handle('window:control', async (_, action: string) => {
    if (!['minimize', 'maximize', 'close'].includes(action)) throw new Error('Unsupported window action.')
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (action === 'minimize') mainWindow.minimize()
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    if (action === 'close') mainWindow.close()
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1536, height: 1000, minWidth: 900, minHeight: 620, backgroundColor: '#111116', title: 'Aryan IDE', autoHideMenuBar: true, frame: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const devInline = process.env.ELECTRON_RENDERER_URL ? " 'unsafe-inline'" : ''
    const policy = `default-src 'self'; script-src 'self' blob:${devInline}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https: http://localhost:* ws://localhost:*`
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => { registerHandlers(); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() }) })
app.on('before-quit', () => { for (const terminal of terminals.values()) terminal.kill(); for (const child of runs.values()) killProcessTree(child) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
