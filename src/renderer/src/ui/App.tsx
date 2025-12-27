import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, LinkSyncResult, NpmrcConfig, PackageListItem, ProjectState } from '@shared/types'
import { MarkdownView } from './MarkdownView'
import { EmptyState } from './EmptyState'

type MainTab = 'REGISTRY' | 'PROJECT' | 'UPDATES'
type DetailTab = 'INFO' | 'README' | 'VERSIONS'

const LS_PROJECT_DIR = 'upm:lastProjectDir'
const LIST_PAGE_SIZE = 20

const hasElectronBridge = () => typeof window !== 'undefined' && typeof window.upm?.getProjectState === 'function'

const statusLabel: Record<PackageListItem['status'], string> = {
  remote: 'REGISTRY',
  installed: 'INSTALLED',
  update_available: 'UPDATE',
  missing: 'MISSING'
}

const formatNpmLog = (log: { cmd: string; stdout: string; stderr: string } | null | undefined) => {
  if (!log) return ''
  return `${log.cmd}\n\n${log.stdout}\n${log.stderr}`.trim()
}

const formatLinkSyncLog = (res: LinkSyncResult) => {
  const lines: string[] = []
  lines.push(`Sync Links`)
  lines.push(`ok: ${res.ok}`)
  lines.push(`linked: ${res.linked.length}`)
  lines.push(`removed: ${res.removed.length}`)
  if (res.warnings?.length) {
    lines.push('')
    lines.push('warnings:')
    lines.push(...res.warnings.map((w) => `- ${w}`))
  }
  if (res.error) {
    lines.push('')
    lines.push(`error: ${res.error}`)
  }
  return lines.join('\n')
}

