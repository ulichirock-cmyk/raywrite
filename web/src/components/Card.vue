<script setup>
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import { AssetChip } from '../editor/assetChip'
import { PathHighlight } from '../editor/pathHighlight'
import { MarkdownDecorations } from '../editor/markdownDecorations'
import { serializeText } from '../editor/serialize'
import { pathStyle } from '../pathStyleStore'
import { uploadFile } from '../api'

const props = defineProps({
  card: { type: Object, required: true },
})
const emit = defineEmits(['change', 'delete', 'toggle-pin'])

const editor = shallowRef(null)
const copied = ref(false)
const uploading = ref(0)
const charCount = ref(0)
const uploadError = ref('')
let copiedTimer = null
let errorTimer = null

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
      attributes: { class: 'editor-body' },
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
})

// 切换全局路径风格时，重算字数并回写持久化 text（保证与复制出来的文本一致）
watch(pathStyle, (style) => {
  if (!editor.value) return
  const text = serializeText(editor.value, style)
  charCount.value = text.length
  emit('change', { doc: editor.value.getJSON(), text })
})

onBeforeUnmount(() => {
  clearTimeout(copiedTimer)
  clearTimeout(errorTimer)
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
      <span class="spacer"></span>
      <span v-if="charCount" class="meta">{{ charCount }} 字</span>
      <button class="btn copy" :class="{ ok: copied }" :disabled="!charCount" @click="doCopy">
        {{ copied ? '已复制 ✓' : '复制' }}
      </button>
      <button class="btn quiet" @click="emit('toggle-pin')">
        {{ card.pinned ? '取消置顶' : '置顶' }}
      </button>
      <button class="btn quiet danger" @click="emit('delete')">删除</button>
    </header>
    <EditorContent :editor="editor" class="editor-wrap" />
  </article>
</template>
