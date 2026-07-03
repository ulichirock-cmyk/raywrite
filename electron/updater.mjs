// 更新检查 + portable exe 自替换。
// electron-updater 不支持 portable 目标，这里是它的轻量替代：
// GitHub API 查 latest release → 弹窗确认 → 下载新 exe 到当前 exe 旁（.part 后缀）
// → 退出时 spawn 一个隐藏 PowerShell 等 portable launcher 释放旧 exe → 覆盖 → 重启。
// 替换始终写回原 exe 路径，用户的快捷方式/摆放位置不受影响（文件名里的旧版本号只是初始下载名）。
import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const REPO = 'ulichirock-cmyk/raywrite' // GitHub Release 来源，仓库迁移时改这里
const UA = { 'User-Agent': 'agentText-updater' }

let ctx = null // { getWin, quitApp }，由 initUpdater 注入
let pending = null // { src, dst }：已下载、等退出时替换
let replacerSpawned = false
let promptedVersion = null // 本次会话已提示过的版本，静默检查不重复弹
let busy = false

export function initUpdater(options) {
  ctx = options
  // 无论「立即重启」还是用户日后从托盘退出，替换脚本都在真正退出前拉起
  app.on('before-quit', spawnReplacer)
  if (app.isPackaged) {
    setTimeout(() => checkForUpdate(false).catch(() => {}), 5000)
    // 托盘保活可能常驻数天，定期再看一眼
    setInterval(() => checkForUpdate(false).catch(() => {}), 6 * 60 * 60 * 1000)
  }
}

export async function checkForUpdate(interactive = false) {
  if (busy || !ctx) return
  busy = true
  try {
    const win = ctx.getWin()
    if (pending) {
      if (interactive) await msg(win, '更新已下载', '退出或重启应用后自动完成替换。')
      return
    }

    const cur = app.getVersion()
    let rel
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { ...UA, Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) throw new Error(`GitHub API ${res.status}`)
      rel = await res.json()
    } catch (err) {
      if (interactive) await msg(win, '检查更新失败', String(err?.message || err))
      return
    }

    const latest = String(rel.tag_name || '').replace(/^v/, '')
    if (!latest || !newer(latest, cur)) {
      if (interactive) await msg(win, '已是最新版本', `当前 v${cur} 即最新发布版本。`)
      return
    }
    if (!interactive && promptedVersion === latest) return
    promptedVersion = latest

    const asset = (rel.assets || []).find((a) => a.name?.endsWith('.exe'))
    // 只有 electron-builder portable launcher 会设这个 env，天然限定 Windows 打包形态
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE
    const canSelfUpdate = Boolean(exePath && asset)

    const ask = await showBox(win, {
      type: 'info',
      title: '发现新版本',
      message: `检测到新版本 v${latest}（当前 v${cur}）`,
      detail: canSelfUpdate
        ? '下载完成后将替换当前 exe，可选择立即重启或退出时自动完成。'
        : '当前运行形态不支持自动替换，将打开下载页面。',
      buttons: canSelfUpdate ? ['下载并更新', '稍后'] : ['打开下载页', '稍后'],
      defaultId: 0,
      cancelId: 1,
    })
    if (ask.response !== 0) return
    if (!canSelfUpdate) {
      shell.openExternal(rel.html_url || `https://github.com/${REPO}/releases/latest`)
      return
    }

    // 优先下到 exe 同目录（替换时同卷 move 最快），目录不可写则兜底到临时目录
    let src = path.join(path.dirname(exePath), asset.name + '.part')
    try {
      await download(asset, src, win)
    } catch {
      src = path.join(os.tmpdir(), asset.name + '.part')
      try {
        await download(asset, src, win)
      } catch (err) {
        await msg(win, '下载更新失败', String(err?.message || err))
        return
      }
    }
    pending = { src, dst: exePath }

    const act = await showBox(win, {
      type: 'question',
      title: '更新已就绪',
      message: `v${latest} 已下载完成，立即重启更新？`,
      detail: '选择「退出时更新」则在下次退出应用时自动完成替换并不再打扰。',
      buttons: ['立即重启', '退出时更新'],
      defaultId: 0,
      cancelId: 1,
    })
    if (act.response === 0) ctx.quitApp()
  } finally {
    busy = false
  }
}

// a > b ?（简单三段数值比较，够用于 X.Y.Z）
function newer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

async function download(asset, dest, win) {
  const res = await fetch(asset.browser_download_url, { headers: UA })
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || asset.size || 0
  let got = 0
  const progress = new Transform({
    transform(chunk, _enc, cb) {
      got += chunk.length
      if (total && win && !win.isDestroyed()) win.setProgressBar(got / total)
      cb(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(res.body), progress, fs.createWriteStream(dest))
    if (asset.size && fs.statSync(dest).size !== asset.size) throw new Error('文件大小校验不符')
  } catch (err) {
    fs.rmSync(dest, { force: true })
    throw err
  } finally {
    if (win && !win.isDestroyed()) win.setProgressBar(-1)
  }
}

// 隐藏 PowerShell 轮询等旧 exe 解锁（launcher 退出）→ 覆盖 → 重启新版。
// 用 -EncodedCommand（UTF-16 base64）而不是 .bat，避免中文路径的代码页坑。
function spawnReplacer() {
  if (!pending || replacerSpawned) return
  replacerSpawned = true
  const q = (s) => `'${s.replace(/'/g, "''")}'`
  const ps = [
    `$src = ${q(pending.src)}`,
    `$dst = ${q(pending.dst)}`,
    'for ($i = 0; $i -lt 120; $i++) {',
    '  Start-Sleep -Milliseconds 1000',
    '  try { Move-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop } catch { continue }',
    '  Start-Process -FilePath $dst',
    '  break',
    '}',
  ].join('\n')
  spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    { detached: true, stdio: 'ignore', windowsHide: true }
  ).unref()
}

function showBox(win, opts) {
  const alive = win && !win.isDestroyed()
  if (alive) win.show() // 窗口藏在托盘时先带出来，否则 Windows 上挂在隐藏窗口的对话框看不见
  return alive ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
}

async function msg(win, message, detail) {
  await showBox(win, { type: 'info', title: 'agentText', message, detail, buttons: ['确定'] })
}
