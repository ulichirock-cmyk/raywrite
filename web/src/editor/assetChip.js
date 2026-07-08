import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 双击缩略图放大看原图：全屏遮罩直接显示落盘原图（url 就是 /assets/... 原文件，
// 缩略是 CSS max-height 压出来的），点击遮罩或 Esc 关闭。
function openLightbox(url, alt) {
  const overlay = document.createElement('div')
  overlay.className = 'asset-lightbox'
  const img = document.createElement('img')
  img.src = url
  img.alt = alt || ''
  overlay.appendChild(img)
  const onKey = (e) => {
    if (e.key === 'Escape') close()
  }
  const close = () => {
    document.removeEventListener('keydown', onKey)
    overlay.remove()
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
}

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
      // 用户手写的注释（#13）：图片 chip 下方可编辑，序列化时跟在路径后输出，
      // 让正文可以引用「哪张图是干嘛的」
      note: { default: '' },
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
          note: el.getAttribute('data-note') || '',
        }),
      },
    ]
  },

  renderHTML({ node }) {
    const { path, url, name, mime, note } = node.attrs
    const attrs = mergeAttributes({
      'data-asset-chip': '',
      'data-path': path,
      'data-url': url,
      'data-name': name,
      'data-mime': mime,
      'data-note': note,
      class: 'asset-chip',
      title: path,
      contenteditable: 'false',
    })
    if ((mime || '').startsWith('image/')) {
      return ['span', mergeAttributes(attrs, { class: 'asset-chip asset-img' }), [
        'img',
        { src: url, class: 'asset-thumb', alt: name },
      ]]
    }
    return ['span', mergeAttributes(attrs, { class: 'asset-chip asset-file' }), name || path]
  },

  // 自定义 NodeView：加一个悬浮才显示的删除角标，不用再靠退格键——
  // 退格删 chip 在光标视觉上会被撑得跟图片一样高，体验很怪。
  // renderHTML 保留给 schema/undo 用，这里的 DOM 结构跟它保持一致。
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const { path, url, name, mime, note } = node.attrs
      const isImage = (mime || '').startsWith('image/')

      const dom = document.createElement('span')
      dom.setAttribute('data-asset-chip', '')
      dom.setAttribute('data-path', path)
      dom.setAttribute('data-url', url)
      dom.setAttribute('data-name', name)
      dom.setAttribute('data-mime', mime)
      dom.setAttribute('data-note', note || '')
      dom.setAttribute('title', path)
      dom.setAttribute('contenteditable', 'false')
      dom.className = isImage ? 'asset-chip asset-img' : 'asset-chip asset-file'

      let noteInput = null
      if (isImage) {
        const img = document.createElement('img')
        img.src = url
        img.className = 'asset-thumb'
        img.alt = name
        // 双击放大看原图（#14）：缩略图只是 CSS 压缩，原图就在 /assets 下
        img.addEventListener('dblclick', (e) => {
          e.preventDefault()
          openLightbox(url, name)
        })
        dom.appendChild(img)

        // 图片注释输入框（#13）：直接写在缩略图下方，失焦/回车时写回节点 attrs
        // 走正常事务，undo/持久化/序列化全都跟得上。size=1 压掉 input 的固有宽度，
        // 让 chip 宽度始终由图片决定。
        noteInput = document.createElement('input')
        noteInput.type = 'text'
        noteInput.size = 1
        noteInput.className = 'asset-note'
        noteInput.placeholder = '注释…'
        noteInput.value = note || ''
        noteInput.addEventListener('keydown', (e) => {
          e.stopPropagation()
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            noteInput.blur()
            editor.commands.focus()
          }
        })
        noteInput.addEventListener('blur', () => {
          const v = noteInput.value.trim()
          if (v === (node.attrs.note || '') || typeof getPos !== 'function') return
          const pos = getPos()
          if (typeof pos !== 'number') return
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, note: v })
          )
        })
        dom.appendChild(noteInput)
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

      // 点删除角标/注释输入框时不要让 ProseMirror 自己那套 mousedown/click
      // 选中逻辑掺和进来，注释框里的按键也不能漏给编辑器
      return {
        dom,
        stopEvent: (event) =>
          del.contains(event.target) || (noteInput && noteInput.contains(event.target)),
      }
    }
  },

  // 纯 chip 行（一段里只有图片/文件，没有文字）会把光标撑成跟图片一样高的
  // 大竖线（#10）：给这类段落挂 chip-line 类，CSS 把 caret 隐掉。一旦用户在
  // 该行敲了字，段落不再是纯 chip，类自动摘掉、光标恢复。
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('assetChipLine'),
        props: {
          decorations: (state) => {
            const decos = []
            state.doc.forEach((child, pos) => {
              if (child.type.name !== 'paragraph' || !child.childCount) return
              let onlyChips = true
              child.forEach((n) => {
                if (n.type.name !== 'assetChip') onlyChips = false
              })
              if (onlyChips) {
                decos.push(Decoration.node(pos, pos + child.nodeSize, { class: 'chip-line' }))
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
