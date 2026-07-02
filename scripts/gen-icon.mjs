// 一次性图标生成脚本：node scripts/gen-icon.mjs
// 设计：深青圆角方块底（--accent #0b7261）+ 白色「>」人字形 + 浅青下划线光标（右下），
// 纯几何形状不依赖字体。4x 超采样后箱式降采样，边缘平滑。
// 产出：electron/icon.ico（16/32/48/256 PNG 条目，Vista+ 支持；256 是 electron-builder 硬要求）、
//       electron/icon.png（256，开发模式 BrowserWindow 用）、electron/tray.png（32，托盘用）。
// 纯 Node 实现：RGBA 像素画图 + node:zlib 手写 PNG 编码（IHDR/IDAT/IEND + CRC32），零依赖。
import { deflateSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '..', 'electron')

// ---- 配色（沿用 web/src/style.css 的主题色） ----
const BG = [0x0b, 0x72, 0x61] // --accent 深青：圆角方块底
const FG = [0xff, 0xff, 0xff] // 白：「>」人字形
const CUR = [0xb8, 0xe6, 0xda] // 浅青：下划线光标

// ---- 像素绘制 ----

// 点到线段距离（人字形两笔用它判定，天然圆头）
function distToSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

// 渲染 size×size RGBA：4x 超采样 + 预乘箱式降采样（避免透明边缘发黑）
function renderIcon(size) {
  const S = 4
  const N = size * S
  const half = N / 2
  const R = 0.22 * N // 圆角半径
  // 「>」两笔：左上 → 中右 → 左下；下划线光标在右下
  const seg = [0.26 * N, 0.3 * N, 0.5 * N, 0.5 * N, 0.26 * N, 0.7 * N]
  const th = (0.11 * N) / 2 // 笔画半厚
  const cur = { x0: 0.58 * N, x1: 0.8 * N, y0: 0.665 * N, y1: 0.75 * N }

  const hi = Buffer.alloc(N * N * 4)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const px = x + 0.5
      const py = y + 0.5
      // 圆角方块内外判定（signed distance 思路）
      const dx = Math.max(Math.abs(px - half) - (half - R), 0)
      const dy = Math.max(Math.abs(py - half) - (half - R), 0)
      if (Math.hypot(dx, dy) > R) continue // 外部：保持全透明
      let c = BG
      if (
        distToSeg(px, py, seg[0], seg[1], seg[2], seg[3]) <= th ||
        distToSeg(px, py, seg[2], seg[3], seg[4], seg[5]) <= th
      ) {
        c = FG
      } else if (px >= cur.x0 && px <= cur.x1 && py >= cur.y0 && py <= cur.y1) {
        c = CUR
      }
      const o = (y * N + x) * 4
      hi[o] = c[0]
      hi[o + 1] = c[1]
      hi[o + 2] = c[2]
      hi[o + 3] = 255
    }
  }

  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const o = ((y * S + sy) * N + (x * S + sx)) * 4
          const al = hi[o + 3]
          r += hi[o] * al
          g += hi[o + 1] * al
          b += hi[o + 2] * al
          a += al
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
      }
      out[o + 3] = Math.round(a / (S * S))
    }
  }
  return out
}

// ---- PNG 编码（IHDR/IDAT/IEND + CRC32，色型 6 = RGBA8） ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // 每行前置 filter 字节 0（None）
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))])
}

// ---- ICO 容器（PNG 压缩条目，Vista+） ----

function makeIco(entries) {
  const head = Buffer.alloc(6)
  head.writeUInt16LE(0, 0) // reserved
  head.writeUInt16LE(1, 2) // type = icon
  head.writeUInt16LE(entries.length, 4)
  const dirs = []
  let offset = 6 + 16 * entries.length
  for (const e of entries) {
    const d = Buffer.alloc(16)
    d[0] = e.size >= 256 ? 0 : e.size // 0 表示 256
    d[1] = e.size >= 256 ? 0 : e.size
    d.writeUInt16LE(1, 4) // planes
    d.writeUInt16LE(32, 6) // bpp
    d.writeUInt32LE(e.png.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += e.png.length
    dirs.push(d)
  }
  return Buffer.concat([head, ...dirs, ...entries.map((e) => e.png)])
}

// ---- 生成 + 自校验 ----

const SIZES = [16, 32, 48, 256]
const pngs = new Map(SIZES.map((s) => [s, encodePng(renderIcon(s), s, s)]))

fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), makeIco(SIZES.map((s) => ({ size: s, png: pngs.get(s) }))))
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), pngs.get(256))
fs.writeFileSync(path.join(OUT_DIR, 'tray.png'), pngs.get(32))

// 自校验：ICO 头 / 条目数 / 每个条目 offset 处是 PNG 签名 / 必含 256
const ico = fs.readFileSync(path.join(OUT_DIR, 'icon.ico'))
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('ICO 头非法')
const count = ico.readUInt16LE(4)
if (count !== SIZES.length) throw new Error(`ICO 条目数 ${count} != ${SIZES.length}`)
let has256 = false
for (let i = 0; i < count; i++) {
  const d = 6 + 16 * i
  const w = ico[d] || 256
  const bytes = ico.readUInt32LE(d + 8)
  const off = ico.readUInt32LE(d + 12)
  if (!ico.subarray(off, off + 8).equals(PNG_SIG)) throw new Error(`条目 ${w} offset 处不是 PNG 签名`)
  if (w === 256) has256 = true
  console.log(`  条目 ${String(w).padStart(3)}×${w}  ${bytes} 字节 @${off}  PNG 签名 ✓`)
}
if (!has256) throw new Error('缺 256 条目（electron-builder 要求 ≥256）')
console.log(`icon.ico（${count} 条目）/ icon.png（256）/ tray.png（32）已生成到 electron/`)
