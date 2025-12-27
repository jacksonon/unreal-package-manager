import type { IpcResult, PluginState } from '@shared/types'

declare global {
  interface Window {
    upm: {
      selectProjectDir(): Promise<IpcResult<string | null>>
      getState(projectDir: string | null): Promise<IpcResult<PluginState>>
      install(projectDir: string, pluginId: string): Promise<IpcResult<PluginState>>
      uninstall(projectDir: string, pluginId: string): Promise<IpcResult<PluginState>>
      upgrade(projectDir: string, pluginId: string): Promise<IpcResult<PluginState>>
    }
  }
}

export {}

