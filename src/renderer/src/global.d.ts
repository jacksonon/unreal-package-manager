import type {
  AppSettings,
  IpcResult,
  LinkSyncResult,
  NpmrcConfig,
  PackageListItem,
  ProjectState
} from '@shared/types'

declare global {
  interface Window {
    upm: {
      selectProjectDir(): Promise<IpcResult<string | null>>
      selectDir(title: string): Promise<IpcResult<string | null>>
      getSettings(): Promise<IpcResult<AppSettings>>
      setSettings(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>
      getProjectState(projectDir: string | null): Promise<IpcResult<ProjectState>>
      searchRegistry(projectDir: string, query: string, limit: number): Promise<IpcResult<PackageListItem[]>>
      getPackageMetadata(
        projectDir: string,
        packageName: string
      ): Promise<IpcResult<{ metadata: any; log: any }>>
      installPackage(
        projectDir: string,
        packageName: string,
        versionOrTag: string,
        dependencyKind: 'runtime' | 'dev'
      ): Promise<IpcResult<ProjectState>>
      uninstallPackage(projectDir: string, packageName: string): Promise<IpcResult<ProjectState>>
      updatePackage(projectDir: string, packageName: string): Promise<IpcResult<ProjectState>>
      syncLinks(projectDir: string): Promise<IpcResult<LinkSyncResult>>
      loadNpmrc(projectDir: string): Promise<IpcResult<NpmrcConfig>>
      saveNpmrc(projectDir: string, npmrc: NpmrcConfig): Promise<IpcResult<boolean>>
    }
  }
}

export {}
