<script setup>
import { ref, computed, onBeforeUnmount } from 'vue'
import { dateKey } from '../date'

const props = defineProps({
  modelValue: { type: String, default: null },
  markedDates: { type: Set, default: () => new Set() },
})
const emit = defineEmits(['update:modelValue'])

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 「今天」不能在创建时固化：Electron 托盘保活会常驻数天，跨天后固化值就错了
// （今日高亮停在昨天、「今天」按钮跳去昨天），定时探测日期变更保持新鲜
const now = ref(new Date())
const dayTimer = setInterval(() => {
  const d = new Date()
  if (dateKey(d) !== dateKey(now.value)) now.value = d
}, 30 * 1000)
onBeforeUnmount(() => clearInterval(dayTimer))
const todayKey = computed(() => dateKey(now.value))
const view = ref({ year: now.value.getFullYear(), month: now.value.getMonth() })

const cells = computed(() => {
  const { year, month } = view.value
  const startOffset = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const p = (n) => String(n).padStart(2, '0')
  const list = Array(startOffset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    list.push({ day: d, key: `${year}-${p(month + 1)}-${p(d)}` })
  }
  return list
})

function shiftMonth(delta) {
  let { year, month } = view.value
  month += delta
  if (month < 0) {
    month = 11
    year -= 1
  } else if (month > 11) {
    month = 0
    year += 1
  }
  view.value = { year, month }
}

function pick(cell) {
  if (!cell) return
  emit('update:modelValue', props.modelValue === cell.key ? null : cell.key)
}

function goToday() {
  const t = new Date()
  now.value = t
  view.value = { year: t.getFullYear(), month: t.getMonth() }
  emit('update:modelValue', dateKey(t))
}
</script>

<template>
  <div class="calendar">
    <div class="cal-head">
      <button class="cal-nav" @click="shiftMonth(-1)">‹</button>
      <span class="cal-title">{{ view.year }}年{{ view.month + 1 }}月</span>
      <button class="cal-nav" @click="shiftMonth(1)">›</button>
    </div>
    <div class="cal-weekdays">
      <span v-for="w in WEEKDAYS" :key="w">{{ w }}</span>
    </div>
    <div class="cal-grid">
      <button
        v-for="(cell, i) in cells"
        :key="i"
        class="cal-cell"
        :class="{
          empty: !cell,
          selected: cell && cell.key === modelValue,
          today: cell && cell.key === todayKey,
          marked: cell && markedDates.has(cell.key),
        }"
        :disabled="!cell"
        @click="pick(cell)"
      >
        {{ cell?.day }}
      </button>
    </div>
    <div class="cal-foot">
      <button class="btn quiet" @click="goToday">今天</button>
      <button v-if="modelValue" class="btn quiet" @click="emit('update:modelValue', null)">
        显示全部
      </button>
    </div>
  </div>
</template>
