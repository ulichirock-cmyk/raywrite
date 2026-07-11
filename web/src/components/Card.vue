<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { AssetChip } from '../editor/assetChip'
import { PathHighlight } from '../editor/pathHighlight'
import { MarkdownDecorations } from '../editor/markdownDecorations'
import { serializeText, serializeSlice } from '../editor/serialize'
import { serializeForAI, buildDocFromAIText } from '../editor/aiPolish'
import { pathStyle } from '../pathStyleStore'
import { settings } from '../settingsStore'
import { aiSettings } from '../aiStore'
import { uploadFile, polishText, correctVoiceText } from '../api'
import { useVoiceInput } from '../voice/useVoiceInput'

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

// 语音输入：录音期间不动编辑器，实时转写显示在卡片底部的浮条里；点「完成」才把
// 整段文本（可选先过一遍 AI 纠错）插到光标处——避免边识别边插还要追踪位置替换
const voice = useVoiceInput()
const voiceCorrecting = ref(false)
const voiceError = ref('')
let voiceErrorTimer = null

function showVoiceError(msg) {
  voiceError.value = msg
  clearTimeout(voiceErrorTimer)
  voiceErrorTimer = setTimeout(() => (voiceError.value = ''), 5000)
}

// 识别服务自己出错终止时（权限拒绝、环境不支持等）没有经过 toggleVoice 的
// stop 流程，这里兜住把错误浮到卡片头部
watch(voice.error, (msg) => {
  if (msg) showVoiceError(msg)
})

function startVoice() {
  if (!voice.supported) {
    showVoiceError('此浏览器不支持语音识别，请用 Chrome / Edge')
    return
  }
  if (voiceCorrecting.value || voice.recording.value) return
  voice.start(settings.voiceLang)
}

async function finishVoice() {
  if (!voice.recording.value || voiceCorrecting.value) return
  const raw = (await voice.stop()).trim()
  if (!raw) return
  let text = raw
  if (settings.voiceCorrect && aiSettings.hasApiKey) {
    voiceCorrecting.value = true
    try {
      // 卡片已有文本随转写一起送去，让 AI 统一术语/人名拼写（Typeless 的上下文感知）
      const context = editor.value ? editor.value.getText({ blockSeparator: '\n' }) : ''
      text = (await correctVoiceText(raw, context)).trim() || raw
    } catch (e) {
      console.error(e)
      // 纠错挂了不吞用户的话——照插原始转写，只提示纠错没成
      showVoiceError(`AI 纠错失败，已插入原始转写：${e?.message || ''}`)
    } finally {
      voiceCorrecting.value = false
    }
  }
  insertDictation(text)
}

// AI 可能把口述整理成多行（列表/分段），多行按段落插入；单行直接接在光标处
function insertDictation(text) {
  if (!editor.value) return
  const lines = text.split('\n')
  const content =
    lines.length === 1
      ? text
      : lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' }))
  editor.value.chain().focus().insertContent(content).run()
}

// 仿 Typeless 的按住说话：按住超过 HOLD_MS 松开即结束并插入；快速单击当作
// 「常开」开关，再点一下（或点浮条上的按钮）结束。用 pointer capture 保证
// 按住时指针滑出按钮外松开也能收到 up。
const HOLD_MS = 400
let pressAt = 0
function onMicDown(e) {
  if (voiceCorrecting.value) return
  e.target.setPointerCapture?.(e.pointerId)
  if (!voice.recording.value) {
    pressAt = Date.now()
    startVoice()
  } else {
    pressAt = 0 // 常开状态下这次按下是为了停止，松开时结束
  }
}
function onMicUp() {
  if (!voice.recording.value) return
  if (pressAt && Date.now() - pressAt < HOLD_MS) return // 快速单击 → 保持常开
  finishVoice()
}

