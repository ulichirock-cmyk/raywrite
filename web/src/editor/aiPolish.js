// AI 整理往返：assetChip（图片/文件）不能直接丢给 LLM 重写，所以送出去之前
// 把每个 chip 换成 [[chip:N]] 占位符（系统提示词要求 AI 原样保留），拿到整理后的
// 文本再把占位符换回真正的 chip 节点，图片/文件不会因为整理而丢失。
const CHIP_TOKEN_RE = /\[\[chip:(\d+)\]\]/g

// 编辑器内容 → { text, chips }：text 送给 AI，chips 是按出现顺序收集的 chip 属性
export function serializeForAI(editor) {
  const chips = []
  const text = editor.getText({
    blockSeparator: '\n',
    textSerializers: {
      assetChip: ({ node }) => {
        chips.push(node.attrs)
        return `[[chip:${chips.length - 1}]]`
      },
    },
  })
  return { text, chips }
}

// AI 整理后的文本 + 原 chips → Tiptap doc JSON，供 editor.commands.setContent 使用
export function buildDocFromAIText(text, chips) {
  const used = new Set()
  const lines = String(text || '').split('\n')
  const content = lines.map((line) => {
    const paragraph = []
    let last = 0
    let m
    CHIP_TOKEN_RE.lastIndex = 0
    while ((m = CHIP_TOKEN_RE.exec(line))) {
      if (m.index > last) paragraph.push({ type: 'text', text: line.slice(last, m.index) })
      const attrs = chips[Number(m[1])]
      if (attrs) {
        paragraph.push({ type: 'assetChip', attrs })
        used.add(Number(m[1]))
      }
      last = m.index + m[0].length
    }
    if (last < line.length) paragraph.push({ type: 'text', text: line.slice(last) })
    return paragraph.length ? { type: 'paragraph', content: paragraph } : { type: 'paragraph' }
  })
  // 系统提示词只是「要求」AI 保留占位符，兜不住它真删——被丢掉的 chip 统一追加
  // 到末尾一段，保证图片/文件绝不因整理而丢失
  const dropped = chips.filter((_, i) => !used.has(i))
  if (dropped.length) {
    content.push({ type: 'paragraph', content: dropped.map((attrs) => ({ type: 'assetChip', attrs })) })
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}
