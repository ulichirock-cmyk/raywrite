import { ref, watch } from 'vue'

// 全局序列化路径风格：'win'（C:\...）| 'wsl'（/mnt/c/...），默认 win，localStorage 持久化。
// serialize.js 是文件的唯一转换出口，这里只管状态；文件本身始终存原生格式（Windows 盘）。
const KEY = 'agentText.pathStyle'
const saved = localStorage.getItem(KEY)
export const pathStyle = ref(saved === 'wsl' ? 'wsl' : 'win')

watch(pathStyle, (v) => localStorage.setItem(KEY, v))

export function togglePathStyle() {
  pathStyle.value = pathStyle.value === 'win' ? 'wsl' : 'win'
}
