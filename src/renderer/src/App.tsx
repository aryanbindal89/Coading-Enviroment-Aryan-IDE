import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  Activity, Bot, Braces, Bug, Check, ChevronDown, ChevronRight, Circle, CircleAlert, Code2,
  Command, Copy, File, FileCode2, FilePlus2, Files, Folder, FolderOpen, FolderPlus, GitBranch, GitCommit,
  GitPullRequest, Github, Info, LoaderCircle, Menu, MessageSquare, Moon, MoreHorizontal, Play, Plus,
  RefreshCw, Search, Send, Settings, Shield, Square, Sun, TerminalSquare, Trash2, X, XCircle
} from 'lucide-react'
import type { AIConfig, ExtensionInfo, FileEntry, GitStatus, RunLanguage, SearchMatch } from '@shared/types'
import type { editor } from 'monaco-editor'

type OpenFile = { path: string; name: string; content: string; saved: string }
type RunOutputPart = { text: string; kind: 'stdout' | 'stderr' | 'system' | 'exit' }
type ChatMessage = { role: 'user' | 'assistant'; content: string }
type View = 'explorer' | 'search' | 'source' | 'run' | 'extensions' | 'settings'
type SearchMode = 'files' | 'text' | 'commands'
type EditorLanguage = RunLanguage | 'typescript' | 'json' | 'plaintext' | 'markdown' | 'html' | 'css' | 'yaml' | 'xml' | 'shell' | 'powershell'
const languageByExtension: Record<string, EditorLanguage> = {
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', py: 'python', java: 'java',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json',
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', css: 'css', yaml: 'yaml', yml: 'yaml',
  xml: 'xml', sh: 'shell', ps1: 'powershell', txt: 'plaintext'
}
const languageTitle: Record<string, string> = { c: 'C', cpp: 'C++', python: 'Python', java: 'Java', javascript: 'JavaScript', typescript: 'TypeScript', json: 'JSON', plaintext: 'Plain Text', markdown: 'Markdown', html: 'HTML', css: 'CSS', yaml: 'YAML', xml: 'XML', shell: 'Shell', powershell: 'PowerShell' }
const editorLanguages: EditorLanguage[] = ['c', 'cpp', 'python', 'java', 'javascript', 'typescript', 'json', 'markdown', 'html', 'css', 'yaml', 'xml', 'shell', 'powershell', 'plaintext']
function fileLanguage(file?: OpenFile) { const ext = file?.name.split('.').pop()?.toLowerCase(); return ext ? languageByExtension[ext] || 'plaintext' : 'plaintext' }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

