import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { platform } from 'node:process'

export function openExternal(url: string) {
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

export function runProcess(command: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `${command} exited with ${code}`))
    })
  })
}

export async function runSql(sql: string) {
  await runProcess('sqlite3', [channelsDbPath(), sql])
}

export function channelsDbPath() {
  return join(homedir(), '.tempo', 'wallet', 'channels.db')
}

export function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}
