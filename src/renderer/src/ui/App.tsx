import React, { useEffect, useMemo, useState } from 'react'
import type { PluginRow, PluginState } from '@shared/types'

const LS_PROJECT_DIR = 'upm:lastProjectDir'

const statusText: Record<PluginRow['status'], string> = {
  available: '可安装',
  installed: '已安装',
  update_available: '可升级',
  installed_external: '已安装（非内置包）'
}

export const App: React.FC = () => {
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [state, setState] = useState<PluginState | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = async (dir: string | null) => {
    const res = await window.upm.getState(dir)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setState(res.data)
  }

  useEffect(() => {
    const last = localStorage.getItem(LS_PROJECT_DIR)
    if (last) {
      setProjectDir(last)
      void refresh(last)
    } else {
      void refresh(null)
    }
  }, [])

  const selectProject = async () => {
    setError(null)
    const res = await window.upm.selectProjectDir()
    if (!res.ok) return setError(res.error)
    if (!res.data) return

    localStorage.setItem(LS_PROJECT_DIR, res.data)
    setProjectDir(res.data)
    await refresh(res.data)
  }

  const act = async (pluginId: string, fn: () => Promise<{ ok: boolean; data?: PluginState; error?: string }>) => {
    setError(null)
    setBusyId(pluginId)
    try {
      const res = await fn()
      if (!res.ok) setError(res.error ?? '操作失败')
      else if (res.data) setState(res.data)
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const plugins = state?.plugins ?? []
    if (!query.trim()) return plugins
    const q = query.trim().toLowerCase()
    return plugins.filter((p) => (p.id + ' ' + p.friendlyName + ' ' + (p.description ?? '')).toLowerCase().includes(q))
  }, [state, query])

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">Unreal Package Manager</div>
        <div className="actions">
          <button className="btn" onClick={selectProject}>
            选择项目文件夹
          </button>
          <button className="btn" onClick={() => void refresh(projectDir)} disabled={busyId !== null}>
            刷新
          </button>
        </div>
      </header>

      <section className="meta">
        <div className="kv">
          <div className="k">项目目录</div>
          <div className="v mono">{projectDir ?? '未选择'}</div>
        </div>
        <div className="kv">
          <div className="k">packages 目录</div>
          <div className="v mono">{state?.packagesDir ?? '-'}</div>
        </div>
        <div className="kv">
          <div className="k">搜索</div>
          <div className="v">
            <input
              className="input"
              value={query}
              placeholder="按插件名/描述过滤"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </section>

      {state?.warnings?.length ? (
        <section className="panel warn">
          {state.warnings.map((w) => (
            <div key={w} className="line">
              {w}
            </div>
          ))}
        </section>
      ) : null}

      {error ? (
        <section className="panel error">
          <div className="line">{error}</div>
        </section>
      ) : null}

      <section className="panel">
        <div className="table">
          <div className="thead">
            <div>插件</div>
            <div>已安装</div>
            <div>可用版本</div>
            <div>状态</div>
            <div>操作</div>
          </div>
          <div className="tbody">
            {filtered.map((p) => (
              <PluginRowView
                key={p.id}
                plugin={p}
                disabled={!projectDir || busyId !== null}
                busy={busyId === p.id}
                onInstall={() =>
                  act(p.id, () => window.upm.install(projectDir!, p.id))
                }
                onUninstall={() =>
                  act(p.id, () => window.upm.uninstall(projectDir!, p.id))
                }
                onUpgrade={() =>
                  act(p.id, () => window.upm.upgrade(projectDir!, p.id))
                }
              />
            ))}
            {filtered.length === 0 ? <div className="empty">无匹配插件</div> : null}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="muted">
          {state ? `共 ${state.plugins.length} 个插件` : '加载中...'} · 状态：
          {Object.entries(statusText)
            .map(([k, v]) => `${v}(${k})`)
            .join(' / ')}
        </div>
      </footer>
    </div>
  )
}

const PluginRowView: React.FC<{
  plugin: PluginRow
  disabled: boolean
  busy: boolean
  onInstall: () => void
  onUninstall: () => void
  onUpgrade: () => void
}> = ({ plugin, disabled, busy, onInstall, onUninstall, onUpgrade }) => {
  const actions = (() => {
    if (plugin.status === 'available') {
      return (
        <button className="btn primary" onClick={onInstall} disabled={disabled || busy}>
          安装
        </button>
      )
    }
    if (plugin.status === 'update_available') {
      return (
        <>
          <button className="btn primary" onClick={onUpgrade} disabled={disabled || busy}>
            升级
          </button>
          <button className="btn danger" onClick={onUninstall} disabled={disabled || busy}>
            卸载
          </button>
        </>
      )
    }
    if (plugin.status === 'installed' || plugin.status === 'installed_external') {
      return (
        <button className="btn danger" onClick={onUninstall} disabled={disabled || busy}>
          卸载
        </button>
      )
    }
    return null
  })()

  return (
    <div className="tr">
      <div>
        <div className="name">{plugin.friendlyName}</div>
        <div className="sub mono">{plugin.id}</div>
        {plugin.description ? <div className="sub">{plugin.description}</div> : null}
      </div>
      <div className="mono">{plugin.installedVersion ?? '-'}</div>
      <div className="mono">{plugin.availableVersion ?? '-'}</div>
      <div>
        <span className={`badge ${plugin.status}`}>{statusText[plugin.status]}</span>
      </div>
      <div className="ops">{busy ? <span className="muted">处理中…</span> : actions}</div>
    </div>
  )
}

