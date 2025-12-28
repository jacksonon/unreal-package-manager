import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
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
import { createTranslator, resolveLanguage } from '../shared/i18n'

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Unreal Package Manager',
    ...(process.platform === 'darwin'
      ? ({
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 14 }
        } as const)
      : {}),
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

  const tMain = () => {
    const locales = [app.getLocale(), ...(app.getPreferredSystemLanguages?.() ?? [])].filter(Boolean)
    const lang = resolveLanguage(settings.uiLanguage, locales)
    return createTranslator(lang)
  }

  ipcMain.handle('project:selectDir', async (): Promise<IpcResult<string | null>> => {
    const t = tMain()
    const res = await dialog.showOpenDialog({
      title: t('dialogs.selectProject.title'),
      properties: ['openDirectory']
    })
    if (res.canceled) return { ok: true, data: null }
    return { ok: true, data: res.filePaths[0] ?? null }
  })

  ipcMain.handle(
    'dialog:selectDir',
    async (_evt, title: string): Promise<IpcResult<string | null>> => {
      const t = tMain()
      const res = await dialog.showOpenDialog({
        title: title || t('dialogs.selectDir.title'),
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
          linkMode: patch.linkMode ?? settings.linkMode,
          theme: patch.theme ?? settings.theme,
          uiLanguage: patch.uiLanguage ?? settings.uiLanguage,
          rememberRecentProjects: patch.rememberRecentProjects ?? settings.rememberRecentProjects,
          ueOnlyFilter: patch.ueOnlyFilter ?? settings.ueOnlyFilter,
          showLogDock: patch.showLogDock ?? settings.showLogDock
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
        return { ok: true, data: await getProjectState(projectDir, settings, tMain()) }
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
        const { log, linkResult } = await installPackage(
          args.projectDir,
          { packageName: args.packageName, versionOrTag: args.versionOrTag, dependencyKind: args.dependencyKind },
          settings
        )
        const state = await getProjectState(args.projectDir, settings, tMain())
        state.lastLog = log
        if (linkResult?.warnings?.length) state.warnings.push(...linkResult.warnings)
        if (linkResult?.error) state.warnings.push(linkResult.error)
        return { ok: true, data: state }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'package:uninstall',
    async (_evt, args: { projectDir: string; packageName: string }): Promise<IpcResult<ProjectState>> => {
      try {
        const { log, linkResult } = await uninstallPackage(args.projectDir, { packageName: args.packageName }, settings)
        const state = await getProjectState(args.projectDir, settings, tMain())
        state.lastLog = log
        if (linkResult?.warnings?.length) state.warnings.push(...linkResult.warnings)
        if (linkResult?.error) state.warnings.push(linkResult.error)
        return { ok: true, data: state }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'package:update',
    async (_evt, args: { projectDir: string; packageName: string }): Promise<IpcResult<ProjectState>> => {
      try {
        const { log, linkResult } = await updatePackage(args.projectDir, { packageName: args.packageName }, settings)
        const state = await getProjectState(args.projectDir, settings, tMain())
        state.lastLog = log
        if (linkResult?.warnings?.length) state.warnings.push(...linkResult.warnings)
        if (linkResult?.error) state.warnings.push(linkResult.error)
        return { ok: true, data: state }
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

  ipcMain.handle('shell:openExternal', async (_evt, url: string): Promise<IpcResult<boolean>> => {
    try {
      const u = new URL(String(url))
      if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') {
        return { ok: false, error: `Unsupported URL protocol: ${u.protocol}` }
      }
      await shell.openExternal(u.toString())
      return { ok: true, data: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

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
