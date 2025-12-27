import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { app } from 'electron'
import type { AvailablePlugin, InstalledPlugin, PluginRow, PluginState } from '../shared/types'

const exists = async (p: string) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

const sanitizeDirName = (value: string) => value.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, '_')

type UPlugin = {
  FriendlyName?: string
  Description?: string
  VersionName?: string
  Version?: number
  Modules?: Array<{ Name?: string }>
}

const pluginIdFromUplugin = (uplugin: UPlugin, upluginPath: string) => {
  const moduleName = uplugin.Modules?.[0]?.Name?.trim()
  if (moduleName) return moduleName
  return path.basename(upluginPath, '.uplugin')
}

const findUpluginFiles = async (rootDir: string, maxDepth: number): Promise<string[]> => {
  const results: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break
    const { dir, depth } = item

    let entries: Dirent[]
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as Dirent[]
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'Intermediate') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.uplugin')) {
        results.push(fullPath)
      } else if (entry.isDirectory() && depth < maxDepth) {
        queue.push({ dir: fullPath, depth: depth + 1 })
      }
    }
  }

  return results
}

const resolvePackagesDir = async (): Promise<{ packagesDir: string; warnings: string[] }> => {
  const warnings: string[] = []
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, 'packages')
    if (!(await exists(packaged))) warnings.push(`未找到内置 packages 目录：${packaged}`)
    return { packagesDir: packaged, warnings }
  }

  const candidates = [
    path.resolve(process.cwd(), '..', 'package'),
    path.resolve(app.getAppPath(), '..', 'package')
  ]
  for (const c of candidates) {
    if (await exists(c)) return { packagesDir: c, warnings }
  }

  warnings.push(`未找到 package/ 目录（已尝试：${candidates.join(', ')}）`)
  return { packagesDir: candidates[0]!, warnings }
}

const listAvailablePlugins = async (packagesDir: string): Promise<AvailablePlugin[]> => {
  if (!(await exists(packagesDir))) return []
  const upluginFiles = await findUpluginFiles(packagesDir, 2)

  const byId = new Map<string, AvailablePlugin>()
  for (const upluginPath of upluginFiles) {
    const uplugin = await readJsonFile<UPlugin>(upluginPath)
    const id = pluginIdFromUplugin(uplugin, upluginPath)
    const plugin: AvailablePlugin = {
      id,
      friendlyName: uplugin.FriendlyName?.trim() || id,
      description: uplugin.Description,
      versionName: uplugin.VersionName ?? (typeof uplugin.Version === 'number' ? String(uplugin.Version) : undefined),
      sourceDir: path.dirname(upluginPath),
      upluginPath
    }

    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, plugin)
      continue
    }

    const a = semver.coerce(existing.versionName ?? '')
    const b = semver.coerce(plugin.versionName ?? '')
    if (a && b) {
      if (semver.gt(b, a)) byId.set(id, plugin)
    } else if ((plugin.versionName ?? '') > (existing.versionName ?? '')) {
      byId.set(id, plugin)
    }
  }

  return [...byId.values()].sort((l, r) => l.id.localeCompare(r.id))
}

const listInstalledPlugins = async (projectDir: string): Promise<InstalledPlugin[]> => {
  const pluginsDir = path.join(projectDir, 'Plugins')
  if (!(await exists(pluginsDir))) return []

  const upluginFiles = await findUpluginFiles(pluginsDir, 3)
  const byId = new Map<string, InstalledPlugin>()

  for (const upluginPath of upluginFiles) {
    const uplugin = await readJsonFile<UPlugin>(upluginPath)
    const id = pluginIdFromUplugin(uplugin, upluginPath)
    const plugin: InstalledPlugin = {
      id,
      friendlyName: uplugin.FriendlyName?.trim() || id,
      description: uplugin.Description,
      versionName: uplugin.VersionName ?? (typeof uplugin.Version === 'number' ? String(uplugin.Version) : undefined),
      installDir: path.dirname(upluginPath),
      upluginPath
    }
    if (!byId.has(id)) byId.set(id, plugin)
  }

  return [...byId.values()].sort((l, r) => l.id.localeCompare(r.id))
}

