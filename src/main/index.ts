import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'node:path'
import { getPluginState, installPlugin, uninstallPlugin, upgradePlugin } from './pluginManager'
import type { IpcResult, PluginState } from '../shared/types'

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'Unreal Package Manager',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
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
  ipcMain.handle('project:selectDir', async (): Promise<IpcResult<string | null>> => {
    const res = await dialog.showOpenDialog({
      title: '选择 Unreal 项目文件夹（包含 .uproject 的目录）',
      properties: ['openDirectory']
    })
    if (res.canceled) return { ok: true, data: null }
    return { ok: true, data: res.filePaths[0] ?? null }
  })

  ipcMain.handle(
    'plugins:getState',
    async (_evt, projectDir: string | null): Promise<IpcResult<PluginState>> => {
      try {
        return { ok: true, data: await getPluginState(projectDir) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'plugins:install',
    async (_evt, args: { projectDir: string; pluginId: string }): Promise<IpcResult<PluginState>> => {
      try {
        await installPlugin(args.projectDir, args.pluginId)
        return { ok: true, data: await getPluginState(args.projectDir) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'plugins:uninstall',
    async (_evt, args: { projectDir: string; pluginId: string }): Promise<IpcResult<PluginState>> => {
      try {
        await uninstallPlugin(args.projectDir, args.pluginId)
        return { ok: true, data: await getPluginState(args.projectDir) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'plugins:upgrade',
    async (_evt, args: { projectDir: string; pluginId: string }): Promise<IpcResult<PluginState>> => {
      try {
        await upgradePlugin(args.projectDir, args.pluginId)
        return { ok: true, data: await getPluginState(args.projectDir) }
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
