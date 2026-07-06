<script setup>
import { ref, computed } from 'vue'
import { dateKey } from '../date'

const props = defineProps({
  modelValue: { type: String, default: null },
  markedDates: { type: Set, default: () => new Set() },
})
const emit = defineEmits(['update:modelValue'])

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

const today = new Date()
const todayKey = dateKey(today)
const view = ref({ year: today.getFullYear(), month: today.getMonth() })

// 日历默认收起，只留一条窄栏——正文才是主角，需要按日期翻查时再展开。
// 收/展状态记进 localStorage，下次打开保持上次选择。
const COLLAPSE_KEY = 'agentText.calCollapsed'
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) !== 'false')
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSE_KEY, String(collapsed.value))
}

// 收起态窄栏上显示当前筛选的日期，没选就提示「日历」
const collapsedLabel = computed(() =>
  props.modelValue ? props.modelValue.replace(/-/g, '/') : '日历'
)

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
  view.value = { year: today.getFullYear(), month: today.getMonth() }
  emit('update:modelValue', todayKey)
}
</script>

<template>
  <div class="calendar" :class="{ collapsed }">
    <button
      v-if="collapsed"
      class="cal-collapsed-bar"
      title="展开日历"
      @click="toggleCollapsed"
    >
      <span class="cal-collapsed-label">📅 {{ collapsedLabel }}</span>
      <span class="cal-caret">▾</span>
    </button>
    <template v-else>
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
      <button class="btn quiet" title="收起日历" @click="toggleCollapsed">收起 ▴</button>
    </div>
    </template>
  </div>
</template>
