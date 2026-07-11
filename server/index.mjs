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
// 跟 electron/shortcut.mjs 共用同一个文件（它存 globalShortcut，这里存 deepseekApiKey）——
// 单用户本地工具，两边都是低频写入，不做并发保护
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const PORT = process.env.PORT || 7777
const POLISH_MODEL = 'deepseek-v4-flash'
// 云端语音转写（Electron 壳里没有浏览器内置语音识别，走这条路）：SiliconFlow 的
// SenseVoice，OpenAI audio/transcriptions 兼容接口，自动识别中英、自带标点
const ASR_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions'
const ASR_MODEL = 'FunAudioLLM/SenseVoiceSmall'
const POLISH_SYSTEM_PROMPT = `你是一个提示词编辑助手。用户会给你一段写给 AI coding agent（比如 Claude Code）的粗略笔记，
可能杂乱、口语化、不完整。把它整理成一段清晰、结构化、可直接使用的提示词：明确目标、必要背景、约束条件，去掉多余口语，
但不要凭空编造用户没提到的信息。保持原文使用的语言（中文原文就用中文整理，英文原文就用英文整理）。
用 Markdown 组织输出，利于 AI 阅读：用 ## 小标题分节（如目标/背景/要求，按内容取舍，不要生搬硬套），
要点用 - 列表，关键约束用 **加粗**，代码/命令/报错片段用反引号或 \`\`\` 代码块。内容很短（一两句话）时直接输出整理后的句子即可，不必强加结构。
如果原文中出现形如 [[chip:N]]（N 为数字）的占位符标记，原样保留在合适的位置，不要删除、拆分、翻译或改写它们，也不要新增这类标记。
只输出整理后的提示词正文，不要输出任何解释、前后缀说明，也不要把整体包在一个 markdown 代码块里。`
// 仿 Typeless 的听写后处理：不是逐字纠错，而是把「说出来的话」变成「写下来的话」
const VOICE_CORRECT_SYSTEM_PROMPT = `你是一个语音听写整理助手（类似 Typeless）。用户给你的是一段语音识别（ASR）自动转写的原始口述，把它整理成对方本来想「写下来」的文本：

1. 修正同音字/近音字错别字，补上合理的标点和分段。
2. 应用说话人的口头改口：出现「不对/不是/等等/说错了/改成/换成/算了还是……」这类自我纠正时，只保留改口后的最终说法，删掉被推翻的部分。
3. 删掉口语赘词（嗯、啊、呃、那个、就是说、然后然后……）和口吃式重复，把口语化表达顺成通顺的书面表达，但严格保持原意——不增删信息、不总结、不扩写。
4. 说话人在逐条列举（第一、第二……/一个是、另一个是……）时，整理成 - 开头的列表行。
5. 技术词汇按语境恢复正确写法：代码标识符、命令、文件路径、专有名词、英文单词（例如「派森」→ Python、「吉特」→ git）。
6. 如果附带了「卡片已有内容」作为上下文，用它统一术语和人名拼写，但绝不把上下文的内容混进输出。

保持原文语言，中文就输出中文。只输出整理后的文本本身，不要任何解释、引号包裹或前后缀。`

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
  // Express 的 query 解析已做过一次 URL 解码，这里不能再 decodeURIComponent——
  // 文件名本身含 % 时二次解码会抛 URIError（如 100%.png），含 %20 之类会被错改名
  const origName = String(req.query.name || '')
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

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  const tmp = SETTINGS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, SETTINGS_FILE)
}

// 只回报「有没有配」，API Key 本身不回传给前端——没必要让它在网络响应里再走一趟
function settingsSummary() {
  const s = readSettings()
  return { hasApiKey: Boolean(s.deepseekApiKey), hasAsrKey: Boolean(s.siliconflowApiKey) }
}

app.get('/api/settings', (_req, res) => {
  res.json(settingsSummary())
})

app.put('/api/settings', express.json(), (req, res) => {
  // 传了字符串就写入（空串 = 清除已保存的 Key）；没传该字段则不动
  if (typeof req.body?.deepseekApiKey === 'string') {
    writeSettings({ deepseekApiKey: req.body.deepseekApiKey.trim() })
  }
  if (typeof req.body?.siliconflowApiKey === 'string') {
    writeSettings({ siliconflowApiKey: req.body.siliconflowApiKey.trim() })
  }
  res.json(settingsSummary())
})

