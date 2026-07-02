import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const HEADING_RE = /^(#{1,6})[ \t]+/
const QUOTE_RE = /^(>+)[ \t]?/
const LIST_RE = /^([-*+]|\d+[.)])[ \t]+/
const FENCE_RE = /^```/

// 内联样式，按顺序匹配：先吃掉代码片段，避免 ** 落在 code span 内被误判成加粗
const INLINE_PATTERNS = [
  { re: /`([^`\n]+)`/g, cls: 'md-code', markerLen: 1 },
  { re: /\*\*([^\n]+?)\*\*/g, cls: 'md-bold', markerLen: 2 },
  { re: /__([^\n]+?)__/g, cls: 'md-bold', markerLen: 2 },
  { re: /~~([^\n]+?)~~/g, cls: 'md-strike', markerLen: 2 },
  { re: /(?<!\*)\*([^\s*][^\n]*?)\*(?!\*)/g, cls: 'md-italic', markerLen: 1 },
  { re: /(?<!_)_([^\s_][^\n]*?)_(?!_)/g, cls: 'md-italic', markerLen: 1 },
]

// 段落的纯文本 + 逐字符对应的文档绝对位置（assetChip 等非文本节点不产出字符，
// 直接跳过，避免位置错位）
function paragraphText(node, start) {
  let text = ''
  const map = []
  node.forEach((child, offset) => {
    if (!child.isText) return
    text += child.text
    const childStart = start + offset
    for (let i = 0; i < child.text.length; i++) map.push(childStart + i)
  })
  return { text, map }
}

function applyInline(text, map, decos, from) {
  const covered = []
  const overlaps = (s, e) => covered.some(([cs, ce]) => s < ce && e > cs)
  for (const { re, cls, markerLen } of INLINE_PATTERNS) {
    re.lastIndex = from
    let m
    while ((m = re.exec(text))) {
      const s = m.index
      const e = s + m[0].length
      if (overlaps(s, e)) continue
      covered.push([s, e])
      decos.push(Decoration.inline(map[s], map[s + markerLen - 1] + 1, { class: 'md-marker' }))
      decos.push(Decoration.inline(map[s + markerLen], map[e - markerLen - 1] + 1, { class: cls }))
      decos.push(Decoration.inline(map[e - markerLen], map[e - 1] + 1, { class: 'md-marker' }))
    }
  }
}

function buildDecorations(doc) {
  const decos = []
  let inFence = false

  doc.forEach((node, pos) => {
    if (node.type.name !== 'paragraph') return
    const { text, map } = paragraphText(node, pos + 1)
    const trimmed = text.trim()

    if (FENCE_RE.test(trimmed)) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-marker md-code-block' }))
      inFence = !inFence
      return
    }
    if (inFence) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-code-block' }))
      return
    }
    if (!text) return

    const heading = HEADING_RE.exec(text)
    if (heading) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `md-h${heading[1].length}` }))
      decos.push(Decoration.inline(map[0], map[heading[0].length - 1] + 1, { class: 'md-marker' }))
      applyInline(text, map, decos, heading[0].length)
      return
    }

    let bodyStart = 0
    const quote = QUOTE_RE.exec(text)
    if (quote) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'md-quote' }))
      decos.push(Decoration.inline(map[0], map[quote[0].length - 1] + 1, { class: 'md-marker' }))
      bodyStart = quote[0].length
    }

    const list = LIST_RE.exec(text.slice(bodyStart))
    if (list) {
      const s = bodyStart
      const e = bodyStart + list[0].length
      decos.push(Decoration.inline(map[s], map[e - 1] + 1, { class: 'md-list-marker' }))
      bodyStart = e
    }

    applyInline(text, map, decos, bodyStart)
  })

  return DecorationSet.create(doc, decos)
}

// 纯装饰的 markdown 实时渲染：文档仍是原始 markdown 语法文本，复制/序列化不受影响
export const MarkdownDecorations = Extension.create({
  name: 'markdownDecorations',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('markdownDecorations'),
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})
