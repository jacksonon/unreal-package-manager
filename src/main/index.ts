import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { loadSettings, saveSettings } from './settings'
import { loadProjectNpmrc, saveProjectNpmrc } from './npmrc'
import {
  getProjectState,
  installPackage,
  loadPackageMetadata,
  searchRemotePackages,
  syncLinks,
  uninstallPackage,
  updatePackage
} from './projectManager'
import { runNpm } from './npm'
import type {
  AppSettings,
  IpcResult,
  LinkSyncResult,
  NpmrcConfig,
  PackageListItem,
  ProjectState
} from '../shared/types'

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Unreal Package Manager',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    await win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  let settings: AppSettings = await loadSettings()

  ipcMain.handle('project:selectDir', async (): Promise<IpcResult<string | null>> => {
    const res = await dialog.showOpenDialog({
      title: '选择 Unreal 项目文件夹（包含 .uproject 的目录）',
      properties: ['openDirectory']
    })
    if (res.canceled) return { ok: true, data: null }
    return { ok: true, data: res.filePaths[0] ?? null }
  })

  ipcMain.handle(
    'dialog:selectDir',
    async (_evt, title: string): Promise<IpcResult<string | null>> => {
      const res = await dialog.showOpenDialog({
        title: title || '选择文件夹',
        properties: ['openDirectory']
      })
      if (res.canceled) return { ok: true, data: null }
      return { ok: true, data: res.filePaths[0] ?? null }
    }
  )

  ipcMain.handle('settings:get', async (): Promise<IpcResult<AppSettings>> => {
    return { ok: true, data: settings }
  })

  ipcMain.handle(
    'settings:set',
    async (_evt, patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> => {
      try {
        settings = {
          npmExecutablePath: patch.npmExecutablePath ?? settings.npmExecutablePath,
          pluginsRootDirOverride: patch.pluginsRootDirOverride ?? settings.pluginsRootDirOverride,
          autoLinkUnrealPlugins: patch.autoLinkUnrealPlugins ?? settings.autoLinkUnrealPlugins,
          linkMode: patch.linkMode ?? settings.linkMode
        }
        await saveSettings(settings)
        return { ok: true, data: settings }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'project:getState',
    async (_evt, projectDir: string | null): Promise<IpcResult<ProjectState>> => {
      try {
        return { ok: true, data: await getProjectState(projectDir, settings) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'registry:search',
    async (
      _evt,
      args: { projectDir: string; query: string; limit: number }
    ): Promise<IpcResult<PackageListItem[]>> => {
      try {
        return {
          ok: true,
          data: await searchRemotePackages(args.projectDir, args.query, args.limit, settings)
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'package:metadata',
    async (
      _evt,
      args: { projectDir: string; packageName: string }
    ): Promise<IpcResult<{ metadata: any; log: any }>> => {
      try {
        return { ok: true, data: await loadPackageMetadata(args.projectDir, args.packageName, settings) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'package:install',
    async (
      _evt,
      args: { projectDir: string; packageName: string; versionOrTag: string; dependencyKind: 'runtime' | 'dev' }
    ): Promise<IpcResult<ProjectState>> => {
      try {
        await installPackage(
          args.projectDir,
          { packageName: args.packageName, versionOrTag: args.versionOrTag, dependencyKind: args.dependencyKind },
          settings
        )
        return { ok: true, data: await getProjectState(args.projectDir, settings) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'package:uninstall',
    async (_evt, args: { projectDir: string; packageName: string }): Promise<IpcResult<ProjectState>> => {
      try {
        await uninstallPackage(args.projectDir, { packageName: args.packageName }, settings)
        return { ok: true, data: await getProjectState(args.projectDir, settings) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'package:update',
    async (_evt, args: { projectDir: string; packageName: string }): Promise<IpcResult<ProjectState>> => {
      try {
        await updatePackage(args.projectDir, { packageName: args.packageName }, settings)
        return { ok: true, data: await getProjectState(args.projectDir, settings) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'links:sync',
    async (_evt, args: { projectDir: string }): Promise<IpcResult<LinkSyncResult>> => {
      try {
        return { ok: true, data: await syncLinks(args.projectDir, settings) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'npmrc:load',
    async (_evt, args: { projectDir: string }): Promise<IpcResult<NpmrcConfig>> => {
      try {
        return { ok: true, data: await loadProjectNpmrc(args.projectDir) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'npmrc:save',
    async (_evt, args: { projectDir: string; npmrc: NpmrcConfig }): Promise<IpcResult<boolean>> => {
      try {
        await saveProjectNpmrc(args.projectDir, args.npmrc)
        return { ok: true, data: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'npm:ping',
    async (_evt, args: { projectDir: string }): Promise<IpcResult<{ cmd: string; exitCode: number; stdout: string; stderr: string }>> => {
      try {
        const npmrc = await loadProjectNpmrc(args.projectDir)
        const res = await runNpm(['ping'], { cwd: args.projectDir, settings, npmrc, queryForRegistry: '*' })
        return { ok: true, data: res }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
