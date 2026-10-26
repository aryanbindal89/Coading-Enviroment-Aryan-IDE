export type RunLanguage = 'c' | 'cpp' | 'python' | 'java' | 'javascript'
export type PlannedCommand = { executable: string; args: string[] }
export function buildExecutionPlan(source: string, language: RunLanguage, config?: Record<string, string>, buildDirectory?: string, sourceText?: string): { compile: PlannedCommand | null; run: PlannedCommand }
