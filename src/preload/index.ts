import { contextBridge, ipcRenderer } from 'electron'
import type { IpcResult, PluginState } from '../shared/types'

const api = {
  selectProjectDir: async (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke('project:selectDir'),
  getState: async (projectDir: string | null): Promise<IpcResult<PluginState>> =>
    ipcRenderer.invoke('plugins:getState', projectDir),
  install: async (projectDir: string, pluginId: string): Promise<IpcResult<PluginState>> =>
    ipcRenderer.invoke('plugins:install', { projectDir, pluginId }),
  uninstall: async (projectDir: string, pluginId: string): Promise<IpcResult<PluginState>> =>
    ipcRenderer.invoke('plugins:uninstall', { projectDir, pluginId }),
  upgrade: async (projectDir: string, pluginId: string): Promise<IpcResult<PluginState>> =>
    ipcRenderer.invoke('plugins:upgrade', { projectDir, pluginId })
}

contextBridge.exposeInMainWorld('upm', api)

