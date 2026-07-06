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
