# Aryan IDE

Aryan IDE is a Windows desktop coding workspace built with Electron, React, TypeScript, Monaco Editor, and xterm.js. It uses the native Windows window frame and keeps filesystem, process, Git, and credential work in the Electron main process behind a small preload API.

## Requirements

- Windows 11 (Windows 10 22H2 should also work)
- Node.js 22 or newer and npm
- Git for Windows for source control
- Optional language tools: GCC/G++, Python, JDK (`javac` and `java`), and Node.js
- Visual Studio Build Tools with the Desktop development with C++ workload for native PTY rebuilds (the app falls back to PowerShell standard streams without it)

## Install and run

In PowerShell, from the project directory:

```powershell
npm install
npm run dev
```

To enable a resizable native PTY after installing Visual Studio Build Tools:

```powershell
npx electron-rebuild -f -w node-pty
npm run dev
```

Create a Windows installer:

```powershell
npm run dist
```

The installer is written to `release/`. `npm run build` compiles main, preload, and renderer code without creating an installer.

## Use

- **Open a folder:** use the folder control in the title bar or the Explorer panel.
- **Edit:** click a workspace file. Monaco provides syntax highlighting, completion, folding, minimap, find/replace, and multi-tab editing. `Ctrl+S` saves.
- **Run:** press `F5` or use Run & Debug. C uses `gcc`, C++ uses `g++`, Python uses `python`, Java uses `javac` then `java`, and JavaScript uses `node`. Configure command names or absolute paths in Settings. Program text input is available in Output while the program runs.
- **Terminal:** open the Terminal panel or press `Ctrl+``. It hosts PowerShell through node-pty when the native module is available; otherwise it falls back to standard streams. PTY mode supports interactive programs and terminal resizing.
- **Git:** Source Control uses the installed Git CLI. Push and pull use the credential helper already configured for Git, such as Git Credential Manager; Aryan IDE never asks for a GitHub password.
- **AI:** Settings accepts an OpenAI-compatible streaming chat-completions endpoint, model, and API key. The key is encrypted using Electron `safeStorage` and is only decrypted in the main process. Without a key, the rest of the IDE remains available.
- **Extensions:** manifests are discovered from `extensions/` in the app and `%APPDATA%/aryan-ide/extensions`. The current release reads manifest metadata only; it does not execute extension entry points.

## Safety and current limits

Running a program executes it as your Windows user. Treat code from other people as untrusted and run it in a disposable Windows account or VM when needed. The runner does not sandbox user programs. It starts executables with argument arrays, uses the workspace as the working directory, and stops a process after 15 minutes. Interactive stdin is line-oriented in the Output panel; programs requiring a full terminal/TTY should be run in the integrated PowerShell terminal.

The Problems and Debug Console panels explain when compiler diagnostics or a debugger adapter are unavailable. Monaco syntax services are not advertised as full compiler diagnostics or language-server support. Java sources with custom package hierarchies may need their classpath configured manually. GitHub authentication is handled by normal Git remotes and the user's credential helper.

The extension directory contains a manifest-only sample. Extension enablement and string settings persist, but commands, themes, and editor-action contributions are not executed in this first version. No external extension code is run. The attachment included with this project contained the written brief but no reference image file, so the UI follows the described dark-purple layout and spacing.

## Project layout

```text
src/main/       Electron main process: workspace, runner, terminal, Git, AI, settings
src/preload/    narrow, typed context bridge
src/renderer/   React UI, Monaco editor, xterm.js, styles
src/shared/     shared IPC types
extensions/     sample extension manifest and API notes
```

## Troubleshooting

- **`node-pty` fails to install:** install Visual Studio Build Tools (Desktop development with C++) and Python, then run `npx electron-rebuild -f -w node-pty`.
- **Compiler is missing:** open Settings and set the runtime to a PATH command or full executable path. Confirm the tool works in a new PowerShell terminal.
- **PowerShell does not start:** verify Windows PowerShell is present at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`.
- **Git panel is empty:** open a repository folder and verify `git --version` from PowerShell.
- **AI calls fail:** confirm the endpoint accepts OpenAI-compatible `/chat/completions` streaming requests and check the model name and API key.
- **Installer signing warning:** Windows SmartScreen can warn on unsigned local installers. Production distribution requires a code-signing certificate.

## Automated tests

Run the current workspace-containment unit tests with:

```powershell
npm test
npx tsc --noEmit
npm run build
```

The automated suite covers lexical workspace path containment. Windows installer generation has been verified for this release. Installing and launching that installer, end-to-end file operations, all language runtimes, and Git operations still need manual verification on a Windows machine with the relevant tools installed.
