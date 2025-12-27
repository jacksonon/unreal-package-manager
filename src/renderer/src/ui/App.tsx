import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, NpmrcConfig, PackageListItem, ProjectState } from '@shared/types'

type MainTab = 'REGISTRY' | 'PROJECT' | 'UPDATES'
type DetailTab = 'INFO' | 'README' | 'VERSIONS' | 'LOG'

const LS_PROJECT_DIR = 'upm:lastProjectDir'

const hasElectronBridge = () => typeof window !== 'undefined' && typeof window.upm?.getProjectState === 'function'

export const App: React.FC = () => {
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [projectState, setProjectState] = useState<ProjectState | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [npmrc, setNpmrc] = useState<NpmrcConfig | null>(null)

  const [tab, setTab] = useState<MainTab>('REGISTRY')
  const [detailTab, setDetailTab] = useState<DetailTab>('INFO')

  const [query, setQuery] = useState('')
  const [ueOnly, setUeOnly] = useState(true)
  const [remoteItems, setRemoteItems] = useState<PackageListItem[]>([])
  const [remoteSearched, setRemoteSearched] = useState(false)
  const [selectedName, setSelectedName] = useState<string | null>(null)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const [installKind, setInstallKind] = useState<'runtime' | 'dev'>('runtime')
  const [installVersionOrTag, setInstallVersionOrTag] = useState('latest')

  const searchTimer = useRef<number | null>(null)

  const refreshSettings = async () => {
    if (!hasElectronBridge()) return
    const res = await window.upm.getSettings()
    if (!res.ok) return setError(res.error)
    setSettings(res.data)
  }

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

  const doSearch = async (dir: string, q: string) => {
    if (!hasElectronBridge()) return
    const res = await window.upm.searchRegistry(dir, q, 200)
    if (!res.ok) return setError(res.error)
    setRemoteItems(res.data)
    setRemoteSearched(true)
  }

  useEffect(() => {
    if (tab !== 'REGISTRY') return
    if (!projectDir) return
    if (!hasElectronBridge()) return
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      void doSearch(projectDir, query)
    }, 350)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [tab, projectDir, query])

  const listItems = useMemo(() => {
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
  }, [tab, projectState, remoteItems, ueOnly, query])

  const selected = useMemo(() => {
    if (!selectedName) return null
    return listItems.find((p) => p.name === selectedName) ?? null
  }, [listItems, selectedName])

  useEffect(() => {
    if (!selectedName && listItems.length) setSelectedName(listItems[0]!.name)
    if (selectedName && !listItems.some((p) => p.name === selectedName)) setSelectedName(listItems[0]?.name ?? null)
  }, [listItems, selectedName])

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
      setTab('PROJECT')
    })
  }

  const uninstallSelected = async () => {
    if (!projectDir || !selected) return
    await act(`uninstall:${selected.name}`, async () => {
      const res = await window.upm.uninstallPackage(projectDir, selected.name)
      if (!res.ok) return setError(res.error)
      setProjectState(res.data)
    })
  }

  const updateSelected = async () => {
    if (!projectDir || !selected) return
    await act(`update:${selected.name}`, async () => {
      const res = await window.upm.updatePackage(projectDir, selected.name)
      if (!res.ok) return setError(res.error)
      setProjectState(res.data)
    })
  }

  const syncLinksNow = async () => {
    if (!projectDir) return
    await act('links:sync', async () => {
      const res = await window.upm.syncLinks(projectDir)
      if (!res.ok) return setError(res.error)
      const joined = [...res.data.warnings]
      if (res.data.error) joined.push(res.data.error)
      if (joined.length) setError(joined.join('\n'))
      await refreshProject(projectDir)
    })
  }

  return (
    <div className="app ue">
      <header className="ue-toolbar">
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

        <label className="chk">
          <input type="checkbox" checked={ueOnly} onChange={(e) => setUeOnly(e.target.checked)} /> UE Only
        </label>

        <button className="btn" onClick={selectProject} disabled={busy !== null}>
          选择项目
        </button>
        <button className="btn" onClick={() => void refreshProject(projectDir)} disabled={busy !== null}>
          刷新
        </button>
        <button className="btn" onClick={() => setShowSettings(true)} disabled={!hasElectronBridge()}>
          设置
        </button>
      </header>

      <div className="ue-content">
        <section className="ue-meta">
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
              <div className="muted">{projectState ? `${listItems.length} items` : '...'}</div>
            </div>
            <div className="ue-list-body">
              {listItems.map((p) => (
                <button
                  key={p.name}
                  className={`ue-item ${selectedName === p.name ? 'active' : ''}`}
                  onClick={() => setSelectedName(p.name)}
                >
                  <div className="ue-item-top">
                    <div className="ue-item-name">{p.displayName ?? p.name}</div>
                    <span className={`badge ${p.status}`}>{p.status}</span>
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
              ))}
              {listItems.length === 0 ? (
                <div className="empty">
                  {tab === 'REGISTRY' && remoteSearched ? (
                    <>
                      <div className="muted">未找到包。</div>
                      <div className="muted">如果你配置的是公网源：</div>
                      <div className="muted">- 请先在设置里点“保存”（写入项目 .npmrc）</div>
                      <div className="muted">- 试试输入更具体的搜索词</div>
                      <div className="muted">- 关闭上面的 UE Only 过滤（公网包通常不含 UE 关键字）</div>
                    </>
                  ) : (
                    'No packages'
                  )}
                </div>
              ) : null}
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
              />
            )}
          </section>
        </main>
      </div>

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
  setError
}) => {
  const [metadata, setMetadata] = useState<any | null>(null)
  const [log, setLog] = useState<any | null>(null)

  useEffect(() => {
    const load = async () => {
      setError(null)
      setMetadata(null)
      setLog(null)
      if (!projectDir) return
      const res = await window.upm.getPackageMetadata(projectDir, selected.name)
      if (!res.ok) return setError(res.error)
      setMetadata(res.data.metadata)
      setLog(res.data.log)
    }
    void load()
  }, [projectDir, selected.name])

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
              >
                <option value="runtime">dependencies</option>
                <option value="dev">devDependencies</option>
              </select>
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
        <Tab active={detailTab === 'LOG'} onClick={() => setDetailTab('LOG')}>
          LOG
        </Tab>
      </div>

      <div className="ue-detail-body">
        {detailTab === 'INFO' ? (
          <div className="ue-grid">
            <InfoRow k="Version" v={metadata?.version ?? selected.latestVersion ?? '-'} mono />
            <InfoRow k="License" v={metadata?.license ?? '-'} mono />
            <InfoRow k="Author" v={metadata?.author ?? '-'} />
            <InfoRow k="Homepage" v={metadata?.homepageUrl ?? '-'} mono />
            <InfoRow k="Repository" v={metadata?.repositoryUrl ?? '-'} mono />
          </div>
        ) : null}

        {detailTab === 'README' ? (
          <pre className="readme">{metadata?.readme ?? 'No readme.'}</pre>
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

        {detailTab === 'LOG' ? (
          <pre className="readme">{log ? `${log.cmd}\n\n${log.stdout}\n${log.stderr}` : 'No log.'}</pre>
        ) : null}
      </div>
    </>
  )
}

const InfoRow: React.FC<{ k: string; v: string; mono?: boolean }> = ({ k, v, mono }) => (
  <div className="ue-inforow">
    <div className="k">{k}</div>
    <div className={`v ${mono ? 'mono' : ''}`}>{v}</div>
  </div>
)

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
      linkMode: 'auto'
    }
  )
  const [draftNpmrc, setDraftNpmrc] = useState<NpmrcConfig>(npmrc ?? { values: {}, scopedRegistries: {} })
  const [pingLog, setPingLog] = useState<string | null>(null)
  const [pane, setPane] = useState<'registry' | 'npm' | 'linking'>('registry')

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])
  useEffect(() => {
    if (npmrc) setDraftNpmrc(npmrc)
  }, [npmrc])

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
