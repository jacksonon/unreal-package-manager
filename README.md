# Unreal Package Manager (Desktop)

跨端桌面端应用（macOS / Windows / Linux），用于管理 Unreal 项目 `Plugins/` 中的插件：

- 选择项目文件夹（包含 `.uproject` 的目录，或任意项目根目录）
- 列出已安装插件（扫描 `<Project>/Plugins/**/*.uplugin`）
- 从内置 `packages` 仓库安装 / 卸载 / 升级插件（文件拷贝到 `<Project>/Plugins/<PluginId>`）

## 开发

```bash
cd unreal-package-manager
npm install
npm run dev
```

开发模式下会默认读取仓库根目录的 `package/` 作为插件源（即 `../package`）。

## 构建

```bash
cd unreal-package-manager
npm run build
```

产物输出在 `unreal-package-manager/release/`。

构建时会把仓库根目录的 `package/` 打包进应用资源目录（`extraResources -> packages`），用于离线安装。

## GitHub Actions

工作流位于仓库根目录：`.github/workflows/unreal-package-manager-desktop.yml`  
会在 macOS / Windows / Linux 上分别构建，并上传 `unreal-package-manager/release/**` 作为 artifacts。

