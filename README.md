# Unreal Package Manager (Desktop)

<p>
  <a href="README.zh-CN.md"><kbd>中文版本</kbd></a>
</p>

Cross-platform desktop app (macOS / Windows / Linux), similar to Unity Package Manager, but for managing Unreal Engine plugins via npm registries:

- Uses your project `package.json` as the entry (dependencies/devDependencies)
- Configure the project `.npmrc` in Settings (registry / scoped registries / proxy, etc.)
- Remote search (npm registry) + preview (readme/versions)
- Install / uninstall / upgrade (via `npm install/uninstall/outdated/view/search`)
- After install, automatically link any package that contains `*.uplugin` in `node_modules` into `<Project>/Plugins/` so UE can discover it

## Development

```bash
cd unreal-package-manager
npm install
npm run dev
```

Note: `electron-vite dev` starts a renderer dev server at `http://localhost:5173/`. If the Electron app does not launch successfully (e.g. Electron binary not installed), opening that URL in a browser will only show a static page and **actions like “Select Folder / Install / Uninstall” will not work** (because `window.upm` is not injected by the preload script).

### Mainland China network (mirrors)

If you're behind restricted networks, you may need both an npm registry mirror and an Electron binary mirror, otherwise you can hit `Error: Electron uninstall`.

```bash
cd unreal-package-manager

# npm registry mirror (or your own private registry)
npm config set registry https://registry.npmmirror.com

# Electron binary mirror (recommended only during install)
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

npm run dev
```

## Build

```bash
cd unreal-package-manager
npm run build
```

Artifacts are written to `release/`.

## Settings

Top-right `Settings` supports:

- Project `.npmrc`: configure `registry` / `@scope:registry` / proxy, etc.
- `Plugins Root Dir Override`: override the target Plugins root (default `<Project>/Plugins`)
- `Auto Link UE Plugins`: after install/uninstall, sync `node_modules` -> `Plugins/` links (Windows uses junction)

If you configured a public registry but see no results under `My Registry`:

- Ensure you clicked `Save` in Settings (writes `<Project>/.npmrc`)
- `UE Only` filter is enabled by default; many public packages don’t include UE keywords — disable it or search by exact package name
- Use `npm ping` in Settings to validate registry/proxy/auth

## Troubleshooting

### Windows: `Error: spawn UNKNOWN`

This usually means the app is trying to run PowerShell’s `npm.ps1` script, which Node/Electron cannot spawn directly.

- In `Settings`, set `npm executable path` explicitly to `C:\\Program Files\\nodejs\\npm.cmd` (or wherever your `npm.cmd` is)
- Run `where npm` and ensure `npm.cmd` is listed, then restart the app

## Creating a compliant npm package (UE plugin)

This app detects local UE plugins by scanning each installed package directory in `node_modules` for `*.uplugin` (package root only). To make your package work well:

1) Put `<PluginName>.uplugin` at the root of your npm package (not nested).
2) Make sure the published tarball includes the `.uplugin`, binaries, content, and resources (use `files` or `.npmignore`).
3) Add UE keywords so remote search can recognize it (for the built-in `UE Only` filter): `unreal-engine`, `ue5`, `ue4`, `uplugin`, etc.
4) Use valid npm fields (`name`, `version`, `license`, `description`, etc.); custom fields are allowed.

### Suggested `package.json` template

The app reads both Unreal-style keys (`Category`, `CreatedBy`, `DocsURL`, ...) and camelCase variants (`category`, `createdBy`, `docsURL`, ...). Keep whichever you prefer, but ensure JSON is valid.

```json
{
  "name": "com.xxx.xxx",
  "displayName": "Package Manager SDK",
  "version": "0.2.1",
  "description": "An Unreal Engine Game Package Manager SDK",
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
    "registry": "https://your-private-registry.example.com"
  }
}
```

### Minimal publish checklist

- `name`: npm package name (lowercase; scoped `@scope/name` is recommended for private registries)
- `version`: SemVer (e.g. `0.2.1`)
- `publishConfig.registry`: your private registry URL (avoid committing credentials into project `.npmrc`)
- `keywords`: include at least one UE keyword for better discovery
- Package root contains `*.uplugin`

Tip: run `npm pack --dry-run` before publishing to verify the tarball includes your `.uplugin` and required files.

## GitHub Actions

Workflow is in `.github/workflows/unreal-package-manager-desktop.yml`.  
Pushing a tag (e.g. `v0.1.0`) builds on macOS / Windows / Linux, uploads `release/**` as artifacts, and publishes them to GitHub Releases.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Troubleshooting

### `Error: Electron uninstall`

This usually means the `electron` binary download failed (`node_modules/electron/dist` missing), often due to network/proxy issues or an interrupted install.

```bash
cd unreal-package-manager
rm -rf node_modules/electron

# Optional: if you're behind restricted networks, set mirrors and reinstall
npm config set registry https://registry.npmmirror.com
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

npm install
npm run dev
```
