import fs from 'node:fs/promises'
import path from 'node:path'
import type { LinkSyncResult } from '../shared/types'
import { spawn } from 'node:child_process'

type LinkRecord = { pluginName: string; packageName: string; targetDir: string }

const UPLUGIN_EXT = '.uplugin'

const pluginNameFromUpluginFilename = (filename: string) => {
  const lower = filename.toLowerCase()
  if (!lower.endsWith(UPLUGIN_EXT)) return null
  // Use the original filename's length to handle case variants like ".UPLUGIN".
  return filename.slice(0, filename.length - UPLUGIN_EXT.length)
}

const manifestPathForDestination = (destinationDir: string) =>
  path.join(destinationDir, '.uenpmmanager_links.json')

const exists = async (p: string) => {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

const isSymlink = async (p: string) => {
  try {
    const st = await fs.lstat(p)
    return st.isSymbolicLink()
  } catch {
    return false
  }
}

const loadManifest = async (manifestPath: string): Promise<Map<string, LinkRecord>> => {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as { links?: LinkRecord[] }
    const map = new Map<string, LinkRecord>()
    for (const rec of parsed.links ?? []) {
      if (rec?.pluginName) map.set(rec.pluginName, rec)
    }
    return map
  } catch {
    return new Map()
  }
}

const saveManifest = async (manifestPath: string, records: LinkRecord[]) => {
  const out = JSON.stringify({ links: records }, null, 2)
  await fs.writeFile(manifestPath, out, 'utf8')
}

const findPluginsInNodeModules = async (workDir: string): Promise<LinkRecord[]> => {
  const nodeModulesDir = path.join(workDir, 'node_modules')
  if (!(await exists(nodeModulesDir))) return []

  const out: LinkRecord[] = []
  const top = await fs.readdir(nodeModulesDir, { withFileTypes: true })

  const isDirectory = async (p: string) => {
    try {
      // Follow symlinks/junctions (common with pnpm / npm link).
      const st = await fs.stat(p)
      return st.isDirectory()
    } catch {
      return false
    }
  }

  const findPluginsInPackageDir = async (packageDir: string) => {
    const found: Array<{ pluginName: string; targetDir: string }> = []
    const byName = new Set<string>()

    const addFromDir = async (dir: string) => {
      let entries: Array<import('node:fs').Dirent>
      try {
        entries = (await fs.readdir(dir, { withFileTypes: true })) as any
      } catch {
        return
      }
      for (const ent of entries) {
        if (!ent.isFile()) continue
        const pluginName = pluginNameFromUpluginFilename(ent.name)
        if (!pluginName || byName.has(pluginName)) continue
        byName.add(pluginName)
        found.push({ pluginName, targetDir: dir })
      }
    }

    // common: package root contains <Plugin>.uplugin
    await addFromDir(packageDir)

    // common: package contains Plugins/<Plugin>/<Plugin>.uplugin
    const pluginsDir = path.join(packageDir, 'Plugins')
    if (await isDirectory(pluginsDir)) {
      await addFromDir(pluginsDir)
      let entries: Array<import('node:fs').Dirent>
      try {
        entries = (await fs.readdir(pluginsDir, { withFileTypes: true })) as any
      } catch {
        entries = []
      }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        if (ent.name.startsWith('.')) continue
        await addFromDir(path.join(pluginsDir, ent.name))
      }
    }

    if (found.length) return found

    // fallback: limited recursive scan for nested .uplugin
    const maxDepth = 6
    const stack: Array<{ dir: string; depth: number }> = [{ dir: packageDir, depth: 0 }]
    while (stack.length) {
      const next = stack.pop()
      if (!next) break
      if (next.depth > maxDepth) continue
      let entries: Array<import('node:fs').Dirent>
      try {
        entries = (await fs.readdir(next.dir, { withFileTypes: true })) as any
      } catch {
        continue
      }
      for (const ent of entries) {
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === '.git') continue
          if (ent.name.startsWith('.')) continue
          stack.push({ dir: path.join(next.dir, ent.name), depth: next.depth + 1 })
          continue
        }
        if (!ent.isFile()) continue
        const pluginName = pluginNameFromUpluginFilename(ent.name)
        if (!pluginName || byName.has(pluginName)) continue
        byName.add(pluginName)
        found.push({ pluginName, targetDir: next.dir })
      }
    }

    return found
  }

  const scanPackageDir = async (packageName: string, packageDir: string) => {
    try {
      const plugins = await findPluginsInPackageDir(packageDir)
      for (const p of plugins) out.push({ pluginName: p.pluginName, packageName, targetDir: p.targetDir })
    } catch {
      // ignore
    }
  }

  for (const ent of top) {
    if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
    if (ent.name.startsWith('.')) continue
    if (ent.name.startsWith('@')) {
      const scopeDir = path.join(nodeModulesDir, ent.name)
      let scoped: Array<import('node:fs').Dirent>
      try {
        scoped = (await fs.readdir(scopeDir, { withFileTypes: true })) as any
      } catch {
        continue
      }
      for (const pkgEnt of scoped) {
        if (!pkgEnt.isDirectory() && !pkgEnt.isSymbolicLink()) continue
        if (pkgEnt.name.startsWith('.')) continue
        const pkgName = `${ent.name}/${pkgEnt.name}`
        await scanPackageDir(pkgName, path.join(scopeDir, pkgEnt.name))
      }
    } else {
      await scanPackageDir(ent.name, path.join(nodeModulesDir, ent.name))
    }
  }

  return out
}

