import { contextBridge, ipcRenderer } from 'electron'
import type { AryanAPI } from '../shared/types'

const api: AryanAPI = {
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  listDirectory: (path) => ipcRenderer.invoke('workspace:list', path),
  readFile: (path) => ipcRenderer.invoke('workspace:read', path),
  saveFile: (path, content) => ipcRenderer.invoke('workspace:save', path, content),
  createEntry: (parent, name, directory) => ipcRenderer.invoke('workspace:create', parent, name, directory),
  renameEntry: (path, name) => ipcRenderer.invoke('workspace:rename', path, name),
  deleteEntry: (path) => ipcRenderer.invoke('workspace:delete', path),
  runFile: (path, language, config) => ipcRenderer.invoke('run:start', path, language, config),
  stopRun: (id) => ipcRenderer.invoke('run:stop', id),
  runWrite: (id, data) => ipcRenderer.invoke('run:write', id, data),
  onRunOutput: (callback) => { const fn = (_: Electron.IpcRendererEvent, event: unknown) => callback(event as never); ipcRenderer.on('run:output', fn); return () => ipcRenderer.removeListener('run:output', fn) },
  terminalStart: () => ipcRenderer.invoke('terminal:start'),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalStop: (id) => ipcRenderer.invoke('terminal:stop', id),
  onTerminalData: (callback) => { const fn = (_: Electron.IpcRendererEvent, event: unknown) => callback(event as never); ipcRenderer.on('terminal:data', fn); return () => ipcRenderer.removeListener('terminal:data', fn) },
  gitStatus: (root) => ipcRenderer.invoke('git:status', root),
  gitAction: (root, action, args) => ipcRenderer.invoke('git:action', root, action, args),
  gitDiff: (root, path) => ipcRenderer.invoke('git:diff', root, path),
  aiConfig: () => ipcRenderer.invoke('ai:config'),
  aiSaveConfig: (config) => ipcRenderer.invoke('ai:save-config', config),
  aiChat: (messages, selectedCode) => ipcRenderer.invoke('ai:chat', messages, selectedCode),
  onAIChunk: (callback) => { const fn = (_: Electron.IpcRendererEvent, event: unknown) => callback(event as never); ipcRenderer.on('ai:chunk', fn); return () => ipcRenderer.removeListener('ai:chunk', fn) },
  getTheme: () => ipcRenderer.invoke('settings:theme'),
  setTheme: (theme) => ipcRenderer.invoke('settings:set-theme', theme),
  getRuntimeConfig: () => ipcRenderer.invoke('settings:runtimes'),
  setRuntimeConfig: (config) => ipcRenderer.invoke('settings:set-runtimes', config),
  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  setExtensionEnabled: (name, enabled) => ipcRenderer.invoke('extensions:set-enabled', name, enabled),
  setExtensionSetting: (name, id, value) => ipcRenderer.invoke('extensions:set-setting', name, id, value),
  windowControl: (action) => ipcRenderer.invoke('window:control', action)
}
contextBridge.exposeInMainWorld('aryan', api)
