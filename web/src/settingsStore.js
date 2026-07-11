import { reactive, watch } from 'vue'

// 全局界面设置，localStorage 持久化。字体只影响卡片正文（.editor-body 的 CSS 变量，
// App.vue 注入），不改序列化输出；collapseLong 控制长卡片是否折叠显示。
const KEY = 'agentText.settings'
const defaults = {
  fontFamily: 'mono',
  fontSize: 15,
  collapseLong: false,
  // 语音输入：转写完成后是否过一遍 AI 纠错（同音字/标点/赘词），及识别语言
  voiceCorrect: true,
  voiceLang: 'zh-CN',
}

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...defaults }
  }
}

export const settings = reactive(load())
watch(settings, (v) => localStorage.setItem(KEY, JSON.stringify(v)))

export const VOICE_LANG_OPTIONS = [
  { key: 'zh-CN', label: '中文' },
  { key: 'en-US', label: 'English' },
]

export const FONT_OPTIONS = [
  { key: 'mono', label: '等宽' },
  { key: 'sans', label: '黑体' },
  { key: 'serif', label: '宋体' },
]

export const FONT_STACKS = {
  mono: "'0xProto Nerd Font Mono', 'JetBrains Mono', ui-monospace, Consolas, monospace",
  sans: "system-ui, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', SimSun, serif",
}
