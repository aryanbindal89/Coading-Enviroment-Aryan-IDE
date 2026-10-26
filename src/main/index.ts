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

const execFileAsync = promisify(execFile)
let mainWindow: BrowserWindow | null = null
let workspaceRoot: string | null = null
const runs = new Map<string, ReturnType<typeof spawn>>()
const terminals = new Map<string, IPty | ReturnType<typeof spawn>>()
const appStatePath = () => path.join(app.getPath('userData'), 'settings.json')
const aiSecretsPath = () => path.join(app.getPath('userData'), 'ai-credentials.json')

type AppState = { theme?: 'dark' | 'light'; runtimes?: Record<string, string>; extensionEnabled?: Record<string, boolean>; extensionSettings?: Record<string, Record<string, string>> }
async function readState(): Promise<AppState> {
  try { return JSON.parse(await readFile(appStatePath(), 'utf8')) as AppState } catch { return {} }
}
async function writeState(next: AppState) {
  await mkdir(app.getPath('userData'), { recursive: true })
  const current = await readState()
  await writeFile(appStatePath(), JSON.stringify({ ...current, ...next }, null, 2), 'utf8')
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
    child.on('error', (error) => { emitRun(id, `${label}: ${error.message}\r\n`, 'system'); finish(127) })
    child.on('close', (code) => finish(code ?? 1))
    const timer = setTimeout(() => { emitRun(id, 'Process stopped after the 15 minute safety limit.\r\n', 'system'); killProcessTree(child) }, 15 * 60 * 1000)
  })
}

async function startRun(file: string, language: RunLanguage, runtimeConfig: Record<string, string> = {}) {
  const source = await existingWorkspacePath(file)
  const info = await stat(source)
  if (!info.isFile()) throw new Error('Choose a source file to run.')
  const extensionMap: Record<RunLanguage, string[]> = { c: ['.c'], cpp: ['.cpp', '.cc', '.cxx'], python: ['.py'], java: ['.java'], javascript: ['.js', '.mjs', '.cjs'] }
  if (!extensionMap[language].includes(path.extname(source).toLowerCase())) throw new Error(`The selected file does not match ${language}.`)
  const id = randomUUID()
  emitRun(id, `Starting ${path.basename(source)}…\r\n`, 'system')
  const configured = runtimeConfig[language]
  const defaults: Record<RunLanguage, string> = { c: 'gcc', cpp: 'g++', python: 'python', java: 'javac', javascript: 'node' }
  const executable = configured?.trim() || defaults[language]
  const cwd = workspaceRoot!
  void (async () => {
    try {
      let code = 0
      if (language === 'python') code = await runCommand(executable, [source], cwd, id, 'Python')
      if (language === 'javascript') code = await runCommand(executable, [source], cwd, id, 'Node.js')
      if (language === 'c' || language === 'cpp') {
        const dir = path.join(app.getPath('temp'), 'aryan-ide-build', id)
        await mkdir(dir, { recursive: true })
        const binary = path.join(dir, process.platform === 'win32' ? 'program.exe' : 'program')
        code = await runCommand(executable, ['-g', source, '-o', binary], cwd, id, language === 'c' ? 'GCC' : 'G++')
        if (code === 0) code = await runCommand(binary, [], cwd, id, 'Program')
      }
      if (language === 'java') {
        const dir = path.join(app.getPath('temp'), 'aryan-ide-build', id)
        await mkdir(dir, { recursive: true })
        code = await runCommand(executable, ['-d', dir, source], cwd, id, 'Java compiler')
        if (code === 0) {
          const java = runtimeConfig.javaRuntime?.trim() || 'java'
          code = await runCommand(java, ['-cp', dir, path.basename(source, '.java')], cwd, id, 'Java runtime')
        }
      }
      emitRun(id, code === 0 ? '\r\nProcess finished with exit code 0.\r\n' : `\r\nProcess finished with exit code ${code}.\r\n`, 'exit')
    } catch (error) { emitRun(id, `${error instanceof Error ? error.message : String(error)}\r\n`, 'system'); emitRun(id, 'Process could not start.\r\n', 'exit') }
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
    return entries.filter((e) => !['.git', 'node_modules', 'dist', 'out'].includes(e.name)).map((e) => ({ name: e.name, path: path.join(dir!, e.name), isDirectory: e.isDirectory() })).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
  })
  ipcMain.handle('workspace:read', async (_, target: string) => readFile(await existingWorkspacePath(target), 'utf8'))
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
    const roots = [path.join(app.getAppPath(), 'extensions'), path.join(app.getPath('userData'), 'extensions')]
    const state = await readState(); const results = [] as { name: string; version: string; description: string; enabled: boolean; settings: { id: string; label: string; value: string }[] }[]
    for (const root of roots) {
      try { for (const dir of await readdir(root, { withFileTypes: true })) if (dir.isDirectory()) {
        try {
          const manifest = JSON.parse(await readFile(path.join(root, dir.name, 'manifest.json'), 'utf8'))
          if (typeof manifest.name === 'string' && typeof manifest.version === 'string' && typeof manifest.description === 'string') {
            const settings = Array.isArray(manifest.settings) ? manifest.settings.filter((item: any) => item && typeof item.id === 'string' && typeof item.label === 'string' && item.type === 'string').slice(0, 20).map((item: any) => ({ id: item.id.slice(0, 80), label: item.label.slice(0, 120), value: String(state.extensionSettings?.[manifest.name]?.[item.id] ?? item.default ?? '').slice(0, 1000) })) : []
            results.push({ name: manifest.name, version: manifest.version, description: manifest.description, enabled: state.extensionEnabled?.[manifest.name] !== false, settings })
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
    await writeState({ extensionEnabled })
  })
  ipcMain.handle('extensions:set-setting', async (_, name: string, id: string, value: string) => {
    assertText(name, 'extension name', 200); assertText(id, 'extension setting id', 80); assertText(value, 'extension setting', 1000)
    const state = await readState(); const extensionSettings = { ...(state.extensionSettings || {}), [name]: { ...(state.extensionSettings?.[name] || {}), [id]: value } }
    await writeState({ extensionSettings })
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
