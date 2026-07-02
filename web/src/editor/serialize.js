// 编辑器内容 → 可直接粘进 CLI agent 的纯文本。
// assetChip 序列化为落盘绝对路径，两侧补空格避免与中文粘连。
export function serializeText(editor) {
  return editor
    .getText({
      blockSeparator: '\n',
      textSerializers: {
        assetChip: ({ node }) => ` ${node.attrs.path} `,
      },
    })
    .replace(/[^\S\n]+\n/g, '\n')
    .trim()
}