export const App: React.FC = () => {
  const platform = hasElectronBridge() ? window.upm.platform : 'web'
  const isMac = platform === 'darwin'

  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [projectState, setProjectState] = useState<ProjectState | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [npmrc, setNpmrc] = useState<NpmrcConfig | null>(null)

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

  const [installKind, setInstallKind] = useState<'runtime' | 'dev'>('runtime')
  const [installVersionOrTag, setInstallVersionOrTag] = useState('latest')

  const searchTimer = useRef<number | null>(null)
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const autoSyncedProjectRef = useRef<string | null>(null)

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
      setError(
        '当前页面未运行在 Electron App 中（preload 未注入），无法执行文件夹选择 / npm / 安装等操作。请用 Electron 窗口打开。'
      )
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
    const last = localStorage.getItem(LS_PROJECT_DIR)
    if (last) setProjectDir(last)
    void refreshSettings()
    void refreshProject(last ?? null)
    void refreshNpmrc(last ?? null)
  }, [])

  const selectProject = async () => {
    setError(null)
    if (!hasElectronBridge()) return refreshProject(projectDir)
    const res = await window.upm.selectProjectDir()
    if (!res.ok) return setError(res.error)
    if (!res.data) return
    localStorage.setItem(LS_PROJECT_DIR, res.data)
    setProjectDir(res.data)
    await refreshProject(res.data)
    await refreshNpmrc(res.data)
  }

  const doSearch = async (dir: string, q: string, limit: number) => {
    if (!hasElectronBridge()) return
    setRemoteLoading(true)
    try {
      const res = await window.upm.searchRegistry(dir, q, limit)
      if (!res.ok) return setError(res.error)
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

  const listItems = useMemo(() => {
    const ueOnly = settings?.ueOnlyFilter ?? false
    if (tab === 'REGISTRY') {
      const base = remoteItems
      const filtered = ueOnly ? base.filter((p) => p.isUnrealPlugin) : base
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
    if (!projectDir) return
    await act('links:sync', async () => {
      const res = await window.upm.syncLinks(projectDir)
      if (!res.ok) return setError(res.error)
      setLogText(formatLinkSyncLog(res.data))
      if (settings?.showLogDock ?? true) setLogVisible(true)
      const joined = [...res.data.warnings]
      if (res.data.error) joined.push(res.data.error)
      if (joined.length) setError(joined.join('\n'))
      await refreshProject(projectDir)
    })
  }

  useEffect(() => {
    if (!projectDir) return
    if (!projectState?.isUnrealProject) return
    if (!settings?.autoLinkUnrealPlugins) return
    if (autoSyncedProjectRef.current === projectDir) return
    autoSyncedProjectRef.current = projectDir
    void syncLinksNow()
  }, [projectDir, projectState?.isUnrealProject, settings?.autoLinkUnrealPlugins])

  useEffect(() => {
    if (settings?.showLogDock === false) setLogVisible(false)
  }, [settings?.showLogDock])

  return (
    <div className="app ue">
      <header className="ue-topbar">
        <div className="ue-toolbar">
          {isMac ? <div className="ue-traffic-spacer" aria-hidden="true" /> : null}
          <div className="ue-title">Unreal Package Manager</div>

          <div className="ue-tabs">
            <Tab active={tab === 'REGISTRY'} onClick={() => setTab('REGISTRY')}>
              My Registry
            </Tab>
            <Tab active={tab === 'PROJECT'} onClick={() => setTab('PROJECT')}>
              In Project
            </Tab>
            <Tab active={tab === 'UPDATES'} onClick={() => setTab('UPDATES')}>
              Updates
            </Tab>
          </div>

          <div className="ue-spacer" />

          <input
            className="ue-search"
            value={query}
            placeholder={tab === 'REGISTRY' ? 'Search registry...' : 'Filter...'}
            onChange={(e) => setQuery(e.target.value)}
          />

          <button className="btn" onClick={selectProject} disabled={busy !== null}>
            选择项目
          </button>
          <button className="btn" onClick={() => void refreshProject(projectDir)} disabled={busy !== null}>
            刷新
          </button>
          <button className="btn" onClick={() => setShowSettings(true)} disabled={!hasElectronBridge()}>
            设置
          </button>
        </div>

        <section className="ue-meta ue-meta-top">
          <div className="kv">
            <div className="k">Project</div>
            <div className="v mono">{projectDir ?? '未选择'}</div>
          </div>
          <div className="kv">
            <div className="k">Registry</div>
            <div className="v mono">{projectState?.npmrc?.values?.registry ?? '(project .npmrc)'}</div>
          </div>
          <div className="kv">
            <div className="k">Plugins Root</div>
            <div className="v mono">{projectState?.pluginsRootDir ?? '-'}</div>
          </div>
        </section>
      </header>

      <div className="ue-content">

        <div className="ue-notices">
          {projectState?.warnings?.length ? (
            <section className="panel warn">
              {projectState.warnings.map((w) => (
                <div key={w} className="line">
                  {w}
                </div>
              ))}
            </section>
          ) : null}

          {error ? (
            <section className="panel error">
              <div className="line" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </div>
            </section>
          ) : null}
        </div>

        <main className="ue-main">
          <aside className="ue-list">
            <div className="ue-list-header">
              <div className="muted">
                {projectState ? `${Math.min(visibleItems.length, listItems.length)} / ${listItems.length} items` : '...'}
                {tab === 'REGISTRY' && remoteLoading ? ' · loading…' : ''}
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
                        <span className={`badge ${p.status}`}>{statusLabel[p.status]}</span>
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
                <EmptyState title="未选择项目" description="点击右上角“选择项目”后查看内容。" />
              ) : tab === 'REGISTRY' ? (
                <EmptyState
                  title={remoteSearched ? '未找到包' : '开始搜索'}
                  description={
                    remoteSearched ? '试试更具体的关键词，或检查 Registry 配置与过滤条件。' : '在上方输入关键词进行搜索。'
                  }
                >
                  {remoteSearched ? (
                    <div className="muted">
                      <div>如果你配置的是公网源：</div>
                      <div>- 请先在设置里点“保存”（写入项目 .npmrc）</div>
                      <div>- 试试输入更具体的搜索词</div>
                      <div>- 关闭设置里的 UE Only 过滤（公网包通常不含 UE 关键字）</div>
                    </div>
                  ) : null}
                </EmptyState>
              ) : tab === 'UPDATES' ? (
                <EmptyState title="暂无更新" description="当前项目没有可更新的包。" />
              ) : (
                <EmptyState title="空列表" description="当前项目还没有安装任何包。" />
              )}
            </div>
          </aside>

          <section className="ue-detail">
            {!selected ? (
              <div className="ue-detail-empty">请选择左侧包</div>
            ) : (
              <PackageDetail
                projectDir={projectDir}
                selected={selected}
                busy={busy}
                detailTab={detailTab}
                setDetailTab={setDetailTab}
                installKind={installKind}
                setInstallKind={setInstallKind}
                installVersionOrTag={installVersionOrTag}
                setInstallVersionOrTag={setInstallVersionOrTag}
                onInstall={installSelected}
                onUninstall={uninstallSelected}
                onUpdate={updateSelected}
                onSyncLinks={syncLinksNow}
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
          onReload={async () => {
            await refreshSettings()
            await refreshProject(projectDir)
            await refreshNpmrc(projectDir)
          }}
          onSaveSettings={async (patch) => {
            setError(null)
            const res = await window.upm.setSettings(patch)
            if (!res.ok) return setError(res.error)
            setSettings(res.data)
          }}
          onSaveNpmrc={async (cfg) => {
            if (!projectDir) return
            const res = await window.upm.saveNpmrc(projectDir, cfg)
            if (!res.ok) return setError(res.error)
            setNpmrc(cfg)
          }}
        />
      ) : null}
    </div>
  )
}

const Tab: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children
}) => (
  <button className={`ue-tab ${active ? 'active' : ''}`} onClick={onClick}>
    {children}
  </button>
)

