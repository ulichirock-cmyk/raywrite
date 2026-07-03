// 全局热键唤出窗口：默认 Ctrl+Shift+Space，可在设置面板改。当前值持久化到
// data/settings.json（跟 cards.json 同一个数据根，随 AGENT_TEXT_ROOT 走）。
import { app, globalShortcut } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_ACCELERATOR = 'Control+Shift+Space'

let ctx = null // { getDataRoot, showWindow }
let current = DEFAULT_ACCELERATOR

function settingsFile() {
  return path.join(ctx.getDataRoot(), 'data', 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(patch) {
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const next = { ...readSettings(), ...patch }
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, file)
}

// 换绑：先取消旧的再注册新的，避免新的注册失败时旧热键也丢了
function register(accelerator) {
  globalShortcut.unregisterAll()
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, () => ctx.showWindow())
  } catch {
    ok = false
  }
  if (ok) current = accelerator
  return ok
}

export function initShortcut(options) {
  ctx = options
  const saved = readSettings().globalShortcut
  if (saved) {
    current = saved
    if (!register(saved)) register(DEFAULT_ACCELERATOR) // 存的热键这次注册不了（比如被别的软件占了），退回默认
  } else {
    register(DEFAULT_ACCELERATOR)
  }
  app.on('will-quit', () => globalShortcut.unregisterAll())
}

export function getShortcut() {
  return current
}

// 渲染进程改热键：成功则持久化并返回 {ok:true, accelerator}；
// 冲突/非法组合会自动退回之前的值，返回 {ok:false, accelerator: 退回后的值}
export function setShortcut(accelerator) {
  if (!accelerator || typeof accelerator !== 'string') return { ok: false, accelerator: current }
  const prev = current
  const ok = register(accelerator)
  if (!ok) {
    register(prev)
    return { ok: false, accelerator: prev }
  }
  writeSettings({ globalShortcut: accelerator })
  return { ok: true, accelerator }
}
