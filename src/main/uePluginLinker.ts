import fs from 'node:fs/promises'
import path from 'node:path'
import type { LinkSyncResult } from '../shared/types'
import { spawn } from 'node:child_process'

type LinkRecord = { pluginName: string; packageName: string; targetDir: string }

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

  const scanPackageDir = async (packageName: string, packageDir: string) => {
    try {
      const entries = await fs.readdir(packageDir, { withFileTypes: true })
      for (const ent of entries) {
        if (!ent.isFile()) continue
        if (!ent.name.toLowerCase().endsWith('.uplugin')) continue
        const pluginName = path.basename(ent.name, '.uplugin')
        if (!pluginName) continue
        out.push({ pluginName, packageName, targetDir: packageDir })
      }
    } catch {
      // ignore
    }
  }

  for (const ent of top) {
    if (!ent.isDirectory()) continue
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
        if (!pkgEnt.isDirectory()) continue
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
    await fs.cp(targetDir, linkPath, {
      recursive: true,
      force: true,
      filter: (p) => !p.includes(`${path.sep}node_modules${path.sep}`) && !p.includes(`${path.sep}.git${path.sep}`)
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
      if (!link && process.platform !== 'win32') {
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

