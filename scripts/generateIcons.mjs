import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const iconPng = path.join(rootDir, 'build', 'icon.png')
const iconIcns = path.join(rootDir, 'build', 'icon.icns')
const iconIco = path.join(rootDir, 'build', 'icon.ico')

const require = createRequire(import.meta.url)
const { appBuilderPath } = require('app-builder-bin')

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

const hasFile = (p) => {
  try {
    fs.accessSync(p, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

if (!hasFile(iconPng)) {
  console.error(`Missing: ${path.relative(rootDir, iconPng)}`)
  process.exit(1)
}

run(appBuilderPath, ['icon', '--input', iconPng, '--format', 'icns', '--out', path.dirname(iconIcns)])
run(appBuilderPath, ['icon', '--input', iconPng, '--format', 'ico', '--out', path.dirname(iconIco)])

if (hasFile(iconIcns)) console.log(`Wrote: ${path.relative(rootDir, iconIcns)}`)
if (hasFile(iconIco)) console.log(`Wrote: ${path.relative(rootDir, iconIco)}`)
