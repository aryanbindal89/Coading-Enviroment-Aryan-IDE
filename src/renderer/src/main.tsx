import React from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import App from './App'
import './styles.css'
import './details.css'

loader.config({ monaco })
monaco.editor.defineTheme('aryan-dark', { base: 'vs-dark', inherit: true, rules: [{ token: 'keyword', foreground: 'c4a7ff' }, { token: 'string', foreground: 'a6d189' }, { token: 'comment', foreground: '777788', fontStyle: 'italic' }, { token: 'number', foreground: 'ef9f76' }], colors: { 'editor.background': '#111116', 'editorLineNumber.foreground': '#555461', 'editorLineNumber.activeForeground': '#c4a7ff', 'editorCursor.foreground': '#b99aff', 'editor.selectionBackground': '#57447b77' } })
monaco.editor.defineTheme('aryan-light', { base: 'vs', inherit: true, rules: [{ token: 'keyword', foreground: '733ac0' }, { token: 'string', foreground: '287a50' }, { token: 'comment', foreground: '888594', fontStyle: 'italic' }, { token: 'number', foreground: 'c05f25' }], colors: { 'editor.background': '#fbfaff', 'editorLineNumber.foreground': '#a29eac', 'editorLineNumber.activeForeground': '#733ac0', 'editorCursor.foreground': '#7c3aed', 'editor.selectionBackground': '#ded3f188' } })

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
