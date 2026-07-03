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

  // 自定义 NodeView：加一个悬浮才显示的删除角标，不用再靠退格键——
  // 退格删 chip 在光标视觉上会被撑得跟图片一样高，体验很怪。
  // renderHTML 保留给 schema/undo 用，这里的 DOM 结构跟它保持一致。
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const { path, url, name, mime } = node.attrs
      const isImage = (mime || '').startsWith('image/')

      const dom = document.createElement('span')
      dom.setAttribute('data-asset-chip', '')
      dom.setAttribute('data-path', path)
      dom.setAttribute('data-url', url)
      dom.setAttribute('data-name', name)
      dom.setAttribute('data-mime', mime)
      dom.setAttribute('title', path)
      dom.setAttribute('contenteditable', 'false')
      dom.className = isImage ? 'asset-chip' : 'asset-chip asset-file'

      if (isImage) {
        const img = document.createElement('img')
        img.src = url
        img.className = 'asset-thumb'
        img.alt = name
        dom.appendChild(img)
      } else {
        dom.appendChild(document.createTextNode(name || path))
      }

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'asset-chip-delete'
      del.setAttribute('contenteditable', 'false')
      del.setAttribute('aria-label', '删除')
      del.textContent = '×'
      del.addEventListener('click', (e) => {
        e.preventDefault()
        if (typeof getPos !== 'function') return
        const pos = getPos()
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      })
      dom.appendChild(del)

      // 点删除角标时不要让 ProseMirror 自己那套 mousedown/click 选中逻辑掺和进来
      return { dom, stopEvent: (event) => del.contains(event.target) }
    }
  },
})
