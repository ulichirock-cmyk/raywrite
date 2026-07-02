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
