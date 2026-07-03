import { reactive } from 'vue'
import { getSettings } from './api'

// 是否配置了 Anthropic API Key，全局共享——每张卡片的「AI 整理」按钮都要看这个状态，
// 只在 App 挂载时和设置面板保存后刷新一次，不用每张卡片各自请求一遍
export const aiSettings = reactive({ hasApiKey: false })

export async function refreshAiSettings() {
  try {
    aiSettings.hasApiKey = Boolean((await getSettings()).hasApiKey)
  } catch {}
}
