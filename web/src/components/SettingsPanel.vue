<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { settings, FONT_OPTIONS, VOICE_LANG_OPTIONS, VOICE_ENGINE_OPTIONS } from '../settingsStore'
import { keyFromCode, formatAccelerator } from '../shortcutKeys'
import { aiSettings, refreshAiSettings } from '../aiStore'
import { saveApiKey, saveAsrApiKey } from '../api'

const open = ref(false)
const root = ref(null)

function onDocClick(e) {
  if (open.value && root.value && !root.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

// 全局热键：只有 Electron 壳（preload 注入了 window.agentText）才有。开发模式下
// 浏览器里没有这个桥，用一个内存态的假实现顶上方便预览录制交互；生产构建里
// import.meta.env.DEV 是编译期常量 false，这段连同判断会被摇树删掉
const realShortcutApi = typeof window !== 'undefined' ? window.agentText?.shortcut : null
let mockAccelerator = 'Control+Shift+Space'
const devMockShortcutApi =
  import.meta.env.DEV && !realShortcutApi
    ? {
        get: async () => mockAccelerator,
        set: async (accelerator) => {
          // 故意用这个组合当"注册失败"的测试路径（Escape 会被录制逻辑拦成"取消"，
          // 所以这里选一个真的能录进来的组合）
          if (accelerator === 'Control+Shift+F1') return { ok: false, accelerator: mockAccelerator }
          mockAccelerator = accelerator
          console.info('[SettingsPanel] mock: shortcut ->', accelerator)
          return { ok: true, accelerator }
        },
      }
    : null
const shortcutApi = realShortcutApi || devMockShortcutApi
const shortcut = ref('')
const recording = ref(false)
const shortcutError = ref(false)

onMounted(async () => {
  if (!shortcutApi) return
  try {
    shortcut.value = await shortcutApi.get()
  } catch {}
})

function startRecording() {
  if (!shortcutApi || recording.value) return
  recording.value = true
  shortcutError.value = false
  window.addEventListener('keydown', onRecordKey, true)
}

function stopRecording() {
  recording.value = false
  window.removeEventListener('keydown', onRecordKey, true)
}

async function onRecordKey(e) {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopRecording()
    return
  }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return // 光按住修饰键不算，等主键

  const mods = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  const key = keyFromCode(e.code)
  // 要求至少一个修饰键，否则全局热键会把这个键在所有程序里都吃掉
  if (!mods.length || !key) {
    shortcutError.value = true
    stopRecording()
    return
  }

  stopRecording()
  const accelerator = [...mods, key].join('+')
  const res = await shortcutApi.set(accelerator)
  shortcut.value = res.accelerator
  shortcutError.value = !res.ok
}

// API Key 保存后不回显——只告诉你「已设置」，输入框留空就是不改动
const apiKeyInput = ref('')
const apiKeySaving = ref(false)
const apiKeySaved = ref(false)

async function onSaveApiKey() {
  const key = apiKeyInput.value.trim()
  if (!key || apiKeySaving.value) return
  apiKeySaving.value = true
  try {
    await saveApiKey(key)
    await refreshAiSettings()
    apiKeyInput.value = ''
    apiKeySaved.value = true
    setTimeout(() => (apiKeySaved.value = false), 1600)
  } catch (e) {
    console.error(e)
  } finally {
    apiKeySaving.value = false
  }
}

// 清除已保存的 Key（传空串给后端 = 删除），否则填错后只能手改 data/settings.json
async function onClearApiKey() {
  if (apiKeySaving.value) return
  apiKeySaving.value = true
  try {
    await saveApiKey('')
    await refreshAiSettings()
    apiKeyInput.value = ''
  } catch (e) {
    console.error(e)
  } finally {
    apiKeySaving.value = false
  }
}

// SiliconFlow Key（云端语音转写用），交互与 DeepSeek Key 完全一致
const asrKeyInput = ref('')
const asrKeySaving = ref(false)
const asrKeySaved = ref(false)

async function onSaveAsrKey() {
  const key = asrKeyInput.value.trim()
  if (!key || asrKeySaving.value) return
  asrKeySaving.value = true
  try {
    await saveAsrApiKey(key)
    await refreshAiSettings()
    asrKeyInput.value = ''
    asrKeySaved.value = true
    setTimeout(() => (asrKeySaved.value = false), 1600)
  } catch (e) {
    console.error(e)
  } finally {
    asrKeySaving.value = false
  }
}

async function onClearAsrKey() {
  if (asrKeySaving.value) return
  asrKeySaving.value = true
  try {
    await saveAsrApiKey('')
    await refreshAiSettings()
    asrKeyInput.value = ''
  } catch (e) {
    console.error(e)
  } finally {
    asrKeySaving.value = false
  }
}
</script>

<template>
  <span ref="root" class="settings-root">
    <button class="btn quiet settings-btn" title="设置" @click="open = !open">
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
    </button>

    <div v-if="open" class="settings-panel">
      <div class="settings-title">设置</div>

      <div class="settings-item">
        <label>卡片字体</label>
        <div class="seg">
          <button
            v-for="o in FONT_OPTIONS"
            :key="o.key"
            class="seg-btn"
            :class="{ on: settings.fontFamily === o.key }"
            @click="settings.fontFamily = o.key"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <div class="settings-item">
        <label>字号 {{ settings.fontSize }}px</label>
        <input v-model.number="settings.fontSize" type="range" min="12" max="20" step="1" />
      </div>

      <div class="settings-item row">
        <label>长卡片折叠</label>
        <input v-model="settings.collapseLong" type="checkbox" />
      </div>
      <p class="settings-hint">开启后过长的卡片会折叠显示，底部可展开/收起。</p>

      <div class="settings-item">
        <label>语音识别引擎</label>
        <div class="seg">
          <button
            v-for="o in VOICE_ENGINE_OPTIONS"
            :key="o.key"
            class="seg-btn"
            :class="{ on: settings.voiceEngine === o.key }"
            @click="settings.voiceEngine = o.key"
          >
            {{ o.label }}
          </button>
        </div>
      </div>
      <p class="settings-hint">
        自动 = 浏览器里用内置识别（实时转写，仅 Chrome/Edge），Electron 客户端里用云端 API
        （录完整段再转写，需下方 SiliconFlow Key）。
      </p>

      <div class="settings-item">
        <label>语音输入识别语言</label>
        <div class="seg">
          <button
            v-for="o in VOICE_LANG_OPTIONS"
            :key="o.key"
            class="seg-btn"
            :class="{ on: settings.voiceLang === o.key }"
            @click="settings.voiceLang = o.key"
          >
            {{ o.label }}
          </button>
        </div>
      </div>

      <div class="settings-item row">
        <label>语音输入 AI 纠错</label>
        <input v-model="settings.voiceCorrect" type="checkbox" />
      </div>
      <p class="settings-hint">
        开启后口述先由 AI 整理成书面文本再插入：修同音字和标点、去赘词、应用口头改口
        （「不对，改成…」只留改后的说法），并参考卡片已有内容统一术语（需下方 DeepSeek Key）。
      </p>

      <div v-if="shortcutApi" class="settings-item">
        <label>全局热键（呼出窗口）</label>
        <button class="btn quiet shortcut-btn" :class="{ recording }" @click="startRecording">
          {{ recording ? '按下新组合…（Esc 取消）' : formatAccelerator(shortcut) }}
        </button>
        <p class="settings-hint" :class="{ error: shortcutError }">
          {{ shortcutError ? '这个组合注册失败，可能被其他程序占用，已还原' : '任何界面下按这个组合都能唤出窗口' }}
        </p>
      </div>

      <div class="settings-item">
        <label>DeepSeek API Key（AI 整理提示词用）</label>
        <div class="apikey-row">
          <input
            v-model="apiKeyInput"
            type="password"
            class="apikey-input"
            autocomplete="off"
            :placeholder="aiSettings.hasApiKey ? '已设置，输入新的可覆盖' : 'sk-...'"
            @keydown.enter="onSaveApiKey"
          />
          <button
            class="btn quiet apikey-save"
            :disabled="!apiKeyInput.trim() || apiKeySaving"
            @click="onSaveApiKey"
          >
            {{ apiKeySaved ? '已保存 ✓' : '保存' }}
          </button>
          <button
            v-if="aiSettings.hasApiKey"
            class="btn quiet apikey-save"
            :disabled="apiKeySaving"
            title="删除已保存的 Key"
            @click="onClearApiKey"
          >
            清除
          </button>
        </div>
        <p class="settings-hint">
          {{ aiSettings.hasApiKey ? '已配置，卡片右上角可用「AI 整理」。' : '配置后卡片才能用「AI 整理」。' }}
          Key 只存本地，不会上传。
        </p>
      </div>

      <div class="settings-item">
        <label>SiliconFlow API Key（云端语音转写用）</label>
        <div class="apikey-row">
          <input
            v-model="asrKeyInput"
            type="password"
            class="apikey-input"
            autocomplete="off"
            :placeholder="aiSettings.hasAsrKey ? '已设置，输入新的可覆盖' : 'sk-...'"
            @keydown.enter="onSaveAsrKey"
          />
          <button
            class="btn quiet apikey-save"
            :disabled="!asrKeyInput.trim() || asrKeySaving"
            @click="onSaveAsrKey"
          >
            {{ asrKeySaved ? '已保存 ✓' : '保存' }}
          </button>
          <button
            v-if="aiSettings.hasAsrKey"
            class="btn quiet apikey-save"
            :disabled="asrKeySaving"
            title="删除已保存的 Key"
            @click="onClearAsrKey"
          >
            清除
          </button>
        </div>
        <p class="settings-hint">
          Electron 客户端里语音输入必须配这个（浏览器内置识别在客户端不可用）。
          到 cloud.siliconflow.cn 注册即得，SenseVoice 转写价格极低。Key 只存本地。
        </p>
      </div>
    </div>
  </span>
</template>
