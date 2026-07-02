import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 数据根（assets/、data/ 的父目录）：可用 AGENT_TEXT_ROOT 覆盖。
// Electron 打包后 __dirname 落在只读的 app.asar 里，agent 也读不到，所以必须解耦。
// 不设 env 时行为与原来完全一致（项目根）。
const DATA_ROOT = process.env.AGENT_TEXT_ROOT
  ? path.resolve(process.env.AGENT_TEXT_ROOT)
  : path.resolve(__dirname, '..')
const ASSETS_DIR = path.join(DATA_ROOT, 'assets')
const DATA_DIR = path.join(DATA_ROOT, 'data')
const CARDS_FILE = path.join(DATA_DIR, 'cards.json')
const PORT = process.env.PORT || 7777

fs.mkdirSync(ASSETS_DIR, { recursive: true })
fs.mkdirSync(DATA_DIR, { recursive: true })

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
}

const app = express()

// 上传：原始二进制直传，内容 hash 命名（天然去重），按日期分目录落盘
app.post('/api/upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => {
  const buf = req.body
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return res.status(400).json({ error: '空文件' })
  }
  const origName = decodeURIComponent(String(req.query.name || ''))
  const mime = req.headers['content-type'] || 'application/octet-stream'
  let ext = path.extname(origName).toLowerCase()
  if (!ext) ext = EXT_BY_MIME[mime] || '.bin'

  const day = new Date().toISOString().slice(0, 10)
  const dir = path.join(ASSETS_DIR, day)
  fs.mkdirSync(dir, { recursive: true })
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10)
  const filename = hash + ext
  const filePath = path.join(dir, filename)
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, buf)

  res.json({
    path: filePath,
    url: `/assets/${day}/${filename}`,
    name: origName || filename,
    mime,
  })
})

function readCards() {
  try {
    return JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'))
  } catch {
    return { cards: [] }
  }
}

function writeCards(data) {
  const tmp = CARDS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, CARDS_FILE)
}

app.get('/api/cards', (_req, res) => res.json(readCards()))

const saveCards = (req, res) => {
  if (!req.body || !Array.isArray(req.body.cards)) {
    return res.status(400).json({ error: 'body 需要 { cards: [] }' })
  }
  writeCards(req.body)
  res.json({ ok: true })
}
app.put('/api/cards', express.json({ limit: '20mb' }), saveCards)
// sendBeacon 只能 POST，页面关闭前的兜底保存走这里
app.post('/api/cards', express.json({ limit: '20mb', type: () => true }), saveCards)

app.use('/assets', express.static(ASSETS_DIR))

// DIST 相对 __dirname：dist 随应用走（打包后在 app.asar 内），不受数据根影响
const DIST = path.resolve(__dirname, '..', 'web', 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
}

app.listen(PORT, () => {
  console.log(`agentText: http://localhost:${PORT}`)
  if (!fs.existsSync(DIST)) {
    console.log('（未找到 web/dist，开发模式请另开 vite：npm run dev）')
  }
})