const LogDock: React.FC<{
  visible: boolean
  text: string
  onToggle: () => void
  onClear: () => void
}> = ({ visible, text, onToggle, onClear }) => {
  const [copyHint, setCopyHint] = useState<string | null>(null)
  const bodyRef = useRef<HTMLPreElement | null>(null)
  const display = text?.trim() ? text : 'No log.'

  useEffect(() => {
    if (!visible) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visible, display])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(display)
      setCopyHint('Copied')
      window.setTimeout(() => setCopyHint(null), 1200)
    } catch (e) {
      console.error(e)
      setCopyHint('Copy failed')
      window.setTimeout(() => setCopyHint(null), 1500)
    }
  }

  return (
    <section className={`ue-logdock ${visible ? 'open' : 'closed'}`} aria-label="Log">
      <div className="ue-logdock-header">
        <div className="ue-logdock-title">LOG</div>
        <div className="ue-logdock-spacer" />
        {copyHint ? <div className="muted mono">{copyHint}</div> : null}
        <button className="btn" onClick={onToggle}>
          {visible ? '隐藏' : '展示'}
        </button>
        <button className="btn" onClick={onClear} disabled={!text?.trim()}>
          清空
        </button>
        <button className="btn" onClick={() => void copy()}>
          复制
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
  detailTab: DetailTab
  setDetailTab: (t: DetailTab) => void
  installKind: 'runtime' | 'dev'
  setInstallKind: (v: 'runtime' | 'dev') => void
  installVersionOrTag: string
  setInstallVersionOrTag: (v: string) => void
  onInstall: () => Promise<void>
  onUninstall: () => Promise<void>
  onUpdate: () => Promise<void>
  onSyncLinks: () => Promise<void>
  setError: (v: string | null) => void
  onSetLogText: (v: string) => void
}> = ({
  projectDir,
  selected,
  busy,
  detailTab,
  setDetailTab,
  installKind,
  setInstallKind,
  installVersionOrTag,
  setInstallVersionOrTag,
  onInstall,
  onUninstall,
  onUpdate,
  onSyncLinks,
  setError,
  onSetLogText
}) => {
  const [metadata, setMetadata] = useState<any | null>(null)

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
            {selected.installedVersion ? `installed ${selected.installedVersion}` : 'not installed'}
            {selected.latestVersion ? ` · latest ${selected.latestVersion}` : ''}
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
                title="dependencies：项目运行时需要（推荐）；devDependencies：仅开发/构建阶段需要"
              >
                <option value="runtime">dependencies（推荐）</option>
                <option value="dev">devDependencies（开发/构建）</option>
              </select>
              <div className="muted" style={{ flexBasis: '100%' }}>
                不确定选哪个：一般 UE 插件包用 <span className="mono">dependencies</span>；只有工具链/脚本才放{' '}
                <span className="mono">devDependencies</span>。
              </div>
              <input
                className="input"
                value={installVersionOrTag}
                onChange={(e) => setInstallVersionOrTag(e.target.value)}
                placeholder="version/tag (default latest)"
                disabled={!canAct}
              />
              <button className="btn primary" onClick={() => void onInstall()} disabled={!canAct}>
                Install
              </button>
            </>
          ) : null}

          {selected.status === 'update_available' ? (
            <button className="btn primary" onClick={() => void onUpdate()} disabled={!canAct}>
              Update
            </button>
          ) : null}

          {selected.status !== 'remote' ? (
            <button className="btn danger" onClick={() => void onUninstall()} disabled={!canAct}>
              Remove
            </button>
          ) : null}

          <button className="btn" onClick={() => void onSyncLinks()} disabled={!canAct}>
            Sync Links
          </button>
        </div>
      </div>

      <div className="ue-detail-tabs">
        <Tab active={detailTab === 'INFO'} onClick={() => setDetailTab('INFO')}>
          INFO
        </Tab>
        <Tab active={detailTab === 'README'} onClick={() => setDetailTab('README')}>
          README
        </Tab>
        <Tab active={detailTab === 'VERSIONS'} onClick={() => setDetailTab('VERSIONS')}>
          VERSIONS
        </Tab>
      </div>

      <div className="ue-detail-body">
        {detailTab === 'INFO' ? (
          <div className="ue-grid">
            <InfoRow k="Version" v={metadata?.version ?? selected.latestVersion ?? '-'} mono />
            <InfoRow k="License" v={metadata?.license ?? '-'} mono />
            <InfoRow k="Author" v={metadata?.author ?? '-'} />
            <InfoRow k="Homepage" v={metadata?.homepageUrl ?? '-'} mono href={metadata?.homepageUrl} />
            <InfoRow k="Repository" v={metadata?.repositoryUrl ?? '-'} mono href={metadata?.repositoryUrl} />
            {metadata?.docsUrl ? <InfoRow k="Docs" v={metadata.docsUrl} mono href={metadata.docsUrl} /> : null}
            {metadata?.marketplaceUrl ? (
              <InfoRow k="Marketplace" v={metadata.marketplaceUrl} mono href={metadata.marketplaceUrl} />
            ) : null}
            {metadata?.supportUrl ? <InfoRow k="Support" v={metadata.supportUrl} mono href={metadata.supportUrl} /> : null}
            {metadata?.createdByUrl ? (
              <InfoRow k="CreatedBy" v={metadata?.createdBy ?? metadata.createdByUrl} mono href={metadata.createdByUrl} />
            ) : metadata?.createdBy ? (
              <InfoRow k="CreatedBy" v={metadata.createdBy} />
            ) : null}
          </div>
        ) : null}

        {detailTab === 'README' ? (
          metadata?.readme ? <MarkdownView markdown={metadata.readme} /> : <div className="muted">No readme.</div>
        ) : null}

        {detailTab === 'VERSIONS' ? (
          <div className="ue-versions">
            {(metadata?.versions ?? []).length ? (
              (metadata.versions ?? []).slice().reverse().slice(0, 80).map((v: string) => (
                <div key={v} className="ue-version">
                  <div className="mono">{v}</div>
                  <div className="mono muted">{metadata?.time?.[v] ?? ''}</div>
                </div>
              ))
            ) : (
              <div className="muted">No versions.</div>
            )}
          </div>
        ) : null}

      </div>
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
}> = ({ projectDir, settings, npmrc, onClose, onSaveSettings, onSaveNpmrc, onReload }) => {
  const [draft, setDraft] = useState<AppSettings>(
    settings ?? {
      npmExecutablePath: null,
      pluginsRootDirOverride: null,
      autoLinkUnrealPlugins: true,
      linkMode: 'auto',
      theme: 'system',
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

  const pickPluginsRoot = async () => {
    const res = await window.upm.selectDir('选择 Plugins 根目录（默认 <Project>/Plugins）')
    if (res.ok && res.data) setDraft((d) => ({ ...d, pluginsRootDirOverride: res.data }))
  }

  const addScope = () => {
    const scope = prompt('Scope（例如 @myco）')
    if (!scope) return
    setDraftNpmrc((c) => ({ ...c, scopedRegistries: { ...(c.scopedRegistries ?? {}), [scope]: '' } }))
  }

  const save = async () => {
    didCommitRef.current = true
    await onSaveSettings(draft)
    if (projectDir) await onSaveNpmrc(draftNpmrc)
    await onReload()
    onClose()
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
          <div className="modal-title">Settings</div>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="modal-layout">
          <div className="modal-sidebar">
            <button
              className={`modal-nav ${pane === 'appearance' ? 'active' : ''}`}
              onClick={() => setPane('appearance')}
            >
              Appearance
            </button>
            <button className={`modal-nav ${pane === 'registry' ? 'active' : ''}`} onClick={() => setPane('registry')}>
              Registry (.npmrc)
            </button>
            <button className={`modal-nav ${pane === 'npm' ? 'active' : ''}`} onClick={() => setPane('npm')}>
              NPM
            </button>
            <button className={`modal-nav ${pane === 'linking' ? 'active' : ''}`} onClick={() => setPane('linking')}>
              Linking
            </button>
            <div className="modal-sidebar-hint">
              <div className="muted">配置会写入：</div>
              <div className="mono muted">{projectDir ? `${projectDir}/.npmrc` : '<Project>/.npmrc'}</div>
            </div>
          </div>

          <div className="modal-body">
            {pane === 'appearance' ? (
              <>
                <div className="modal-section-title">Appearance</div>
                <div className="modal-row">
                  <div className="k">Theme</div>
                  <div className="v">
                    <select
                      className="select"
                      value={draft.theme}
                      onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as any }))}
                    >
                      <option value="system">跟随系统</option>
                      <option value="dark">暗色</option>
                      <option value="light">亮色</option>
                    </select>
                    <div className="muted" style={{ marginTop: 8 }}>
                      立即预览；保存后会持久化
                    </div>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">UE Only Filter</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.ueOnlyFilter}
                        onChange={(e) => setDraft((d) => ({ ...d, ueOnlyFilter: e.target.checked }))}
                      />{' '}
                      只显示 Unreal 插件包（按关键字/本地 <code className="mono">*.uplugin</code> 识别）
                    </label>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">Log Panel</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.showLogDock}
                        onChange={(e) => setDraft((d) => ({ ...d, showLogDock: e.target.checked }))}
                      />{' '}
                      显示底部日志面板（安装/卸载/同步后会写入日志）
                    </label>
                  </div>
                </div>
              </>
            ) : null}

            {pane === 'registry' ? (
              <>
                <div className="modal-section-title">Project .npmrc</div>
                {!projectDir ? (
                  <div className="muted" style={{ paddingTop: 8 }}>
                    请选择项目后再配置源（会写入 <code className="mono">&lt;Project&gt;/.npmrc</code>）
                  </div>
                ) : (
                  <>
                    <div className="modal-row">
                      <div className="k">registry</div>
                      <div className="v">
                        <input
                          className="input"
                          value={draftNpmrc.values?.registry ?? ''}
                          placeholder="例如 https://registry.npmjs.org/"
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
                          placeholder="例如 http://127.0.0.1:7890"
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
                          placeholder="例如 http://127.0.0.1:7890"
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
                      <div className="k">Scoped Registries</div>
                      <div className="v">
                        <div className="modal-actions">
                          <button className="btn" onClick={addScope}>
                            Add Scope
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
                                  placeholder="registry url"
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
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="muted" style={{ marginTop: 10 }}>
                            无 scoped registry
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="modal-row">
                      <div className="k">Registry Test</div>
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
                            用于快速判断 registry/proxy/auth 是否可用（使用项目 .npmrc）
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
                <div className="modal-section-title">NPM</div>
                <div className="modal-row">
                  <div className="k">Npm Executable Path</div>
                  <div className="v">
                    <input
                      className="input"
                      value={draft.npmExecutablePath ?? ''}
                      placeholder="空=使用 PATH 中的 npm（Windows: npm.cmd）"
                      onChange={(e) => setDraft((d) => ({ ...d, npmExecutablePath: e.target.value || null }))}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {pane === 'linking' ? (
              <>
                <div className="modal-section-title">Linking</div>
                <div className="modal-row">
                  <div className="k">Plugins Root Dir</div>
                  <div className="v">
                    <input
                      className="input"
                      value={draft.pluginsRootDirOverride ?? ''}
                      placeholder="空=使用 <Project>/Plugins"
                      onChange={(e) => setDraft((d) => ({ ...d, pluginsRootDirOverride: e.target.value || null }))}
                    />
                    <div className="modal-actions">
                      <button className="btn" onClick={pickPluginsRoot}>
                        选择…
                      </button>
                      <button className="btn" onClick={() => setDraft((d) => ({ ...d, pluginsRootDirOverride: null }))}>
                        重置
                      </button>
                    </div>
                  </div>
                </div>

                <div className="modal-row">
                  <div className="k">Auto Link UE Plugins</div>
                  <div className="v">
                    <label className="chk">
                      <input
                        type="checkbox"
                        checked={draft.autoLinkUnrealPlugins}
                        onChange={(e) => setDraft((d) => ({ ...d, autoLinkUnrealPlugins: e.target.checked }))}
                      />{' '}
                      安装/卸载后自动同步 <code className="mono">node_modules</code> → <code className="mono">Plugins/</code> 链接
                    </label>
                    <div className="muted" style={{ marginTop: 6 }}>
                      Windows 默认使用 Junction（mklink /J），macOS/Linux 使用 symlink；也可切换为拷贝模式。
                    </div>
                    <select
                      className="select"
                      value={draft.linkMode}
                      onChange={(e) => setDraft((d) => ({ ...d, linkMode: e.target.value as any }))}
                      style={{ marginTop: 8 }}
                    >
                      <option value="auto">Link (symlink/junction)</option>
                      <option value="copy">Copy</option>
                    </select>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={() => void onReload()}>
            重新加载
          </button>
          <button className="btn primary" onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
