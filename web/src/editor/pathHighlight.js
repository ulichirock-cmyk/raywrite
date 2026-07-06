import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// 常见源码/文本文件扩展名——裸文件名识别，以及「带空格路径」的收尾锚点都用它
const EXT =
  'c|h|cpp|hpp|cc|cxx|m|mm|js|mjs|cjs|ts|jsx|tsx|py|vue|rs|go|java|kt|swift|css|scss|less|html|htm|json|yaml|yml|toml|ini|md|txt|sh|fish|bash|zsh|sql|proto|cmake|mk|log'

const PATH_RE = new RegExp(
  [
    // 带空格的路径/文件名：以明确的路径前缀（C:\、/、~/、./）开头、以已知扩展名结尾，
    // 中间的空格照样吞进来整体高亮。像 MobaXterm 日志名
    // ~/log/MobaXterm  COM6USBSerialPortCOM6  20260706_161018.txt 这种带空格的路径
    // 才不会被拆成断续的几段（懒惰匹配停在第一个扩展名，不会连累后面的正文）。
    String.raw`(?:[A-Za-z]:[\\/]|(?<![\w:/])(?:~|\.{1,2})?/)[^\n"'　<>|*?]*?\.(?:${EXT})(?::\d+)?(?![\w.])`,
    // Windows 路径：C:\foo\bar 或 C:/foo/bar（正反斜杠都认）
    String.raw`[A-Za-z]:[\\/][^\s"'　<>|*?]+`,
    // Unix 路径：/abs、~/home、./rel，可带 :行号；排除 URL 的 ://
    String.raw`(?<![\w:/])(?:~|\.{1,2})?/[\w.\-+@%~]+(?:/[\w.\-+@%~]+)*(?::\d+)?`,
    // 裸文件名：gauge.c:412、config.json
    String.raw`(?<![\w./\\])[\w\-]+(?:\.[\w\-]+)*\.(?:${EXT})(?::\d+)?(?![\w.])`,
  ].join('|'),
  'g'
)

function buildDecorations(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    PATH_RE.lastIndex = 0
    let m
    while ((m = PATH_RE.exec(node.text))) {
      decos.push(
        Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
          class: 'path-hl',
        })
      )
    }
  })
  return DecorationSet.create(doc, decos)
}

// 纯装饰高亮：路径仍是普通文本，复制时原样输出，不影响编辑与序列化
export const PathHighlight = Extension.create({
  name: 'pathHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pathHighlight'),
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