function cancelVoice() {
  voice.cancel()
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

// issue #1 的第三条漏网路径：只要这次复制不是 ProseMirror 亲手处理的，浏览器
// 默认的 HTML→文本转换就会给每个 <p> 之间补一个空行。PM 不接管的情况有两类：
// 选区端点落在编辑器 DOM 之外（从卡片头部/正文四周 padding 拖选），或 DOM 选区
// 还没同步进 PM 内部状态（state.selection 仍是空的，PM 的 copy 处理器直接早退）。
// 在卡片根元素捕获 copy 兜底：PM 能正常处理就放行；否则把 DOM 选区端点收敛映射
// 回编辑器文档，仍走 serializeSlice 这个唯一出口输出单换行纯文本。
function onCopyCapture(e) {
  const view = editor.value?.view
  if (!view || !e.clipboardData) return
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return
  const dom = view.dom
  const bothIn = dom.contains(sel.anchorNode) && dom.contains(sel.focusNode)
  if (bothIn && !view.state.selection.empty) return // PM 自己会用 clipboardTextSerializer 处理
  const range = sel.getRangeAt(0)
  if (!range.intersectsNode(dom)) return
  let from = 0
  let to = view.state.doc.content.size
  try {
    if (dom.contains(range.startContainer)) from = view.posAtDOM(range.startContainer, range.startOffset)
    if (dom.contains(range.endContainer)) to = view.posAtDOM(range.endContainer, range.endOffset)
  } catch {
    // posAtDOM 对不上就退回整篇文档，宁可多复制也不能输出带空行的脏文本
  }
  if (from >= to) return
  const slice = view.state.doc.slice(from, to)
  e.clipboardData.setData('text/plain', serializeSlice(slice, pathStyle.value))
  e.preventDefault()
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
      // Windows CF_HTML 包装（<html>\n<body>\n<!--StartFragment-->…）在 body/fragment
      // 边界带字面换行；片段一旦带 data-pm-slice（即应用内复制），PM 会用
      // preserveWhitespace:'full' 解析整个 HTML，这些换行就成了粘贴内容前后的空段落
      // （<p><br><br></p>，trimPastedBlankLines 认不出）。解析前只留 fragment 部分即可
      // 根治；无 fragment 注释时退回剥标签紧邻换行。外部来源 HTML 走空白折叠，不受影响。
      transformPastedHTML: (html) => {
        const m = html.match(/<!--StartFragment-->([\s\S]*)<!--EndFragment-->/)
        if (m) return m[1]
        return html
          .replace(/(<(?:html|body)[^>]*>)[\r\n]+/gi, '$1')
          .replace(/[\r\n]+(<\/(?:html|body)>)/gi, '$1')
      },
      transformPasted: (slice) => trimPastedBlankLines(slice),
      // 原生 Ctrl+C 复制也走跟「复制」按钮一致的纯文本序列化，否则 PM 默认用 '\n\n'
      // 连段落，粘进终端每行多一空行（issue #1）。pathStyle.value 在复制那一刻取现值。
      clipboardTextSerializer: (slice) => serializeSlice(slice, pathStyle.value),
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
  clearTimeout(voiceErrorTimer)
  voice.cancel()
  resizeOb?.disconnect()
  editor.value?.destroy()
})
</script>

<template>
  <article class="card" :class="{ pinned: card.pinned }" @copy.capture="onCopyCapture">
    <header class="card-head">
      <span class="meta">{{ fmtTime(card.createdAt) }}</span>
      <span v-if="card.pinned" class="meta pin-mark">置顶</span>
      <span v-if="uploading" class="meta busy">上传中…</span>
      <span v-if="uploadError" class="meta upload-error">{{ uploadError }}</span>
      <span v-if="polishError" class="meta upload-error">{{ polishError }}</span>
      <span v-if="voiceError" class="meta upload-error">{{ voiceError }}</span>
      <span class="spacer"></span>
      <span v-if="charCount" class="meta">{{ charCount }} 字</span>
      <button
        class="btn quiet voice-btn"
        :class="{ recording: voice.recording.value }"
        :disabled="voiceCorrecting"
        :title="voice.recording.value ? '再点一下结束并插入' : '按住说话，松开插入；单击切换常开'"
        @pointerdown="onMicDown"
        @pointerup="onMicUp"
        @pointercancel="onMicUp"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
        {{ voice.recording.value ? '录音中' : '语音' }}
      </button>
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
    <div v-if="voice.recording.value || voiceCorrecting" class="voice-bar">
      <span class="voice-dot" :class="{ thinking: voiceCorrecting }"></span>
      <span v-if="voiceCorrecting" class="voice-live">AI 纠错中…</span>
      <span v-else class="voice-live">
        {{ voice.finals.value }}<i class="voice-interim">{{ voice.interim.value }}</i>
        <span v-if="!voice.finals.value && !voice.interim.value" class="voice-interim">正在听，请说话…</span>
      </span>
      <template v-if="!voiceCorrecting">
        <button class="btn quiet voice-done" @click="finishVoice">完成并插入</button>
        <button class="btn quiet danger" @click="cancelVoice">取消</button>
      </template>
    </div>
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
