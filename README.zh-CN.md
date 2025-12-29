# Unreal Package Manager (Desktop)

<p>
  <a href="README.md"><kbd>English</kbd></a>
</p>

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

产物输出在 `release/`。

## 设置

应用右上角 `设置` 支持：

- 项目 `.npmrc`：配置 `registry` / `@scope:registry` / proxy 等
- `Plugins Root Dir Override`：自定义目标 Plugins 根目录（默认 `<Project>/Plugins`）
- `Auto Link UE Plugins`：安装/卸载后自动同步 `node_modules` -> `Plugins/` 链接（Windows 使用 junction）

如果你配置了公网源但 `My Registry` 里看不到结果：

- 确认在设置里点了 `保存`（会写入 `<Project>/.npmrc`）
- 默认开启了 `UE Only` 过滤；公网源大部分包不带 UE 关键字，先关闭该过滤或直接搜索你的包名
- 在设置里用 `npm ping` 测试 registry/proxy/auth 是否可用

## 如何构造符合标准的 npm 包（UE 插件）

本应用通过扫描 `node_modules/<package>/` 目录下（仅包根目录）是否存在 `*.uplugin` 来识别 UE 插件包，并在开启自动链接时把它链接到 `<Project>/Plugins/<PluginName>`。

要让你的包“符合标准”且在 UPM 里可用，建议遵循：

1) 把 `<PluginName>.uplugin` 放在 npm 包根目录（不要嵌套到子目录里）。
2) 确保发布到 registry 的 tarball 里包含 `.uplugin`、二进制、内容、资源等（用 `files` 或 `.npmignore` 控制）。
3) `keywords` 至少包含一个 UE 关键词，便于远程搜索识别（`UE Only` 过滤会用到）：`unreal-engine` / `ue5` / `ue4` / `uplugin` 等。
4) 保持 `package.json` 的 npm 标准字段正确（`name` / `version` / `license` / `description` 等），扩展字段可以自定义。

### 从（.uplugin/.uproject）字段复用到 `package.json`

UPM 读取包元信息时，既支持 Unreal 风格的键（`Category`, `CreatedBy`, `DocsURL`...），也支持 camelCase 版本（`category`, `createdBy`, `docsURL`...）。你可以按习惯选择，但务必保证 JSON 合法。

示例（修正为合法 JSON）：

```json
{
  "name": "com.xxx.xxx",
  "displayName": "Package Manager SDK",
  "version": "0.2.1",
  "description": "A Unreal Engine Game Package Manager SDK",
  "author": {
    "name": "Jackson",
    "email": "apple.developer@email.cn",
    "url": "https://games.xxx.com"
  },
  "license": "MIT",
  "engines": {
    "unreal": "^4.27.0"
  },
  "Category": "SDK",
  "CreatedBy": "Games",
  "CreatedByURL": "https://rightai.com",
  "DocsURL": "",
  "MarketplaceURL": "",
  "SupportURL": "",
  "EnabledByDefault": true,
  "CanContainContent": false,
  "IsBetaVersion": false,
  "keywords": [
    "unreal-engine",
    "ue5",
    "ue4",
    "uobject",
    "plugin"
  ],
  "publishConfig": {
    "registry": "你的私有源（URL）"
  }
}
```

### 最小发布清单（建议）

- `name`：npm 包名（必须小写；私服建议用 scoped 包名 `@scope/name`）
- `version`：SemVer（例如 `0.2.1`）
- `publishConfig.registry`：你的私有源 URL（不要把 token/密码提交到项目 `.npmrc`）
- `keywords`：包含 UE 关键词便于检索
- npm 包根目录存在 `*.uplugin`

提示：发布前可以先跑一次 `npm pack --dry-run`，确认打包产物里包含 `.uplugin` 和所需文件。

## GitHub Actions

工作流位于仓库根目录：`.github/workflows/unreal-package-manager-desktop.yml`  
推送 tag（例如 `v0.1.0`）后会在 macOS / Windows / Linux 上分别构建，并上传 `release/**` 作为 artifacts，同时发布到对应的 GitHub Release 附件里。

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 常见问题

### Windows：`Error: spawn UNKNOWN`

这通常表示应用在运行 npm 时命中了 PowerShell 版本的 `npm.ps1`（脚本），而 Node/Electron 无法直接 `spawn` 该脚本。

解决方法：

- 在应用右上角 `设置` 里，把 `npm executable path` 显式设置为 `C:\\Program Files\\nodejs\\npm.cmd`（或你机器上的 `npm.cmd`）
- 在命令行运行 `where npm`，确认输出里包含 `npm.cmd`，然后重启应用

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