// 把卡片草稿丢给 DeepSeek 整理成结构清晰的提示词；chip（图片/文件）在发给前端前已
// 被替换成 [[chip:N]] 占位符，这里原样透传，由前端负责把占位符换回真正的 chip。
// deepseek-v4-flash 是 OpenAI ChatCompletions 兼容接口，thinking+reasoning_effort:max 开满推理力度
app.post('/api/polish', express.json({ limit: '1mb' }), async (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: '内容为空' })
  const apiKey = readSettings().deepseekApiKey
  if (!apiKey) return res.status(400).json({ error: '还没在设置里填 DeepSeek API Key' })

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      // 上游挂起时不能让请求永远吊着——前端按钮会一直停在「整理中…」
      signal: AbortSignal.timeout(120_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: POLISH_MODEL,
        messages: [
          { role: 'system', content: POLISH_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: 'max',
        stream: false,
      }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return res.status(502).json({ error: `AI 请求失败（HTTP ${r.status}）`, detail })
    }
    const data = await r.json()
    const polished = data.choices?.[0]?.message?.content || ''
    if (!polished) return res.status(502).json({ error: 'AI 没有返回内容' })
    res.json({ text: polished })
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'AI 请求超时' : String(err?.message || err)
    res.status(502).json({ error: msg })
  }
})

// 云端语音转写：录音二进制直传（同 /api/upload 的风格，非 multipart），这里再包成
// multipart 转发给 SiliconFlow。给没有浏览器内置语音识别的环境用（Electron/Firefox）
app.post('/api/transcribe', express.raw({ type: () => true, limit: '50mb' }), async (req, res) => {
  const buf = req.body
  if (!Buffer.isBuffer(buf) || buf.length < 1000) {
    return res.status(400).json({ error: '没有录到有效声音' })
  }
  const apiKey = readSettings().siliconflowApiKey
  if (!apiKey) return res.status(400).json({ error: '还没在设置里填 SiliconFlow API Key' })
  const mime = req.headers['content-type'] || 'audio/webm'
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm'

  try {
    const form = new FormData()
    form.append('model', ASR_MODEL)
    form.append('file', new Blob([buf], { type: mime }), `audio.${ext}`)
    const r = await fetch(ASR_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return res.status(502).json({ error: `转写请求失败（HTTP ${r.status}）`, detail })
    }
    const data = await r.json()
    const text = String(data.text ?? '').trim()
    if (!text) return res.status(502).json({ error: '没有识别出内容' })
    res.json({ text })
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? '转写请求超时' : String(err?.message || err)
    res.status(502).json({ error: msg })
  }
})

// 语音转写纠错：跟 /api/polish 同一把 Key、同一个模型，但提示词只做「保真纠错」
// （同音字/标点/赘词），不做结构化改写；也不开 thinking——纠错要快，用户在等着插入
app.post('/api/voice-correct', express.json({ limit: '1mb' }), async (req, res) => {
  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: '内容为空' })
  // 卡片已有内容当参考上下文（统一术语用），太长只取尾部——听写通常接着末尾写
  const context = String(req.body?.context || '').trim().slice(-1000)
  const apiKey = readSettings().deepseekApiKey
  if (!apiKey) return res.status(400).json({ error: '还没在设置里填 DeepSeek API Key' })
  const userContent = context
    ? `【卡片已有内容，仅作术语参考，不要输出】\n${context}\n\n【待整理的语音转写】\n${text}`
    : text

  try {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: POLISH_MODEL,
        messages: [
          { role: 'system', content: VOICE_CORRECT_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        stream: false,
      }),
    })
    if (!r.ok) {
      const detail = await r.text().catch(() => '')
      return res.status(502).json({ error: `AI 请求失败（HTTP ${r.status}）`, detail })
    }
    const data = await r.json()
    const corrected = data.choices?.[0]?.message?.content || ''
    if (!corrected) return res.status(502).json({ error: 'AI 没有返回内容' })
    res.json({ text: corrected })
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'AI 请求超时' : String(err?.message || err)
    res.status(502).json({ error: msg })
  }
})

app.use('/assets', express.static(ASSETS_DIR))

// DIST 相对 __dirname：dist 随应用走（打包后在 app.asar 内），不受数据根影响
const DIST = path.resolve(__dirname, '..', 'web', 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
}

// 只监听回环地址：单用户本地工具，没有理由让局域网内其他设备摸到——
// 尤其现在 /api/polish 会拿本机配置的 API Key 转发请求，不锁会被白嫖额度
app.listen(PORT, '127.0.0.1', () => {
  console.log(`agentText: http://localhost:${PORT}`)
  if (!fs.existsSync(DIST)) {
    console.log('（未找到 web/dist，开发模式请另开 vite：npm run dev）')
  }
})
