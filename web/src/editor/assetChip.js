import { Node, mergeAttributes } from '@tiptap/core'

// 落盘资产的行内原子节点：图片显示缩略图，其他文件显示文件名。
// 整个 chip 不可拆分，一次退格整体删除；复制时序列化为落盘绝对路径。
export const AssetChip = Node.create({
  name: 'assetChip',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      path: { default: '' },
      url: { default: '' },
      name: { default: '' },
      mime: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-asset-chip]',
        getAttrs: (el) => ({
          path: el.getAttribute('data-path') || '',
          url: el.getAttribute('data-url') || '',
          name: el.getAttribute('data-name') || '',
          mime: el.getAttribute('data-mime') || '',
        }),
      },
    ]
  },

  renderHTML({ node }) {
    const { path, url, name, mime } = node.attrs
    const attrs = mergeAttributes({
      'data-asset-chip': '',
      'data-path': path,
      'data-url': url,
      'data-name': name,
      'data-mime': mime,
      class: 'asset-chip',
      title: path,
      contenteditable: 'false',
    })
    if ((mime || '').startsWith('image/')) {
      return ['span', attrs, ['img', { src: url, class: 'asset-thumb', alt: name }]]
    }
    return ['span', mergeAttributes(attrs, { class: 'asset-chip asset-file' }), name || path]
  },
})
