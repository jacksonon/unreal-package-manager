export type PluginId = string

export type AvailablePlugin = {
  id: PluginId
  friendlyName: string
  description?: string
  versionName?: string
  sourceDir: string
  upluginPath: string
}

export type InstalledPlugin = {
  id: PluginId
  friendlyName: string
  description?: string
  versionName?: string
  installDir: string
  upluginPath: string
}

export type PluginRow = {
  id: PluginId
  friendlyName: string
  description?: string
  installedVersion?: string
  availableVersion?: string
  status:
    | 'available'
    | 'installed'
    | 'update_available'
    | 'installed_external'
  sourceDir?: string
  installDir?: string
}

export type PluginState = {
  projectDir: string | null
  packagesDir: string
  plugins: PluginRow[]
  warnings: string[]
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

