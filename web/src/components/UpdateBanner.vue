<script setup>
// Electron 壳的自动更新提示：右下角悬浮条，不遮内容、不抢焦点、不弹模态框。
// 状态全部来自主进程 IPC 推送（electron/updater.mjs 的 broadcast）——纯浏览器模式下
// window.agentText 不存在，组件直接不渲染。
import { onBeforeUnmount, onMounted, ref } from 'vue'

const updater = typeof window !== 'undefined' ? window.agentText?.updater : null
const status = ref({ phase: 'idle' })
const restarting = ref(false)
let unsub = null

// 纯浏览器开发模式下没有 window.agentText（那是 Electron preload 才注入的），
// 但又想不靠真实 GitHub release 就预览这条提示条——开一个仅 DEV 生效的调试钩子。
// import.meta.env.DEV 在 `vite build` 产物里是编译期常量 false，这整段连同判断
// 会被摇树删掉，不会进生产包。
const devMock = import.meta.env.DEV && !updater

onMounted(async () => {
  if (devMock) {
    window.__mockUpdateStatus = (s) => (status.value = s)
    console.info(
      '[UpdateBanner] 开发调试：window.__mockUpdateStatus({phase:"downloading",version:"0.2.0",progress:0.4}) 之类来预览各状态'
    )
    return
  }
  if (!updater) return
  try {
    const s = await updater.getStatus()
    if (s) status.value = s
  } catch {}
  unsub = updater.onStatus((s) => (status.value = s))
})

onBeforeUnmount(() => unsub?.())

async function restart() {
  if (restarting.value) return
  if (devMock) {
    console.info('[UpdateBanner] mock: restart() called')
    status.value = { phase: 'idle' }
    return
  }
  restarting.value = true
  try {
    await updater.restart()
  } catch {
    restarting.value = false
  }
}

function openDownload() {
  if (devMock) {
    console.info('[UpdateBanner] mock: openDownloadPage() called')
    return
  }
  updater.openDownloadPage()
}

// 「稍后」：仅隐藏本地提示，已下载好的更新仍会在下次退出应用时自动落地
function dismiss() {
  status.value = { phase: 'idle' }
}
</script>

<template>
  <Transition name="update-toast">
    <div
      v-if="(updater || devMock) && status.phase !== 'idle'"
      class="update-toast"
      :class="status.phase"
    >
      <template v-if="status.phase === 'checking'">
        <span class="update-spinner" />
        <span class="update-text">正在检查更新…</span>
      </template>

      <template v-else-if="status.phase === 'downloading'">
        <span class="update-spinner" />
        <span class="update-text">
          正在下载更新 v{{ status.version }}
          <span v-if="status.progress != null" class="update-pct"
            >{{ Math.round(status.progress * 100) }}%</span
          >
        </span>
        <span class="update-bar"
          ><span class="update-bar-fill" :style="{ width: (status.progress ?? 0) * 100 + '%' }"
        /></span>
      </template>

      <template v-else-if="status.phase === 'ready'">
        <span class="update-dot" />
        <span class="update-text">新版本 v{{ status.version }} 已就绪</span>
        <button class="btn primary update-action" :disabled="restarting" @click="restart">
          {{ restarting ? '重启中…' : '立即重启' }}
        </button>
        <button class="update-close" title="稍后" @click="dismiss">×</button>
      </template>

      <template v-else-if="status.phase === 'manual'">
        <span class="update-dot" />
        <span class="update-text">新版本 v{{ status.version }} 可用</span>
        <button class="btn primary update-action" @click="openDownload">打开下载页</button>
        <button class="update-close" title="稍后" @click="dismiss">×</button>
      </template>

      <template v-else-if="status.phase === 'up-to-date'">
        <span class="update-dot ok" />
        <span class="update-text">已是最新版本</span>
      </template>

      <template v-else-if="status.phase === 'error'">
        <span class="update-dot err" />
        <span class="update-text">{{ status.message || '更新出错' }}</span>
        <button class="update-close" title="关闭" @click="dismiss">×</button>
      </template>
    </div>
  </Transition>
</template>
