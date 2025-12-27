import type { UiLanguage } from './i18n'

export type DependencyKind = 'runtime' | 'dev'

export type NpmrcConfig = {
  values: Record<string, string>
  scopedRegistries: Record<string, string>
}

export type PackageListItem = {
  name: string
  displayName?: string
  description?: string
  keywords?: string[]
  isUnrealPlugin?: boolean

  requestedRange?: string
  dependencyKind?: DependencyKind

  installedVersion?: string
  wantedVersion?: string
  latestVersion?: string

  status: 'remote' | 'installed' | 'update_available' | 'missing'
}

export type PackageMetadata = {
  name: string
  displayName?: string
  version?: string
  description?: string
  author?: string
  license?: string
  keywords?: string[]
  homepageUrl?: string
  repositoryUrl?: string
  readme?: string

  distTags?: Record<string, string>
  versions?: string[]
  time?: Record<string, string>

  engines?: Record<string, string>
  category?: string
  createdBy?: string
  createdByUrl?: string
  docsUrl?: string
  marketplaceUrl?: string
  supportUrl?: string

  enabledByDefault?: boolean
  canContainContent?: boolean
  isBetaVersion?: boolean
}

export type LinkSyncResult = {
  ok: boolean
  linked: Array<{ pluginName: string; packageName: string; targetDir: string }>
  removed: Array<{ pluginName: string; packageName: string; targetDir: string }>
  warnings: string[]
  error?: string
}

export type ProjectState = {
  projectDir: string | null
  workingDir: string | null
  isUnrealProject: boolean
  npmPath: string
  pluginsRootDir: string | null
  npmrc: NpmrcConfig | null
  packages: PackageListItem[]
  warnings: string[]
  lastLog?: { cmd: string; exitCode: number; stdout: string; stderr: string }
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type AppSettings = {
  npmExecutablePath: string | null
  pluginsRootDirOverride: string | null
  autoLinkUnrealPlugins: boolean
  linkMode: 'auto' | 'copy'
  theme: 'system' | 'dark' | 'light'
  uiLanguage: UiLanguage
  ueOnlyFilter: boolean
  showLogDock: boolean
}
