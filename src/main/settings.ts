import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { AppSettings } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  npmExecutablePath: null,
  pluginsRootDirOverride: null,
  autoLinkUnrealPlugins: true,
  linkMode: 'auto'
}

const settingsFilePath = () => path.join(app.getPath('userData'), 'settings.json')

export const loadSettings = async (): Promise<AppSettings> => {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      npmExecutablePath: parsed.npmExecutablePath ?? null,
      pluginsRootDirOverride: parsed.pluginsRootDirOverride ?? null,
      autoLinkUnrealPlugins: parsed.autoLinkUnrealPlugins ?? DEFAULT_SETTINGS.autoLinkUnrealPlugins,
      linkMode: parsed.linkMode ?? DEFAULT_SETTINGS.linkMode
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export const saveSettings = async (settings: AppSettings) => {
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf8')
}