export const getPluginState = async (projectDir: string | null): Promise<PluginState> => {
  const { packagesDir, warnings } = await resolvePackagesDir()
  const available = await listAvailablePlugins(packagesDir)
  const installed = projectDir ? await listInstalledPlugins(projectDir) : []

  const rows = new Map<string, PluginRow>()

  for (const a of available) {
    rows.set(a.id, {
      id: a.id,
      friendlyName: a.friendlyName,
      description: a.description,
      availableVersion: a.versionName,
      status: 'available',
      sourceDir: a.sourceDir
    })
  }

  for (const i of installed) {
    const existing = rows.get(i.id)
    const base: PluginRow = existing ?? {
      id: i.id,
      friendlyName: i.friendlyName,
      description: i.description,
      status: 'installed_external'
    }

    base.installedVersion = i.versionName
    base.installDir = i.installDir

    if (existing?.availableVersion && i.versionName) {
      const a = semver.coerce(existing.availableVersion)
      const b = semver.coerce(i.versionName)
      if (a && b && semver.gt(a, b)) base.status = 'update_available'
      else base.status = 'installed'
    } else if (existing) {
      base.status = 'installed'
    }

    rows.set(i.id, base)
  }

  if (projectDir) {
    const uproject = await findUproject(projectDir)
    if (!uproject) warnings.push('提示：未在该目录下找到 .uproject 文件（仍可管理 Plugins/）')
  }

  return {
    projectDir,
    packagesDir,
    plugins: [...rows.values()].sort((l, r) => l.id.localeCompare(r.id)),
    warnings
  }
}

const findUproject = async (projectDir: string): Promise<string | null> => {
  try {
    const entries = (await fs.readdir(projectDir, { withFileTypes: true })) as unknown as Dirent[]
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.uproject')) {
        return path.join(projectDir, entry.name)
      }
    }
  } catch {
    // ignore
  }
  return null
}

const copyDir = async (fromDir: string, toDir: string) => {
  await fs.mkdir(toDir, { recursive: true })
  const entries = await fs.readdir(fromDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'Intermediate') continue
    const src = path.join(fromDir, entry.name)
    const dst = path.join(toDir, entry.name)
    if (entry.isDirectory()) {
      await copyDir(src, dst)
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst)
    }
  }
}

const assertProjectDir = async (projectDir: string) => {
  if (!projectDir?.trim()) throw new Error('projectDir 不能为空')
  if (!(await exists(projectDir))) throw new Error(`项目目录不存在：${projectDir}`)
}

export const installPlugin = async (projectDir: string, pluginId: string) => {
  await assertProjectDir(projectDir)
  const { packagesDir } = await resolvePackagesDir()
  const available = await listAvailablePlugins(packagesDir)
  const plugin = available.find((p) => p.id === pluginId)
  if (!plugin) throw new Error(`未在 packages 中找到插件：${pluginId}`)

  const pluginsDir = path.join(projectDir, 'Plugins')
  await fs.mkdir(pluginsDir, { recursive: true })

  const destDir = path.join(pluginsDir, sanitizeDirName(pluginId))
  if (await exists(destDir)) throw new Error(`插件已存在：${destDir}`)

  await copyDir(plugin.sourceDir, destDir)
}

export const uninstallPlugin = async (projectDir: string, pluginId: string) => {
  await assertProjectDir(projectDir)
  const installed = await listInstalledPlugins(projectDir)
  const found = installed.find((p) => p.id === pluginId)
  const destDir = found?.installDir ?? path.join(projectDir, 'Plugins', sanitizeDirName(pluginId))
  if (!(await exists(destDir))) throw new Error(`未找到已安装插件目录：${destDir}`)
  await fs.rm(destDir, { recursive: true, force: true })
}

export const upgradePlugin = async (projectDir: string, pluginId: string) => {
  await assertProjectDir(projectDir)
  const installed = await listInstalledPlugins(projectDir)
  const found = installed.find((p) => p.id === pluginId)
  const destDir = found?.installDir ?? path.join(projectDir, 'Plugins', sanitizeDirName(pluginId))
  if (await exists(destDir)) await fs.rm(destDir, { recursive: true, force: true })
  await installPlugin(projectDir, pluginId)
}
