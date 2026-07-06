<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import Card from './components/Card.vue'
import Calendar from './components/Calendar.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import UpdateBanner from './components/UpdateBanner.vue'
import { loadCards, saveCards, saveCardsBeacon } from './api'
import { pathStyle, togglePathStyle } from './pathStyleStore'
import { settings, FONT_STACKS } from './settingsStore'
import { refreshAiSettings } from './aiStore'
import { dateKey } from './date'

const cards = ref([])
const loaded = ref(false)
const selectedDate = ref(null)
const searchQuery = ref('')

// 日历侧边栏整体隐藏/展开（#2）：默认隐藏，正文占满全宽；顶栏小按钮切换，
// 状态记 localStorage。隐藏时若有日期筛选，按钮上带出日期免得忘了正被过滤。
const CAL_OPEN_KEY = 'agentText.calOpen'
const calOpen = ref(localStorage.getItem(CAL_OPEN_KEY) === 'true')
function toggleCal() {
  calOpen.value = !calOpen.value
  localStorage.setItem(CAL_OPEN_KEY, String(calOpen.value))
}
let saveTimer = null
let dirty = false

// 空卡片只是待写的展示位，没内容就不落盘——存量数据里只留用户真正写过的卡片
const persistable = (list) => list.filter((c) => c.text)

function scheduleSave() {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    dirty = false
    await saveCards(persistable(cards.value))
  }, 600)
}

function flushOnHide() {
  if (dirty) saveCardsBeacon(persistable(cards.value))
}

function makeEmptyCard(createdAt) {
  return {
    id: 'c_' + Math.random().toString(36).slice(2, 10),
    createdAt,
    pinned: false,
    doc: null,
    text: '',
  }
}

// 新卡片刚创建时是空的，不用落盘（persistable 也会自动过滤掉）——
// 真正写了字之后 onChange 才会触发 scheduleSave
function newCard() {
  cards.value.unshift(makeEmptyCard(new Date().toISOString()))
}

// 某天空卡片数不够 3 张就补齐——点进任何一天都有地方可写，不会看到空页面，
// 相当于给每天预置几张空白卡片当模板。这些补的都是空卡片，不落盘
const MIN_EMPTY_PER_DAY = 3
function ensureEmptyCards(day) {
  const dayCards = cards.value.filter((c) => dateKey(c.createdAt) === day)
  const emptyCount = dayCards.filter((c) => !c.text).length
  const need = MIN_EMPTY_PER_DAY - emptyCount
  if (need <= 0) return
  const [y, m, d] = day.split('-').map(Number)
  for (let i = 0; i < need; i++) {
    // 分钟位用「已有卡片数 + i」错开，避免多次补齐时新卡片时间戳撞在一起
    cards.value.unshift(makeEmptyCard(new Date(y, m - 1, d, 9, dayCards.length + i).toISOString()))
  }
}

// 日历圆点只标「真写了内容」的天，空白预置卡片不占位，否则点开哪天都会亮点
const markedDates = computed(
  () => new Set(cards.value.filter((c) => c.text).map((c) => dateKey(c.createdAt)))
)

// 卡片正文字体设置 → CSS 变量，.editor-body 消费
const cardFontVars = computed(() => ({
  '--card-font': FONT_STACKS[settings.fontFamily] || FONT_STACKS.mono,
  '--card-font-size': settings.fontSize + 'px',
}))

// 搜索是全局的：不管当前选没选日期，都在全部卡片里按文本子串匹配，
// 结果靠卡片自带的时间戳（07-03 20:55）定位是哪天写的，不用额外加日期标签
const sorted = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const list = q
    ? cards.value.filter((c) => c.text && c.text.toLowerCase().includes(q))
    : selectedDate.value
      ? cards.value.filter((c) => dateKey(c.createdAt) === selectedDate.value)
      : cards.value
  return [...list].sort(
    (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt)
  )
})

function onChange(card, { doc, text }) {
  card.doc = doc
  card.text = text
  scheduleSave()
}

function onDelete(card) {
  cards.value = cards.value.filter((c) => c.id !== card.id)
  scheduleSave()
}

// 删除过渡：卡片高度塌缩到 0 并抵消列表 gap，让下方卡片被文档流平滑带上来
function cardLeave(el, done) {
  el.style.height = el.offsetHeight + 'px'
  el.style.overflow = 'hidden'
  void el.offsetHeight // 强制回流，让显式高度先落地，后面的改动才走过渡
  el.style.transition = 'height 0.22s ease, margin-bottom 0.22s ease, opacity 0.16s ease'
  el.style.height = '0'
  el.style.marginBottom = '-14px' // 抵消 .cards 的 gap: 14px
  el.style.opacity = '0'
  setTimeout(done, 240)
}

function onTogglePin(card) {
  card.pinned = !card.pinned
  scheduleSave()
}

onMounted(async () => {
  refreshAiSettings()
  try {
    const data = await loadCards()
    cards.value = data.cards || []
  } catch (e) {
    console.error(e)
  }
  if (!cards.value.length) ensureEmptyCards(dateKey(new Date()))
  loaded.value = true
  window.addEventListener('pagehide', flushOnHide)
})

onBeforeUnmount(() => window.removeEventListener('pagehide', flushOnHide))

watch(selectedDate, (day) => {
  if (day && loaded.value) ensureEmptyCards(day)
})
</script>

<template>
  <div class="layout" :style="cardFontVars">
    <aside class="sidebar" :class="{ hidden: !calOpen }">
      <Calendar v-model="selectedDate" :marked-dates="markedDates" />
    </aside>

    <div class="page">
      <header class="topbar">
        <span class="topbar-left">
          <button
            class="btn quiet cal-toggle"
            :class="{ active: calOpen }"
            :title="calOpen ? '隐藏日历' : '展开日历'"
            @click="toggleCal"
          >
            📅<span v-if="!calOpen && selectedDate" class="cal-toggle-date">{{
              selectedDate.slice(5).replace('-', '/')
            }}</span>
          </button>
          <span class="brand-name">Ray Write</span>
        </span>
        <span class="topbar-actions">
          <span class="search-box">
            <input v-model="searchQuery" type="text" class="search-input" placeholder="搜索卡片…" />
            <button v-if="searchQuery" class="search-clear" title="清空" @click="searchQuery = ''">
              ×
            </button>
          </span>
          <button
            class="btn quiet path-style"
            :title="`复制出的路径风格：${pathStyle === 'win' ? 'Windows（C:\\...）' : 'WSL（/mnt/c/...）'}，点击切换`"
            @click="togglePathStyle"
          >
            {{ pathStyle === 'win' ? 'Win' : 'WSL' }}
          </button>
          <SettingsPanel />
          <button class="btn primary" @click="newCard">＋ 新建输入框</button>
        </span>
      </header>

      <main v-if="loaded" class="cards">
        <p v-if="searchQuery.trim() && !sorted.length" class="empty-hint">没有找到匹配的卡片</p>
        <p v-else-if="selectedDate && !sorted.length" class="empty-hint">这天没有卡片</p>
        <TransitionGroup :css="false" @leave="cardLeave">
          <Card
            v-for="c in sorted"
            :key="c.id"
            :card="c"
            @change="(p) => onChange(c, p)"
            @delete="onDelete(c)"
            @toggle-pin="onTogglePin(c)"
          />
        </TransitionGroup>
      </main>
    </div>
  </div>

  <UpdateBanner />
</template>
