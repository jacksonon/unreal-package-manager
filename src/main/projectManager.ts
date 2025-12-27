import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AppSettings,
  DependencyKind,
  NpmrcConfig,
  PackageListItem,
  PackageMetadata,
  ProjectState
} from '../shared/types'
import { loadProjectNpmrc } from './npmrc'
import { getEffectiveNpmPath, npmSearchRemote, runNpm, type NpmCommandResult } from './npm'
import { syncUePluginLinks } from './uePluginLinker'

const UE_KEYWORDS = new Set([
  'unreal-plugin',
  'unreal-engine-plugin',
  'ue-plugin',
  'uplugin',
  'unreal-engine',
  'unrealengine',
  'ue4',
  'ue5'
])

const isUnrealKeyword = (kw: string) => UE_KEYWORDS.has(kw.toLowerCase())

const exists = async (p: string) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const findUproject = async (projectDir: string): Promise<string | null> => {
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true })
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.uproject')) return path.join(projectDir, e.name)
    }
  } catch {
    // ignore
  }
  return null
}

const readJson = async <T>(filePath: string): Promise<T> => JSON.parse(await fs.readFile(filePath, 'utf8')) as T

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const readProjectPackageJson = async (projectDir: string): Promise<{ items: PackageListItem[]; warnings: string[] }> => {
  const warnings: string[] = []
  const p = path.join(projectDir, 'package.json')
  if (!(await exists(p))) return { items: [], warnings: ['package.json 未找到（请在项目根目录创建或指定 working dir）'] }
  const root = await readJson<PackageJson>(p)

  const add = (deps: Record<string, string> | undefined, kind: DependencyKind, out: PackageListItem[]) => {
    for (const [name, range] of Object.entries(deps ?? {})) {
      out.push({
        name,
        displayName: name,
        requestedRange: range,
        dependencyKind: kind,
        status: 'missing'
      })
    }
  }

  const items: PackageListItem[] = []
  add(root.dependencies, 'runtime', items)
  add(root.devDependencies, 'dev', items)
  items.sort((a, b) => a.name.localeCompare(b.name))
  return { items, warnings }
}

const parseInstalledFromNpmLs = (stdout: string) => {
  const installed = new Map<string, { version?: string; missing?: boolean }>()
  const root = JSON.parse(stdout) as any
  const deps = root?.dependencies ?? {}
  for (const [name, dep] of Object.entries(deps)) {
    const version = (dep as any)?.version
    const missing = !!(dep as any)?.missing
    installed.set(name, { version, missing })
  }
  return installed
}

const parseOutdated = (stdout: string) => {
  const outdated = new Map<string, { current?: string; wanted?: string; latest?: string }>()
  const root = JSON.parse(stdout) as any
  for (const [name, v] of Object.entries(root ?? {})) {
    outdated.set(name, {
      current: (v as any)?.current,
      wanted: (v as any)?.wanted,
      latest: (v as any)?.latest
    })
  }
  return outdated
}

const packageDirInNodeModules = (projectDir: string, packageName: string) => {
  // scoped: @scope/name
  const parts = packageName.split('/')
  if (packageName.startsWith('@') && parts.length === 2) {
    return path.join(projectDir, 'node_modules', parts[0]!, parts[1]!)
  }
  return path.join(projectDir, 'node_modules', packageName)
}

const detectLocalUnrealPlugin = async (projectDir: string, packageName: string): Promise<boolean> => {
  const dir = packageDirInNodeModules(projectDir, packageName)
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.uplugin'))
  } catch {
    return false
  }
}

