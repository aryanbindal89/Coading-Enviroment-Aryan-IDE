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
- **Edit:** click a workspace file. Monaco provides syntax highlighting, completion, folding, minimap, find/replace, and multi-tab editing. Change the editor language mode beside the Run button; font size and word wrap are in Settings. `Ctrl+S` saves.
- **Search:** `Ctrl+P` searches workspace file names, `Ctrl+Shift+F` searches file contents, and `Ctrl+Shift+P` opens the command palette. Content search skips build and dependency folders and bounds the number and size of files it reads.
- **Run:** press `F5` or use Run & Debug. C uses `gcc`, C++ uses `g++`, Python uses `python`, Java uses `javac` then `java`, and JavaScript uses `node`. Configure command names or absolute paths in Settings. Program text input is available in Output while the program runs.
- **Terminal:** open the Terminal panel or press `Ctrl+``. It hosts PowerShell through node-pty when the native module is available; otherwise it falls back to standard streams. The fallback supports basic line input. PTY mode supports full interactive programs and terminal resizing.
- **Git:** Source Control uses the installed Git CLI. Push and pull use the credential helper already configured for Git, such as Git Credential Manager; Aryan IDE never asks for a GitHub password.
- **AI:** Settings accepts an OpenAI-compatible streaming chat-completions endpoint, model, and API key. The key is encrypted using Electron `safeStorage` and is only decrypted in the main process. Code suggestions open in a review dialog before insertion. Without a key, the rest of the IDE remains available.
- **Extensions:** manifests are discovered from `extensions/` in the app and `%APPDATA%/aryan-ide/extensions`. The declarative API supports editor snippets, palette commands, accent themes, and string settings. Extension JavaScript entry points are never executed.

## Safety and current limits

Running a program executes it as your Windows user. Treat code from other people as untrusted and run it in a disposable Windows account or VM when needed. The runner does not sandbox user programs. It starts executables with argument arrays, uses the workspace as the working directory, and stops a process after 15 minutes. Interactive stdin is line-oriented in the Output panel; programs requiring a full terminal/TTY should be run in the integrated PowerShell terminal.

The Problems panel shows Monaco's file markers for languages with built-in services; these are not full compiler diagnostics or language-server support. The Debug Console reports that a debugger adapter must be installed; Aryan IDE does not simulate breakpoints. GitHub authentication is handled by normal Git remotes and the user's credential helper.

The standard-stream PowerShell fallback does not provide full terminal control. Install Visual Studio Build Tools and rebuild `node-pty` for PTY input and terminal resizing. The attachment included with this project contained the written brief but no reference image file, so the UI follows the described dark-purple layout and spacing.

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

The automated suite covers workspace path containment and runner argument plans, including a JavaScript run through the current Node executable. The production bundle and Windows installer have been generated. C/C++/Python/Java runtimes, PTY rebuild, AI provider calls, Git workflows, and installing the generated installer still need machine-level verification with those tools and credentials available.
