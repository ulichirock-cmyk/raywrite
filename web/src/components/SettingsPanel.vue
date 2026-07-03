<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { settings, FONT_OPTIONS } from '../settingsStore'

const open = ref(false)
const root = ref(null)

function onDocClick(e) {
  if (open.value && root.value && !root.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
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
    </div>
  </span>
</template>