export const getProjectState = async (
  projectDir: string | null,
  settings: AppSettings
): Promise<ProjectState> => {
  const warnings: string[] = []
  const npmPath = getEffectiveNpmPath(settings)
  if (!projectDir) {
    return {
      projectDir: null,
      workingDir: null,
      isUnrealProject: false,
      npmPath,
      pluginsRootDir: null,
      npmrc: null,
      packages: [],
      warnings: ['请选择 Unreal 项目目录']
    }
  }

  if (!(await exists(projectDir))) {
    return {
      projectDir,
      workingDir: projectDir,
      isUnrealProject: false,
      npmPath,
      pluginsRootDir: settings.pluginsRootDirOverride ?? path.join(projectDir, 'Plugins'),
      npmrc: null,
      packages: [],
      warnings: [`项目目录不存在：${projectDir}`]
    }
  }

  const uproject = await findUproject(projectDir)
  if (!uproject) warnings.push('提示：未在该目录下找到 .uproject 文件（仍可管理 package.json & Plugins/）')

  const npmrc = await loadProjectNpmrc(projectDir)
  const pluginsRootDir = settings.pluginsRootDirOverride ?? path.join(projectDir, 'Plugins')

  const pkg = await readProjectPackageJson(projectDir)
  warnings.push(...pkg.warnings)

  let lsRes: NpmCommandResult | null = null
  let outdatedRes: NpmCommandResult | null = null

  if (await exists(path.join(projectDir, 'package.json'))) {
    lsRes = await runNpm(['ls', '--depth=0', '--json'], { cwd: projectDir, settings, npmrc })
    if (lsRes.exitCode !== 0 && !lsRes.stdout.trim()) {
      warnings.push(lsRes.stderr || 'npm ls failed')
    }

    outdatedRes = await runNpm(['outdated', '--json'], {
      cwd: projectDir,
      settings,
      npmrc,
      queryForRegistry: '*'
    })
    const t = outdatedRes.stdout.trim()
    // npm returns exit code 1 if outdated exists
    if (outdatedRes.exitCode !== 0 && outdatedRes.exitCode !== 1 && !t) {
      warnings.push(outdatedRes.stderr || 'npm outdated failed')
    }
  }

  const installed = (() => {
    try {
      return lsRes?.stdout?.trim() ? parseInstalledFromNpmLs(lsRes.stdout) : new Map()
    } catch {
      warnings.push('npm ls JSON 解析失败')
      return new Map()
    }
  })()

  const outdated = (() => {
    try {
      return outdatedRes?.stdout?.trim() ? parseOutdated(outdatedRes.stdout) : new Map()
    } catch {
      warnings.push('npm outdated JSON 解析失败')
      return new Map()
    }
  })()

  const packages: PackageListItem[] = []
  for (const item of pkg.items) {
    const inst = installed.get(item.name)
    const out = outdated.get(item.name)
    const installedVersion = inst?.version
    const isMissing = inst?.missing || (!installedVersion && item.requestedRange)

    const status: PackageListItem['status'] =
      out?.latest && installedVersion ? 'update_available' : isMissing ? 'missing' : 'installed'

    const isUe = await detectLocalUnrealPlugin(projectDir, item.name)

    packages.push({
      ...item,
      installedVersion,
      wantedVersion: out?.wanted ?? undefined,
      latestVersion: out?.latest ?? undefined,
      status,
      isUnrealPlugin: isUe || item.isUnrealPlugin
    })
  }

  return {
    projectDir,
    workingDir: projectDir,
    isUnrealProject: !!uproject,
    npmPath,
    pluginsRootDir,
    npmrc,
    packages,
    warnings,
    lastLog: lsRes ?? undefined
  }
}

export const searchRemotePackages = async (
  projectDir: string,
  query: string,
  limit: number,
  settings: AppSettings
) => {
  const npmrc = await loadProjectNpmrc(projectDir)
  const res = await npmSearchRemote(query, limit, { cwd: projectDir, settings, npmrc })
  if (res.error) throw new Error(res.error)

  const byName = new Map<string, PackageListItem>()
  for (const raw of res.items) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as any
    const name = String(o.name ?? '')
    if (!name) continue
    const keywords = Array.isArray(o.keywords) ? o.keywords.map(String) : undefined
    const isUnrealPlugin = !!keywords?.some((k: string) => isUnrealKeyword(k))
    byName.set(name, {
      name,
      displayName: o.displayName || o.DisplayName || name,
      description: o.description,
      keywords,
      isUnrealPlugin,
      latestVersion: o.version,
      status: 'remote'
    })
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
}

