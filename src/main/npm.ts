import { execFile, spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings, NpmrcConfig } from '../shared/types'

export type NpmCommandResult = {
  cmd: string
  exitCode: number
  stdout: string
  stderr: string
}

const uniq = (arr: string[]) => [...new Set(arr)]

const splitPath = (value: string) => value.split(path.delimiter).filter(Boolean)

const mergePathParts = (...lists: Array<string[] | null | undefined>) => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!list) continue
    for (const item of list) {
      const trimmed = item.trim()
      if (!trimmed) continue
      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

let cachedShellPath: Promise<string | null> | null = null

const readPathFromLoginShell = async (): Promise<string | null> => {
  if (os.platform() === 'win32') return null

  if (!cachedShellPath) {
    cachedShellPath = new Promise((resolve) => {
      const shell =
        process.env.SHELL?.trim() || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash')
      const shellArgs = os.platform() === 'darwin' ? ['-lic'] : ['-lc']
      const script = 'printf "__UPM_PATH__%s__UPM_END__" "$PATH"'

      execFile(
        shell,
        [...shellArgs, script],
        { timeout: 2500, env: process.env },
        (err, stdout) => {
          if (err) return resolve(null)
          const matches = Array.from(String(stdout).matchAll(/__UPM_PATH__(.*?)__UPM_END__/gs))
          const last = matches.length ? matches[matches.length - 1] : null
          const value = last?.[1]?.trim() || ''
          resolve(value || null)
        }
      )
    })
  }

  return cachedShellPath
}

const buildNpmSpawnEnv = async (): Promise<NodeJS.ProcessEnv> => {
  const basePath = process.env.PATH || ''
  const common: string[] =
    os.platform() === 'darwin'
      ? [
          '/opt/homebrew/bin',
          '/opt/homebrew/sbin',
          '/usr/local/bin',
          '/usr/local/sbin',
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin'
        ]
      : os.platform() === 'linux'
        ? ['/usr/local/bin', '/usr/local/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
        : []

  const shellPath = await readPathFromLoginShell()
  const merged = mergePathParts(splitPath(shellPath || ''), splitPath(basePath), common)
  return { ...process.env, PATH: merged.join(path.delimiter) }
}

const uniqueScopedRegistry = (cfg: NpmrcConfig): string | null => {
  const values = Object.values(cfg.scopedRegistries ?? {}).filter(Boolean)
  const unique = uniq(values)
  return unique.length === 1 ? unique[0]! : null
}

const uniqueScopedRegistries = (cfg: NpmrcConfig): string[] => {
  const values = Object.values(cfg.scopedRegistries ?? {}).filter(Boolean)
  return uniq(values).sort()
}

const resolveRegistryForQuery = (cfg: NpmrcConfig, query: string): string | null => {
  if (cfg.values?.registry) return cfg.values.registry

  const trimmed = query.trim()
  if (trimmed.startsWith('@')) {
    const scope = trimmed.split('/')[0]!
    const scoped = cfg.scopedRegistries?.[scope]
    if (scoped) return scoped
  }

  return uniqueScopedRegistry(cfg)
}

export const getEffectiveNpmPath = (settings: AppSettings): string => {
  const configured = settings.npmExecutablePath?.trim()
  if (configured) return configured
  return os.platform() === 'win32' ? 'npm.cmd' : 'npm'
}

export const runNpm = async (
  args: string[],
  opts: {
    cwd: string
    settings: AppSettings
    npmrc?: NpmrcConfig
    queryForRegistry?: string
    forceRegistry?: string | null
  }
): Promise<NpmCommandResult> => {
  const npmPath = getEffectiveNpmPath(opts.settings)

  const cmdArgs = [...args]
  const registry =
    opts.forceRegistry ??
    (opts.npmrc ? resolveRegistryForQuery(opts.npmrc, opts.queryForRegistry ?? '') : null)
  if (registry && !cmdArgs.some((a) => a.startsWith('--registry='))) {
    cmdArgs.push(`--registry=${registry}`)
  }

  const cmd = `${npmPath} ${cmdArgs.join(' ')}`
  return new Promise((resolve) => {
    void (async () => {
      const env = await buildNpmSpawnEnv()
      let child
      try {
        child = spawn(npmPath, cmdArgs, {
          cwd: opts.cwd,
          env,
          shell: false
        })
      } catch (err) {
        resolve({ cmd, exitCode: -1, stdout: '', stderr: String(err) })
        return
      }
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += String(d)))
      child.stderr.on('data', (d) => (stderr += String(d)))
      child.on('close', (code) => {
        resolve({ cmd, exitCode: typeof code === 'number' ? code : -1, stdout, stderr })
      })
      child.on('error', (err) => {
        const anyErr = err as Error & { code?: string }
        if (anyErr.code === 'ENOENT') {
          const configured = opts.settings.npmExecutablePath?.trim()
          const hint = configured
            ? `Configured npm executable not found: ${npmPath}`
            : os.platform() === 'darwin'
              ? 'npm not found. If you installed Node via Homebrew/NVM, set Settings → npm executable path (e.g. /opt/homebrew/bin/npm), or launch the app from Terminal so PATH is available.'
              : 'npm not found. Install Node.js (npm) or set Settings → npm executable path.'
          resolve({ cmd, exitCode: -1, stdout, stderr: (stderr + hint + '\n' + String(err)).trim() })
          return
        }
        resolve({ cmd, exitCode: -1, stdout, stderr: (stderr + String(err)).trim() })
      })
    })()
  })
}

