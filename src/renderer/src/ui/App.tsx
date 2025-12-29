import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, LinkSyncResult, NpmrcConfig, PackageListItem, ProjectState } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { MarkdownView } from './MarkdownView'
import { EmptyState } from './EmptyState'
import { useI18n } from './i18n'
import {
  Icon,
  IconArrowUp,
  IconChevron,
  IconFolder,
  IconGear,
  IconGlobe,
  IconPlugin,
  IconRefresh,
  IconSearch,
  IconSidebar
} from './icons'

type MainTab = 'REGISTRY' | 'PROJECT' | 'UPDATES'
type DetailTab = 'INFO' | 'README' | 'VERSIONS'

const LS_PROJECT_DIR = 'upm:lastProjectDir'
const LS_RECENT_PROJECTS = 'upm:recentProjects'
const LS_PROJECT_PANEL_OPEN = 'upm:projectPanelOpen'
const LS_REMEMBER_PROJECTS = 'upm:rememberRecentProjectsFallback'
const LS_PROJECT_CONTEXT_OPEN = 'upm:projectContextOpen'
const LIST_PAGE_SIZE = 20

const hasElectronBridge = () => typeof window !== 'undefined' && typeof window.upm?.getProjectState === 'function'

const statusLabelKey: Record<PackageListItem['status'], MessageKey> = {
  remote: 'status.remote',
  installed: 'status.installed',
  update_available: 'status.update_available',
  missing: 'status.missing'
}

const formatNpmLog = (log: { cmd: string; stdout: string; stderr: string } | null | undefined) => {
  if (!log) return ''
  return `${log.cmd}\n\n${log.stdout}\n${log.stderr}`.trim()
}

const formatLinkSyncLog = (t: (key: MessageKey, vars?: Record<string, string | number>) => string, res: LinkSyncResult) => {
  const lines: string[] = []
  lines.push(t('links.log.title'))
  lines.push(t('links.log.ok', { value: String(res.ok) }))
  lines.push(t('links.log.linked', { value: res.linked.length }))
  lines.push(t('links.log.removed', { value: res.removed.length }))
  if (res.warnings?.length) {
    lines.push('')
    lines.push(t('links.log.warnings'))
    lines.push(...res.warnings.map((w) => `- ${w}`))
  }
  if (res.error) {
    lines.push('')
    lines.push(t('links.log.error', { value: res.error }))
  }
  return lines.join('\n')
}