export default function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState('')
  const [languageOverrides, setLanguageOverrides] = useState<Record<string, EditorLanguage>>({})
  const [view, setView] = useState<View>('explorer')
  const [aiOpen, setAiOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)
  const [bottomTab, setBottomTab] = useState<'terminal' | 'output' | 'problems' | 'debug'>('terminal')
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState<{ title: string; parent?: string; target?: string; directory?: boolean; mode?: 'create' | 'rename' } | null>(null)
  const [modalValue, setModalValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: FileEntry } | null>(null)
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('files')
  const [searchResults, setSearchResults] = useState<FileEntry[]>([])
  const [textMatches, setTextMatches] = useState<SearchMatch[]>([])
  const [terminalSession, setTerminalSession] = useState('')
  const [terminalReady, setTerminalReady] = useState(false)
  const [runId, setRunId] = useState('')
  const [runOutput, setRunOutput] = useState('')
  const [runOutputParts, setRunOutputParts] = useState<RunOutputPart[]>([])
  const [programInput, setProgramInput] = useState('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [selectedCode, setSelectedCode] = useState('')
  const [pendingAIEdit, setPendingAIEdit] = useState<string | null>(null)
  const [aiConfig, setAiConfig] = useState<AIConfig>({ endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', hasKey: false })
  const [apiKey, setApiKey] = useState('')
  const [runtimeConfig, setRuntimeConfig] = useState<Record<string, string>>({})
  const [editorFontSize, setEditorFontSize] = useState(() => { const value = Number(localStorage.getItem('aryan.editorFontSize')); return Number.isInteger(value) && value >= 10 && value <= 24 ? value : 13 })
  const [wordWrap, setWordWrap] = useState(() => localStorage.getItem('aryan.wordWrap') === 'on')
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [gitDiff, setGitDiff] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [activeExtensionTheme, setActiveExtensionTheme] = useState<{ name: string; id: string } | null>(null)
  const [problemMarkers, setProblemMarkers] = useState<editor.IMarker[]>([])
  const [splash, setSplash] = useState(true)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const markerListenerRef = useRef<{ dispose: () => void } | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const terminalSessionRef = useRef('')
  const fitRef = useRef<FitAddon | null>(null)
  const terminalHost = useRef<HTMLDivElement | null>(null)
  const rootName = root ? root.split(/[\\/]/).filter(Boolean).pop() || root : 'No Folder Opened'
  const activeFile = openFiles.find((file) => file.path === activePath)
  const dirtyCount = openFiles.filter((file) => file.content !== file.saved).length

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000) }, [])
  const refreshDirectory = useCallback(async (dir: string) => {
    try { const entries = await window.aryan.listDirectory(dir); setTree((prev) => ({ ...prev, [dir]: entries })) }
    catch (error) { notify(errorMessage(error)) }
  }, [notify])
  const openWorkspace = useCallback(async () => {
    try {
      if (dirtyCount && !window.confirm(`Discard unsaved changes in ${dirtyCount} open file${dirtyCount === 1 ? '' : 's'} and switch workspace?`)) return
      const selected = await window.aryan.openWorkspace()
      if (!selected) return
      setRoot(selected); setTree({}); setExpanded(new Set([selected])); setOpenFiles([]); setActivePath(''); setGitStatus(null)
      await refreshDirectory(selected)
      notify(`Opened ${selected.split(/[\\/]/).pop()}`)
    } catch (error) { notify(errorMessage(error)) }
  }, [dirtyCount, notify, refreshDirectory])
  const toggleDirectory = useCallback(async (entry: FileEntry) => {
    if (expanded.has(entry.path)) { setExpanded((prev) => { const next = new Set(prev); next.delete(entry.path); return next }); return }
    if (!tree[entry.path]) await refreshDirectory(entry.path)
    setExpanded((prev) => new Set(prev).add(entry.path))
  }, [expanded, refreshDirectory, tree])
  const openFile = useCallback(async (path: string, name?: string) => {
    const existing = openFiles.find((file) => file.path === path)
    if (existing) { setActivePath(path); return }
    try {
      const content = await window.aryan.readFile(path)
      const next = { path, name: name || path.split(/[\\/]/).pop() || 'Untitled', content, saved: content }
      setOpenFiles((prev) => [...prev, next]); setActivePath(path); setView('explorer')
    } catch (error) { notify(errorMessage(error)) }
  }, [notify, openFiles])
  const saveFile = useCallback(async (): Promise<boolean> => {
    if (!activeFile || activeFile.content === activeFile.saved) return true
    try {
      await window.aryan.saveFile(activeFile.path, activeFile.content)
      setOpenFiles((prev) => prev.map((file) => file.path === activeFile.path ? { ...file, saved: file.content } : file))
      notify('File saved')
      return true
    } catch (error) { notify(errorMessage(error)); return false }
  }, [activeFile, notify])
  const openSearchMatch = async (match: SearchMatch) => {
    const alreadyActive = activePath === match.path
    await openFile(match.path, match.name)
    setView('explorer'); setQuery('')
    const reveal = () => {
      const instance = editorRef.current
      if (!instance) return
      instance.revealLineInCenter(match.lineNumber)
      instance.setPosition({ lineNumber: match.lineNumber, column: 1 })
      instance.focus()
    }
    if (alreadyActive) requestAnimationFrame(reveal)
    else window.setTimeout(reveal, 80)
  }
  const closeFile = useCallback((file: OpenFile) => {
    if (file.content !== file.saved && !window.confirm(`Discard unsaved changes to ${file.name}?`)) return
    setOpenFiles((prev) => { const next = prev.filter((entry) => entry.path !== file.path); if (activePath === file.path) setActivePath(next[next.length - 1]?.path || ''); return next })
  }, [activePath])
  const performCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!modal || !modalValue.trim()) return
    try {
      if (modal.mode === 'rename' && modal.target) {
        const nextPath = await window.aryan.renameEntry(modal.target, modalValue.trim())
        const oldPath = modal.target
        const insideOldPath = (target: string) => target === oldPath || target.startsWith(oldPath + '/') || target.startsWith(oldPath + '\\')
        const rebasePath = (target: string) => nextPath + target.slice(oldPath.length)
        setTree((previous) => {
          const next = { ...previous }
          for (const key of Object.keys(previous)) if (insideOldPath(key)) {
            const rebased = rebasePath(key)
            next[rebased] = previous[key].map((entry) => ({ ...entry, path: rebasePath(entry.path) }))
            delete next[key]
          }
          return next
        })
        setExpanded((previous) => new Set([...previous].map((entry) => insideOldPath(entry) ? rebasePath(entry) : entry)))
        setOpenFiles((prev) => prev.map((file) => {
          const nested = file.path.startsWith(oldPath + '/') || file.path.startsWith(oldPath + '\\')
          if (file.path !== oldPath && !nested) return file
          const suffix = file.path.slice(oldPath.length)
          const path = nextPath + suffix
          return { ...file, path, name: file.path === oldPath ? modalValue.trim() : file.name }
        }))
        if (activePath === oldPath || activePath.startsWith(oldPath + '/') || activePath.startsWith(oldPath + '\\')) setActivePath(nextPath + activePath.slice(oldPath.length))
        await refreshDirectory(pathParent(oldPath))
      } else if (modal.parent) await window.aryan.createEntry(modal.parent, modalValue.trim(), Boolean(modal.directory))
      if (modal.parent) await refreshDirectory(modal.parent)
      setModal(null); setModalValue(''); notify(modal.mode === 'rename' ? 'Renamed successfully' : 'Created successfully')
    } catch (error) { notify(errorMessage(error)) }
  }
  const deleteItem = async (item: FileEntry) => {
    const unsaved = openFiles.filter((file) => (file.path === item.path || file.path.startsWith(item.path + '/') || file.path.startsWith(item.path + '\\')) && file.content !== file.saved).length
    const unsavedNote = unsaved ? ` This will also discard unsaved changes in ${unsaved} open file${unsaved === 1 ? '' : 's'}.` : ''
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.${unsavedNote}`)) return
    try {
      await window.aryan.deleteEntry(item.path)
      if (root) await refreshDirectory(pathParent(item.path))
      const removed = openFiles.filter((file) => file.path === item.path || file.path.startsWith(item.path + '/') || file.path.startsWith(item.path + '\\'))
      setOpenFiles((prev) => prev.filter((file) => !removed.includes(file)))
      if (removed.some((file) => file.path === activePath)) setActivePath('')
      setContextMenu(null); notify('Item deleted')
    } catch (error) { notify(errorMessage(error)) }
  }
  const runActive = async () => {
    if (!activeFile) { notify('Open a source file first'); return }
    const language = fileLanguage(activeFile)
    if (!['c', 'cpp', 'python', 'java', 'javascript'].includes(language)) { notify(`${languageTitle[language]} files are not executable by the Run button`); return }
    if (!(await saveFile())) return
    setRunOutput(''); setRunOutputParts([]); setGitDiff(''); setBottomTab('output'); setBottomOpen(true)
    try { if (runId) await window.aryan.stopRun(runId); const id = await window.aryan.runFile(activeFile.path, language as RunLanguage, runtimeConfig); setRunId(id) }
    catch (error) { notify(errorMessage(error)) }
  }
  const refreshGit = useCallback(async () => {
    if (!root) return
    try { const status = await window.aryan.gitStatus(root); setGitStatus(status) }
    catch { setGitStatus(null) }
  }, [root])
  const restartTerminal = async () => {
    if (terminalSessionRef.current) await window.aryan.terminalStop(terminalSessionRef.current)
    terminalRef.current?.writeln('\r\n[Starting a new PowerShell session]\r\n')
    try {
      const id = await window.aryan.terminalStart()
      terminalSessionRef.current = id; setTerminalSession(id); setTerminalReady(true)
      fitRef.current?.fit(); await window.aryan.terminalResize(id, terminalRef.current?.cols || 100, terminalRef.current?.rows || 28)
    } catch (error) { notify(errorMessage(error)) }
  }
  const gitAction = async (action: string, args: string[] = []) => {
    if (!root) return
    try { const result = await window.aryan.gitAction(root, action, args); notify(result.trim() || 'Git action completed'); await refreshGit() }
    catch (error) { notify(errorMessage(error)) }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [savedTheme, runtimes, config, ext, extensionTheme] = await Promise.all([window.aryan.getTheme(), window.aryan.getRuntimeConfig(), window.aryan.aiConfig(), window.aryan.listExtensions(), window.aryan.getActiveExtensionTheme()])
        setTheme(savedTheme); setRuntimeConfig(runtimes); setAiConfig(config); setExtensions(ext); setActiveExtensionTheme(extensionTheme)
      } catch { /* app remains usable if a preference cannot be loaded */ }
    })()
    const timer = window.setTimeout(() => setSplash(false), 650)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { localStorage.setItem('aryan.editorFontSize', String(editorFontSize)) }, [editorFontSize])
  useEffect(() => { localStorage.setItem('aryan.wordWrap', wordWrap ? 'on' : 'off') }, [wordWrap])
  useEffect(() => {
    const root = document.documentElement
    const activeExtension = activeExtensionTheme && extensions.find((item) => item.name === activeExtensionTheme.name && item.enabled)
    const palette = activeExtension?.themes.find((item) => item.id === activeExtensionTheme?.id)
    if (palette) {
      root.style.setProperty('--accent', palette.accent)
      root.style.setProperty('--accent-2', palette.accent)
      root.style.setProperty('--accent-soft', `${palette.accent}22`)
    } else {
      root.style.removeProperty('--accent'); root.style.removeProperty('--accent-2'); root.style.removeProperty('--accent-soft')
    }
  }, [activeExtensionTheme, extensions])
  useEffect(() => { if (root) void refreshGit() }, [root, refreshGit])
  useEffect(() => {
    if (!root || !query.trim() || searchMode !== 'files') { setSearchResults([]); return }
    let cancelled = false
    const search = async () => {
      const matches: FileEntry[] = []; const stack = [root]; let visited = 0
      while (stack.length && matches.length < 50 && visited < 3000) {
        const dir = stack.pop()!; let entries: FileEntry[]
        try { entries = await window.aryan.listDirectory(dir) } catch { continue }
        visited += entries.length
        for (const entry of entries) {
          if (entry.isDirectory) stack.push(entry.path)
          else if (entry.name.toLowerCase().includes(query.toLowerCase())) matches.push(entry)
        }
      }
      if (!cancelled) setSearchResults(matches.slice(0, 30))
    }
    const timer = window.setTimeout(() => void search(), 220)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, root, searchMode])
  useEffect(() => {
    if (!root || !query.trim() || searchMode !== 'text') { setTextMatches([]); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void window.aryan.searchText(query).then((matches) => { if (!cancelled) setTextMatches(matches) }).catch(() => { if (!cancelled) setTextMatches([]) })
    }, 260)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [query, root, searchMode])
  useEffect(() => {
    const removeRun = window.aryan.onRunOutput(({ id, text, kind }) => {
      setRunId((current) => kind === 'exit' && current === id ? '' : current)
      if (id === runId || !runId) {
        setRunOutput((prev) => (prev + text).slice(-150000))
        setRunOutputParts((prev) => [...prev, { text, kind }].slice(-2000))
      }
    })
    const removeAI = window.aryan.onAIChunk(({ text, done, error }) => {
      if (text) setChat((prev) => { const next = [...prev]; const last = next[next.length - 1]; if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + text }; else next.push({ role: 'assistant', content: text }); return next })
      if (error) setChat((prev) => [...prev, { role: 'assistant', content: `Provider error: ${error}` }])
      if (done) setChatBusy(false)
    })
    return () => { removeRun(); removeAI() }
  }, [runId])
  useEffect(() => {
    if (!terminalHost.current) return
    let disposed = false
    const terminal = new Terminal({ cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 12, convertEol: true, theme: theme === 'dark' ? { background: '#101014', foreground: '#d8d7e0', cursor: '#a78bfa', selectionBackground: '#5d4b80' } : { background: '#fbfaff', foreground: '#292638', cursor: '#7c3aed', selectionBackground: '#d9ccfa' } })
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(terminalHost.current); terminalRef.current = terminal; fitRef.current = fit
    let session = ''
    void window.aryan.terminalStart().then((id) => {
      if (disposed) { void window.aryan.terminalStop(id); return }
      session = id; terminalSessionRef.current = id; setTerminalSession(id); setTerminalReady(true); fit.fit(); void window.aryan.terminalResize(id, terminal.cols, terminal.rows)
    }).catch((e) => { terminal.writeln(`Unable to start PowerShell: ${errorMessage(e)}`) })
    const removeData = window.aryan.onTerminalData((event) => {
      if (event.id === terminalSessionRef.current) terminal.write(event.data)
      if (event.exit !== undefined && event.id === terminalSessionRef.current) { terminalSessionRef.current = ''; setTerminalSession(''); setTerminalReady(false) }
    })
    terminal.onData((data) => { const id = terminalSessionRef.current; if (id) void window.aryan.terminalWrite(id, data).catch((e) => notify(errorMessage(e))) })
    const observer = new ResizeObserver(() => { try { fit.fit(); const id = terminalSessionRef.current; if (id) void window.aryan.terminalResize(id, terminal.cols, terminal.rows) } catch { /* terminal is closing */ } })
    observer.observe(terminalHost.current)
    return () => { disposed = true; const id = terminalSessionRef.current || session; terminalSessionRef.current = ''; if (id) void window.aryan.terminalStop(id); observer.disconnect(); removeData(); terminal.dispose(); terminalRef.current = null; fitRef.current = null; setTerminalReady(false) }
  }, [])
  useEffect(() => { if (terminalRef.current) terminalRef.current.options.theme = theme === 'dark' ? { background: '#101014', foreground: '#d8d7e0', cursor: '#a78bfa', selectionBackground: '#5d4b80' } : { background: '#fbfaff', foreground: '#292638', cursor: '#7c3aed', selectionBackground: '#d9ccfa' } }, [theme])
  useEffect(() => { if (bottomOpen && bottomTab === 'terminal') requestAnimationFrame(() => { try { fitRef.current?.fit() } catch { /* terminal is initializing */ } }) }, [bottomOpen, bottomTab])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveFile() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void openWorkspace() }
      if (event.key === 'F5') { event.preventDefault(); void runActive() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p' && !event.shiftKey) { event.preventDefault(); setSearchMode('files'); setView('search'); window.setTimeout(() => document.querySelector<HTMLInputElement>('.quick-search input')?.focus(), 0) }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchMode('text'); setView('search'); window.setTimeout(() => document.querySelector<HTMLInputElement>('.quick-search input')?.focus(), 0) }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setSearchMode('commands'); setView('search'); window.setTimeout(() => document.querySelector<HTMLInputElement>('.quick-search input')?.focus(), 0) }
      if ((event.ctrlKey || event.metaKey) && event.key === '`') { event.preventDefault(); setBottomOpen((open) => !open); setBottomTab('terminal') }
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener)
  }, [openWorkspace, runActive, saveFile])
  useEffect(() => { const close = () => setContextMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close) }, [])

  const onEditorMount: OnMount = (editorInstance, monaco) => {
    editorRef.current = editorInstance; monacoRef.current = monaco
    monaco.editor.setTheme(theme === 'dark' ? 'aryan-dark' : 'aryan-light')
    markerListenerRef.current?.dispose()
    const updateMarkers = () => {
      const model = editorInstance.getModel()
      setProblemMarkers(model ? monaco.editor.getModelMarkers({ resource: model.uri }) : [])
    }
    markerListenerRef.current = monaco.editor.onDidChangeMarkers((resources) => {
      const uri = editorInstance.getModel()?.uri.toString()
      if (uri && resources.some((resource) => resource.toString() === uri)) updateMarkers()
    })
    updateMarkers()
    const selection = editorInstance.getSelection(); if (activeFile && selection) editorInstance.setSelection(selection)
  }
  useEffect(() => {
    if (!activeFile) { setProblemMarkers([]); return }
    const model = editorRef.current?.getModel()
    if (model && monacoRef.current) setProblemMarkers(monacoRef.current.editor.getModelMarkers({ resource: model.uri }))
  }, [activePath, activeFile])
  useEffect(() => () => markerListenerRef.current?.dispose(), [])
  const insertSnippet = (snippet: string) => {
    const instance = editorRef.current
    const model = instance?.getModel()
    if (!instance || !model || !activeFile) { notify('Open an editor file before using this editor action'); return }
    const selection = instance.getSelection()
    const position = instance.getPosition() || { lineNumber: model.getLineCount(), column: model.getLineMaxColumn(model.getLineCount()) }
    const range = selection || { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }
    instance.executeEdits('extension-action', [{ range, text: snippet, forceMoveMarkers: true }])
    instance.focus(); notify('Snippet inserted. Review the edit and save when ready.')
  }
  const insertExtensionSnippet = (extension: ExtensionInfo, snippet: string) => {
    const expandedSnippet = extension.settings.reduce((value, setting) => value.split(`{{${setting.id}}}`).join(setting.value), snippet)
    insertSnippet(expandedSnippet)
  }
  const activateExtensionTheme = async (extension: ExtensionInfo, themeOption: ExtensionInfo['themes'][number]) => {
    try {
      await window.aryan.setActiveExtensionTheme({ name: extension.name, id: themeOption.id })
      await window.aryan.setTheme(themeOption.base)
      setTheme(themeOption.base); setActiveExtensionTheme({ name: extension.name, id: themeOption.id })
      notify(`${themeOption.name} theme applied`)
    } catch (error) { notify(errorMessage(error)) }
  }
  const clearExtensionTheme = async () => {
    try { await window.aryan.setActiveExtensionTheme(null); setActiveExtensionTheme(null); notify('Default accent restored') }
    catch (error) { notify(errorMessage(error)) }
  }
  const sendChat = async (event: FormEvent) => {
    event.preventDefault()
    const input = (document.querySelector<HTMLTextAreaElement>('.chat-input textarea')?.value || '').trim()
    if (!input || chatBusy) return
    if (!aiConfig.hasKey) { setView('settings'); notify('Add your AI API key in Settings to start chatting'); return }
    const next = [...chat, { role: 'user' as const, content: input }]
    setChat(next); setChatBusy(true)
    const textarea = document.querySelector<HTMLTextAreaElement>('.chat-input textarea'); if (textarea) textarea.value = ''
    try { await window.aryan.aiChat(next, selectedCode || undefined); setSelectedCode('') }
    catch (error) { setChatBusy(false); setChat((prev) => [...prev, { role: 'assistant', content: errorMessage(error) }]) }
  }
  const copySuggestion = async (text: string) => { await navigator.clipboard.writeText(text); notify('Copied to clipboard') }
  const prepareSuggestion = (text: string) => {
    const code = text.match(/```(?:\w+)?\n([\s\S]*?)```/)?.[1]
    if (!code) { notify('This response has no fenced code snippet to insert'); return }
    if (!activeFile) { notify('Open an editor file before reviewing a code suggestion'); return }
    setPendingAIEdit(code)
  }
  const applySuggestion = (code: string) => {
    if (!editorRef.current || !activeFile) { notify('Open an editor file before inserting this suggestion'); return }
    const selection = editorRef.current.getSelection()
    editorRef.current.executeEdits('ai-suggestion', [{ range: selection || new (monacoRef.current!.Range)(1, 1, 1, 1), text: code, forceMoveMarkers: true }])
    setPendingAIEdit(null)
    notify('Suggestion inserted. Review it and save when ready.')
  }
  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await window.aryan.aiSaveConfig({ endpoint: aiConfig.endpoint, model: aiConfig.model, apiKey: apiKey || undefined })
      await window.aryan.setRuntimeConfig(runtimeConfig)
      const nextAI = await window.aryan.aiConfig(); setAiConfig(nextAI); setApiKey(''); setView('explorer'); notify('Settings saved securely')
    } catch (error) { notify(errorMessage(error)) }
  }
  const changeTheme = async () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); setActiveExtensionTheme(null); await Promise.all([window.aryan.setTheme(next), window.aryan.setActiveExtensionTheme(null)]) }
  const refreshAll = async () => { if (root) { await refreshDirectory(root); await refreshGit() } }
  const showDiff = async (file?: string) => { if (!root) return; try { setGitDiff(await window.aryan.gitDiff(root, file)); setRunOutput(''); setRunOutputParts([]); setBottomOpen(true); setBottomTab('output') } catch (error) { notify(errorMessage(error)) } }
  const builtinCommands = [
    { id: 'file.open-folder', title: 'Open Folder', action: () => void openWorkspace() },
    { id: 'file.new-file', title: 'New File', action: () => { if (!root) { notify('Open a workspace folder first'); return } setModal({ title: 'New file', parent: root, directory: false, mode: 'create' }) } },
    { id: 'file.save', title: 'Save Current File', action: () => void saveFile() },
    { id: 'run.start', title: 'Run Active File', action: () => void runActive() },
    { id: 'terminal.toggle', title: 'Toggle Terminal Panel', action: () => { setBottomOpen((open) => !open); setBottomTab('terminal') } },
    { id: 'theme.toggle', title: 'Toggle Dark/Light Theme', action: () => void changeTheme() },
    { id: 'settings.open', title: 'Open Settings', action: () => setView('settings') },
    { id: 'assistant.toggle', title: 'Toggle AI Assistant', action: () => setAiOpen((open) => !open) }
  ]
  const extensionCommands = extensions.filter((extension) => extension.enabled).flatMap((extension) => extension.commands.map((command) => ({ id: `extension:${extension.name}:${command.id}`, title: `${command.title} · ${extension.name}`, action: () => insertExtensionSnippet(extension, command.snippet) })))
  const commands = [...builtinCommands, ...extensionCommands]
  const menuItem = (icon: React.ReactNode, title: string, action: () => void, active = false, badge?: string) => <button title={title} className={`activity-button ${active ? 'active' : ''}`} onClick={action}>{icon}{badge && <i>{badge}</i>}</button>
  const language = languageOverrides[activePath] || fileLanguage(activeFile)

  return <main className="app-shell" data-theme={theme}>
    {splash && <div className="splash"><div className="brand-mark large"><Code2 size={24} /></div><strong>Aryan IDE</strong><span>Preparing your workspace</span><div className="splash-line" /></div>}
    <header className="titlebar">
      <div className="brand"><div className="brand-mark"><Code2 size={16} /></div><span>Aryan <b>IDE</b></span></div>
      <button className="workspace-picker" onClick={() => void openWorkspace()}><FolderOpen size={14} />{rootName}<ChevronDown size={13} /></button>
      <div className="quick-search"><Search size={15} /><input value={query} onFocus={() => setView('search')} onChange={(e) => { setQuery(e.target.value); setView('search') }} placeholder="Search files in workspace…" /><kbd>Ctrl P</kbd>{view === 'search' && searchMode === 'files' && query && <div className="search-popover">{searchResults.length ? searchResults.map((item) => <button key={item.path} onClick={() => { void openFile(item.path, item.name); setQuery('') }}><FileCode2 size={15} /><span>{item.name}<small>{item.path.replace(root || '', '')}</small></span></button>) : <div className="empty-search">Searching workspace…</div>}</div>}</div>
      <div className="title-actions"><button className="icon-button" title="Toggle theme" onClick={() => void changeTheme()}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><button className="icon-button" title="GitHub workflows use your configured Git credential manager" onClick={() => { setView('source'); void refreshGit() }}><Github size={16} /></button><button className="icon-button" title="Notifications" onClick={() => notify('You are all caught up')}><Circle size={15} /></button><button className="icon-button" title="Settings" onClick={() => setView('settings')}><Settings size={16} /></button><div className="window-actions"><button title="Minimize" onClick={() => void window.aryan.windowControl('minimize')}>−</button><button title="Maximize" onClick={() => void window.aryan.windowControl('maximize')}>□</button><button className="close-window" title="Close Aryan IDE" onClick={() => void window.aryan.windowControl('close')}>×</button></div></div>
    </header>
    <div className="workspace-layout">
      <nav className="activity-bar">
        {menuItem(<Files size={19} />, 'Explorer', () => setView('explorer'), view === 'explorer')}
        {menuItem(<Search size={19} />, 'Search', () => setView('search'), view === 'search')}
        {menuItem(<GitBranch size={19} />, 'Source control', () => { setView('source'); void refreshGit() }, view === 'source', gitStatus?.files.length ? String(gitStatus.files.length) : '')}
        {menuItem(<Bug size={19} />, 'Run and debug', () => { setView('run'); setBottomOpen(true) }, view === 'run')}
        {menuItem(<Braces size={19} />, 'Extensions', () => { setView('extensions'); void window.aryan.listExtensions().then(setExtensions) }, view === 'extensions')}
        <div className="activity-spacer" />
        {menuItem(<Bot size={19} />, 'AI assistant', () => setAiOpen((open) => !open), aiOpen)}
        {menuItem(<Settings size={19} />, 'Settings', () => setView('settings'), view === 'settings')}
        <div className="activity-avatar">A</div>
      </nav>
      <aside className="side-panel">
        <div className="panel-heading"><span>{view === 'explorer' ? 'EXPLORER' : view === 'source' ? 'SOURCE CONTROL' : view === 'run' ? 'RUN & DEBUG' : view === 'search' ? 'SEARCH' : view === 'extensions' ? 'EXTENSIONS' : 'SETTINGS'}</span><button className="subtle-icon" title="More actions" onClick={() => void refreshAll()}><MoreHorizontal size={17} /></button></div>
        {view === 'explorer' && <>
          <div className="section-title"><span>OPEN EDITORS</span><span className="muted">{openFiles.length || ''}</span></div>
          {openFiles.map((file) => <div className={`open-file-row ${activePath === file.path ? 'selected' : ''}`} key={file.path} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setActivePath(file.path) }} onClick={() => setActivePath(file.path)}><FileCode2 size={14} /><span>{file.name}</span>{file.content !== file.saved && <i className="dirty-dot" />}<button className="mini-close" title="Close editor" onClick={(e) => { e.stopPropagation(); closeFile(file) }}><X size={13} /></button></div>)}
          <div className="section-title explorer-title"><span>{rootName.toUpperCase()}</span>{root && <div className="inline-actions"><button title="New file" onClick={() => { setModal({ title: 'New file', parent: root, directory: false, mode: 'create' }); setModalValue('') }}><FilePlus2 size={14} /></button><button title="New folder" onClick={() => { setModal({ title: 'New folder', parent: root, directory: true, mode: 'create' }); setModalValue('') }}><FolderPlus size={14} /></button><button title="Refresh explorer" onClick={() => void refreshDirectory(root)}><RefreshCw size={13} /></button><button title="Open folder" onClick={() => void openWorkspace()}><MoreHorizontal size={15} /></button></div>}</div>
          <div className="tree-scroll">{root ? (tree[root] || []).map((entry) => <TreeItem key={entry.path} entry={entry} level={0} tree={tree} expanded={expanded} activePath={activePath} onToggle={toggleDirectory} onOpen={openFile} onContext={(e, item) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, item }) }} />) : <div className="empty-workspace"><Folder size={26} /><strong>No folder opened</strong><span>Open a folder to browse files and start coding.</span><button className="primary-button" onClick={() => void openWorkspace()}>Open Folder</button></div>}</div>
        </>}
        {view === 'search' && <div className="side-search"><label>Search workspace</label><div className="search-mode"><button className={searchMode === 'files' ? 'active' : ''} onClick={() => setSearchMode('files')}>Files</button><button className={searchMode === 'text' ? 'active' : ''} onClick={() => setSearchMode('text')}>Text <kbd>Ctrl+Shift+F</kbd></button><button className={searchMode === 'commands' ? 'active' : ''} onClick={() => setSearchMode('commands')}>Commands <kbd>Ctrl+Shift+P</kbd></button></div><div className="search-field"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchMode === 'files' ? 'Type a file name' : searchMode === 'text' ? 'Find in workspace' : 'Type a command'} autoFocus /></div><div className="section-title results-label">RESULTS <span>{searchMode === 'files' ? searchResults.length : searchMode === 'text' ? textMatches.length : commands.filter((command) => !query || command.title.toLowerCase().includes(query.toLowerCase()) || command.id.toLowerCase().includes(query.toLowerCase())).length}</span></div>{searchMode === 'files' ? searchResults.map((file) => <button className="search-result" key={file.path} onClick={() => void openFile(file.path, file.name)}><FileCode2 size={14} /><span>{file.name}<small>{file.path.replace(root || '', '')}</small></span></button>) : searchMode === 'text' ? textMatches.map((match, index) => <button className="search-result text-match" key={`${match.path}:${match.lineNumber}:${index}`} onClick={() => void openSearchMatch(match)}><FileCode2 size={14} /><span>{match.name}<small>{match.path.replace(root || '', '')}:{match.lineNumber}</small><em>{match.line}</em></span></button>) : commands.filter((command) => !query || command.title.toLowerCase().includes(query.toLowerCase()) || command.id.toLowerCase().includes(query.toLowerCase())).map((command) => <button className="search-result command-result" key={command.id} onClick={command.action}><Command size={14} /><span>{command.title}<small>{command.id}</small></span></button>)}</div>}
        {view === 'source' && <div className="source-panel"><div className="source-summary"><GitBranch size={15} /><b>{gitStatus?.branch || 'No Git repository'}</b><button title="Refresh Git status" onClick={() => void refreshGit()}><RefreshCw size={14} /></button></div>{!root ? <div className="panel-empty">Open a workspace to see Git status.</div> : !gitStatus ? <div className="panel-empty">This folder is not a Git repository, or Git is unavailable.</div> : <>
          <div className="section-title">CHANGES <span>{gitStatus.files.length}</span><button onClick={() => void gitAction('stage-all')} title="Stage all"><Plus size={14} /></button></div>
          {gitStatus.files.map((file) => <div className="git-file" key={file.path + file.status}><button onClick={() => void showDiff(file.path)} title="Review diff"><FileCode2 size={14} /><span>{file.path}</span><em>{file.index !== ' ' ? file.index : file.working}</em></button><button title={file.index !== ' ' ? 'Unstage file' : 'Stage file'} onClick={() => void gitAction(file.index !== ' ' ? 'unstage' : 'stage', [file.path])}>{file.index !== ' ' ? <X size={14} /> : <Plus size={14} />}</button></div>)}
          <textarea className="commit-message" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} placeholder="Message (required)" /><button className="primary-button full" disabled={!commitMessage.trim()} onClick={() => { void gitAction('commit', [commitMessage]); setCommitMessage('') }}><GitCommit size={14} /> Commit</button>
          <div className="git-actions"><button onClick={() => void gitAction('pull')}><GitPullRequest size={14} /> Pull</button><button onClick={() => void gitAction('push')}><GitPullRequest size={14} /> Push</button><button onClick={() => { const name = window.prompt('New branch name'); if (name) void gitAction('branch', [name]) }}><Plus size={14} /> Branch</button><button onClick={async () => { try { const branches = await window.aryan.gitAction(root!, 'branches'); const name = window.prompt(`Switch to branch:\n${branches.trim()}`); if (name) await gitAction('checkout', [name.trim()]) } catch (error) { notify(errorMessage(error)) } }}><GitBranch size={14} /> Switch</button></div><button className="plain-row" onClick={() => void showDiff()}><Code2 size={14} /> Review working diff</button></>}</div>}
        {view === 'run' && <div className="run-panel"><button className="primary-button full" onClick={() => void runActive()}><Play size={15} /> Run active file <kbd>F5</kbd></button><button className="secondary-button full" disabled={!runId} onClick={() => { void window.aryan.stopRun(runId); setRunId('') }}><Square size={14} /> Stop</button><div className="run-info"><Info size={14} /><p>Aryan IDE runs C/C++, Python, Java, and JavaScript files using configured local tools. Programs run with your Windows account permissions.</p></div><div className="section-title">SUPPORTED RUNNERS</div>{[['C', 'gcc'], ['C++', 'g++'], ['Python', 'python'], ['Java', 'javac + java'], ['JavaScript', 'node']].map(([name, runtime]) => <div className="runtime-row" key={name}><span>{name}</span><code>{runtime}</code></div>)}<button className="plain-row" onClick={() => setView('settings')}><Settings size={14} /> Configure compiler paths</button></div>}
        {view === 'extensions' && <div className="extensions-panel">
          <div className="extension-note"><Shield size={16} /><span>Extensions declare validated snippets and accent themes in JSON. No extension JavaScript is executed.</span></div>
          {extensions.length ? extensions.map((ext) => <div className="extension-card" key={ext.name}>
            <div className="extension-icon"><Braces size={17} /></div>
            <div className="extension-content"><strong>{ext.name}</strong><small>v{ext.version} · {ext.enabled ? 'Enabled' : 'Disabled'}</small><p>{ext.description}</p>
              {ext.commands.length > 0 && <div className="extension-contributions"><b>COMMANDS</b>{ext.commands.map((command) => <button key={command.id} disabled={!ext.enabled} onClick={() => insertExtensionSnippet(ext, command.snippet)}><Command size={12} />{command.title}</button>)}</div>}
              {ext.editorActions.length > 0 && <div className="extension-contributions"><b>EDITOR ACTIONS</b>{ext.editorActions.map((action) => <button key={action.id} disabled={!ext.enabled} onClick={() => insertExtensionSnippet(ext, action.snippet)}><FilePlus2 size={12} />{action.title}</button>)}</div>}
              {ext.themes.length > 0 && <div className="extension-contributions"><b>THEMES</b>{ext.themes.map((themeOption) => <button key={themeOption.id} disabled={!ext.enabled} className={activeExtensionTheme?.name === ext.name && activeExtensionTheme.id === themeOption.id ? 'selected-theme' : ''} onClick={() => void activateExtensionTheme(ext, themeOption)}><span className="theme-swatch" style={{ background: themeOption.accent }} />{activeExtensionTheme?.name === ext.name && activeExtensionTheme.id === themeOption.id ? `${themeOption.name} · Active` : themeOption.name}</button>)}</div>}
              {ext.settings.map((setting) => <label className="extension-setting" key={setting.id}>{setting.label}<input value={setting.value} onChange={(e) => setExtensions((prev) => prev.map((item) => item.name === ext.name ? { ...item, settings: item.settings.map((current) => current.id === setting.id ? { ...current, value: e.target.value } : current) } : item))} onBlur={() => void window.aryan.setExtensionSetting(ext.name, setting.id, setting.value)} /></label>)}
            </div>
            <button className={`extension-toggle ${ext.enabled ? 'on' : ''}`} title={ext.enabled ? 'Disable extension' : 'Enable extension'} onClick={async () => { await window.aryan.setExtensionEnabled(ext.name, !ext.enabled); setExtensions(await window.aryan.listExtensions()); if (ext.enabled && activeExtensionTheme?.name === ext.name) setActiveExtensionTheme(null) }}><span /></button>
          </div>) : <div className="panel-empty">No extensions found. Add a manifest under <code>extensions/</code>.</div>}
          {activeExtensionTheme && <button className="plain-row" onClick={() => void clearExtensionTheme()}><Sun size={14} /> Restore built-in accent</button>}
          <button className="plain-row" onClick={() => notify('See EXTENSIONS.md for the declarative contribution format and security model.')}><Info size={14} /> Extension development guide</button>
        </div>}
        {view === 'settings' && <form className="settings-panel" onSubmit={saveSettings}><div className="settings-group"><h3>AI Provider</h3><p>Configure an OpenAI compatible streaming chat endpoint. Your key is encrypted by Windows secure storage.</p><label>Chat completions endpoint<input value={aiConfig.endpoint} onChange={(e) => setAiConfig({ ...aiConfig, endpoint: e.target.value })} /></label><label>Model<input value={aiConfig.model} onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })} /></label><label>API key<input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={aiConfig.hasKey ? 'Key saved · enter to replace' : 'Paste provider API key'} /></label><small className="secure-note"><Shield size={12} /> {aiConfig.hasKey ? 'A key is stored in encrypted OS credentials.' : 'No key configured. All other features work without AI.'}</small></div><div className="settings-group"><h3>Language runtimes</h3><p>Use a PATH command name or an absolute path to a compiler/interpreter.</p>{[['c', 'C compiler (GCC)'], ['cpp', 'C++ compiler (G++)'], ['python', 'Python interpreter'], ['java', 'Java compiler (javac)'], ['javaRuntime', 'Java runtime'], ['javascript', 'Node.js']].map(([key, label]) => <label key={key}>{label}<input value={runtimeConfig[key] || ''} onChange={(e) => setRuntimeConfig({ ...runtimeConfig, [key]: e.target.value })} placeholder={key === 'javaRuntime' ? 'java' : key} /></label>)}</div><div className="settings-group"><h3>Editor</h3><label>Font size<input type="number" min={10} max={24} value={editorFontSize} onChange={(e) => setEditorFontSize(Math.max(10, Math.min(24, Number(e.target.value) || 13)))} /></label><button type="button" className="secondary-button" onClick={() => setWordWrap((value) => !value)}>Word wrap: {wordWrap ? 'On' : 'Off'}</button></div><div className="settings-group"><h3>Appearance</h3><button type="button" className="secondary-button" onClick={() => void changeTheme()}>{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} Switch to {theme === 'dark' ? 'light' : 'dark'} theme</button></div><button className="primary-button full" type="submit"><Check size={15} /> Save settings</button></form>}
      </aside>
      <section className="center-column">
        <div className="editor-tabs">{openFiles.map((file) => <button key={file.path} className={`editor-tab ${file.path === activePath ? 'active' : ''}`} onClick={() => setActivePath(file.path)}><FileCode2 size={14} /><span>{file.name}</span>{file.content !== file.saved && <i className="dirty-dot" />}<span className="tab-close" onClick={(e) => { e.stopPropagation(); closeFile(file) }}><X size={13} /></span></button>)}<div className="tab-actions">{activeFile && <select className="language-select" title="Change editor language mode" aria-label="Editor language mode" value={language} onChange={(e) => setLanguageOverrides((prev) => ({ ...prev, [activePath]: e.target.value as EditorLanguage }))}>{editorLanguages.map((item) => <option key={item} value={item}>{languageTitle[item]}</option>)}</select>}<button title="Run active file (F5)" disabled={!activeFile} onClick={() => void runActive()}><Play size={13} /></button><button title="Save file" onClick={() => void saveFile()}><Check size={14} /></button><button title="Toggle terminal" onClick={() => setBottomOpen((open) => !open)}><TerminalSquare size={15} /></button></div></div>
        <div className="editor-wrap">{activeFile ? <><Editor key={activePath} path={activePath} value={activeFile.content} language={language === 'plaintext' ? 'plaintext' : language} theme={theme === 'dark' ? 'aryan-dark' : 'aryan-light'} onMount={onEditorMount} onChange={(value) => setOpenFiles((prev) => prev.map((file) => file.path === activePath ? { ...file, content: value || '' } : file))} options={{ automaticLayout: true, minimap: { enabled: true, scale: 0.8 }, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: editorFontSize, lineHeight: 21, tabSize: 4, scrollBeyondLastLine: false, smoothScrolling: true, cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true }, folding: true, wordWrap: wordWrap ? 'on' : 'off', renderLineHighlight: 'line', padding: { top: 14, bottom: 14 }, suggestOnTriggerCharacters: true, quickSuggestions: true, glyphMargin: true }} />
          <div className="editor-breadcrumb"><span>{rootName}</span><ChevronRight size={12} /><span>{activeFile.name}</span><span className="language-chip">{languageTitle[language] || 'Plain Text'}</span></div></> : <div className="welcome-screen"><div className="welcome-logo"><Code2 size={25} /></div><h1>Build something great.</h1><p>A focused workspace for your next idea.</p><div className="welcome-actions"><button onClick={() => void openWorkspace()}><FolderOpen size={16} /> Open Folder <kbd>Ctrl+O</kbd></button><button onClick={() => { if (!root) { notify('Open a workspace folder to create files'); return } setModal({ title: 'New file', parent: root, directory: false, mode: 'create' }) }}><FilePlus2 size={16} /> New File</button><button onClick={() => { setView('search'); setQuery('') }}><Search size={16} /> Find File <kbd>Ctrl+P</kbd></button></div><div className="welcome-footer"><span><Circle size={7} fill="currentColor" /> Aryan IDE 0.1.0</span><span>MONACO EDITOR</span></div></div>}</div>
        <section className={`bottom-panel ${bottomOpen ? '' : 'hidden'}`}><div className="bottom-tabs"><button className={bottomTab === 'terminal' ? 'active' : ''} onClick={() => setBottomTab('terminal')}><TerminalSquare size={14} /> Terminal</button><button className={bottomTab === 'output' ? 'active' : ''} onClick={() => setBottomTab('output')}><Activity size={14} /> Output</button><button className={bottomTab === 'problems' ? 'active' : ''} onClick={() => setBottomTab('problems')}><CircleAlert size={14} /> Problems</button><button className={bottomTab === 'debug' ? 'active' : ''} onClick={() => setBottomTab('debug')}><Bug size={14} /> Debug Console</button><div className="bottom-tools">{bottomTab === 'terminal' && <><span>{terminalSession ? 'PowerShell' : 'Terminal stopped'}</span><button title="New terminal session" onClick={() => void restartTerminal()}><Plus size={14} /></button><button title="Terminate terminal" onClick={() => { if (terminalSession) void window.aryan.terminalStop(terminalSession); terminalSessionRef.current = ''; setTerminalSession(''); setTerminalReady(false) }}><XCircle size={14} /></button></>}<button title="Close panel" onClick={() => setBottomOpen(false)}><X size={14} /></button></div></div>
          <div className="bottom-content"><div ref={terminalHost} className={`terminal-host ${bottomTab === 'terminal' ? '' : 'hidden'}`} />{bottomTab === 'output' && <><pre className="output-text">{gitDiff || (runOutputParts.length ? runOutputParts.map((part, index) => <span key={`${part.kind}:${index}`} className={`run-output-${part.kind}`}>{part.text}</span>) : runOutput || 'Run a source file to see its output here.')}</pre>{runId && <form className="program-input" onSubmit={(e) => { e.preventDefault(); void window.aryan.runWrite(runId, programInput + '\n').catch((err) => notify(errorMessage(err))); setProgramInput('') }}><span>stdin ›</span><input value={programInput} onChange={(e) => setProgramInput(e.target.value)} placeholder="Send input to the running program" /><button><Send size={14} /></button></form>}</>}{bottomTab === 'problems' && (problemMarkers.length ? <div className="problems-list">{problemMarkers.map((marker, index) => <button key={`${marker.message}:${marker.startLineNumber}:${index}`} onClick={() => { editorRef.current?.revealPositionInCenter({ lineNumber: marker.startLineNumber, column: marker.startColumn }); editorRef.current?.setPosition({ lineNumber: marker.startLineNumber, column: marker.startColumn }); editorRef.current?.focus() }}><CircleAlert size={14} /><span>{marker.message}<small>{marker.source || 'Monaco'} · line {marker.startLineNumber}, column {marker.startColumn}</small></span></button>)}</div> : <div className="panel-empty inline-empty"><Info size={15} /> No editor diagnostics for the current file. Monaco language services provide basic editor checks; compilers and language servers are separate.</div>)}{bottomTab === 'debug' && <div className="panel-empty inline-empty">Debugging requires a language debugger adapter. No debugger is configured.</div>}</div>
        </section>
        <footer className="statusbar"><span><GitBranch size={13} />{gitStatus?.branch || (root ? 'No repository' : 'No workspace')}</span><button onClick={() => { setBottomOpen(true); setBottomTab('problems') }} title="Show editor diagnostics"><CircleAlert size={13} /> {problemMarkers.length}</button><div className="status-spacer" /><button onClick={() => { setBottomOpen(true); setBottomTab('terminal') }}><TerminalSquare size={13} /> Terminal</button><span>{activeFile ? `${editorRef.current?.getPosition()?.lineNumber || 1}:${editorRef.current?.getPosition()?.column || 1}` : 'Ready'}</span><span>{languageTitle[language] || 'Plain Text'}</span><span>UTF-8</span><span>Windows</span></footer>
      </section>
      {aiOpen && <aside className="ai-panel"><div className="ai-heading"><div><span className="ai-icon"><Bot size={17} /></span><strong>AI ASSISTANT</strong></div><button className="subtle-icon" title="Close assistant" onClick={() => setAiOpen(false)}><X size={15} /></button></div><div className="ai-context"><span className="context-dot" />{activeFile ? activeFile.name : 'Workspace assistant'}{selectedCode && <button onClick={() => setSelectedCode('')} title="Clear selected code"><X size={12} /></button>}</div><div className="chat-scroll">{chat.length === 0 ? <div className="ai-welcome"><div className="ai-orb"><Bot size={22} /></div><h3>What are we building?</h3><p>Ask about your code, debug an error, or get a second pair of eyes.</p><div className="prompt-chips"><button onClick={() => { const input = document.querySelector<HTMLTextAreaElement>('.chat-input textarea'); if (input) input.value = 'Explain this file'; setSelectedCode(editorRef.current?.getValue() || '') }}>Explain this file</button><button onClick={() => { const input = document.querySelector<HTMLTextAreaElement>('.chat-input textarea'); if (input) input.value = 'Help me debug this code' }}>Help me debug</button><button onClick={() => { const input = document.querySelector<HTMLTextAreaElement>('.chat-input textarea'); if (input) input.value = 'Suggest a small improvement' }}>Suggest an improvement</button></div></div> : chat.map((message, index) => <div className={`chat-message ${message.role}`} key={index}><div className="message-avatar">{message.role === 'assistant' ? <Bot size={14} /> : 'Y'}</div><div className="message-body">{message.role === 'assistant' ? <MarkdownLite text={message.content} /> : <p>{message.content}</p>}{message.role === 'assistant' && message.content && <div className="message-actions"><button title="Copy response" onClick={() => void copySuggestion(message.content)}><Copy size={13} /></button><button title="Insert code suggestion into current selection" onClick={() => prepareSuggestion(message.content)}><FilePlus2 size={13} /> Insert</button></div>}</div></div>)}{chatBusy && <div className="typing-indicator"><span /><span /><span /> Aryan is thinking</div>}</div><form className="chat-input" onSubmit={sendChat}><textarea rows={2} placeholder={aiConfig.hasKey ? 'Ask anything about your code…' : 'Set up an API key to chat…'} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} /><div><button type="button" title="Explain selected editor code" onClick={() => { const selection = editorRef.current?.getModel()?.getValueInRange(editorRef.current.getSelection()!); if (selection) { setSelectedCode(selection); notify('Selected code attached to your next question') } else notify('Select code in the editor first') }}><Code2 size={14} /></button><span>AI can make mistakes</span><button className="send-button" disabled={chatBusy}><Send size={14} /></button></div></form></aside>}
    </div>
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}><button onClick={() => { if (contextMenu.item.isDirectory) { setModal({ title: 'New file', parent: contextMenu.item.path, directory: false, mode: 'create' }) } else void openFile(contextMenu.item.path, contextMenu.item.name); setContextMenu(null) }}><FileCode2 size={14} /> {contextMenu.item.isDirectory ? 'New File' : 'Open'}</button><button onClick={() => { setModal({ title: 'Rename item', target: contextMenu.item.path, mode: 'rename' }); setModalValue(contextMenu.item.name); setContextMenu(null) }}><Command size={14} /> Rename</button><button className="danger" onClick={() => void deleteItem(contextMenu.item)}><Trash2 size={14} /> Delete</button></div>}
    {pendingAIEdit !== null && <div className="modal-scrim" onClick={() => setPendingAIEdit(null)}><section className="modal-card ai-review-card" role="dialog" aria-modal="true" aria-labelledby="ai-review-title" onClick={(e) => e.stopPropagation()}><div className="modal-heading"><h3 id="ai-review-title">Review AI suggestion</h3><button type="button" title="Close review" onClick={() => setPendingAIEdit(null)}><X size={16} /></button></div><p>Review the code before inserting it into the current editor selection.</p><pre className="ai-review-code"><code>{pendingAIEdit}</code></pre><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingAIEdit(null)}>Cancel</button><button type="button" className="primary-button" disabled={!activeFile} onClick={() => applySuggestion(pendingAIEdit)}><FilePlus2 size={14} /> Insert into editor</button></div></section></div>}
    {modal && <div className="modal-scrim" onClick={() => setModal(null)}><form className="modal-card" onSubmit={performCreate} onClick={(e) => e.stopPropagation()}><div className="modal-heading"><h3>{modal.title}</h3><button type="button" onClick={() => setModal(null)}><X size={16} /></button></div><label>Name<input autoFocus value={modalValue} onChange={(e) => setModalValue(e.target.value)} placeholder={modal.directory ? 'Folder name' : 'File name'} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button">{modal.mode === 'rename' ? 'Rename' : 'Create'}</button></div></form></div>}
    {toast && <div className="toast"><Info size={15} />{toast}</div>}
  </main>
}

