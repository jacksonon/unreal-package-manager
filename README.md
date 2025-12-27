# Unreal Package Manager (Desktop)

跨端桌面端应用（macOS / Windows / Linux），类似 Unity Package Manager，但用于管理 Unreal 插件：

- 以项目 `package.json` 为入口（dependencies/devDependencies）
- 在设置里配置项目 `.npmrc`（registry / scoped registries / proxy 等）
- 远程搜索（npm registry）、预览（readme/versions）
- 安装 / 卸载 / 升级（调用 `npm install/uninstall/outdated/view/search`）
- 安装后可把 `node_modules` 里包含 `*.uplugin` 的包自动链接到 `<Project>/Plugins/`（让 UE 可发现）

## 开发

```bash
cd unreal-package-manager
npm install
npm run dev
```

注意：`electron-vite dev` 会同时启动一个 renderer 的 dev server（`http://localhost:5173/`）。如果 Electron App 没启动成功（比如 Electron 二进制没装好），你在浏览器里打开这个 URL 只能看到静态页面，**“选择文件夹/安装/卸载”都会无效**（因为 `window.upm` 没有被 preload 注入）。

### 国内网络（镜像）

如果你在国内网络环境，通常需要同时设置 npm 镜像与 Electron 二进制镜像，否则会出现 `Error: Electron uninstall`。

```bash
cd unreal-package-manager

# npm 镜像（也可以用你自己的公司/私服镜像）
npm config set registry https://registry.npmmirror.com

# Electron 二进制镜像（建议只在安装时临时设置）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

npm run dev
```

## 构建

```bash
cd unreal-package-manager
npm run build
```

产物输出在 `unreal-package-manager/release/`。

## 设置

应用右上角 `设置` 支持：

- 项目 `.npmrc`：配置 `registry` / `@scope:registry` / proxy 等
- `Plugins Root Dir Override`：自定义目标 Plugins 根目录（默认 `<Project>/Plugins`）
- `Auto Link UE Plugins`：安装/卸载后自动同步 `node_modules` -> `Plugins/` 链接（Windows 使用 junction）

## GitHub Actions

工作流位于仓库根目录：`.github/workflows/unreal-package-manager-desktop.yml`  
会在 macOS / Windows / Linux 上分别构建，并上传 `unreal-package-manager/release/**` 作为 artifacts。

## 常见问题

### `Error: Electron uninstall`

这表示 `electron` 包的二进制没下载成功（`node_modules/electron/dist` 缺失），通常是网络/代理导致 postinstall 下载失败，或安装过程被中断。

```bash
cd unreal-package-manager
rm -rf node_modules/electron

# 可选：如果你在国内网络环境，先设置镜像再装
npm config set registry https://registry.npmmirror.com
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

npm install
npm run dev
```