export const App: React.FC = () => {
  const platform = hasElectronBridge() ? window.upm.platform : 'web'
  const isMac = platform === 'darwin'
  const { t, setPref } = useI18n()

  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [projectState, setProjectState] = useState<ProjectState | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [npmrc, setNpmrc] = useState<NpmrcConfig | null>(null)
  const [projectPanelOpen, setProjectPanelOpen] = useState(true)
  const [projectSearch, setProjectSearch] = useState('')
  const [recentProjects, setRecentProjects] = useState<string[]>([])
  const [projectContextOpen, setProjectContextOpen] = useState(true)
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  const [tab, setTab] = useState<MainTab>('REGISTRY')
  const [detailTab, setDetailTab] = useState<DetailTab>('INFO')
  const [logVisible, setLogVisible] = useState(false)
  const [logText, setLogText] = useState<string>('')

  const [query, setQuery] = useState('')
  const [remoteItems, setRemoteItems] = useState<PackageListItem[]>([])
  const [remoteSearched, setRemoteSearched] = useState(false)
  const [remoteLimit, setRemoteLimit] = useState(LIST_PAGE_SIZE)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [alertQueue, setAlertQueue] = useState<string[]>([])
  const lastAlertsKeyRef = useRef<string>('')
  const lastWarningsKeyRef = useRef<string>('')
  const lastErrorAlertRef = useRef<{ key: string; at: number } | null>(null)

  const [installKind, setInstallKind] = useState<'runtime' | 'dev'>('runtime')
  const [installVersionOrTag, setInstallVersionOrTag] = useState('latest')

  const searchTimer = useRef<number | null>(null)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const autoSyncedKeyRef = useRef<string>('')

  const refreshSettings = async () => {
    if (!hasElectronBridge()) return
    const res = await window.upm.getSettings()
    if (!res.ok) return setError(res.error)
    setSettings(res.data)
  }

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const effective = (pref: 'system' | 'dark' | 'light') => {
      if (pref === 'system') return media?.matches ? 'dark' : 'light'
      return pref
    }
    const apply = (pref: 'system' | 'dark' | 'light') => {
      root.dataset.theme = effective(pref)
      root.dataset.themePref = pref
    }

    const pref = settings?.theme ?? 'system'
    apply(pref)

    if (pref !== 'system' || !media) return
    const onChange = () => apply('system')
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [settings?.theme])

  const refreshProject = async (dir: string | null) => {
    if (!hasElectronBridge()) {
      setError(t('errors.noElectron'))
      return
    }
    const res = await window.upm.getProjectState(dir)
    if (!res.ok) return setError(res.error)
    setProjectState(res.data)
  }

  const refreshNpmrc = async (dir: string | null) => {
    if (!hasElectronBridge() || !dir) return
    const res = await window.upm.loadNpmrc(dir)
    if (!res.ok) return setError(res.error)
    setNpmrc(res.data)
  }

  useEffect(() => {
    const open = localStorage.getItem(LS_PROJECT_PANEL_OPEN)
    if (open === '0') setProjectPanelOpen(false)
    const ctxOpen = localStorage.getItem(LS_PROJECT_CONTEXT_OPEN)
    if (ctxOpen === '0') setProjectContextOpen(false)
    void refreshSettings()
  }, [])

  useEffect(() => {
    const remember = settings?.rememberRecentProjects
    if (typeof remember !== 'boolean') return

    if (!remember) {
      setRecentProjects([])
      localStorage.setItem(LS_REMEMBER_PROJECTS, '0')
      void refreshProject(projectDir)
      return
    }

    localStorage.setItem(LS_REMEMBER_PROJECTS, '1')
    const last = localStorage.getItem(LS_PROJECT_DIR)
    const raw = localStorage.getItem(LS_RECENT_PROJECTS)
    const base: string[] = (() => {
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw) as unknown
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
      } catch {
        return []
      }
    })()

    const list = last && !base.includes(last) ? [...base, last] : base
    setRecentProjects(list.slice(-20))
    void setActiveProject(last ?? null)
  }, [settings?.rememberRecentProjects])

  const saveRecents = (updater: (prev: string[]) => string[]) => {
    setRecentProjects((prev) => {
      const next = updater(prev)
      localStorage.setItem(LS_RECENT_PROJECTS, JSON.stringify(next))
      return next
    })
  }

  const removeRecentProject = (dir: string) => {
    saveRecents((prev) => prev.filter((p) => p !== dir))
    if (localStorage.getItem(LS_PROJECT_DIR) === dir) localStorage.removeItem(LS_PROJECT_DIR)
  }

  useEffect(() => {
    if (!projectMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjectMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [projectMenu])

  const setActiveProject = async (dir: string | null) => {
    const remember = settings?.rememberRecentProjects ?? localStorage.getItem(LS_REMEMBER_PROJECTS) !== '0'
    setRemoteItems([])
    setRemoteSearched(false)
    setRemoteLimit(LIST_PAGE_SIZE)
    setSelectedName(null)
    setProjectState(null)
    setNpmrc(null)

    if (dir) {
      if (remember) localStorage.setItem(LS_PROJECT_DIR, dir)
      setProjectDir(dir)
      if (remember) {
        saveRecents((prev) => {
          if (prev.includes(dir)) return prev
          return [...prev, dir].slice(-20)
        })
      }
    } else {
      setProjectDir(null)
    }
    await refreshProject(dir)
    await refreshNpmrc(dir)
  }

  useEffect(() => {
    setPref(settings?.uiLanguage ?? 'system')
  }, [settings?.uiLanguage, setPref])

  const selectProject = async () => {
    setError(null)
    if (!hasElectronBridge()) return refreshProject(projectDir)
    const res = await window.upm.selectProjectDir()
    if (!res.ok) return setError(res.error)
    if (!res.data) return
    await setActiveProject(res.data)
  }

  const doSearch = async (dir: string, q: string, limit: number) => {
    if (!hasElectronBridge()) return
    setRemoteLoading(true)
    try {
      const res = await window.upm.searchRegistry(dir, q, limit)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setRemoteItems(res.data)
      setRemoteSearched(true)
    } finally {
      setRemoteLoading(false)
    }
  }

  useEffect(() => {
    if (tab !== 'REGISTRY') return
    if (!projectDir) return
    if (!hasElectronBridge()) return
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      void doSearch(projectDir, query, remoteLimit)
    }, 350)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [tab, projectDir, query, remoteLimit])

  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE)
    if (tab === 'REGISTRY') setRemoteLimit(LIST_PAGE_SIZE)
    listBodyRef.current?.scrollTo({ top: 0 })
  }, [tab, projectDir, query, settings?.ueOnlyFilter])

  useEffect(() => {
    if (tab !== 'REGISTRY') return
    setRemoteItems([])
    setRemoteSearched(false)
  }, [projectDir, projectState?.npmrc?.values?.registry, tab])

  const listItems = useMemo(() => {
    const ueOnly = settings?.ueOnlyFilter ?? false
    if (tab === 'REGISTRY') {
      const base = remoteItems
      const localByName = new Map((projectState?.packages ?? []).map((p) => [p.name, p] as const))
      const merged = base.map((p) => {
        const local = localByName.get(p.name)
        if (!local) return p
        return {
          ...p,
          requestedRange: local.requestedRange,
          dependencyKind: local.dependencyKind,
          installedVersion: local.installedVersion,
          wantedVersion: local.wantedVersion,
          latestVersion: p.latestVersion ?? local.latestVersion,
          status: local.status,
          isUnrealPlugin: !!(p.isUnrealPlugin || local.isUnrealPlugin)
        }
      })
      const filtered = ueOnly ? merged.filter((p) => p.isUnrealPlugin) : merged
      if (!query.trim()) return filtered
      const q = query.trim().toLowerCase()
      return filtered.filter((p) => (p.name + ' ' + (p.description ?? '')).toLowerCase().includes(q))
    }

    const packages = projectState?.packages ?? []
    let filtered = ueOnly ? packages.filter((p) => p.isUnrealPlugin) : packages
    if (tab === 'UPDATES') filtered = filtered.filter((p) => p.status === 'update_available')
    if (!query.trim()) return filtered
    const q = query.trim().toLowerCase()
    return filtered.filter((p) => (p.name + ' ' + (p.description ?? '')).toLowerCase().includes(q))
  }, [tab, projectState, remoteItems, settings?.ueOnlyFilter, query])

  const selected = useMemo(() => {
    if (!selectedName) return null
    return listItems.find((p) => p.name === selectedName) ?? null
  }, [listItems, selectedName])

  const visibleItems = useMemo(() => listItems.slice(0, visibleCount), [listItems, visibleCount])

  useEffect(() => {
    if (!selectedName && listItems.length) setSelectedName(listItems[0]!.name)
    if (selectedName && !listItems.some((p) => p.name === selectedName)) setSelectedName(listItems[0]?.name ?? null)
  }, [listItems, selectedName])

  const onListScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    const el = e.currentTarget
    const threshold = 80
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold
    if (!nearBottom) return

    if (visibleCount < listItems.length) setVisibleCount((c) => c + LIST_PAGE_SIZE)

    if (tab === 'REGISTRY' && !remoteLoading && remoteItems.length >= remoteLimit) {
      setRemoteLimit((n) => n + LIST_PAGE_SIZE)
    }
  }

  useEffect(() => {
    if (!selectedName) return
    const idx = listItems.findIndex((p) => p.name === selectedName)
    if (idx >= 0 && idx >= visibleCount) setVisibleCount(idx + 1)
  }, [selectedName, listItems, visibleCount])

  const act = async (key: string, fn: () => Promise<void>) => {
    setError(null)
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const installSelected = async () => {
    if (!projectDir || !selected) return
    await act(`install:${selected.name}`, async () => {
      const res = await window.upm.installPackage(projectDir, selected.name, installVersionOrTag || 'latest', installKind)
      if (!res.ok) return setError(res.error)
      setProjectState(res.data)
      if (res.data.lastLog) {
        setLogText(formatNpmLog(res.data.lastLog))
        if (settings?.showLogDock ?? true) setLogVisible(true)
      }
      setTab('PROJECT')
    })
  }

  const uninstallSelected = async () => {
    if (!projectDir || !selected) return
    await act(`uninstall:${selected.name}`, async () => {
      const res = await window.upm.uninstallPackage(projectDir, selected.name)
      if (!res.ok) return setError(res.error)
      setProjectState(res.data)
      if (res.data.lastLog) {
        setLogText(formatNpmLog(res.data.lastLog))
        if (settings?.showLogDock ?? true) setLogVisible(true)
      }
    })
  }

  const updateSelected = async () => {
    if (!projectDir || !selected) return
    await act(`update:${selected.name}`, async () => {
      const res = await window.upm.updatePackage(projectDir, selected.name)
      if (!res.ok) return setError(res.error)
      setProjectState(res.data)
      if (res.data.lastLog) {
        setLogText(formatNpmLog(res.data.lastLog))
        if (settings?.showLogDock ?? true) setLogVisible(true)
      }
    })
  }

  const syncLinksNow = async () => {
    if (!hasElectronBridge()) return
    if (!projectDir) return
    if (!projectState?.isUnrealProject) return
    await act('links:sync', async () => {
      const res = await window.upm.syncLinks(projectDir)
      if (!res.ok) return setError(res.error)
      setLogText(formatLinkSyncLog(t, res.data))
      if (settings?.showLogDock ?? true) setLogVisible(true)
      const joined = [...res.data.warnings]
      if (res.data.error) joined.push(res.data.error)
      if (joined.length) setError(joined.join('\n'))
      await refreshProject(projectDir)
    })
  }

  const installSelectedVersion = async (version: string) => {
    if (!projectDir || !selected) return
    setInstallVersionOrTag(version)
    const kind = selected.dependencyKind ?? installKind
    await act(`install:${selected.name}@${version}`, async () => {
      const res = await window.upm.installPackage(projectDir, selected.name, version || 'latest', kind)
      if (!res.ok) return setError(res.error)
      setProjectState(res.data)
      if (res.data.lastLog) {
        setLogText(formatNpmLog(res.data.lastLog))
        if (settings?.showLogDock ?? true) setLogVisible(true)
      }
      setTab('PROJECT')
    })
  }

  useEffect(() => {
    if (!projectDir) return
    if (!projectState?.isUnrealProject) return
    if (!settings?.autoLinkUnrealPlugins) return
    const key = [projectDir, settings.pluginsRootDirOverride ?? '', settings.linkMode].join('|')
    if (autoSyncedKeyRef.current === key) return
    autoSyncedKeyRef.current = key
    void syncLinksNow()
  }, [
    projectDir,
    projectState?.isUnrealProject,
    settings?.autoLinkUnrealPlugins,
    settings?.pluginsRootDirOverride,
    settings?.linkMode
  ])

  useEffect(() => {
    if (settings?.autoLinkUnrealPlugins) return
    autoSyncedKeyRef.current = ''
  }, [settings?.autoLinkUnrealPlugins])

  useEffect(() => {
    if (settings?.showLogDock === false) setLogVisible(false)
  }, [settings?.showLogDock])

  useEffect(() => {
    const alerts = projectState?.alerts ?? []
    const key = alerts.join('\n')
    if (!alerts.length || key === lastAlertsKeyRef.current) return
    lastAlertsKeyRef.current = key
    setAlertQueue((q) => [...q, ...alerts])
  }, [projectState?.alerts])

  useEffect(() => {
    const existingAlerts = new Set(projectState?.alerts ?? [])
    const warnings = (projectState?.warnings ?? []).filter((w) => !existingAlerts.has(w))
    const key = warnings.join('\n')
    if (!warnings.length || key === lastWarningsKeyRef.current) return
    lastWarningsKeyRef.current = key
    setAlertQueue((q) => [...q, ...warnings])
  }, [projectState?.alerts, projectState?.warnings])

  useEffect(() => {
    const msg = (error ?? '').trim()
    if (!msg) return
    const now = Date.now()
    const prev = lastErrorAlertRef.current
    if (!prev || prev.key !== msg || now - prev.at > 10_000) {
      lastErrorAlertRef.current = { key: msg, at: now }
      setAlertQueue((q) => [...q, msg])
    }
  }, [error])

  const currentAlert = alertQueue[0] ?? null

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase()
    if (!q) return recentProjects
    return recentProjects.filter((p) => p.toLowerCase().includes(q))
  }, [recentProjects, projectSearch])

  const toggleProjectPanel = () => {
    setProjectPanelOpen((v) => {
      const next = !v
      localStorage.setItem(LS_PROJECT_PANEL_OPEN, next ? '1' : '0')
      return next
    })
  }

  return (
    <div className={`app ue ${isMac ? 'is-mac' : ''} ${projectPanelOpen ? 'with-projects' : ''}`}>
      <header className="ue-topbar">
        <div className="ue-window-chrome" aria-hidden="true" />
        <div className="ue-toolbar">
          <div className="ue-toolbar-left">
            <button
              className={`btn ue-projects-toggle ${projectPanelOpen ? 'active' : ''}`}
              onClick={toggleProjectPanel}
              aria-label={projectPanelOpen ? t('projects.toggle.hide') : t('projects.toggle.show')}
              title={projectPanelOpen ? t('projects.toggle.hide') : t('projects.toggle.show')}
            >
              <Icon><IconSidebar /></Icon>
              {projectPanelOpen ? t('projects.toggle.hide') : t('projects.toggle.show')}
            </button>
          </div>

          <div aria-hidden="true" />

          <div className="ue-toolbar-right">
            <button className="btn" onClick={() => setShowSettings(true)} disabled={!hasElectronBridge()}>
              <Icon><IconGear /></Icon>
              {t('actions.settings')}
            </button>
          </div>
        </div>
      </header>

      <div className="ue-content">

        <main className="ue-main">
          {projectPanelOpen ? (
            <aside className="ue-projects" aria-label="Projects">
              <div className="ue-projects-header">
                <div className="ue-projects-title">{t('projects.title')}</div>
              </div>

              <div className="ue-projects-body">
                <div className="ue-search-wrap">
                  <div className="ue-search-icon">
                    <Icon><IconSearch /></Icon>
                  </div>
                  <input
                    className="ue-search ue-search-sidebar"
                    value={projectSearch}
                    placeholder={t('projects.search.placeholder')}
                    onChange={(e) => setProjectSearch(e.target.value)}
                  />
                </div>

                <div className="ue-projects-context-wrap">
                  <div className="ue-projects-context-header">
                    <div className="ue-projects-context-title">{t('projects.context.title')}</div>
                    <button
                      className="ue-icon-btn"
                      onClick={() => {
                        setProjectContextOpen((v) => {
                          const next = !v
                          localStorage.setItem(LS_PROJECT_CONTEXT_OPEN, next ? '1' : '0')
                          return next
                        })
                      }}
                      aria-label={projectContextOpen ? t('projects.context.hide') : t('projects.context.show')}
                      title={projectContextOpen ? t('projects.context.hide') : t('projects.context.show')}
                    >
                      <Icon><IconChevron direction={projectContextOpen ? 'up' : 'down'} /></Icon>
                    </button>
                  </div>

                  {projectContextOpen ? (
                    <div className="ue-list-context ue-projects-context">
                      <div className="ue-list-context-row">
                        <div className="ue-list-context-k">
                          <Icon><IconFolder /></Icon>
                          <span className="k">{t('meta.project')}</span>
                        </div>
                        <div className="ue-list-context-v mono">{projectDir ?? t('meta.unselected')}</div>
                      </div>
                      <div className="ue-list-context-row">
                        <div className="ue-list-context-k">
                          <Icon><IconGlobe /></Icon>
                          <span className="k">{t('meta.registry')}</span>
                        </div>
                        <div className="ue-list-context-v mono">
                          {projectState?.npmrc?.values?.registry ?? t('meta.projectNpmrc')}
                        </div>
                      </div>
                      <div className="ue-list-context-row">
                        <div className="ue-list-context-k">
                          <Icon><IconPlugin /></Icon>
                          <span className="k">{t('meta.pluginsRoot')}</span>
                        </div>
                        <div className="ue-list-context-v mono">{projectState?.pluginsRootDir ?? t('meta.unknown')}</div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="ue-projects-actions">
                  <button className="btn ue-btn-sm" onClick={selectProject} disabled={busy !== null}>
                    <Icon><IconFolder /></Icon>
                    {t('actions.selectProject')}
                  </button>
                  <button
                    className="ue-icon-btn"
                    onClick={() =>
                      void act('project:refresh', async () => {
                        await refreshProject(projectDir)
                        await refreshNpmrc(projectDir)
                      })
                    }
                    disabled={busy !== null}
                    aria-label={t('actions.refresh')}
                    title={t('actions.refresh')}
                  >
                    <Icon><IconRefresh /></Icon>
                  </button>
                </div>

                <div className="ue-projects-list">
                  {filteredProjects.length ? (
                    filteredProjects.map((p) => (
                      <button
                        key={p}
                        className={`ue-project-item ${p === projectDir ? 'active' : ''}`}
                        onClick={() => void act('project:switch', async () => setActiveProject(p))}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (settings?.rememberRecentProjects === false) return
                          const w = window.innerWidth
                          const h = window.innerHeight
                          const mw = 180
                          const mh = 60
                          const x = Math.min(e.clientX, Math.max(0, w - mw - 8))
                          const y = Math.min(e.clientY, Math.max(0, h - mh - 8))
                          setProjectMenu({ x, y, path: p })
                        }}
                        title={p}
                      >
                        <div className="ue-project-item-top">
                          <Icon><IconFolder /></Icon>
                          <div className="ue-project-item-name mono">{p.split(/[\\/]/).filter(Boolean).pop() ?? p}</div>
                        </div>
                        <div className="ue-project-item-path mono">{p}</div>
                      </button>
                    ))
                  ) : (
                    <EmptyState
                      title={settings?.rememberRecentProjects === false ? t('projects.disabled') : t('projects.empty')}
                      description={
                        settings?.rememberRecentProjects === false ? t('projects.disabled.desc') : t('projects.empty.desc')
                      }
                    />
                  )}
                </div>
              </div>
            </aside>
          ) : null}

          <aside className="ue-list">
            <div className="ue-list-header">
              <div className="ue-search-wrap">
                <div className="ue-search-icon">
                  <Icon><IconSearch /></Icon>
                </div>
                <input
                  className="ue-search ue-search-sidebar"
                  value={query}
                  placeholder={tab === 'REGISTRY' ? t('search.registry.placeholder') : t('search.filter.placeholder')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="ue-list-header-top">
                <div className="ue-tabs">
                  <Tab active={tab === 'REGISTRY'} onClick={() => setTab('REGISTRY')} icon={<IconGlobe />}>
                    {t('tabs.registry')}
                  </Tab>
                  <Tab active={tab === 'PROJECT'} onClick={() => setTab('PROJECT')} icon={<IconFolder />}>
                    {t('tabs.project')}
                  </Tab>
                  <Tab active={tab === 'UPDATES'} onClick={() => setTab('UPDATES')} icon={<IconArrowUp />}>
                    {t('tabs.updates')}
                  </Tab>
                </div>
              </div>

              <div className="muted">
                {projectState
                  ? t('list.count', { shown: Math.min(visibleItems.length, listItems.length), total: listItems.length })
                  : '...'}
                {tab === 'REGISTRY' && remoteLoading ? t('list.loading') : ''}
              </div>
            </div>
            <div className="ue-list-body" ref={listBodyRef} onScroll={onListScroll}>
              {listItems.length ? (
                visibleItems.map((p) => (
                  <button
                    key={p.name}
                    className={`ue-item ${selectedName === p.name ? 'active' : ''}`}
                    onClick={() => setSelectedName(p.name)}
                  >
                    <div className="ue-item-top">
                      <div className="ue-item-name">{p.displayName ?? p.name}</div>
                      <div className="ue-item-tags">
                        {p.isUnrealPlugin ? <span className="tag ue">UE</span> : null}
                        <span className={`badge ${p.status}`}>{t(statusLabelKey[p.status])}</span>
                      </div>
                    </div>
                    <div className="ue-item-sub mono">{p.name}</div>
                    {p.installedVersion ? (
                      <div className="ue-item-sub mono">
                        installed {p.installedVersion}
                        {p.latestVersion ? ` · latest ${p.latestVersion}` : ''}
                      </div>
                    ) : p.latestVersion ? (
                      <div className="ue-item-sub mono">latest {p.latestVersion}</div>
                    ) : null}
                    {p.description ? <div className="ue-item-sub">{p.description}</div> : null}
                  </button>
                ))
              ) : !projectDir ? (
                <EmptyState title={t('empty.noProject.title')} description={t('empty.noProject.desc')} />
              ) : tab === 'REGISTRY' ? (
                <EmptyState
                  title={remoteSearched ? t('empty.registry.noResults.title') : t('empty.registry.start.title')}
                  description={
                    remoteSearched ? t('empty.registry.noResults.desc') : t('empty.registry.start.desc')
                  }
                >
                  {remoteSearched ? (
                    <div className="muted">
                      <div>{t('empty.registry.noResults.help.header')}</div>
                      <div>{t('empty.registry.noResults.help.save')}</div>
                      <div>{t('empty.registry.noResults.help.query')}</div>
                      <div>{t('empty.registry.noResults.help.filter')}</div>
                    </div>
                  ) : null}
                </EmptyState>
              ) : tab === 'UPDATES' ? (
                <EmptyState title={t('empty.updates.title')} description={t('empty.updates.desc')} />
              ) : (
                <EmptyState title={t('empty.project.title')} description={t('empty.project.desc')} />
              )}
            </div>
          </aside>

          <section className="ue-detail">
            {!selected ? (
              <EmptyState title={t('detail.selectPrompt')} icon="←" />
            ) : (
              <PackageDetail
                projectDir={projectDir}
                selected={selected}
                busy={busy}
                isUnrealProject={!!projectState?.isUnrealProject}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                installKind={installKind}
                setInstallKind={setInstallKind}
                installVersionOrTag={installVersionOrTag}
                setInstallVersionOrTag={setInstallVersionOrTag}
                onInstall={installSelected}
                onInstallVersion={installSelectedVersion}
                onUninstall={uninstallSelected}
                onUpdate={updateSelected}
                setError={setError}
                onSetLogText={setLogText}
              />
            )}
          </section>
        </main>
      </div>

      {settings?.showLogDock ?? true ? (
        <LogDock
          visible={logVisible}
          text={logText}
          onToggle={() => setLogVisible((v) => !v)}
          onClear={() => setLogText('')}
        />
      ) : null}

      {showSettings ? (
        <SettingsModal
          projectDir={projectDir}
          settings={settings}
          npmrc={npmrc}
          onClose={() => setShowSettings(false)}
          onClearProjectHistory={() => {
            localStorage.removeItem(LS_RECENT_PROJECTS)
            localStorage.removeItem(LS_PROJECT_DIR)
            setRecentProjects([])
          }}
          onReload={async () => {
            await refreshSettings()
            await refreshProject(projectDir)
            await refreshNpmrc(projectDir)
          }}
          onSaveSettings={async (patch) => {
            setError(null)
            const res = await window.upm.setSettings(patch)
            if (!res.ok) {
              setError(res.error)
              throw new Error(res.error)
            }
            setSettings(res.data)
          }}
          onSaveNpmrc={async (cfg) => {
            if (!projectDir) return
            const res = await window.upm.saveNpmrc(projectDir, cfg)
            if (!res.ok) {
              setError(res.error)
              throw new Error(res.error)
            }
            setNpmrc(cfg)
          }}
        />
      ) : null}

      {currentAlert ? (
        <div className="alert-backdrop" role="dialog" aria-modal="true">
          <div className="alert">
            <div className="alert-title">{t('alert.title')}</div>
            <div className="alert-body" style={{ whiteSpace: 'pre-wrap' }}>
              {currentAlert}
            </div>
            <div className="alert-actions">
              <button
                className="btn primary"
                onClick={() => setAlertQueue((q) => q.slice(1))}
              >
                {t('alert.ok')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {projectMenu ? (
        <div
          className="ue-menu-overlay"
          onMouseDown={() => setProjectMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setProjectMenu(null)
          }}
        >
          <div
            className="ue-menu"
            style={{ left: projectMenu.x, top: projectMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="ue-menu-item danger"
              onClick={() => {
                const ok = confirm(t('projects.remove.confirm', { path: projectMenu.path }))
                if (!ok) return
                removeRecentProject(projectMenu.path)
                setProjectMenu(null)
              }}
            >
              {t('projects.remove')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const Tab: React.FC<{ active: boolean; onClick: () => void; icon?: React.ReactNode; children: React.ReactNode }> = ({
  active,
  onClick,
  icon,
  children
}) => (
  <button className={`ue-tab ${active ? 'active' : ''}`} onClick={onClick}>
    <span className="ue-tab-inner">
      {icon ? <Icon>{icon}</Icon> : null}
      <span className="ue-tab-text">{children}</span>
    </span>
  </button>
)

const LogDock: React.FC<{
  visible: boolean
  text: string
  onToggle: () => void
  onClear: () => void
}> = ({ visible, text, onToggle, onClear }) => {
  const { t } = useI18n()
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const bodyRef = useRef<HTMLPreElement | null>(null)
  const display = text?.trim() ? text : t('log.noLog')

  useEffect(() => {
    if (!visible) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible, display])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(display)
      setCopyHint(t('log.copied'))
      window.setTimeout(() => setCopyHint(null), 1200)
    } catch (e) {
      console.error(e)
      setCopyHint(t('log.copyFailed'))
      window.setTimeout(() => setCopyHint(null), 1500)
    }
  }

  return (
    <section className={`ue-logdock ${visible ? 'open' : 'closed'}`} aria-label="Log">
      <div className="ue-logdock-header">
        <div className="ue-logdock-title">{t('log.title')}</div>
        <div className="ue-logdock-spacer" />
        {copyHint ? <div className="muted mono">{copyHint}</div> : null}
        <button className="btn" onClick={onToggle}>
          {visible ? t('log.toggle.hide') : t('log.toggle.show')}
        </button>
        <button className="btn" onClick={onClear} disabled={!text?.trim()}>
          {t('log.clear')}
        </button>
        <button className="btn" onClick={() => void copy()}>
          {t('log.copy')}
        </button>
      </div>
      {visible ? <pre ref={bodyRef} className="ue-logdock-body mono">{display}</pre> : null}
    </section>
  )
}

const PackageDetail: React.FC<{
  projectDir: string | null
  selected: PackageListItem
  busy: string | null
  isUnrealProject: boolean
  detailTab: DetailTab
  setDetailTab: (t: DetailTab) => void
  installKind: 'runtime' | 'dev'
  setInstallKind: (v: 'runtime' | 'dev') => void
  installVersionOrTag: string
  setInstallVersionOrTag: (v: string) => void
  onInstall: () => Promise<void>
  onInstallVersion: (version: string) => Promise<void>
  onUninstall: () => Promise<void>
  onUpdate: () => Promise<void>
  setError: (v: string | null) => void
  onSetLogText: (v: string) => void
}> = ({
  projectDir,
  selected,
  busy,
  isUnrealProject,
  detailTab,
  setDetailTab,
  installKind,
  setInstallKind,
  installVersionOrTag,
  setInstallVersionOrTag,
  onInstall,
  onInstallVersion,
  onUninstall,
  onUpdate,
  setError,
  onSetLogText
}) => {
  const { t } = useI18n()
  const [metadata, setMetadata] = useState<any | null>(null)
  const [showVersionPicker, setShowVersionPicker] = useState(false)
  const [versionFilter, setVersionFilter] = useState('')

  const allVersions = useMemo(() => {
    const v = (metadata?.versions ?? []) as string[]
    return Array.isArray(v) ? v.slice().reverse() : []
  }, [metadata?.versions])

  const filteredVersions = useMemo(() => {
    const q = versionFilter.trim().toLowerCase()
    if (!q) return allVersions.slice(0, 200)
    return allVersions.filter((v) => v.toLowerCase().includes(q)).slice(0, 200)
  }, [allVersions, versionFilter])

  useEffect(() => {
    const load = async () => {
      setError(null)
      setMetadata(null)
      if (!projectDir) return
      const res = await window.upm.getPackageMetadata(projectDir, selected.name)
      if (!res.ok) return setError(res.error)
      setMetadata(res.data.metadata)
      if (typeof res.data?.log !== 'undefined') onSetLogText(formatNpmLog(res.data.log))
    }
    void load()
  }, [projectDir, selected.name, onSetLogText])

  const canAct = !!projectDir && busy === null

  return (
    <>
      <div className="ue-detail-header">
        <div className="ue-detail-title">
          <div className="name">{metadata?.displayName ?? selected.displayName ?? selected.name}</div>
          <div className="sub mono">{selected.name}</div>
          <div className="sub mono">
            {selected.installedVersion
              ? t('detail.installed', { version: selected.installedVersion })
              : t('detail.notInstalled')}
            {selected.latestVersion ? t('detail.latest', { version: selected.latestVersion }) : ''}
          </div>
          {selected.description || metadata?.description ? <div className="sub">{metadata?.description ?? selected.description}</div> : null}
        </div>

        <div className="ue-detail-actions">
          {selected.status === 'remote' || selected.status === 'missing' ? (
            <>
              <select
                className="select"
                value={installKind}
                onChange={(e) => setInstallKind(e.target.value as any)}
                disabled={!canAct}
                title={t('detail.installKind.title')}
              >
                <option value="runtime">{t('detail.installKind.runtime')}</option>
                <option value="dev">{t('detail.installKind.dev')}</option>
              </select>
              <div className="muted" style={{ flexBasis: '100%' }}>
                {t('detail.installKind.hint')}
              </div>
              <input
                className="input"
                value={installVersionOrTag}
                onChange={(e) => setInstallVersionOrTag(e.target.value)}
                placeholder={t('detail.versionTag.placeholder')}
                disabled={!canAct}
              />
              <button className="btn primary" onClick={() => void onInstall()} disabled={!canAct}>
                {t('detail.action.install')}
              </button>
            </>
          ) : null}

          {selected.status === 'update_available' ? (
            <button
              className="btn primary"
              onClick={() => {
                setVersionFilter('')
                setShowVersionPicker(true)
              }}
              disabled={!canAct}
            >
              {t('detail.action.update')}
            </button>
          ) : null}

          {selected.status !== 'remote' ? (
            <button className="btn danger" onClick={() => void onUninstall()} disabled={!canAct}>
              {t('detail.action.remove')}
            </button>
          ) : null}

        </div>
      </div>

      <div className="ue-detail-tabs">
        <Tab active={detailTab === 'INFO'} onClick={() => setDetailTab('INFO')}>
          {t('detail.tabs.info')}
        </Tab>
        <Tab active={detailTab === 'README'} onClick={() => setDetailTab('README')}>
          {t('detail.tabs.readme')}
        </Tab>
        <Tab active={detailTab === 'VERSIONS'} onClick={() => setDetailTab('VERSIONS')}>
          {t('detail.tabs.versions')}
        </Tab>
      </div>

      <div className="ue-detail-body">
        {detailTab === 'INFO' ? (
          <div className="ue-grid">
            <InfoRow k={t('detail.info.version')} v={metadata?.version ?? selected.latestVersion ?? '-'} mono />
            <InfoRow k={t('detail.info.license')} v={metadata?.license ?? '-'} mono />
            <InfoRow k={t('detail.info.author')} v={metadata?.author ?? '-'} />
            <InfoRow k={t('detail.info.homepage')} v={metadata?.homepageUrl ?? '-'} mono href={metadata?.homepageUrl} />
            <InfoRow
              k={t('detail.info.repository')}
              v={metadata?.repositoryUrl ?? '-'}
              mono
              href={metadata?.repositoryUrl}
            />
            {metadata?.docsUrl ? <InfoRow k={t('detail.info.docs')} v={metadata.docsUrl} mono href={metadata.docsUrl} /> : null}
            {metadata?.marketplaceUrl ? (
              <InfoRow k={t('detail.info.marketplace')} v={metadata.marketplaceUrl} mono href={metadata.marketplaceUrl} />
            ) : null}
            {metadata?.supportUrl ? (
              <InfoRow k={t('detail.info.support')} v={metadata.supportUrl} mono href={metadata.supportUrl} />
            ) : null}
            {metadata?.createdByUrl ? (
              <InfoRow
                k={t('detail.info.createdBy')}
                v={metadata?.createdBy ?? metadata.createdByUrl}
                mono
                href={metadata.createdByUrl}
              />
            ) : metadata?.createdBy ? (
              <InfoRow k={t('detail.info.createdBy')} v={metadata.createdBy} />
            ) : null}
          </div>
        ) : null}

        {detailTab === 'README' ? (
          metadata?.readme ? <MarkdownView markdown={metadata.readme} /> : <div className="muted">{t('detail.noReadme')}</div>
        ) : null}

        {detailTab === 'VERSIONS' ? (
          <div className="ue-versions">
            {(metadata?.versions ?? []).length ? (
              (metadata.versions ?? []).slice().reverse().slice(0, 80).map((v: string) => (
                <div key={v} className={`ue-version ${selected.installedVersion === v ? 'active' : ''}`}>
                  <div className="ue-version-main">
                    <div className="mono">{v}</div>
                    <div className="mono muted">{metadata?.time?.[v] ?? ''}</div>
                  </div>
                  {projectDir ? (
                    <button
                      className="btn"
                      disabled={!canAct || selected.installedVersion === v}
                      onClick={() => void onInstallVersion(v)}
                      title={selected.installedVersion === v ? t('detail.installed', { version: v }) : ''}
                    >
                      {t('detail.action.useVersion')}
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="muted">{t('detail.noVersions')}</div>
            )}
          </div>
        ) : null}

      </div>

      {showVersionPicker ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowVersionPicker(false)
          }}
        >
          <div className="modal version-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title-row">
              <div className="modal-title">{t('detail.versionPicker.title')}</div>
              <button className="btn" onClick={() => setShowVersionPicker(false)}>
                {t('settings.close')}
              </button>
            </div>

            <div className="version-modal-body">
              <div className="version-modal-meta">
                <div className="mono">{selected.name}</div>
                <div className="muted mono">
                  {selected.installedVersion
                    ? t('detail.installed', { version: selected.installedVersion })
                    : t('detail.notInstalled')}
                  {selected.latestVersion ? t('detail.latest', { version: selected.latestVersion }) : ''}
                </div>
              </div>

              <input
                className="input"
                value={versionFilter}
                onChange={(e) => setVersionFilter(e.target.value)}
                placeholder={t('search.filter.placeholder')}
                autoFocus
              />

              <div className="version-modal-list">
                {filteredVersions.length ? (
                  filteredVersions.map((v) => (
                    <div key={v} className={`ue-version ${selected.installedVersion === v ? 'active' : ''}`}>
                      <div className="ue-version-main">
                        <div className="mono">{v}</div>
                        <div className="mono muted">{metadata?.time?.[v] ?? ''}</div>
                      </div>
                      <button
                        className="btn"
                        disabled={!canAct || selected.installedVersion === v}
                        onClick={() => {
                          void (async () => {
                            await onInstallVersion(v)
                            setShowVersionPicker(false)
                          })()
                        }}
                      >
                        {t('detail.action.useVersion')}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="muted">{t('detail.noVersions')}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

const normalizeExternalUrl = (url: string) => {
  const trimmed = url.trim()
  if (trimmed.startsWith('git+')) return trimmed.slice('git+'.length)
  if (trimmed.startsWith('git://')) return `https://${trimmed.slice('git://'.length)}`
  return trimmed
}

const openExternal = async (url: string) => {
  const normalized = normalizeExternalUrl(url)
  if (typeof window !== 'undefined' && typeof window.upm?.openExternal === 'function') {
    const res = await window.upm.openExternal(normalized)
    if (!res.ok) console.error(res.error)
    return
  }
  window.open(normalized, '_blank', 'noopener,noreferrer')
}

const InfoRow: React.FC<{ k: string; v: string; mono?: boolean; href?: string }> = ({ k, v, mono, href }) => {
  const canLink = typeof href === 'string' && !!href.trim() && v !== '-'
  return (
    <div className="ue-inforow">
      <div className="k">{k}</div>
      <div className={`v ${mono ? 'mono' : ''}`}>
        {canLink ? (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              void openExternal(href).catch((err) => console.error(err))
            }}
          >
            {v}
          </a>
        ) : (
          v
        )}
      </div>
    </div>
  )
}

const SettingsModal: React.FC<{
  projectDir: string | null
  settings: AppSettings | null
  npmrc: NpmrcConfig | null
  onClose: () => void
  onSaveSettings: (patch: Partial<AppSettings>) => Promise<void>
  onSaveNpmrc: (cfg: NpmrcConfig) => Promise<void>
  onReload: () => Promise<void>
  onClearProjectHistory: () => void
}> = ({ projectDir, settings, npmrc, onClose, onSaveSettings, onSaveNpmrc, onReload, onClearProjectHistory }) => {
  const { t, setPref } = useI18n()
  const [draft, setDraft] = useState<AppSettings>(
    settings ?? {
      npmExecutablePath: null,
      pluginsRootDirOverride: null,
      autoLinkUnrealPlugins: true,
      linkMode: 'auto',
      theme: 'system',
      uiLanguage: 'system',
      rememberRecentProjects: true,
      ueOnlyFilter: false,
      showLogDock: true
    }
  )
  const [draftNpmrc, setDraftNpmrc] = useState<NpmrcConfig>(npmrc ?? { values: {}, scopedRegistries: {} })
  const [pingLog, setPingLog] = useState<string | null>(null)
  const [pane, setPane] = useState<'appearance' | 'registry' | 'npm' | 'linking'>('appearance')
  const didCommitRef = useRef(false)

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])
  useEffect(() => {
    if (npmrc) setDraftNpmrc(npmrc)
  }, [npmrc])

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const effective = (pref: 'system' | 'dark' | 'light') => {
      if (pref === 'system') return media?.matches ? 'dark' : 'light'
      return pref
    }

    const initialPref = settings?.theme ?? 'system'
    root.dataset.theme = effective(draft.theme)

    return () => {
      // If user closes without saving, revert to the original theme preference.
      // If saved, App-level theme effect owns the final state.
      if (!didCommitRef.current) {
        root.dataset.theme = effective(initialPref)
      }
    }
  }, [draft.theme, settings?.theme])

  useEffect(() => {
    const initial = settings?.uiLanguage ?? 'system'
    setPref(draft.uiLanguage)
    return () => {
      if (!didCommitRef.current) setPref(initial)
    }
  }, [draft.uiLanguage, settings?.uiLanguage, setPref])

  const pickPluginsRoot = async () => {
    const res = await window.upm.selectDir(t('settings.linking.pickDialogTitle'))
    if (res.ok && res.data) setDraft((d) => ({ ...d, pluginsRootDirOverride: res.data }))
  }

  const addScope = () => {
    const scope = prompt(t('settings.registry.scoped.prompt'))
    if (!scope) return
    setDraftNpmrc((c) => ({ ...c, scopedRegistries: { ...(c.scopedRegistries ?? {}), [scope]: '' } }))
  }

  const save = async () => {
    try {
      await onSaveSettings(draft)
      if (projectDir) await onSaveNpmrc(draftNpmrc)
      didCommitRef.current = true
      await onReload()
      onClose()
    } catch {
      // errors are surfaced by caller; keep modal open
    }
  }

  const ping = async () => {
    if (!projectDir) return
    const res = await window.upm.npmPing(projectDir)
    if (!res.ok) return setPingLog(res.error)
    setPingLog(`${res.data.cmd}\n\n${res.data.stdout}\n${res.data.stderr}`.trim())
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-title-row">
          <div className="modal-title">{t('settings.title')}</div>
          <button className="btn" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>

        <div className="modal-layout">
          <div className="modal-sidebar">
            <button
              className={`modal-nav ${pane === 'appearance' ? 'active' : ''}`}
              onClick={() => setPane('appearance')}
            >
              {t('settings.nav.appearance')}
            </button>
            <button className={`modal-nav ${pane === 'registry' ? 'active' : ''}`} onClick={() => setPane('registry')}>
              {t('settings.nav.registry')}
            </button>
            <button className={`modal-nav ${pane === 'npm' ? 'active' : ''}`} onClick={() => setPane('npm')}>
              {t('settings.nav.npm')}
            </button>
            <button className={`modal-nav ${pane === 'linking' ? 'active' : ''}`} onClick={() => setPane('linking')}>
              {t('settings.nav.linking')}
            </button>
            <div className="modal-sidebar-hint">
              <div className="muted">{t('settings.writesTo')}</div>
              <div className="mono muted">{projectDir ? `${projectDir}/.npmrc` : '<Project>/.npmrc'}</div>
            </div>
          </div>

          <div className="modal-body">
            {pane === 'appearance' ? (
              <>
                <div className="modal-section-title">{t('settings.appearance.title')}</div>
                <div className="modal-row">
                  <div className="k">{t('settings.appearance.theme')}</div>
                  <div className="v">
                    <select
                      className="select"
                      value={draft.theme}
                      onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as any }))}
                    >
                      <option value="system">{t('settings.appearance.theme.system')}</option>
                      <option value="dark">{t('settings.appearance.theme.dark')}</option>
                      <option value="light">{t('settings.appearance.theme.light')}</option>
                    </select>
                    <div className="muted" style={{ marginTop: 8 }}>
                      {t('settings.appearance.theme.hint')}
                    </div>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">{t('settings.appearance.language')}</div>
                  <div className="v">
                    <select
                      className="select"
                      value={draft.uiLanguage}
                      onChange={(e) => setDraft((d) => ({ ...d, uiLanguage: e.target.value as AppSettings['uiLanguage'] }))}
                    >
                      <option value="system">{t('settings.appearance.language.system')}</option>
                      <option value="en">{t('settings.appearance.language.en')}</option>
                      <option value="zh">{t('settings.appearance.language.zh')}</option>
                      <option value="ja">{t('settings.appearance.language.ja')}</option>
                      <option value="ko">{t('settings.appearance.language.ko')}</option>
                      <option value="fr">{t('settings.appearance.language.fr')}</option>
                      <option value="de">{t('settings.appearance.language.de')}</option>
                      <option value="ru">{t('settings.appearance.language.ru')}</option>
                    </select>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">{t('settings.appearance.projects')}</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.rememberRecentProjects}
                        onChange={(e) => setDraft((d) => ({ ...d, rememberRecentProjects: e.target.checked }))}
                      />{' '}
                      {t('settings.appearance.projects.remember')}
                    </label>
                    <div className="modal-actions" style={{ marginTop: 8 }}>
                      <button
                        className="btn danger"
                        onClick={() => {
                          const ok = confirm(t('settings.appearance.projects.clear.confirm'))
                          if (!ok) return
                          onClearProjectHistory()
                        }}
                      >
                        {t('settings.appearance.projects.clear')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">{t('settings.appearance.ueOnly')}</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.ueOnlyFilter}
                        onChange={(e) => setDraft((d) => ({ ...d, ueOnlyFilter: e.target.checked }))}
                      />{' '}
                      {t('settings.appearance.ueOnly.label')}
                    </label>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">{t('settings.appearance.logPanel')}</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.showLogDock}
                        onChange={(e) => setDraft((d) => ({ ...d, showLogDock: e.target.checked }))}
                      />{' '}
                      {t('settings.appearance.logPanel.label')}
                    </label>
                  </div>
                </div>
              </>
            ) : null}

            {pane === 'registry' ? (
              <>
                <div className="modal-section-title">{t('settings.registry.title')}</div>
                {!projectDir ? (
                  <div className="muted" style={{ paddingTop: 8 }}>
                    {t('settings.registry.needProject')}
                  </div>
                ) : (
                  <>
                    <div className="modal-row">
                      <div className="k">registry</div>
                      <div className="v">
                        <input
                          className="input"
                          value={draftNpmrc.values?.registry ?? ''}
                          placeholder={t('settings.registry.placeholder.registry')}
                          onChange={(e) =>
                            setDraftNpmrc((c) => ({
                              ...c,
                              values: { ...(c.values ?? {}), registry: e.target.value || '' }
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="modal-row">
                      <div className="k">proxy</div>
                      <div className="v">
                        <input
                          className="input"
                          value={draftNpmrc.values?.proxy ?? ''}
                          placeholder={t('settings.registry.placeholder.proxy')}
                          onChange={(e) =>
                            setDraftNpmrc((c) => ({
                              ...c,
                              values: { ...(c.values ?? {}), proxy: e.target.value || '' }
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="modal-row">
                      <div className="k">https-proxy</div>
                      <div className="v">
                        <input
                          className="input"
                          value={draftNpmrc.values?.['https-proxy'] ?? ''}
                          placeholder={t('settings.registry.placeholder.proxy')}
                          onChange={(e) =>
                            setDraftNpmrc((c) => ({
                              ...c,
                              values: { ...(c.values ?? {}), 'https-proxy': e.target.value || '' }
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="modal-row">
                      <div className="k">strict-ssl</div>
                      <div className="v">
                        <label className="chk">
                          <input
                            type="checkbox"
                            checked={(draftNpmrc.values?.['strict-ssl'] ?? 'true') !== 'false'}
                            onChange={(e) =>
                              setDraftNpmrc((c) => ({
                                ...c,
                                values: { ...(c.values ?? {}), 'strict-ssl': e.target.checked ? 'true' : 'false' }
                              }))
                            }
                          />{' '}
                          strict-ssl
                        </label>
                      </div>
                    </div>

                    <div className="modal-row">
                      <div className="k">{t('settings.registry.scoped.title')}</div>
                      <div className="v">
                        <div className="modal-actions">
                          <button className="btn" onClick={addScope}>
                            {t('settings.registry.scoped.add')}
                          </button>
                        </div>
                        {Object.keys(draftNpmrc.scopedRegistries ?? {}).length ? (
                          <div className="scopes">
                            {Object.entries(draftNpmrc.scopedRegistries).map(([scope, url]) => (
                              <div key={scope} className="scope-row">
                                <div className="mono">{scope}</div>
                                <input
                                  className="input"
                                  value={url}
                                  placeholder={t('settings.registry.scoped.placeholder')}
                                  onChange={(e) =>
                                    setDraftNpmrc((c) => ({
                                      ...c,
                                      scopedRegistries: { ...(c.scopedRegistries ?? {}), [scope]: e.target.value }
                                    }))
                                  }
                                />
                                <button
                                  className="btn danger"
                                  onClick={() =>
                                    setDraftNpmrc((c) => {
                                      const next = { ...(c.scopedRegistries ?? {}) }
                                      delete next[scope]
                                      return { ...c, scopedRegistries: next }
                                    })
                                  }
                                >
                                  {t('settings.registry.scoped.remove')}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="muted" style={{ marginTop: 10 }}>
                            {t('settings.registry.scoped.empty')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="modal-row">
                      <div className="k">{t('settings.registry.test.title')}</div>
                      <div className="v">
                        <div className="modal-actions">
                          <button className="btn" onClick={() => void ping()}>
                            npm ping
                          </button>
                        </div>
                        {pingLog ? (
                          <pre className="readme" style={{ marginTop: 10 }}>
                            {pingLog}
                          </pre>
                        ) : (
                          <div className="muted" style={{ marginTop: 10 }}>
                            {t('settings.registry.test.hint')}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : null}

            {pane === 'npm' ? (
              <>
                <div className="modal-section-title">{t('settings.npm.title')}</div>
                <div className="modal-row">
                  <div className="k">{t('settings.npm.path')}</div>
                  <div className="v">
                    <input
                      className="input"
                      value={draft.npmExecutablePath ?? ''}
                      placeholder={t('settings.npm.path.placeholder')}
                      onChange={(e) => setDraft((d) => ({ ...d, npmExecutablePath: e.target.value || null }))}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {pane === 'linking' ? (
              <>
                <div className="modal-section-title">{t('settings.linking.title')}</div>
                <div className="modal-row">
                  <div className="k">{t('settings.linking.pluginsRoot')}</div>
                  <div className="v">
                    <input
                      className="input"
                      value={draft.pluginsRootDirOverride ?? ''}
                      placeholder={t('settings.linking.pluginsRoot.placeholder')}
                      onChange={(e) => setDraft((d) => ({ ...d, pluginsRootDirOverride: e.target.value || null }))}
                    />
                    <div className="modal-actions">
                      <button className="btn" onClick={pickPluginsRoot}>
                        {t('settings.linking.pick')}
                      </button>
                      <button className="btn" onClick={() => setDraft((d) => ({ ...d, pluginsRootDirOverride: null }))}>
                        {t('settings.linking.reset')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">{t('settings.linking.autoLink')}</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.autoLinkUnrealPlugins}
                        onChange={(e) => setDraft((d) => ({ ...d, autoLinkUnrealPlugins: e.target.checked }))}
                      />{' '}
                      {t('settings.linking.autoLink.label')}
                    </label>
                    <div className="muted" style={{ marginTop: 6 }}>
                      {t('settings.linking.autoLink.hint')}
                    </div>
                    <select
                      className="select"
                      value={draft.linkMode}
                      onChange={(e) => setDraft((d) => ({ ...d, linkMode: e.target.value as any }))}
                      style={{ marginTop: 8 }}
                    >
                      <option value="auto">{t('settings.linking.mode.link')}</option>
                      <option value="copy">{t('settings.linking.mode.copy')}</option>
                    </select>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={() => void onReload()}>
            {t('settings.footer.reload')}
          </button>
          <button className="btn primary" onClick={() => void save()}>
            {t('settings.footer.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
