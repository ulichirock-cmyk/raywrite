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
let pending = null // { src }：已暂存的新版 exe，等退出时由 explorer 拉起接力替换
let relaunchSpawned = false
let promptedVersion = null // 本次会话已提示过的版本，静默检查不重复弹
let busy = false

export function initUpdater(options) {
  ctx = options
  // 无论「立即重启」还是用户日后从托盘退出：用 explorer 代理启动已暂存的新版 exe
  // （等价用户双击，父进程是 shell），真正的替换由新版进程的 runUpdateHandoff 完成。
  // 不直接 spawn 新 exe——app 的子进程会随进程树被连坐杀掉（实测 .part 残留的根因）；
  // 也不走 PowerShell/WMI/cmd——系统脚本工具链会被安全软件选择性拦截（实测「存取被拒」）。
  app.on('before-quit', (e) => {
    if (!pending || relaunchSpawned) return
    relaunchSpawned = true
    e.preventDefault() // 暂缓退出，给 explorer 转发启动请求留时间
    shellLaunch(pending.src)
    setTimeout(() => app.quit(), 500) // relaunchSpawned 已置位，这次不再拦截
  })
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

    // 优先下到 exe 同目录（替换时同卷操作最快），目录不可写则兜底到临时目录
    let part = path.join(path.dirname(exePath), asset.name + '.part')
    try {
      await download(asset, part, win)
    } catch {
      part = path.join(os.tmpdir(), asset.name + '.part')
      try {
        await download(asset, part, win)
      } catch (err) {
        await msg(win, '下载更新失败', String(err?.message || err))
        return
      }
    }
    // 下载完成：.part 转正为新版 exe（与旧 exe 并存），写替换协议文件。
    // 真正的替换由新版进程启动时的 runUpdateHandoff 执行。
    const stageDir = path.dirname(part)
    let staged = path.join(stageDir, asset.name)
    if (normPath(staged) === normPath(exePath)) staged = path.join(stageDir, 'new-' + asset.name)
    try {
      fs.rmSync(staged, { force: true })
      fs.renameSync(part, staged)
      fs.writeFileSync(
        path.join(stageDir, 'agentText-update.json'),
        JSON.stringify({ phase: 'replace', src: staged, dst: exePath, version: latest })
      )
    } catch (err) {
      await msg(win, '更新暂存失败', String(err?.message || err))
      return
    }
    pending = { src: staged }

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

// ---- 自举替换（update handoff）----
// 协议：下载完成后新版 exe 与旧 exe 并存，同目录 agentText-update.json 记
// { phase:'replace', src:新exe, dst:旧exe }。退出时 explorer 拉起 src；src 进程启动
// 最前沿（拿单实例锁之前）读到协议 → 等旧 exe 解锁 → 删旧 → 把自身文件复制回旧路径
// （保住用户的快捷方式）→ 把协议改成 { phase:'cleanup', temp:src } → explorer 启动
// 旧路径上的新版 → 自退。接力实例启动时看到 cleanup 就后台删掉临时 exe。
// 全程只有本应用和 explorer 参与——不依赖 PowerShell/WMI/cmd（会被安全软件拦截）。

const normPath = (p) => String(p || '').replace(/\//g, '\\').toLowerCase()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// explorer 代理启动（等价用户双击）。spawn 的失败是异步 error 事件，try/catch
// 兜不住，必须挂空 handler，否则会把进程整个崩掉
function shellLaunch(target) {
  try {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [target], {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
  } catch {}
}

function ulog(dir, line) {
  try {
    fs.appendFileSync(path.join(dir, 'agentText-update.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {}
}

// main.mjs 启动最前调用。返回 true 表示本进程是替换接力，调用方不得继续正常启动
// （替换完成后这里自行退出）；返回 false 则正常启动（可能顺带触发后台清理）。
export function runUpdateHandoff() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (!exe) return false
  const dir = path.dirname(exe)
  const manifestPath = path.join(dir, 'agentText-update.json')
  let m
  try {
    m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return false
  }
  const me = normPath(exe)
  if (m.phase === 'replace' && normPath(m.src) === me) {
    replaceAndRelaunch(m, manifestPath, dir)
    return true
  }
  if (m.phase === 'replace' && normPath(m.dst) === me) {
    // 接力没发生（explorer 启动失败或用户直接开了旧版）：归零，updater 之后会重新提示
    ulog(dir, 'stale replace manifest on old exe, resetting')
    try {
      fs.rmSync(m.src, { force: true })
    } catch {}
    fs.rmSync(manifestPath, { force: true })
    return false
  }
  if (m.phase === 'cleanup') cleanupTemp(m, manifestPath, dir)
  return false
}

async function replaceAndRelaunch(m, manifestPath, dir) {
  ulog(dir, `replace start: ${m.src} -> ${m.dst}`)
  // 等旧 exe 的 portable launcher 退出释放文件锁，然后删掉旧 exe
  for (let i = 0; i < 120 && fs.existsSync(m.dst); i++) {
    try {
      fs.rmSync(m.dst)
    } catch (e) {
      if (i % 20 === 0) ulog(dir, `waiting for old exe unlock (${e.code || e.message})`)
      await sleep(500)
    }
  }
  if (fs.existsSync(m.dst)) {
    // 旧 exe 一直解不了锁：放弃替换，以新文件名重启继续用（协议归零）
    ulog(dir, 'old exe still locked, give up replacing, run from new file')
    fs.rmSync(manifestPath, { force: true })
    relaunchAndExit(m.src)
    return
  }
  try {
    fs.copyFileSync(m.src, m.dst) // 把自己复制回旧路径，快捷方式照旧可用
    fs.writeFileSync(manifestPath, JSON.stringify({ phase: 'cleanup', temp: m.src }))
    ulog(dir, 'replaced ok, relaunching new exe at old path')
    relaunchAndExit(m.dst)
  } catch (e) {
    ulog(dir, `copy back failed (${e.message}), run from new file`)
    fs.rmSync(manifestPath, { force: true })
    relaunchAndExit(m.src)
  }
}

function relaunchAndExit(target) {
  shellLaunch(target)
  setTimeout(() => app.exit(0), 500)
}

function cleanupTemp(m, manifestPath, dir) {
  let tries = 0
  const timer = setInterval(() => {
    try {
      fs.rmSync(m.temp, { force: true })
    } catch {}
    if (!fs.existsSync(m.temp)) {
      clearInterval(timer)
      fs.rmSync(manifestPath, { force: true })
      ulog(dir, 'cleanup done')
    } else if (++tries >= 120) {
      clearInterval(timer) // 删不掉就留着协议文件，下次启动再试
      ulog(dir, 'cleanup still pending, will retry next launch')
    }
  }, 1000)
}

function showBox(win, opts) {
  const alive = win && !win.isDestroyed()
  if (alive) win.show() // 窗口藏在托盘时先带出来，否则 Windows 上挂在隐藏窗口的对话框看不见
  return alive ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
}

async function msg(win, message, detail) {
  await showBox(win, { type: 'info', title: 'agentText', message, detail, buttons: ['确定'] })
}
