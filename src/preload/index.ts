import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  IpcResult,
  LinkSyncResult,
  NpmrcConfig,
  PackageListItem,
  ProjectState
} from '../shared/types'

const api = {
  selectProjectDir: async (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke('project:selectDir'),
  selectDir: async (title: string): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke('dialog:selectDir', title),
  getSettings: async (): Promise<IpcResult<AppSettings>> => ipcRenderer.invoke('settings:get'),
  setSettings: async (patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke('settings:set', patch),
  getProjectState: async (projectDir: string | null): Promise<IpcResult<ProjectState>> =>
    ipcRenderer.invoke('project:getState', projectDir),
  searchRegistry: async (
    projectDir: string,
    query: string,
    limit: number
  ): Promise<IpcResult<PackageListItem[]>> =>
    ipcRenderer.invoke('registry:search', { projectDir, query, limit }),
  getPackageMetadata: async (
    projectDir: string,
    packageName: string
  ): Promise<IpcResult<{ metadata: any; log: any }>> =>
    ipcRenderer.invoke('package:metadata', { projectDir, packageName }),
  installPackage: async (
    projectDir: string,
    packageName: string,
    versionOrTag: string,
    dependencyKind: 'runtime' | 'dev'
  ): Promise<IpcResult<ProjectState>> =>
    ipcRenderer.invoke('package:install', { projectDir, packageName, versionOrTag, dependencyKind }),
  uninstallPackage: async (projectDir: string, packageName: string): Promise<IpcResult<ProjectState>> =>
    ipcRenderer.invoke('package:uninstall', { projectDir, packageName }),
  updatePackage: async (projectDir: string, packageName: string): Promise<IpcResult<ProjectState>> =>
    ipcRenderer.invoke('package:update', { projectDir, packageName }),
  syncLinks: async (projectDir: string): Promise<IpcResult<LinkSyncResult>> =>
    ipcRenderer.invoke('links:sync', { projectDir }),
  loadNpmrc: async (projectDir: string): Promise<IpcResult<NpmrcConfig>> =>
    ipcRenderer.invoke('npmrc:load', { projectDir }),
  saveNpmrc: async (projectDir: string, npmrc: NpmrcConfig): Promise<IpcResult<boolean>> =>
    ipcRenderer.invoke('npmrc:save', { projectDir, npmrc }),
  npmPing: async (
    projectDir: string
  ): Promise<IpcResult<{ cmd: string; exitCode: number; stdout: string; stderr: string }>> =>
    ipcRenderer.invoke('npm:ping', { projectDir })
}

contextBridge.exposeInMainWorld('upm', api)