export const loadPackageMetadata = async (
  projectDir: string,
  packageName: string,
  settings: AppSettings
): Promise<{ metadata: PackageMetadata; log: NpmCommandResult }> => {
  const npmrc = await loadProjectNpmrc(projectDir)
  const fields = [
    'name',
    'displayName',
    'DisplayName',
    'version',
    'description',
    'author',
    'license',
    'engines',
    'category',
    'Category',
    'createdBy',
    'CreatedBy',
    'createdByURL',
    'CreatedByURL',
    'docsURL',
    'DocsURL',
    'marketplaceURL',
    'MarketplaceURL',
    'supportURL',
    'SupportURL',
    'enabledByDefault',
    'EnabledByDefault',
    'canContainContent',
    'CanContainContent',
    'isBetaVersion',
    'IsBetaVersion',
    'keywords',
    'homepage',
    'repository',
    'readme',
    'dist-tags',
    'versions',
    'time'
  ]

  const log = await runNpm(['view', packageName, ...fields, '--json'], {
    cwd: projectDir,
    settings,
    npmrc,
    queryForRegistry: packageName
  })
  if (log.exitCode !== 0 && !log.stdout.trim()) {
    throw new Error(log.stderr || 'npm view failed')
  }

  const root = JSON.parse(log.stdout) as any
  const repositoryUrl =
    typeof root?.repository === 'string'
      ? root.repository
      : typeof root?.repository?.url === 'string'
        ? root.repository.url
        : undefined

  const metadata: PackageMetadata = {
    name: root?.name ?? packageName,
    displayName: root?.displayName ?? root?.DisplayName,
    version: root?.version,
    description: root?.description,
    author: typeof root?.author === 'string' ? root.author : root?.author?.name,
    license: root?.license,
    keywords: root?.keywords,
    homepageUrl: root?.homepage,
    repositoryUrl,
    readme: root?.readme,
    distTags: root?.['dist-tags'],
    versions: root?.versions,
    time: root?.time,
    engines: root?.engines,
    category: root?.category ?? root?.Category,
    createdBy: root?.createdBy ?? root?.CreatedBy,
    createdByUrl: root?.createdByURL ?? root?.CreatedByURL,
    docsUrl: root?.docsURL ?? root?.DocsURL,
    marketplaceUrl: root?.marketplaceURL ?? root?.MarketplaceURL,
    supportUrl: root?.supportURL ?? root?.SupportURL,
    enabledByDefault: root?.enabledByDefault ?? root?.EnabledByDefault,
    canContainContent: root?.canContainContent ?? root?.CanContainContent,
    isBetaVersion: root?.isBetaVersion ?? root?.IsBetaVersion
  }
  return { metadata, log }
}

export const installPackage = async (
  projectDir: string,
  args: { packageName: string; versionOrTag: string; dependencyKind: DependencyKind },
  settings: AppSettings
) => {
  const npmrc = await loadProjectNpmrc(projectDir)
  const saveFlag = args.dependencyKind === 'dev' ? '--save-dev' : '--save'
  const spec = args.versionOrTag?.trim() ? `${args.packageName}@${args.versionOrTag.trim()}` : args.packageName
  const log = await runNpm(['install', spec, saveFlag], {
    cwd: projectDir,
    settings,
    npmrc,
    queryForRegistry: args.packageName
  })
  if (log.exitCode !== 0) throw new Error(log.stderr || 'npm install failed')

  let linkResult = null
  if (settings.autoLinkUnrealPlugins) {
    linkResult = await syncUePluginLinks(projectDir, settings.pluginsRootDirOverride ?? path.join(projectDir, 'Plugins'), settings.linkMode)
  }
  return { log, linkResult }
}

export const uninstallPackage = async (
  projectDir: string,
  args: { packageName: string },
  settings: AppSettings
) => {
  const npmrc = await loadProjectNpmrc(projectDir)
  const log = await runNpm(['uninstall', args.packageName], {
    cwd: projectDir,
    settings,
    npmrc,
    queryForRegistry: args.packageName
  })
  if (log.exitCode !== 0) throw new Error(log.stderr || 'npm uninstall failed')

  let linkResult = null
  if (settings.autoLinkUnrealPlugins) {
    linkResult = await syncUePluginLinks(projectDir, settings.pluginsRootDirOverride ?? path.join(projectDir, 'Plugins'), settings.linkMode)
  }
  return { log, linkResult }
}

export const updatePackage = async (
  projectDir: string,
  args: { packageName: string },
  settings: AppSettings
) => {
  const npmrc = await loadProjectNpmrc(projectDir)
  const log = await runNpm(['install', `${args.packageName}@latest`], {
    cwd: projectDir,
    settings,
    npmrc,
    queryForRegistry: args.packageName
  })
  if (log.exitCode !== 0) throw new Error(log.stderr || 'npm update failed')

  let linkResult = null
  if (settings.autoLinkUnrealPlugins) {
    linkResult = await syncUePluginLinks(projectDir, settings.pluginsRootDirOverride ?? path.join(projectDir, 'Plugins'), settings.linkMode)
  }
  return { log, linkResult }
}

export const syncLinks = async (projectDir: string, settings: AppSettings) => {
  return syncUePluginLinks(
    projectDir,
    settings.pluginsRootDirOverride ?? path.join(projectDir, 'Plugins'),
    settings.linkMode
  )
}
