# Repository Guidelines

## Project Structure & Module Organization

- `src/main/`: Electron main process (IPC handlers, npm/project operations, settings).
- `src/preload/`: Preload bridge that exposes a limited API to the renderer (e.g. `window.upm`).
- `src/renderer/`: Vite + React UI (`src/renderer/src/ui/` for components, `styles.css` for styling).
- `src/shared/`: Types shared between main/preload/renderer (`src/shared/types.ts`).
- Build outputs: `dist/` (bundled app code), `release/` (packaged installers via electron-builder).

## Build, Test, and Development Commands

```bash
npm install     # install dependencies (Electron download happens here)
npm run dev     # start electron-vite dev (renderer dev server + Electron app)
npm run build   # build + package into release/
```

Notes:
- `npm run dev` requires Electron to launch; otherwise the renderer URL (`http://localhost:5173/`) will not have the preload API.
- For constrained networks you may need `ELECTRON_MIRROR=... npm install` (see `README.md`).

## Coding Style & Naming Conventions

- Language: TypeScript (strict). Keep changes type-safe and avoid `any` unless unavoidable.
- Formatting: follow existing style (2-space indent, single quotes, minimal semicolons).
- Naming:
  - React components: `PascalCase` (e.g. `App.tsx`).
  - Modules/files: `camelCase.ts` (e.g. `projectManager.ts`, `uePluginLinker.ts`).

## Testing Guidelines

- No dedicated test runner is configured yet (no `npm test` script).
- Do a quick smoke test in `npm run dev`: select a project, load state, search registry, install/uninstall, and verify plugin linking.

## Commit & Pull Request Guidelines

- Current Git history is minimal and informal (e.g. `push`). Use clearer messages going forward (imperative, scoped): `main: fix npmrc parsing`.
- PRs should include: a short description, steps to verify, and screenshots/GIFs for UI changes. Call out OS-specific behavior (macOS/Windows/Linux).

## Security & Configuration Tips

- Never commit credentials in project `.npmrc` files. Prefer environment variables or local user config.
- Packaging output (`release/`) and dependencies (`node_modules/`) should not be committed.

