import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { initUpdater, checkForUpdate, runUpdateHandoff } from './updater.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 7777

// 数据根：AGENT_TEXT_ROOT（用户覆盖）→ 打包后 ~/agentText → 开发时项目根。
// server/index.mjs 读的就是这个 env，所以启动内嵌 server 前必须先设好。
const DATA_ROOT = process.env.AGENT_TEXT_ROOT
  ? path.resolve(process.env.AGENT_TEXT_ROOT)
  : app.isPackaged
    ? path.join(os.homedir(), 'agentText')
    : path.resolve(__dirname, '..')

let win = null
let tray = null
let quitting = false

// 统一退出：先 close 让页面 pagehide 的 sendBeacon 兜底保存打到本地 server，再退出
// （托盘「退出」和更新器「立即重启」共用）
function quitApp() {
  quitting = true
  if (win) win.close()
  setTimeout(() => app.quit(), 300)
}

// 探测端口上是否已有 server 在跑（用户可能单独 npm start 了）——有则复用，别重复起
function probeServer() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/cards', timeout: 800 },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function ensureServer() {
  if (await probeServer()) return // 已有服务，直接复用
  process.env.AGENT_TEXT_ROOT = DATA_ROOT
  process.env.PORT = String(PORT)
  await import('../server/index.mjs') // 该文件 import 即 listen
}

// 托盘图标：scripts/gen-icon.mjs 生成的 tray.png；读不到时兜底青色方块
function makeTrayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  if (!img.isEmpty()) return img
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = 0x0b // R
    buf[i * 4 + 1] = 0x72 // G
    buf[i * 4 + 2] = 0x61 // B
    buf[i * 4 + 3] = 0xff // A
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'agentText',
    icon: path.join(__dirname, 'icon.png'), // 开发模式窗口/任务栏图标；打包后 exe 图标由 build.win.icon 生效
    webPreferences: { contextIsolation: true },
  })
  win.loadURL(`http://127.0.0.1:${PORT}`)

  // 点关闭按钮不退出，改为隐藏到托盘（保活）
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

function createTray() {
  tray = new Tray(makeTrayIcon())
  tray.setToolTip('agentText')
  const menu = Menu.buildFromTemplate([
    { label: '显示', click: () => (win ? (win.show(), win.focus()) : createWindow()) },
    { label: '检查更新', click: () => checkForUpdate(true).catch(() => {}) },
    { label: '退出', click: quitApp },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => (win ? (win.show(), win.focus()) : createWindow()))
}

// 更新接力：若本进程是刚下载的新版 exe 且有替换协议，只做替换后自退，不进正常启动
if (runUpdateHandoff()) {
  // 替换逻辑完成后自行 app.exit()
} else if (!app.requestSingleInstanceLock()) {
  // 单实例：二次启动聚焦已有窗口
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    await ensureServer()
    createWindow()
    createTray()
    initUpdater({ getWin: () => win, quitApp }) // 打包形态下启动 5s 后静默检查一次 + 每 6h 一次

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else if (win) win.show()
    })
  })

  // 保活到托盘：所有窗口关闭也不退出（Windows/Linux 默认会退，这里显式拦住）
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    quitting = true
  })
}
