<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { AssetChip } from '../editor/assetChip'
import { PathHighlight } from '../editor/pathHighlight'
import { MarkdownDecorations } from '../editor/markdownDecorations'
import { serializeText } from '../editor/serialize'
import { serializeForAI, buildDocFromAIText } from '../editor/aiPolish'
import { pathStyle } from '../pathStyleStore'
import { settings } from '../settingsStore'
import { aiSettings } from '../aiStore'
import { uploadFile, polishText } from '../api'

const props = defineProps({
  card: { type: Object, required: true },
})
const emit = defineEmits(['change', 'delete', 'toggle-pin'])

const editor = shallowRef(null)
const copied = ref(false)
const uploading = ref(0)
const charCount = ref(0)
const uploadError = ref('')
const polishing = ref(false)
const polishError = ref('')
let copiedTimer = null
let errorTimer = null
let polishErrorTimer = null

// 长文折叠：内容实际高度超阈值才算 overflowing（ResizeObserver 盯编辑器 DOM，
// 字号切换、编辑增删都会触发重测）；expanded 是本卡的临时展开态，不持久化
const COLLAPSE_H = 260
const overflowing = ref(false)
const expanded = ref(false)
let resizeOb = null
const collapsed = computed(() => settings.collapseLong && overflowing.value && !expanded.value)

// 首段是否为"纯 chip 行"（空段落也算，可直接往里插）：决定新 chip 是接在首段
// 末尾，还是需要在最前面新起一段，从而让图片始终聚在文本上方而非插入正文中间。
function firstParagraphTakesChip(doc) {
  const first = doc.firstChild
  if (!first || first.type.name !== 'paragraph') return false
  let onlyChips = true
  first.forEach((child) => {
    if (child.type.name !== 'assetChip') onlyChips = false
  })
  return onlyChips
}

async function insertFiles(files) {
  for (const file of files) {
    uploading.value++
    try {
      const info = await uploadFile(file)
      const chip = { type: 'assetChip', attrs: info }
      const doc = editor.value.state.doc
      if (firstParagraphTakesChip(doc)) {
        const pos = 1 + doc.firstChild.content.size
        editor.value.chain().focus().insertContentAt(pos, chip).run()
      } else {
        editor.value.chain().focus().insertContentAt(0, { type: 'paragraph', content: [chip] }).run()
      }
    } catch (e) {
      console.error(e)
      uploadError.value = `上传失败：${file.name || '剪贴板图片'}`
      clearTimeout(errorTimer)
      errorTimer = setTimeout(() => (uploadError.value = ''), 4000)
    } finally {
      uploading.value--
    }
  }
}

async function doCopy() {
  if (!editor.value) return
  const text = serializeText(editor.value, pathStyle.value)
  if (!text) return
  await navigator.clipboard.writeText(text)
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1400)
}

// 把卡片草稿丢给 AI 整理成结构清晰的提示词——chip（图片/文件）先换成占位符
// 送出去，拿到结果后再换回真正的 chip，不会因为整理丢图
async function doPolish() {
  if (!editor.value || polishing.value || !charCount.value) return
  polishing.value = true
  // 整理是慢请求，期间锁住编辑——否则用户中途敲的字会被 setContent 整体覆盖丢掉
  editor.value.setEditable(false)
  try {
    const { text, chips } = serializeForAI(editor.value)
    const result = await polishText(text)
    const doc = buildDocFromAIText(result, chips)
    editor.value.commands.setContent(doc, true)
  } catch (e) {
    console.error(e)
    polishError.value = e?.message || '整理失败'
    clearTimeout(polishErrorTimer)
    polishErrorTimer = setTimeout(() => (polishError.value = ''), 4000)
  } finally {
    if (editor.value && !editor.value.isDestroyed) editor.value.setEditable(true)
    polishing.value = false
  }
}

const isEmptyPara = (node) => node?.type.name === 'paragraph' && node.content.size === 0