function pathParent(target: string) { return target.slice(0, Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'))) }

function TreeItem({ entry, level, tree, expanded, activePath, onToggle, onOpen, onContext }: {
  entry: FileEntry; level: number; tree: Record<string, FileEntry[]>; expanded: Set<string>; activePath: string
  onToggle: (entry: FileEntry) => void; onOpen: (path: string, name: string) => void; onContext: (event: React.MouseEvent, entry: FileEntry) => void
}) {
  const isExpanded = expanded.has(entry.path)
  const extension = entry.name.split('.').pop()?.toLowerCase()
  return <><button className={`tree-row ${activePath === entry.path ? 'selected' : ''}`} style={{ paddingLeft: 9 + level * 15 }} onClick={() => entry.isDirectory ? onToggle(entry) : onOpen(entry.path, entry.name)} onContextMenu={(e) => onContext(e, entry)}>{entry.isDirectory ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="tree-indent" />}{entry.isDirectory ? (isExpanded ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />) : <FileIcon extension={extension} />}<span>{entry.name}</span></button>{entry.isDirectory && isExpanded && (tree[entry.path] || []).map((child) => <TreeItem key={child.path} entry={child} level={level + 1} tree={tree} expanded={expanded} activePath={activePath} onToggle={onToggle} onOpen={onOpen} onContext={onContext} />)}</>
}
function FileIcon({ extension }: { extension?: string }) { const color = extension === 'py' ? '#80c7f2' : extension === 'js' || extension === 'ts' || extension === 'tsx' ? '#e9c46a' : extension === 'json' ? '#d9a85e' : extension === 'html' ? '#e98265' : '#aaa7b8'; return <FileCode2 size={14} color={color} /> }
function MarkdownLite({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g)
  return <div className="markdown-lite">{parts.map((part, i) => part.startsWith('```') ? <pre key={i}><code>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code></pre> : part.split('\n').map((line, j) => <p key={`${i}-${j}`}>{line || '\u00a0'}</p>))}</div>
}
