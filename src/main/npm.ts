import { spawn } from 'node:child_process'
import os from 'node:os'
import type { AppSettings, NpmrcConfig } from '../shared/types'

export type NpmCommandResult = {
  cmd: string
  exitCode: number
  stdout: string
  stderr: string
}

const uniq = (arr: string[]) => [...new Set(arr)]

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
    const child = spawn(npmPath, cmdArgs, {
      cwd: opts.cwd,
      env: process.env,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += String(d)))
    child.stderr.on('data', (d) => (stderr += String(d)))
    child.on('close', (code) => {
      resolve({ cmd, exitCode: typeof code === 'number' ? code : -1, stdout, stderr })
    })
    child.on('error', (err) => {
      resolve({ cmd, exitCode: -1, stdout, stderr: stderr + String(err) })
    })
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