// 粘贴时剥掉选区首尾整段的空行：从卡片里选中「空行 + 一段文字」复制再粘贴时，
// 那几段空行本不该跟着进来（否则光标后凭空多出很多空白行）。只裁首尾成整段的空行，
// 中间的空行是刻意留白，原样保留。首/尾段被裁掉后该侧就变成闭合插入（open 深度归 0），
// 正好让内容紧接光标落下。这套文档结构最多一层，open 深度 >1 时保守跳过不动。
function trimPastedBlankLines(slice) {
  let content = slice.content
  let openStart = slice.openStart
  let openEnd = slice.openEnd
  if (openStart <= 1) {
    while (content.childCount && isEmptyPara(content.firstChild)) {
      content = content.cut(content.firstChild.nodeSize)
      openStart = 0
    }
  }
  if (openEnd <= 1) {
    while (content.childCount && isEmptyPara(content.lastChild)) {
      content = content.cut(0, content.size - content.lastChild.nodeSize)
      openEnd = 0
    }
  }
  if (content.eq(slice.content)) return slice
  return new Slice(content, openStart, openEnd)
}

function fmtTime(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

onMounted(() => {
  editor.value = new Editor({
    content: props.card.doc || '',
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
      }),
      AssetChip,
      PathHighlight,
      MarkdownDecorations,
      Extension.create({
        name: 'copyShortcut',
        addKeyboardShortcuts: () => ({
          'Mod-Enter': () => {
            doCopy()
            return true
          },
        }),
      }),
    ],
    editorProps: {
      attributes: { class: 'editor-body', spellcheck: 'false' },
      transformPasted: (slice) => trimPastedBlankLines(slice),
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || [])
        if (!files.length) return false
        event.preventDefault()
        insertFiles(files)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files || [])
        if (!files.length) return false
        event.preventDefault()
        insertFiles(files)
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = serializeText(ed, pathStyle.value)
      charCount.value = text.length
      emit('change', { doc: ed.getJSON(), text })
    },
  })
  charCount.value = serializeText(editor.value, pathStyle.value).length

  resizeOb = new ResizeObserver(() => {
    overflowing.value = editor.value.view.dom.offsetHeight > COLLAPSE_H
  })
  resizeOb.observe(editor.value.view.dom)
})

// 切换全局路径风格时重算字数展示；持久化 text 的回写由 App.vue 的 watch 统一做
// （它连未挂载的卡片一起处理），这里不再 emit，避免同一次切换重复触发保存
watch(pathStyle, (style) => {
  if (!editor.value) return
  charCount.value = serializeText(editor.value, style).length
})

onBeforeUnmount(() => {
  clearTimeout(copiedTimer)
  clearTimeout(errorTimer)
  clearTimeout(polishErrorTimer)
  resizeOb?.disconnect()
  editor.value?.destroy()
})
</script>

<template>
  <article class="card" :class="{ pinned: card.pinned }">
    <header class="card-head">
      <span class="meta">{{ fmtTime(card.createdAt) }}</span>
      <span v-if="card.pinned" class="meta pin-mark">置顶</span>
      <span v-if="uploading" class="meta busy">上传中…</span>
      <span v-if="uploadError" class="meta upload-error">{{ uploadError }}</span>
      <span v-if="polishError" class="meta upload-error">{{ polishError }}</span>
      <span class="spacer"></span>
      <span v-if="charCount" class="meta">{{ charCount }} 字</span>
      <button
        class="btn quiet"
        :disabled="!charCount || polishing || !aiSettings.hasApiKey"
        :title="aiSettings.hasApiKey ? 'AI 把这张卡片整理成结构清晰的提示词' : '先在设置里填 DeepSeek API Key'"
        @click="doPolish"
      >
        {{ polishing ? '整理中…' : 'AI 整理' }}
      </button>
      <button class="btn copy" :class="{ ok: copied }" :disabled="!charCount" @click="doCopy">
        {{ copied ? '已复制 ✓' : '复制' }}
      </button>
      <button class="btn quiet" @click="emit('toggle-pin')">
        {{ card.pinned ? '取消置顶' : '置顶' }}
      </button>
      <button class="btn quiet danger" @click="emit('delete')">删除</button>
    </header>
    <EditorContent :editor="editor" class="editor-wrap" :class="{ collapsed }" />
    <button
      v-if="settings.collapseLong && overflowing"
      class="expand-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起 ▴' : '展开 ▾' }}
    </button>
  </article>
</template>
