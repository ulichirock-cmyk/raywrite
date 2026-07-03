<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import Card from './components/Card.vue'
import Calendar from './components/Calendar.vue'
import { loadCards, saveCards, saveCardsBeacon } from './api'
import { pathStyle, togglePathStyle } from './pathStyleStore'
import { dateKey } from './date'

const cards = ref([])
const loaded = ref(false)
const selectedDate = ref(null)
let saveTimer = null
let dirty = false

function scheduleSave() {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    dirty = false
    await saveCards(cards.value)
  }, 600)
}

function flushOnHide() {
  if (dirty) saveCardsBeacon(cards.value)
}

function newCard() {
  cards.value.unshift({
    id: 'c_' + Math.random().toString(36).slice(2, 10),
    createdAt: new Date().toISOString(),
    pinned: false,
    doc: null,
    text: '',
  })
  scheduleSave()
}

const markedDates = computed(() => new Set(cards.value.map((c) => dateKey(c.createdAt))))

const sorted = computed(() => {
  const list = selectedDate.value
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
  try {
    const data = await loadCards()
    cards.value = data.cards || []
  } catch (e) {
    console.error(e)
  }
  if (!cards.value.length) newCard()
  loaded.value = true
  window.addEventListener('pagehide', flushOnHide)
})

onBeforeUnmount(() => window.removeEventListener('pagehide', flushOnHide))
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <Calendar v-model="selectedDate" :marked-dates="markedDates" />
    </aside>

    <div class="page">
      <header class="topbar">
        <span class="brand-name">Ray Write</span>
        <span class="topbar-actions">
          <button
            class="btn quiet path-style"
            :title="`复制出的路径风格：${pathStyle === 'win' ? 'Windows（C:\\...）' : 'WSL（/mnt/c/...）'}，点击切换`"
            @click="togglePathStyle"
          >
            {{ pathStyle === 'win' ? 'Win' : 'WSL' }}
          </button>
          <button class="btn primary" @click="newCard">＋ 新建输入框</button>
        </span>
      </header>

      <main v-if="loaded" class="cards">
        <p v-if="selectedDate && !sorted.length" class="empty-hint">这天没有卡片</p>
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
</template>
