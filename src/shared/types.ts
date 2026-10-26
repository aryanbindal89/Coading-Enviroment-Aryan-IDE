export type FileEntry = { name: string; path: string; isDirectory: boolean }
export type RunLanguage = 'c' | 'cpp' | 'python' | 'java' | 'javascript'
export type GitStatus = { branch: string; files: { path: string; index: string; working: string; status: string }[] }
export type AIConfig = { endpoint: string; model: string; hasKey: boolean }

export type AryanAPI = {
  openWorkspace: () => Promise<string | null>
  listDirectory: (path: string) => Promise<FileEntry[]>
  readFile: (path: string) => Promise<string>
  saveFile: (path: string, content: string) => Promise<void>
  createEntry: (parent: string, name: string, directory: boolean) => Promise<string>
  renameEntry: (path: string, name: string) => Promise<string>
  deleteEntry: (path: string) => Promise<void>
  runFile: (path: string, language: RunLanguage, config?: Record<string, string>) => Promise<string>
  stopRun: (id: string) => Promise<void>
  runWrite: (id: string, data: string) => Promise<void>
  onRunOutput: (callback: (event: { id: string; text: string; kind: 'stdout' | 'stderr' | 'system' | 'exit' }) => void) => () => void
  terminalStart: () => Promise<string>
  terminalWrite: (id: string, data: string) => Promise<void>
  terminalResize: (id: string, cols: number, rows: number) => Promise<void>
  terminalStop: (id: string) => Promise<void>
  onTerminalData: (callback: (event: { id: string; data: string; exit?: number }) => void) => () => void
  gitStatus: (root: string) => Promise<GitStatus>
  gitAction: (root: string, action: string, args?: string[]) => Promise<string>
  gitDiff: (root: string, path?: string) => Promise<string>
  aiConfig: () => Promise<AIConfig>
  aiSaveConfig: (config: { endpoint: string; model: string; apiKey?: string }) => Promise<void>
  aiChat: (messages: { role: 'user' | 'assistant'; content: string }[], selectedCode?: string) => Promise<void>
  onAIChunk: (callback: (chunk: { text: string; done?: boolean; error?: string }) => void) => () => void
  getTheme: () => Promise<'dark' | 'light'>
  setTheme: (theme: 'dark' | 'light') => Promise<void>
  getRuntimeConfig: () => Promise<Record<string, string>>
  setRuntimeConfig: (config: Record<string, string>) => Promise<void>
  listExtensions: () => Promise<{ name: string; version: string; description: string; enabled: boolean; settings: { id: string; label: string; value: string }[] }[]>
  setExtensionEnabled: (name: string, enabled: boolean) => Promise<void>
  setExtensionSetting: (name: string, id: string, value: string) => Promise<void>
  windowControl: (action: 'minimize' | 'maximize' | 'close') => Promise<void>
}
