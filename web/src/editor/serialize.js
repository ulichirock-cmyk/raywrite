import { toWin, toWsl } from './pathStyle'

// 编辑器内容 → 可直接粘进 CLI agent 的纯文本。
// assetChip 序列化为落盘绝对路径，两侧补空格避免与中文粘连。
// style 决定输出风格：'win'（C:\...）| 'wsl'（/mnt/c/...）；文件本身只存一份，这里按需转换。
export function serializeText(editor, style = 'win') {
  const conv = style === 'wsl' ? toWsl : toWin
  return editor
    .getText({
      blockSeparator: '\n',
      textSerializers: {
        assetChip: ({ node }) => ` ${conv(node.attrs.path)} `,
      },
    })
    .replace(/[^\S\n]+\n/g, '\n')
    .trim()
}

// 原生 Ctrl+C 复制走 ProseMirror 的 clipboardTextSerializer；不接管的话它默认用
// '\n\n' 连接段落，多行内容粘进终端后每行都多出一空行（issue #1 复发根因——那次
// 只修了「复制」按钮的 serializeText 和粘进卡片的 transformPasted，漏了选中直接复制）。
// 这里与 serializeText 对齐：段落间单 '\n'、assetChip → 落盘绝对路径、hardBreak → '\n'。
// 不整体 .trim()——原生复制可能只选了一行的一部分，裁掉首尾空格会破坏所见即所得。
export function serializeSlice(slice, style = 'win') {
  const conv = style === 'wsl' ? toWsl : toWin
  return slice.content
    .textBetween(0, slice.content.size, '\n', (leaf) => {
      if (leaf.type.name === 'assetChip') return ` ${conv(leaf.attrs?.path || '')} `
      if (leaf.type.name === 'hardBreak') return '\n'
      return ''
    })
    .replace(/[^\S\n]+\n/g, '\n')
}

// 同上，但直接吃持久化的 doc JSON，不需要活的编辑器实例——切换路径风格时
// 未挂载的卡片（被日期筛选/搜索过滤掉）也要重算 text。本编辑器 schema 只有
// 一层 paragraph，行内是 text / assetChip / hardBreak（getText 里 hardBreak → '\n'），
// 输出须与 serializeText 一致。
export function serializeDocText(doc, style = 'win') {
  const conv = style === 'wsl' ? toWsl : toWin
  const inline = (n) => {
    if (n.type === 'assetChip') return ` ${conv(n.attrs?.path || '')} `
    if (n.type === 'hardBreak') return '\n'
    return n.text || ''
  }
  return (doc?.content || [])
    .map((block) => (block.content || []).map(inline).join(''))
    .join('\n')
    .replace(/[^\S\n]+\n/g, '\n')
    .trim()
}
