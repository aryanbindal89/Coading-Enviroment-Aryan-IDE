const path = require('node:path')

const extensions = {
  c: ['.c'], cpp: ['.cpp', '.cc', '.cxx'], python: ['.py'], java: ['.java'], javascript: ['.js', '.mjs', '.cjs']
}
const defaults = { c: 'gcc', cpp: 'g++', python: 'python', java: 'javac', javascript: 'node' }

function buildExecutionPlan(source, language, config = {}, buildDirectory, sourceText = '') {
  if (!extensions[language]) throw new Error('Unsupported language.')
  if (!extensions[language].includes(path.extname(source).toLowerCase())) throw new Error(`The selected file does not match ${language}.`)
  const executable = config[language]?.trim() || defaults[language]
  if (language === 'python' || language === 'javascript') return { compile: null, run: { executable, args: [source] } }
  if (!buildDirectory) throw new Error('A temporary build directory is required for compiled languages.')
  const binary = path.join(buildDirectory, process.platform === 'win32' ? 'program.exe' : 'program')
  if (language === 'c' || language === 'cpp') {
    return { compile: { executable, args: ['-g', source, '-o', binary] }, run: { executable: binary, args: [] } }
  }
  const packageName = sourceText.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1]
  const className = `${packageName ? `${packageName}.` : ''}${path.basename(source, '.java')}`
  return {
    compile: { executable, args: ['-encoding', 'UTF-8', '-d', buildDirectory, source] },
    run: { executable: config.javaRuntime?.trim() || 'java', args: ['-cp', buildDirectory, className] }
  }
}

module.exports = { buildExecutionPlan }