const removeLinkDir = async (linkPath: string) => {
  // On Windows junction removal requires rmdir; fs.rm works for junction directories too.
  await fs.rm(linkPath, { recursive: true, force: true })
}

const createLinkToDirectory = async (linkPath: string, targetDir: string, mode: 'auto' | 'copy') => {
  if (await exists(linkPath)) {
    // allow replacing only if it is a link
    const link = await isSymlink(linkPath)
    if (link) await removeLinkDir(linkPath)
    else throw new Error('Destination path already exists and is not a link.')
  }

  await fs.mkdir(path.dirname(linkPath), { recursive: true })

  if (mode === 'copy') {
    // Filter based on destination path so it stays correct even when the source
    // is a symlink/junction and fs.cp dereferences to a different real path.
    const shouldCopy = (_srcPath: string, destPath: string) => {
      const rel = path.relative(linkPath, destPath)
      if (!rel || rel === '.') return true
      const parts = rel.split(path.sep)
      return !parts.includes('node_modules') && !parts.includes('.git')
    }
    await fs.cp(targetDir, linkPath, {
      recursive: true,
      force: true,
      dereference: true,
      filter: (src, dest) => shouldCopy(src, dest)
    })
    return
  }

  if (process.platform === 'win32') {
    // Use mklink /J for junction (no admin needed like symlink).
    await new Promise<void>((resolve, reject) => {
      const child = spawn('cmd.exe', ['/C', 'mklink', '/J', linkPath, targetDir], {
        windowsHide: true
      })
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`mklink failed (exit code ${code ?? -1}).`))
      })
      child.on('error', reject)
    })
    return
  }

  await fs.symlink(targetDir, linkPath)
}

export const syncUePluginLinks = async (
  workDir: string,
  destinationDir: string,
  mode: 'auto' | 'copy'
): Promise<LinkSyncResult> => {
  const result: LinkSyncResult = { ok: false, linked: [], removed: [], warnings: [] }

  const destFull = path.resolve(destinationDir)
  const manifestPath = manifestPathForDestination(destFull)
  const discovered = await findPluginsInNodeModules(workDir)

  const hasManifest = await exists(manifestPath)
  if (discovered.length === 0 && !hasManifest) {
    result.ok = true
    return result
  }

  await fs.mkdir(destFull, { recursive: true })
  const managed = await loadManifest(manifestPath)

  const desiredByPlugin = new Map<string, LinkRecord>()
  for (const rec of discovered) {
    if (desiredByPlugin.has(rec.pluginName)) {
      result.warnings.push(`Multiple packages provide plugin '${rec.pluginName}'; keeping the first one.`)
      continue
    }
    desiredByPlugin.set(rec.pluginName, rec)
  }

  for (const [pluginName, rec] of managed) {
    if (desiredByPlugin.has(pluginName)) continue
    const linkPath = path.join(destFull, pluginName)
    if (await exists(linkPath)) {
      const link = await isSymlink(linkPath)
      if (!link && mode !== 'copy' && process.platform !== 'win32') {
        result.warnings.push(`Managed link '${linkPath}' exists but is not a link (manifest entry removed).`)
        result.removed.push(rec)
        continue
      }
      try {
        await removeLinkDir(linkPath)
      } catch (e) {
        result.warnings.push(`Failed to remove link '${linkPath}': ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
    }
    result.removed.push(rec)
  }

  const newManaged = new Map(managed)
  for (const [pluginName, desired] of desiredByPlugin) {
    const linkPath = path.join(destFull, pluginName)
    const alreadyManaged = managed.has(pluginName)
    if (await exists(linkPath)) {
      if (alreadyManaged) {
        // Replace managed link if needed.
        await removeLinkDir(linkPath)
      } else {
        result.warnings.push(`Skipping '${linkPath}' because it exists (not managed).`)
        continue
      }
    }
    try {
      await createLinkToDirectory(linkPath, desired.targetDir, mode)
      newManaged.set(pluginName, desired)
      result.linked.push(desired)
    } catch (e) {
      result.warnings.push(`Failed to create link '${linkPath}': ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  await saveManifest(manifestPath, [...newManaged.values()])
  result.ok = true
  return result
}
