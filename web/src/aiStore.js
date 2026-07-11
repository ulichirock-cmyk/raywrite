import { reactive } from 'vue'
import { getSettings } from './api'

// 是否配置了 DeepSeek / SiliconFlow API Key，全局共享——「AI 整理」按钮和语音
// 输入都要看这个状态，只在 App 挂载时和设置面板保存后刷新一次
export const aiSettings = reactive({ hasApiKey: false, hasAsrKey: false })

export async function refreshAiSettings() {
  try {
    const s = await getSettings()
    aiSettings.hasApiKey = Boolean(s.hasApiKey)
    aiSettings.hasAsrKey = Boolean(s.hasAsrKey)
  } catch {}
}
