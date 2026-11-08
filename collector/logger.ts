export type LogLevel = 'info' | 'warn' | 'error'

/** One JSON object per line; never logs tokens or prompt content. */
export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields })
  process.stdout.write(`${line}\n`)
}