export const npmSearchRemote = async (
  query: string,
  limit: number,
  opts: { cwd: string; settings: AppSettings; npmrc: NpmrcConfig }
) => {
  const trimmed = query.trim()
  const effective = trimmed.length ? trimmed : '*'

  const globalRegistry = opts.npmrc.values?.registry?.trim() || ''
  const scopedRegistries = uniqueScopedRegistries(opts.npmrc)

  const buildArgs = (q: string, l: number, registryOverride?: string) => {
    const args = ['search', q, '--json', `--searchlimit=${l}`]
    if (registryOverride?.trim()) args.push(`--registry=${registryOverride.trim()}`)
    return args
  }

  // If wildcard + no global registry but multiple scoped registries, fan out and merge.
  if (effective === '*' && !globalRegistry && scopedRegistries.length > 1) {
    const per = Math.max(10, Math.floor(limit / scopedRegistries.length))
    const all: unknown[] = []
    const errors: string[] = []
    for (const r of scopedRegistries) {
      const res = await runNpm(buildArgs(effective, per, r), {
        cwd: opts.cwd,
        settings: opts.settings,
        npmrc: opts.npmrc,
        forceRegistry: r,
        queryForRegistry: effective
      })
      if (res.exitCode !== 0 && !res.stdout.trim()) {
        errors.push(res.stderr || 'npm search failed')
        continue
      }
      try {
        const parsed = JSON.parse(res.stdout)
        if (Array.isArray(parsed)) all.push(...parsed)
      } catch {
        errors.push('Failed to parse npm search JSON output.')
      }
    }
    return { items: all, error: errors.length ? errors.join('\n') : null }
  }

  const registryOverride = resolveRegistryForQuery(opts.npmrc, effective)
  const res = await runNpm(buildArgs(effective, limit, registryOverride ?? undefined), {
    cwd: opts.cwd,
    settings: opts.settings,
    npmrc: opts.npmrc,
    queryForRegistry: effective,
    forceRegistry: registryOverride
  })
  if (res.exitCode !== 0 && !res.stdout.trim()) {
    return { items: [], error: res.stderr || 'npm search failed' }
  }
  try {
    const parsed = JSON.parse(res.stdout)
    if (Array.isArray(parsed)) return { items: parsed, error: null }
    if (parsed && typeof parsed === 'object' && 'error' in (parsed as any)) {
      const summary = (parsed as any)?.error?.summary
      return { items: [], error: summary || 'npm search failed' }
    }
    return { items: [], error: 'Unexpected npm search output.' }
  } catch {
    return { items: [], error: 'Failed to parse npm search JSON output.' }
  }
}
